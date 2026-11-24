import io
import os
import struct
import zipfile

import pytest
from defusedxml.ElementTree import fromstring
from PIL import Image

os.environ.setdefault("JIANTI_PROCESSOR_TOKEN", "t" * 40)

from processor.word.docx import DocxError, read_docx  # noqa: E402
from processor.word.mtef import MtefError, parse_mtef  # noqa: E402
from processor.word.mtef_latex import equation_latex  # noqa: E402
from processor.word.omml import omml_latex  # noqa: E402


# --- MathType -----------------------------------------------------------------
HEADER = bytes([5, 1, 0, 7, 8]) + b"DSMT7\x00" + bytes([1])


def char(text, face=3):
    return bytes([2, 0, face + 128]) + struct.pack("<H", ord(text))


def line(*items):
    return bytes([1, 0]) + b"".join(items) + b"\x00"


NULL_LINE = bytes([1, 1])


def tmpl(selector, variation, *slots):
    return bytes([3, 0, selector, variation, 0]) + b"".join(slots) + b"\x00"


def latex_of(*items):
    return equation_latex(parse_mtef(HEADER + line(*items) + b"\x00"))


def test_mathtype_fraction_scripts_and_root():
    rendered = latex_of(
        char("x"), tmpl(28, 0, NULL_LINE, line(char("2", 8))), char("=", 6),
        tmpl(11, 0, line(char("1", 8)), line(tmpl(10, 0, line(char("3", 8)), NULL_LINE))),
    )
    assert rendered.problems == []
    assert rendered.latex == r"x^{2}=\frac{1}{\sqrt{3}}"


def test_mathtype_vector_cases_and_text():
    vector = tmpl(31, 2, line(char("P"), char("A")), char("\u20d7", 22))
    assert latex_of(vector).latex == r"\overrightarrow{PA}"
    matrix = bytes([5, 0, 0, 0, 0, 2, 1, 0, 0]) + line(char("0", 8)) + line(char("x")) + b"\x00"
    cases = tmpl(2, 1, bytes([1, 0]) + matrix + b"\x00", char("{", 22))
    assert latex_of(char("y"), char("=", 6), cases).latex == r"y=\begin{cases}0\\x\end{cases}"
    assert latex_of(char("且", 12), char("R", 7), char("≤", 6)).latex == r"\text{且}\mathbf{R}\leqslant"
    assert latex_of(char("s", 2), char("i", 2), char("n", 2), char("x")).latex == r"\sin x"


def test_mathtype_unknowns_are_reported_not_guessed():
    rendered = latex_of(char("\ue123", 11))
    assert rendered.problems == ["private character U+E123"]
    with pytest.raises(MtefError):
        parse_mtef(bytes([4, 1, 0, 3, 5]) + b"\x00")
    with pytest.raises(MtefError):
        parse_mtef(HEADER + bytes([1, 0, 2, 0]))  # truncated character


# --- Office Math --------------------------------------------------------------
MNS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'


def omml(body):
    return omml_latex(fromstring(f"<m:oMath {MNS}>{body}</m:oMath>"))


def r(text, plain=False):
    style = '<m:rPr><m:sty m:val="p"/></m:rPr>' if plain else ""
    return f"<m:r>{style}<m:t>{text}</m:t></m:r>"


def test_omml_structures():
    fraction = f"<m:f><m:num>{r('1')}</m:num><m:den>{r('𝑥')}</m:den></m:f>"
    assert omml(fraction).latex == r"\frac{1}{x}"
    sub = f"<m:sSub><m:e>{r('𝑎')}</m:e><m:sub>{r('𝑛')}</m:sub></m:sSub>"
    assert omml(sub).latex == "a_{n}"
    radical = f'<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>{r("2")}</m:e></m:rad>'
    assert omml(radical).latex == r"\sqrt{2}"
    vector = f'<m:acc><m:accPr><m:chr m:val="\u20d7"/></m:accPr><m:e>{r("𝐴𝐵")}</m:e></m:acc>'
    assert omml(vector).latex == r"\overrightarrow{AB}"
    function = f"<m:func><m:fName>{r('sin', True)}</m:fName><m:e>{r('𝑥')}</m:e></m:func>"
    assert omml(function).latex == r"\sin x"


def test_omml_half_open_interval_and_cases():
    left = f'<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val=""/></m:dPr><m:e>{r("1,")}' \
           f'<m:d><m:dPr><m:begChr m:val=""/><m:endChr m:val=")"/></m:dPr><m:e>{r("+∞")}</m:e></m:d></m:e></m:d>'
    assert omml(left).latex == r"[1,+\infty)"
    cases = f'<m:d><m:dPr><m:begChr m:val="{{"/><m:endChr m:val=""/></m:dPr><m:e><m:eqArr>' \
            f'<m:e>{r("𝑥,𝑥≥0")}</m:e><m:e>{r("−𝑥,𝑥&lt;0")}</m:e></m:eqArr></m:e></m:d>'
    assert omml(cases).latex == r"\begin{cases}x,x\geqslant0\\-x,x<0\end{cases}"


def test_omml_unknown_character_is_reported():
    assert omml(r("⨍")).problems == ["character U+2A0D"]


# --- docx ---------------------------------------------------------------------
WNS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
       'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
       'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
       'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' + MNS)


def png(width=20, height=10):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(buffer, format="PNG")
    return buffer.getvalue()


CONTENT_TYPES = ('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                 '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
                 '<Override PartName="/word/document.xml" '
                 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
PACKAGE_RELS = ('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                'Target="word/document.xml"/></Relationships>')


def make_docx(body, rels="", numbering=None, extra=None):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", PACKAGE_RELS)
        archive.writestr("word/document.xml", f"<w:document {WNS}><w:body>{body}</w:body></w:document>")
        archive.writestr("word/_rels/document.xml.rels",
                         '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                         + rels + "</Relationships>")
        if numbering:
            archive.writestr("word/numbering.xml", f"<w:numbering {WNS}>{numbering}</w:numbering>")
        for name, data in (extra or {}).items():
            archive.writestr(name, data)
    return buffer.getvalue()


def rel(rid, target):
    return f'<Relationship Id="{rid}" Target="{target}" Type="x"/>'


def test_docx_text_numbering_blank_and_formula_tokens():
    numbering = ('<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/>'
                 '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1．"/></w:lvl></w:abstractNum>'
                 '<w:num w:numId="7"><w:abstractNumId w:val="1"/></w:num>')
    numbered = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr>'
    body = (f'<w:p>{numbered}<w:r><w:t>已知</w:t></w:r><m:oMath>{r("𝑥")}</m:oMath>'
            '<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">        </w:t></w:r></w:p>'
            f'<w:p>{numbered}<w:r><w:t>x</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>'
            '<w:t>2</w:t></w:r><w:r><w:sym w:font="Symbol" w:char="F0A3"/></w:r></w:p>'
            '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A．1</w:t></w:r></w:p></w:tc>'
            '<w:tc><w:p><w:r><w:t>B．2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
    result = read_docx(make_docx(body, numbering=numbering))
    blocks = result["blocks"]
    assert blocks[0] == {"type": "paragraph", "text": "1． 已知⟦F1⟧⟦F2⟧"}
    assert blocks[1] == {"type": "paragraph", "text": "2． x⟦F3⟧≤"}
    assert blocks[2] == {"type": "table", "rows": [["A．1", "B．2"]]}
    formulas = {item["id"]: item for item in result["formulas"]}
    assert formulas["F1"]["latex"] == "x" and formulas["F1"]["source"] == "omml"
    assert formulas["F2"]["latex"] == r"\underline{\hspace{4em}}"
    assert formulas["F3"]["latex"] == "^{2}"
    assert result["report"]["formulas"] == {"omml": {"converted": 1, "review": 0}}
    assert result["report"]["numberedParagraphs"] == 2


def test_docx_images_and_unreadable_equation_fallback():
    drawing = ('<w:p><w:r><w:drawing><a:graphic><a:graphicData uri="pic"><a:blip r:embed="rImg"/>'
               '</a:graphicData></a:graphic></w:drawing></w:r></w:p>')
    equation = ('<w:p><w:r><w:object><v:shape><v:imagedata r:id="rPrev"/></v:shape>'
                '<o:OLEObject ProgID="Equation.DSMT4" r:id="rOle"/></w:object></w:r></w:p>')
    rels = rel("rImg", "media/image1.png") + rel("rPrev", "media/image2.png") + rel("rOle", "embeddings/oleObject1.bin")
    data = make_docx(drawing + equation, rels, extra={
        "word/media/image1.png": png(40, 30), "word/media/image2.png": png(12, 8),
        "word/embeddings/oleObject1.bin": b"not an ole file"})
    result = read_docx(data)
    assert [block["text"] for block in result["blocks"]] == ["⟦I1⟧", "⟦F1⟧"]
    formula = result["formulas"][0]
    assert formula["status"] == "review" and formula["source"] == "mathtype" and formula["preview"] == "I2"
    roles = {asset["id"]: (asset["role"], asset["width"], asset["height"]) for asset in result["assets"]}
    assert roles == {"I1": ("image", 40, 30), "I2": ("formula_preview", 12, 8)}
    assert result["report"]["reviewFormulas"] == 1 and result["report"]["images"] == 1


def test_docx_rejects_non_docx():
    with pytest.raises(DocxError):
        read_docx(b"plain text")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("other.xml", "<x/>")
    with pytest.raises(DocxError):
        read_docx(buffer.getvalue())


def test_parse_endpoint_requires_token_and_docx_type():
    from fastapi.testclient import TestClient
    from processor.main import app, TOKEN, DOCX_TYPE
    client = TestClient(app)
    body = make_docx("<w:p><w:r><w:t>题</w:t></w:r></w:p>")
    assert client.post("/v1/docx/parse", content=body, headers={"content-type": DOCX_TYPE}).status_code == 401
    headers = {"x-processor-token": TOKEN}
    assert client.post("/v1/docx/parse", content=body, headers={**headers, "content-type": "application/pdf"}).status_code == 415
    assert client.post("/v1/docx/parse", content=b"zz", headers={**headers, "content-type": DOCX_TYPE}).status_code == 422
    response = client.post("/v1/docx/parse", content=body, headers={**headers, "content-type": DOCX_TYPE})
    assert response.status_code == 200
    assert response.json()["blocks"] == [{"type": "paragraph", "text": "题"}]
    assert response.json()["report"]["layout"] == "flow"
    # A .docx body declared as legacy .doc is refused before any conversion.
    assert client.post("/v1/docx/parse", content=body, headers={**headers, "content-type": "application/msword"}).status_code == 415


# --- Variants found in real papers (2026-11-11 test set) ------------------------
def test_mathtype_extension_record_ruler_colour_and_trailing_bytes():
    tex = bytes([102, 21]) + b"TeX Input Language\x00p\x00"  # one-byte length, keeps the typed TeX
    ruler_line = bytes([1, 0x02, 3, 0, 0x9C, 0, 0, 0xA8, 0, 0, 0x94, 8]) + char("x") + b"\x00"  # ruler without a tag
    colour = bytes([2, 0x01, 3 + 128]) + struct.pack("<H", ord("f")) + bytes([15, 1, 6, 0, 5, 0])  # colour in embellishments
    data = HEADER + tex + ruler_line + line(colour) + b"\x00" + b"\x65\x55leftover"
    equation = parse_mtef(data)
    assert equation.tex_input == "p"
    assert equation_latex(equation).latex == r"\begin{array}{l}x\\f'\end{array}"


def test_mathtype_empty_script_operator_slot_bars_and_angles():
    assert latex_of(char("x"), tmpl(27, 0, line(), NULL_LINE)).problems == []
    total = tmpl(22, 112, NULL_LINE, line(char("i", 1), char("=", 1), char("1", 1)), line(char("n")), line(char("∑", 6)))
    assert latex_of(total, char("b")).latex == r"\sum_{\mathrm{i}=1}^{n}b"
    bars = tmpl(4, 3, line(char("A"), char("F")), char("\uec07", 22), char("\uec08", 22))
    assert latex_of(bars).latex == r"\left| AF\right|"
    assert latex_of(char(chr(0x2329), 6), char("a"), char(chr(0x232A), 6)).latex == r"\langle a\rangle"


def drawing(size, anchored=False, rid="rImg"):
    kind = "wp:anchor" if anchored else "wp:inline"
    cx, cy = int(size[0] * 12700), int(size[1] * 12700)
    return (f'<w:r><w:drawing><{kind} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
            f'<wp:extent cx="{cx}" cy="{cy}"/><a:graphic><a:graphicData uri="pic"><a:blip r:embed="{rid}"/></a:graphicData>'
            f'</a:graphic></{kind}></w:drawing></w:r>')


def test_small_inline_pictures_are_formula_images():
    body = ("<w:p>" + drawing((60, 20), rid="r1") + drawing((140, 60), rid="r2") + drawing((85, 85), rid="r3")
            + drawing((60, 20), anchored=True, rid="r4") + "</w:p>")
    rels = "".join(rel(f"r{n}", f"media/image{n}.png") for n in range(1, 5))
    media = {f"word/media/image{n}.png": png(20 + n, 10) for n in range(1, 5)}
    result = read_docx(make_docx(body, rels, extra=media))
    roles = [asset["role"] for asset in result["assets"]]
    assert roles == ["formula_image", "formula_image", "image", "image"]
    assert result["report"]["formulaImages"] == 2 and result["report"]["layout"] == "flow"


def test_page_positioned_pictures_mark_the_layout():
    shape = ('<w:r><w:pict><v:shape style="position:absolute;margin-left:{x}pt;margin-top:10pt;width:30pt;height:12pt;'
             'mso-position-horizontal-relative:page"><v:imagedata r:id="rP"/></v:shape></w:pict></w:r>')
    body = "<w:p><w:r><w:t>1．已知</w:t></w:r>" + "".join(shape.format(x=40 + n) for n in range(9)) + "</w:p>"
    result = read_docx(make_docx(body, rel("rP", "media/image1.png"), extra={"word/media/image1.png": png()}))
    assert result["report"]["layout"] == "positioned"
    assert result["report"]["positionedPictures"] == 9


def test_unreadable_icon_sized_pictures_are_decoration_and_greek_text_keeps_commands():
    body = "<w:p>" + drawing((10.5, 14), rid="rIcon") + drawing((60, 40), rid="rFig") + "</w:p>"
    rels = rel("rIcon", "media/image1.emf") + rel("rFig", "media/image2.emf")
    result = read_docx(make_docx(body, rels, extra={"word/media/image1.emf": b"bad", "word/media/image2.emf": b"bad"}))
    assert result["report"]["imagesUnreadable"] == 1  # only the content-sized picture warns
    assert result["report"]["unsupported"] == {"decoration:emf": 1}
    assert latex_of(char("π", 1), char("x", 1)).latex == r"\pi\mathrm{x}"


def test_a_page_sized_picture_marks_the_layout():
    # Scans and PDF exports put each page in one picture; the text layer lacks the formulas.
    body = "<w:p><w:r><w:t>1．已知</w:t></w:r>" + drawing((597, 844), anchored=True, rid="rPage") + "</w:p>"
    result = read_docx(make_docx(body, rel("rPage", "media/image1.png"), extra={"word/media/image1.png": png()}))
    assert result["report"]["layout"] == "positioned"


@pytest.mark.skipif(__import__("processor.word.office", fromlist=["soffice_path"]).soffice_path() is None,
                    reason="LibreOffice is not installed")
def test_legacy_doc_is_converted_and_layout_rendered():
    from fastapi.testclient import TestClient
    from processor.main import app, TOKEN
    from processor.word.office import convert
    docx = make_docx(f"<w:p><w:r><w:t>1．已知</w:t></w:r><m:oMath>{r('𝑥')}</m:oMath></w:p>")
    doc = convert(docx, ".docx", "pdf")
    assert doc.startswith(b"%PDF-")
    client = TestClient(app)
    headers = {"x-processor-token": TOKEN, "content-type": "application/msword"}
    word97 = _to_doc(docx)
    parsed = client.post("/v1/docx/parse", content=word97, headers=headers)
    assert parsed.status_code == 200, parsed.text
    assert parsed.json()["report"]["convertedFrom"] == "doc"
    assert "已知" in parsed.json()["blocks"][0]["text"]
    rendered = client.post("/v1/docx/render", content=word97, headers=headers)
    assert rendered.status_code == 200 and rendered.content.startswith(b"%PDF-")


def _to_doc(docx: bytes) -> bytes:
    """Make a Word 97 file with LibreOffice so the legacy path is exercised end to end."""
    import subprocess
    import tempfile
    from pathlib import Path
    from processor.word.office import soffice_path
    with tempfile.TemporaryDirectory() as folder:
        source = Path(folder) / "in.docx"
        source.write_bytes(docx)
        subprocess.run([soffice_path(), f"-env:UserInstallation={(Path(folder) / 'p').resolve().as_uri()}", "--headless",
                        "--convert-to", "doc:MS Word 97", "--outdir", folder, str(source)], check=True, timeout=150,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return (Path(folder) / "in.doc").read_bytes()
