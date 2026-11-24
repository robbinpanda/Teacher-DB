"""Read a .docx exam paper into text blocks, formulas, images and a fidelity report.

Text keeps formulas and images as placeholders (``⟦F3⟧``, ``⟦I2⟧``) so the
caller decides how to render them and can verify none were lost later.
"""
from __future__ import annotations

import base64
import io
import posixpath
import re
import shutil
import subprocess
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass, field
from xml.etree.ElementTree import Element

from defusedxml.ElementTree import fromstring
from PIL import Image

from .mtef import MtefError, equation_native, parse_mtef
from .mtef_latex import equation_latex
from .omml import M, omml_latex

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
V = "{urn:schemas-microsoft-com:vml}"
O = "{urn:schemas-microsoft-com:office:office}"
MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"
WPS = "{http://schemas.microsoft.com/office/word/2010/wordprocessingShape}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"

MAX_DOCX_BYTES = 60 * 1024 * 1024
MAX_UNCOMPRESSED = 400 * 1024 * 1024
MAX_ENTRIES = 6000
MAX_XML_BYTES = 40 * 1024 * 1024
MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_FORMULAS = 8000
MAX_ASSETS = 1500

SYMBOL_FONT = {
    0x22: "∀", 0x24: "∃", 0x27: "∍", 0x2D: "−", 0x44: "Δ", 0x46: "Φ", 0x47: "Γ", 0x4C: "Λ", 0x50: "Π",
    0x51: "Θ", 0x53: "Σ", 0x57: "Ω", 0x5E: "⊥", 0x61: "α", 0x62: "β", 0x63: "χ", 0x64: "δ", 0x65: "ε",
    0x66: "φ", 0x67: "γ", 0x68: "η", 0x69: "ι", 0x6A: "ϕ", 0x6B: "κ", 0x6C: "λ", 0x6D: "μ", 0x6E: "ν",
    0x70: "π", 0x71: "θ", 0x72: "ρ", 0x73: "σ", 0x74: "τ", 0x75: "υ", 0x77: "ω", 0x78: "ξ", 0x79: "ψ",
    0x7A: "ζ", 0xA2: "′", 0xA3: "≤", 0xA5: "∞", 0xAB: "↔", 0xAC: "←", 0xAD: "↑", 0xAE: "→", 0xAF: "↓",
    0xB0: "°", 0xB1: "±", 0xB2: "″", 0xB3: "≥", 0xB4: "×", 0xB5: "∝", 0xB6: "∂", 0xB7: "•", 0xB8: "÷",
    0xB9: "≠", 0xBA: "≡", 0xBB: "≈", 0xBC: "…", 0xC6: "∅", 0xC7: "∩", 0xC8: "∪", 0xC9: "⊃", 0xCA: "⊇",
    0xCB: "⊄", 0xCC: "⊂", 0xCD: "⊆", 0xCE: "∈", 0xCF: "∉", 0xD0: "∠", 0xD6: "√", 0xD7: "⋅", 0xD8: "¬",
    0xD9: "∧", 0xDA: "∨", 0xDB: "⇔", 0xDC: "⇐", 0xDE: "⇒", 0xE0: "◊", 0xE5: "∑", 0xF2: "∫", 0xBD: "|",
}
RASTER = {"png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg", "gif": "image/gif", "bmp": "image/bmp",
          "tif": "image/tiff", "tiff": "image/tiff", "wmf": "image/wmf", "emf": "image/emf", "wdp": "image/vnd.ms-photo"}
CHINESE_DIGITS = "零一二三四五六七八九"
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"


class DocxError(ValueError):
    pass


@dataclass
class Formula:
    id: str
    source: str  # mathtype, omml, text_script, blank
    latex: str
    display: bool = False
    status: str = "converted"  # converted, review
    problems: list[str] = field(default_factory=list)
    preview: str | None = None  # asset id of the original rendering

    def as_json(self) -> dict:
        return {"id": self.id, "source": self.source, "latex": self.latex, "display": self.display,
                "status": self.status, "problems": self.problems, "preview": self.preview}


@dataclass
class Asset:
    id: str
    role: str  # image, formula_image, formula_preview, object_preview
    mime: str
    data: bytes
    width: int
    height: int
    display: tuple[float, float] | None = None  # size in points as laid out in Word

    def as_json(self) -> dict:
        return {"id": self.id, "role": self.role, "mime": self.mime, "width": self.width, "height": self.height,
                "displayWidth": round(self.display[0], 1) if self.display else None,
                "displayHeight": round(self.display[1], 1) if self.display else None,
                "base64": base64.b64encode(self.data).decode("ascii")}


@dataclass
class Report:
    paragraphs: int = 0
    tables: int = 0
    images: int = 0
    formula_images: int = 0
    positioned_pictures: int = 0
    page_pictures: int = 0
    inline_pictures: int = 0
    images_unreadable: int = 0
    object_previews: int = 0
    numbered_paragraphs: int = 0
    text_boxes: int = 0
    unsupported: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def note(self, kind: str) -> None:
        self.unsupported[kind] = self.unsupported.get(kind, 0) + 1

    def warn(self, message: str) -> None:
        if message not in self.warnings and len(self.warnings) < 50:
            self.warnings.append(message)


def _children(element: Element, tag: str) -> list[Element]:
    return [child for child in element if child.tag == tag]


def _attr(element: Element | None, name: str, default: str = "") -> str:
    if element is None:
        return default
    return element.get(W + name, default)


class DocxReader:
    def __init__(self, data: bytes):
        if len(data) > MAX_DOCX_BYTES:
            raise DocxError("Word 文件超过 60 MB")
        try:
            self.zip = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile as exc:
            raise DocxError("不是有效的 .docx 文件（旧版 .doc 请先在 Word 中另存为 .docx）") from exc
        infos = self.zip.infolist()
        if len(infos) > MAX_ENTRIES or sum(info.file_size for info in infos) > MAX_UNCOMPRESSED:
            raise DocxError("Word 文件解压后过大")
        self.names = {info.filename for info in infos}
        if "word/document.xml" not in self.names:
            raise DocxError("不是有效的 .docx 文件：缺少 word/document.xml")
        self.rels = self._relationships("word/_rels/document.xml.rels")
        self.formulas: list[Formula] = []
        self.assets: list[Asset] = []
        self.asset_by_target: dict[tuple[str, str], str] = {}
        self.report = Report()
        self.floating: list[str] = []
        self.numbering = _Numbering(self._xml("word/numbering.xml"), self._xml("word/styles.xml"))

    # Package helpers -------------------------------------------------------
    def _read(self, name: str, limit: int = MAX_XML_BYTES) -> bytes:
        info = self.zip.getinfo(name)
        if info.file_size > limit:
            raise DocxError(f"{name} 过大")
        return self.zip.read(name)

    def _xml(self, name: str) -> Element | None:
        if name not in self.names:
            return None
        return fromstring(self._read(name))

    def _relationships(self, name: str) -> dict[str, str]:
        root = self._xml(name)
        rels: dict[str, str] = {}
        if root is None:
            return rels
        for rel in root.iter(PKG_REL + "Relationship"):
            if rel.get("TargetMode") == "External":
                continue
            target = rel.get("Target", "")
            path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join("word", target))
            if path.startswith("../") or path not in self.names:
                continue
            rels[rel.get("Id", "")] = path
        return rels

    # Entry -----------------------------------------------------------------
    def read(self) -> dict:
        root = self._xml("word/document.xml")
        body = root.find(W + "body") if root is not None else None
        if body is None:
            raise DocxError("Word 文档结构无效：缺少正文")
        blocks: list[dict] = []
        for child in body:
            self._block(child, blocks)
        formulas = [formula.as_json() for formula in self.formulas]
        by_status: dict[str, dict[str, int]] = {}
        for formula in self.formulas:
            if formula.source in ("text_script", "blank"):
                continue
            entry = by_status.setdefault(formula.source, {"converted": 0, "review": 0})
            entry[formula.status] += 1
        report = self.report
        return {
            "version": 1,
            "blocks": blocks,
            "formulas": formulas,
            "assets": [asset.as_json() for asset in self.assets],
            "report": {
                "paragraphs": report.paragraphs, "tables": report.tables, "images": report.images,
                "formulaImages": report.formula_images,
                "layout": "positioned" if _positioned_layout(report) else "flow",
                "positionedPictures": report.positioned_pictures,
                "imagesUnreadable": report.images_unreadable, "objectPreviews": report.object_previews,
                "numberedParagraphs": report.numbered_paragraphs, "textBoxes": report.text_boxes,
                "formulas": by_status, "unsupported": report.unsupported, "warnings": report.warnings,
                "reviewFormulas": sum(1 for formula in self.formulas if formula.status == "review"),
            },
        }

    def _block(self, element: Element, blocks: list[dict]) -> None:
        if element.tag == W + "p":
            text = self._paragraph(element)
            if text.strip():
                blocks.append({"type": "paragraph", "text": text})
        elif element.tag == W + "tbl":
            rows = self._table(element)
            if any(cell.strip() for row in rows for cell in row):
                blocks.append({"type": "table", "rows": rows})
        elif element.tag == W + "sdt":
            content = element.find(W + "sdtContent")
            for child in content if content is not None else []:
                self._block(child, blocks)
        elif element.tag in (W + "customXml", W + "ins", W + "smartTag"):
            for child in element:
                self._block(child, blocks)
        elif element.tag == M + "oMathPara":
            token = self._omml(element, display=True)
            blocks.append({"type": "paragraph", "text": token})

    def _table(self, table: Element) -> list[list[str]]:
        self.report.tables += 1
        rows: list[list[str]] = []
        for row in self._rows(table):
            cells = []
            for cell in _children(row, W + "tc"):
                parts = []
                for child in cell:
                    if child.tag == W + "p":
                        parts.append(self._paragraph(child, count=False))
                    elif child.tag == W + "tbl":
                        nested = self._table(child)
                        parts.append(" ".join(" | ".join(r) for r in nested))
                cells.append("\n".join(part for part in parts if part.strip()))
            rows.append(cells)
        return rows

    def _rows(self, table: Element) -> list[Element]:
        rows = []
        for child in table:
            if child.tag == W + "tr":
                rows.append(child)
            elif child.tag in (W + "sdt", W + "customXml"):
                content = child.find(W + "sdtContent") if child.tag == W + "sdt" else child
                rows.extend(self._rows(content) if content is not None else [])
        return rows

    # Paragraphs ------------------------------------------------------------
    def _paragraph(self, paragraph: Element, count: bool = True) -> str:
        if count:
            self.report.paragraphs += 1
        prefix = self.numbering.prefix(paragraph)
        if prefix:
            self.report.numbered_paragraphs += 1
        pieces: list[str] = []
        outer, self.floating = self.floating, []
        try:
            self._inline(paragraph, pieces)
            if self.floating:
                pieces.append("\n" + "".join(self.floating))
        finally:
            self.floating = outer
        text = "".join(pieces)
        text = re.sub(r"[ \t\u00a0]+\n", "\n", text)
        return (prefix + " " if prefix else "") + text.strip("\n")

    def _inline(self, element: Element, pieces: list[str]) -> None:
        for child in element:
            tag = child.tag
            if tag == W + "r":
                self._run(child, pieces)
            elif tag == M + "oMath":
                pieces.append(self._omml(child, display=False))
            elif tag == M + "oMathPara":
                pieces.append(self._omml(child, display=True))
            elif tag in (W + "hyperlink", W + "ins", W + "smartTag", W + "fldSimple", W + "customXml",
                         W + "bdo", W + "dir", W + "moveTo"):
                self._inline(child, pieces)
            elif tag == W + "sdt":
                content = child.find(W + "sdtContent")
                if content is not None:
                    self._inline(content, pieces)
            elif tag == MC + "AlternateContent":
                self._inline(self._alternate(child), pieces)
            elif tag in (W + "del", W + "moveFrom", W + "pPr", W + "bookmarkStart", W + "bookmarkEnd",
                         W + "proofErr", W + "commentRangeStart", W + "commentRangeEnd", W + "permStart", W + "permEnd"):
                continue

    def _alternate(self, element: Element) -> Element:
        """Pick a representation we can read: a Choice with a picture, else the Fallback."""
        choices = _children(element, MC + "Choice")
        fallback = element.find(MC + "Fallback")
        for choice in choices:
            if any(node.tag == A + "blip" for node in choice.iter()) and not any(node.tag == WPS + "txbx" for node in choice.iter()):
                return choice
        if fallback is not None:
            return fallback
        return choices[0] if choices else element

    def _run(self, run: Element, pieces: list[str]) -> None:
        props = run.find(W + "rPr")
        vert = _attr(props.find(W + "vertAlign") if props is not None else None, "val")
        underline = props is not None and props.find(W + "u") is not None and _attr(props.find(W + "u"), "val", "single") != "none"
        hidden = props is not None and props.find(W + "vanish") is not None and _attr(props.find(W + "vanish"), "val", "1") not in ("0", "false")
        if hidden:
            return
        text_parts: list[str] = []

        def flush() -> None:
            if not text_parts:
                return
            text = "".join(text_parts)
            text_parts.clear()
            if underline and text.strip() == "" and len(text) >= 2:
                width = max(2, min(12, round(len(text) / 2)))
                pieces.append(self._formula("blank", r"\underline{\hspace{" + str(width) + "em}}"))
            elif vert in ("superscript", "subscript") and text.strip():
                script = text.strip()
                latex = ("^{" if vert == "superscript" else "_{") + _escape_script(script) + "}"
                pieces.append(self._formula("text_script", latex))
            else:
                pieces.append(text)

        for child in run:
            tag = child.tag
            if tag == W + "t":
                text_parts.append(child.text or "")
            elif tag == W + "tab" or tag == W + "ptab":
                text_parts.append(" ")
            elif tag in (W + "br", W + "cr"):
                if _attr(child, "type") != "page":
                    text_parts.append("\n")
            elif tag == W + "noBreakHyphen":
                text_parts.append("-")
            elif tag == W + "sym":
                text_parts.append(self._symbol(child))
            elif tag == W + "object":
                flush()
                pieces.append(self._object(child))
            elif tag == W + "drawing":
                flush()
                pieces.append(self._drawing(child))
            elif tag == W + "pict":
                flush()
                pieces.append(self._pict(child))
            elif tag == MC + "AlternateContent":
                flush()
                inner: list[str] = []
                self._run(_wrap_run(self._alternate(child)), inner)
                pieces.extend(inner)
        flush()

    def _symbol(self, element: Element) -> str:
        font = _attr(element, "font").lower()
        try:
            code = int(_attr(element, "char", "0"), 16)
        except ValueError:
            code = 0
        if "symbol" in font:
            char = SYMBOL_FONT.get(code & 0xFF)
            if char:
                return char
        if code and not (0xF000 <= code <= 0xF0FF):
            return chr(code)
        self.report.note(f"symbol:{font or 'unknown'}")
        self.report.warn(f"有 {font or '未知'} 字体的特殊符号无法识别，已标记待核对")
        return "�"

    # Formulas --------------------------------------------------------------
    def _formula(self, source: str, latex: str, display: bool = False, status: str = "converted",
                 problems: list[str] | None = None, preview: str | None = None) -> str:
        if len(self.formulas) >= MAX_FORMULAS:
            raise DocxError("公式数量超过上限")
        formula = Formula(id=f"F{len(self.formulas) + 1}", source=source, latex=latex, display=display,
                          status=status, problems=problems or [], preview=preview)
        self.formulas.append(formula)
        return f"⟦{formula.id}⟧"

    def _omml(self, element: Element, display: bool) -> str:
        try:
            rendered = omml_latex(element)
        except RecursionError:
            return self._formula("omml", "", display, "review", ["formula nesting too deep"])
        status = "review" if rendered.problems or not rendered.latex else "converted"
        problems = rendered.problems or ([] if rendered.latex else ["empty formula"])
        return self._formula("omml", rendered.latex, display, status, problems)

    def _object(self, obj: Element) -> str:
        ole = obj.find(f".//{O}OLEObject")
        image = obj.find(f".//{V}imagedata")
        preview_target = self.rels.get(image.get(R + "id", "")) if image is not None else None
        prog_id = (ole.get("ProgID") or "") if ole is not None else ""
        target = self.rels.get(ole.get(R + "id", "")) if ole is not None else None
        if "equation" in prog_id.lower() or "mathtype" in prog_id.lower():
            latex, problems = "", []
            if target:
                try:
                    equation = parse_mtef(equation_native(self._read(target, MAX_IMAGE_BYTES)))
                    rendered = equation_latex(equation)
                    latex, problems = rendered.latex, rendered.problems
                    if not latex:
                        problems = problems or ["empty formula"]
                    if problems and equation.tex_input:
                        # The author typed this formula as TeX; that source is exact.
                        latex, problems = equation.tex_input.strip(), []
                except MtefError as exc:
                    problems = [str(exc)]
            else:
                problems = ["embedded equation missing"]
            if not problems:
                return self._formula("mathtype", latex)
            preview = self._asset(preview_target, "formula_preview", _vml_size(obj)) if preview_target else None
            if preview is None:
                self.report.warn("有 MathType 公式无法转换且没有可用的预览图")
            return self._formula("mathtype", latex, False, "review", problems, preview)
        # Other embedded objects (charts, geometry software, Visio): keep the picture.
        asset = self._asset(preview_target, "object_preview", _vml_size(obj)) if preview_target else None
        self.report.note(f"object:{prog_id or 'unknown'}")
        if asset is None:
            self.report.warn(f"嵌入对象 {prog_id or '未知类型'} 没有可用的预览图")
            return ""
        self.report.object_previews += 1
        return f"⟦{asset}⟧"

    # Images ----------------------------------------------------------------
    def _drawing(self, drawing: Element) -> str:
        if any(node.tag in (WPS + "txbx", W + "txbxContent") for node in drawing.iter()):
            self.report.text_boxes += 1
            self.report.warn("文档含文本框，其中的文字需对照原卷核对")
            texts = []
            for content in drawing.iter(W + "txbxContent"):
                for paragraph in _children(content, W + "p"):
                    texts.append(self._paragraph(paragraph, count=False))
            return " ".join(text for text in texts if text.strip())
        tokens = []
        extent = drawing.find(f".//{WP}extent")
        size = None
        if extent is not None:
            try:
                size = (int(extent.get("cx", "0")) / 12700, int(extent.get("cy", "0")) / 12700)
            except ValueError:
                size = None
        for blip in drawing.iter(A + "blip"):
            target = self.rels.get(blip.get(R + "embed", ""))
            if target:
                floating = drawing.find(WP + "anchor") is not None
                if floating:
                    self.report.positioned_pictures += 1
                else:
                    self.report.inline_pictures += 1
                asset = self._asset(target, "formula_image" if _formula_sized(size) and not floating else "image", size)
                if asset:
                    tokens.append(f"⟦{asset}⟧")
            else:
                self.report.warn("有图片引用了外部或缺失的文件")
        has_picture = drawing.find(f".//{A}blip") is not None
        if not tokens and not has_picture and drawing.find(f".//{A}graphicData") is not None:
            uri = drawing.find(f".//{A}graphicData").get("uri", "")
            self.report.note("drawing:" + uri.rsplit("/", 1)[-1])
            self.report.warn("文档含图表或形状，未能提取为图片，请对照原卷核对")
        if drawing.find(WP + "anchor") is not None and tokens:
            # A floating picture is anchored to its paragraph, not to the
            # character where the anchor happens to sit; place it after the text.
            self.floating.extend(tokens)
            return ""
        return "".join(tokens)

    def _pict(self, pict: Element) -> str:
        tokens = []
        for content in pict.iter(W + "txbxContent"):
            self.report.text_boxes += 1
            self.report.warn("文档含文本框，其中的文字需对照原卷核对")
            tokens.extend(self._paragraph(paragraph, count=False) for paragraph in _children(content, W + "p"))
        for image in pict.iter(V + "imagedata"):
            target = self.rels.get(image.get(R + "id", ""))
            size = _vml_size(pict)
            if _vml_floating(pict):
                self.report.positioned_pictures += 1
            else:
                self.report.inline_pictures += 1
            role = "formula_image" if _formula_sized(size) and not _vml_floating(pict) else "image"
            asset = self._asset(target, role, size) if target else None
            if asset:
                tokens.append(f"⟦{asset}⟧")
        return " ".join(token for token in tokens if token)

    def _asset(self, target: str | None, role: str, size: tuple[float, float] | None = None) -> str | None:
        if not target:
            return None
        key = (target, role)
        if key in self.asset_by_target:
            existing = self.asset_by_target[key]
            if existing and size and size[0] > 0 and size[1] > 0:
                asset = next(item for item in self.assets if item.id == existing)
                asset.display = asset.display or size
            return existing
        if len(self.assets) >= MAX_ASSETS:
            raise DocxError("图片数量超过上限")
        extension = target.rsplit(".", 1)[-1].lower()
        try:
            data = self._read(target, MAX_IMAGE_BYTES)
            converted = _normalize_image(data, extension)
        except Exception:
            converted = None
        if converted is None and size and size[0] <= DECORATION_MAX and size[1] <= DECORATION_MAX:
            # A picture shown at icon size (bullets, markers) is decoration, not content.
            self.report.note("decoration:" + extension)
            self.asset_by_target[key] = None  # type: ignore[assignment]
            return None
        if converted is None:
            self.report.images_unreadable += 1
            self.report.warn(f"有 {extension.upper()} 格式的图片无法读取，请对照原卷补图")
            self.asset_by_target[key] = None  # type: ignore[assignment]
            return None
        mime, payload, width, height = converted
        display = size if size and size[0] > 0 and size[1] > 0 else None
        if display and display[0] >= PAGE_PICTURE_MIN[0] and display[1] >= PAGE_PICTURE_MIN[1]:
            self.report.page_pictures += 1
        asset = Asset(id=f"I{len(self.assets) + 1}", role=role, mime=mime, data=payload, width=width, height=height, display=display)
        self.assets.append(asset)
        if role == "image":
            self.report.images += 1
        elif role == "formula_image":
            self.report.formula_images += 1
        self.asset_by_target[key] = asset.id
        return asset.id


DECORATION_MAX = 16.0  # points
PAGE_PICTURE_MIN = (450.0, 600.0)  # points: a picture covering most of an A4 page
FORMULA_IMAGE_MAX_HEIGHT = 36.0  # points: one line, or a stacked fraction
FORMULA_IMAGE_TALL_HEIGHT = 90.0  # piecewise functions and systems, which are wide
FORMULA_IMAGE_MIN_ASPECT = 1.8
FORMULA_IMAGE_MAX_WIDTH = 420.0


def _positioned_layout(report: "Report") -> bool:
    """Most pictures placed at page coordinates: the text flow cannot place them."""
    total = report.positioned_pictures + report.inline_pictures
    if report.page_pictures:
        # A whole page as one picture (scans, PDF exports) holds content the text lacks.
        return True
    return report.positioned_pictures >= 8 and report.positioned_pictures * 2 >= total


def _formula_sized(size: tuple[float, float] | None) -> bool:
    """Papers converted from PDF embed formulas as small inline pictures."""
    if not size or not 0 < size[0] <= FORMULA_IMAGE_MAX_WIDTH or size[1] <= 0:
        return False
    return size[1] <= FORMULA_IMAGE_MAX_HEIGHT or (
        size[1] <= FORMULA_IMAGE_TALL_HEIGHT and size[0] >= FORMULA_IMAGE_MIN_ASPECT * size[1])


def _vml_floating(element: Element) -> bool:
    shape = next((node for node in element.iter() if node.tag in (V + "shape", V + "rect", V + "image")), None)
    return shape is not None and "position:absolute" in shape.get("style", "").replace(" ", "")


def _vml_size(element: Element) -> tuple[float, float] | None:
    """Display size in points from a VML shape style such as "width:30.75pt;height:17pt"."""
    shape = next((node for node in element.iter() if node.tag in (V + "shape", V + "rect", V + "image")), None)
    if shape is None:
        return None
    style = {key.strip(): value.strip() for key, _, value in (item.partition(":") for item in shape.get("style", "").split(";"))}
    units = {"pt": 1.0, "in": 72.0, "cm": 72 / 2.54, "mm": 72 / 25.4, "px": 0.75}
    size = []
    for name in ("width", "height"):
        match = re.fullmatch(r"([\d.]+)(pt|in|cm|mm|px)?", style.get(name, ""))
        if not match:
            return None
        size.append(float(match.group(1)) * units[match.group(2) or "px"])
    return (size[0], size[1]) if size[0] > 0 and size[1] > 0 else None


def _wrap_run(element: Element) -> Element:
    run = Element(W + "r")
    for node in element.iter():
        if node.tag in (W + "drawing", W + "pict", W + "t", W + "object"):
            run.append(node)
            break
    return run


def _escape_script(value: str) -> str:
    out = []
    for char in unicodedata.normalize("NFKC", value):
        if char in "{}%#&$_^\\~":
            out.append("\\" + char if char not in "\\^~" else " ")
        else:
            out.append(char)
    return "".join(out)


def _normalize_image(data: bytes, extension: str) -> tuple[str, bytes, int, int] | None:
    """Return (mime, bytes, width, height) as PNG or JPEG, or None if unreadable."""
    if extension in ("wmf", "emf"):
        data = _metafile_to_png(data, extension)
        if data is None:
            return None
        extension = "png"
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    with Image.open(io.BytesIO(data)) as image:
        if image.width * image.height > MAX_IMAGE_PIXELS:
            return None
        image.load()
        if image.format == "JPEG" and image.mode in ("RGB", "L"):
            return "image/jpeg", data, image.width, image.height
        if image.format == "PNG" and len(data) <= 8 * 1024 * 1024:
            return "image/png", data, image.width, image.height
        converted = image.convert("RGBA" if "A" in image.getbands() or image.mode == "P" else "RGB")
        output = io.BytesIO()
        converted.save(output, format="PNG", optimize=True)
        return "image/png", output.getvalue(), image.width, image.height


def _metafile_to_png(data: bytes, extension: str) -> bytes | None:
    """WMF/EMF to PNG: Pillow can on Windows; elsewhere libwmf's wmf2gd handles WMF."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load(dpi=144)
            output = io.BytesIO()
            image.convert("RGB").save(output, format="PNG")
            return output.getvalue()
    except Exception:
        pass
    if extension != "wmf" or not shutil.which("wmf2gd"):
        return None
    with tempfile.TemporaryDirectory(prefix="docx-wmf-") as folder:
        source = posixpath.join(folder, "in.wmf")
        target = posixpath.join(folder, "out.png")
        with open(source, "wb") as handle:
            handle.write(data)
        try:
            subprocess.run(["wmf2gd", "-t", "png", "--maxpect", "--maxwidth=1200", "--maxheight=1200", "-o", target, source],
                           check=True, timeout=20, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with open(target, "rb") as handle:
                return handle.read()
        except (subprocess.SubprocessError, OSError):
            return None


class _Numbering:
    """Word automatic list numbering (numbering.xml), including style-linked lists."""

    def __init__(self, numbering: Element | None, styles: Element | None):
        self.abstract: dict[str, dict[int, tuple[str, str, int]]] = {}
        self.instances: dict[str, tuple[str, dict[int, int]]] = {}
        self.counters: dict[str, dict[int, int]] = {}
        self.style_numbering: dict[str, tuple[str, int]] = {}
        if numbering is not None:
            for abstract in numbering.iter(W + "abstractNum"):
                levels = {}
                for level in abstract.iter(W + "lvl"):
                    try:
                        index = int(_attr(level, "ilvl", "0"))
                        start = int(_attr(level.find(W + "start"), "val", "1") or 1)
                    except ValueError:
                        continue
                    levels[index] = (_attr(level.find(W + "numFmt"), "val", "decimal"),
                                     _attr(level.find(W + "lvlText"), "val", f"%{index + 1}."), start)
                self.abstract[_attr(abstract, "abstractNumId")] = levels
            for num in numbering.iter(W + "num"):
                overrides = {}
                for override in num.iter(W + "lvlOverride"):
                    start = override.find(W + "startOverride")
                    if start is not None:
                        try:
                            overrides[int(_attr(override, "ilvl", "0"))] = int(_attr(start, "val", "1"))
                        except ValueError:
                            pass
                self.instances[_attr(num, "numId")] = (_attr(num.find(W + "abstractNumId"), "val"), overrides)
        if styles is not None:
            based: dict[str, str] = {}
            direct: dict[str, tuple[str, int]] = {}
            for style in styles.iter(W + "style"):
                style_id = _attr(style, "styleId")
                base = style.find(W + "basedOn")
                if base is not None:
                    based[style_id] = _attr(base, "val")
                num_pr = style.find(f"{W}pPr/{W}numPr")
                if num_pr is not None:
                    num_id = _attr(num_pr.find(W + "numId"), "val")
                    try:
                        level = int(_attr(num_pr.find(W + "ilvl"), "val", "0"))
                    except ValueError:
                        level = 0
                    direct[style_id] = (num_id, level)
            for style_id in set(based) | set(direct):
                current, depth = style_id, 0
                while current and depth < 10:
                    if current in direct:
                        self.style_numbering[style_id] = direct[current]
                        break
                    current, depth = based.get(current, ""), depth + 1

    def prefix(self, paragraph: Element) -> str:
        props = paragraph.find(W + "pPr")
        if props is None:
            return ""
        num_pr = props.find(W + "numPr")
        num_id, level = None, 0
        if num_pr is not None:
            num_id = _attr(num_pr.find(W + "numId"), "val") or None
            try:
                level = int(_attr(num_pr.find(W + "ilvl"), "val", "0"))
            except ValueError:
                level = 0
        if num_id is None:
            style = _attr(props.find(W + "pStyle"), "val")
            if style in self.style_numbering:
                num_id, level = self.style_numbering[style]
        if not num_id or num_id == "0" or num_id not in self.instances:
            return ""
        abstract_id, overrides = self.instances[num_id]
        levels = self.abstract.get(abstract_id, {})
        if level not in levels:
            return ""
        counters = self.counters.setdefault(num_id, {})
        fmt, template, start = levels[level]
        start = overrides.get(level, start)
        counters[level] = counters.get(level, start - 1) + 1
        for deeper in [key for key in counters if key > level]:
            del counters[deeper]
        if fmt in ("bullet", "none"):
            return ""

        def replace(match: re.Match) -> str:
            index = int(match.group(1)) - 1
            if index not in levels:
                return ""
            level_fmt, _, level_start = levels[index]
            value = counters.get(index, overrides.get(index, level_start))
            return _format_number(value, level_fmt if index == level else level_fmt)

        return re.sub(r"%([1-9])", replace, template).strip()


def _format_number(value: int, fmt: str) -> str:
    if fmt in ("upperLetter", "lowerLetter"):
        letters = ""
        number = value
        while number > 0:
            number, remainder = divmod(number - 1, 26)
            letters = chr(65 + remainder) + letters
        return letters if fmt == "upperLetter" else letters.lower()
    if fmt in ("upperRoman", "lowerRoman"):
        numerals = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"),
                    (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
        out, number = "", value
        for amount, numeral in numerals:
            while number >= amount:
                out, number = out + numeral, number - amount
        return out if fmt == "upperRoman" else out.lower()
    if fmt.startswith("chinese") or fmt.startswith("ideograph") or fmt == "taiwaneseCounting":
        return _chinese(value)
    if fmt in ("decimalEnclosedCircle", "decimalEnclosedCircleChinese") and 1 <= value <= 20:
        return CIRCLED[value - 1]
    if fmt == "decimalZero":
        return f"{value:02d}"
    if fmt == "decimalFullWidth":
        return "".join(chr(ord(digit) + 0xFEE0) for digit in str(value))
    return str(value)


def _chinese(value: int) -> str:
    if value < 10:
        return CHINESE_DIGITS[value]
    if value < 20:
        return "十" + (CHINESE_DIGITS[value % 10] if value % 10 else "")
    if value < 100:
        return CHINESE_DIGITS[value // 10] + "十" + (CHINESE_DIGITS[value % 10] if value % 10 else "")
    return str(value)


def read_docx(data: bytes) -> dict:
    return DocxReader(data).read()
