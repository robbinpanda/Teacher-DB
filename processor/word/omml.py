"""Convert Office Math (OMML) elements to LaTeX.

Unknown elements and characters are listed in ``problems`` instead of being
dropped or guessed, so the caller can mark the formula for review.
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from xml.etree.ElementTree import Element

from .symbols import FUNCTIONS, is_cjk, join_tokens, symbol_latex, text_latex

M = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

ACCENTS = {
    "\u0302": r"\hat", "\u0303": r"\tilde", "\u0304": r"\bar", "\u0305": r"\overline", "\u0307": r"\dot",
    "\u0308": r"\ddot", "\u030c": r"\check", "\u0306": r"\breve", "\u20d7": r"\overrightarrow",
    "\u20d1": r"\overrightarrow", "\u20d6": r"\overleftarrow", "\u20e1": r"\overleftrightarrow",
    "→": r"\overrightarrow", "←": r"\overleftarrow", "\u0311": r"\overset{\frown}", "⌢": r"\overset{\frown}",
    "¯": r"\overline", "^": r"\hat", "~": r"\tilde",
}
WIDE_ACCENTS = {r"\hat": r"\widehat", r"\tilde": r"\widetilde", r"\bar": r"\overline"}
DELIMITERS = {"(": "(", ")": ")", "[": "[", "]": "]", "{": r"\{", "}": r"\}", "|": "|", "‖": r"\|",
              "〈": r"\langle", "〉": r"\rangle", "⟨": r"\langle", "⟩": r"\rangle", "⌊": r"\lfloor",
              "⌋": r"\rfloor", "⌈": r"\lceil", "⌉": r"\rceil", "": "."}
NARY = {"∑": r"\sum", "∏": r"\prod", "∐": r"\coprod", "∫": r"\int", "∬": r"\iint", "∭": r"\iiint",
        "∮": r"\oint", "⋃": r"\bigcup", "⋂": r"\bigcap", "⋁": r"\bigvee", "⋀": r"\bigwedge"}
IGNORED = {"rPr", "ctrlPr", "fPr", "sSubPr", "sSupPr", "sSubSupPr", "sPrePr", "radPr", "dPr", "naryPr",
           "funcPr", "limLowPr", "limUppPr", "accPr", "barPr", "groupChrPr", "boxPr", "borderBoxPr",
           "eqArrPr", "mPr", "phantPr", "oMathParaPr", "argPr", "bookmarkStart", "bookmarkEnd",
           "proofErr", "permStart", "permEnd"}


@dataclass
class Rendered:
    latex: str
    problems: list[str] = field(default_factory=list)


def omml_latex(element: Element) -> Rendered:
    """Convert an m:oMath or m:oMathPara element."""
    converter = _Converter()
    if element.tag == M + "oMathPara":
        rows = [converter.children(child) for child in element if child.tag == M + "oMath"]
        latex = rows[0] if len(rows) == 1 else r"\begin{array}{l}" + r"\\".join(rows) + r"\end{array}"
    else:
        latex = converter.children(element)
    return Rendered(" ".join(latex.split()).strip(), converter.problems)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _val(element: Element | None, default: str = "") -> str:
    if element is None:
        return default
    value = element.get(M + "val")
    return default if value is None else value


def _prop(element: Element, path: str, default: str = "") -> str:
    found = element.find(path.replace("m:", M))
    return _val(found, default) if found is not None else default


def _on(element: Element, path: str) -> bool:
    found = element.find(path.replace("m:", M))
    return found is not None and _val(found, "1") in ("1", "on", "true")


class _Converter:
    def __init__(self):
        self.problems: list[str] = []

    def problem(self, message: str) -> str:
        if message not in self.problems:
            self.problems.append(message)
        return ""

    def arg(self, parent: Element, name: str) -> str:
        found = parent.find(M + name)
        return self.children(found) if found is not None else ""

    def children(self, element: Element | None) -> str:
        if element is None:
            return ""
        return join_tokens([self.node(child) for child in element])

    def node(self, element: Element) -> str:
        name = _local(element.tag)
        if element.tag.startswith(W):
            if name == "r":
                text = "".join(t.text or "" for t in element.iter(W + "t"))
                return self.text_run(text, plain=True) if text else ""
            return ""
        if name in IGNORED:
            return ""
        handler = getattr(self, "m_" + name, None)
        if handler is None:
            return self.problem(f"element {name}")
        return handler(element)

    # Runs ------------------------------------------------------------------
    def m_r(self, element: Element) -> str:
        text = "".join(t.text or "" for t in element.iter(M + "t"))
        if not text:
            return ""
        props = element.find(M + "rPr")
        if props is not None and props.find(M + "nor") is not None and any(is_cjk(c) for c in text):
            return r"\text{" + text_latex(text) + "}"
        style = _prop(props, "m:sty", "") if props is not None else ""
        script = _prop(props, "m:scr", "") if props is not None else ""
        latex = self.text_run(text, plain=style in ("p", "b"))
        if script == "double-struck":
            latex = r"\mathbb{" + latex + "}"
        elif script == "script":
            latex = r"\mathcal{" + latex + "}"
        elif style in ("b", "bi"):
            latex = r"\mathbf{" + latex + "}"
        return latex

    def text_run(self, text: str, plain: bool) -> str:
        tokens: list[str] = []
        index = 0
        while index < len(text):
            char = text[index]
            if is_cjk(char):
                end = index
                while end < len(text) and (is_cjk(text[end]) or text[end] in "，。、；：！？（）"):
                    end += 1
                tokens.append(r"\text{" + text_latex(text[index:end]) + "}")
                index = end
                continue
            if char.isascii() and char.isalpha():
                end = index
                while end < len(text) and text[end].isascii() and text[end].isalpha():
                    end += 1
                word = text[index:end]
                tokens.append(self.word(word, plain))
                index = end
                continue
            tokens.append(self.character(char))
            index += 1
        return join_tokens(tokens)

    def word(self, word: str, plain: bool) -> str:
        if word in FUNCTIONS:
            return "\\" + word
        if plain and len(word) > 1:
            for name in sorted(FUNCTIONS, key=len, reverse=True):
                if word.startswith(name) and len(word) > len(name):
                    return "\\" + name + " " + word[len(name):]
        return word

    def character(self, char: str) -> str:
        code = ord(char)
        if 0x1D400 <= code <= 0x1D7FF:
            name = unicodedata.name(char, "")
            base = unicodedata.normalize("NFKC", char)
            if "DOUBLE-STRUCK" in name:
                return r"\mathbb{" + base + "}"
            if "BOLD" in name and base.isalpha() and len(base) == 1 and base.isascii():
                return r"\mathbf{" + base + "}"
            latex = symbol_latex(base)
            return latex if latex is not None else self.problem(f"character U+{code:04X}")
        if code == 0x210E:  # PLANCK CONSTANT is Word's italic h
            return "h"
        latex = symbol_latex(char)
        if latex is None:
            normalized = unicodedata.normalize("NFKC", char)
            if normalized != char and len(normalized) == 1:
                latex = symbol_latex(normalized)
        if latex is None:
            return self.problem(f"character U+{code:04X}")
        return latex

    # Structures ------------------------------------------------------------
    def m_f(self, element: Element) -> str:
        kind = _prop(element, "m:fPr/m:type", "bar")
        numerator, denominator = self.arg(element, "num"), self.arg(element, "den")
        if kind in ("lin", "skw"):
            return "{" + numerator + "}/{" + denominator + "}"
        if kind == "noBar":
            return r"\genfrac{}{}{0pt}{}{" + numerator + "}{" + denominator + "}"
        return r"\frac{" + numerator + "}{" + denominator + "}"

    def _base(self, element: Element) -> str:
        base = self.arg(element, "e")
        return base if base else "{}"

    def m_sSub(self, element: Element) -> str:
        return "{" + self._base(element) + "}_{" + self.arg(element, "sub") + "}" if self._needs_group(element) else self._base(element) + "_{" + self.arg(element, "sub") + "}"

    def m_sSup(self, element: Element) -> str:
        return "{" + self._base(element) + "}^{" + self.arg(element, "sup") + "}" if self._needs_group(element) else self._base(element) + "^{" + self.arg(element, "sup") + "}"

    def m_sSubSup(self, element: Element) -> str:
        base = self._base(element)
        if self._needs_group(element):
            base = "{" + base + "}"
        return base + "_{" + self.arg(element, "sub") + "}^{" + self.arg(element, "sup") + "}"

    def _needs_group(self, element: Element) -> bool:
        base = element.find(M + "e")
        if base is None:
            return False
        kids = [child for child in base if _local(child.tag) not in IGNORED]
        if len(kids) != 1:
            return len(kids) > 1
        if _local(kids[0].tag) == "r":
            text = "".join(t.text or "" for t in kids[0].iter(M + "t"))
            return len(text) > 1 and not text.isascii() or (len(text) > 1 and text.isalpha() and text not in FUNCTIONS)
        return _local(kids[0].tag) in ("sSub", "sSup", "sSubSup")

    def m_sPre(self, element: Element) -> str:
        return "{}_{" + self.arg(element, "sub") + "}^{" + self.arg(element, "sup") + "}" + self._base(element)

    def m_rad(self, element: Element) -> str:
        degree = "" if _on(element, "m:radPr/m:degHide") else self.arg(element, "deg")
        return (r"\sqrt[" + degree + "]{" if degree else r"\sqrt{") + self.arg(element, "e") + "}"

    def m_d(self, element: Element) -> str:
        props = element.find(M + "dPr")
        begin = _prop(props, "m:begChr", "(") if props is not None else "("
        end = _prop(props, "m:endChr", ")") if props is not None else ")"
        separator = _prop(props, "m:sepChr", "|") if props is not None else "|"
        parts = [child for child in element if child.tag == M + "e"]
        if begin not in DELIMITERS or end not in DELIMITERS:
            return self.problem(f"delimiter {begin!r}{end!r}")
        if begin == "{" and end == "" and len(parts) == 1:
            inner = [child for child in parts[0] if _local(child.tag) not in IGNORED]
            if len(inner) == 1 and _local(inner[0].tag) in ("eqArr", "m"):
                return self.cases(inner[0])
        sep = DELIMITERS.get(separator, separator)
        content = (" " + sep + " ").join(self.children(part) for part in parts)
        left, right = DELIMITERS[begin], DELIMITERS[end]
        if not self._tall(element):
            # Word builds half-open intervals from one-sided fences; plain
            # characters keep "[a, b)" readable instead of nested \left. pairs.
            return join_tokens([left if left != "." else "", content, right if right != "." else ""])
        return r"\left" + left + " " + content + r"\right" + right

    def _tall(self, element: Element) -> bool:
        tall = {"f", "nary", "eqArr", "m", "limLow", "limUpp", "groupChr"}
        return any(_local(child.tag) in tall for child in element.iter())

    def cases(self, element: Element) -> str:
        if _local(element.tag) == "eqArr":
            rows = [self.children(row).replace("&", "") for row in element if row.tag == M + "e"]
        else:
            rows = ["&".join(self.children(cell) for cell in row if cell.tag == M + "e")
                    for row in element if row.tag == M + "mr"]
        return r"\begin{cases}" + r"\\".join(rows) + r"\end{cases}"

    def m_eqArr(self, element: Element) -> str:
        rows = [self.children(row) for row in element if row.tag == M + "e"]
        if any("&" in row for row in rows):
            return r"\begin{aligned}" + r"\\".join(rows) + r"\end{aligned}"
        return r"\begin{array}{l}" + r"\\".join(rows) + r"\end{array}"

    def m_m(self, element: Element) -> str:
        rows = ["&".join(self.children(cell) for cell in row if cell.tag == M + "e")
                for row in element if row.tag == M + "mr"]
        return r"\begin{matrix}" + r"\\".join(rows) + r"\end{matrix}"

    def m_nary(self, element: Element) -> str:
        operator_char = _prop(element, "m:naryPr/m:chr", "∫")
        operator = NARY.get(operator_char)
        if operator is None:
            return self.problem(f"n-ary operator {operator_char!r}")
        lower = "" if _on(element, "m:naryPr/m:subHide") else self.arg(element, "sub")
        upper = "" if _on(element, "m:naryPr/m:supHide") else self.arg(element, "sup")
        out = operator
        if _prop(element, "m:naryPr/m:limLoc", "") == "undOvr" and operator not in (r"\sum", r"\prod"):
            out += r"\limits"
        if lower:
            out += "_{" + lower + "}"
        if upper:
            out += "^{" + upper + "}"
        return join_tokens([out, " " + self.arg(element, "e")])

    def m_func(self, element: Element) -> str:
        name = self.arg(element, "fName")
        return join_tokens([name, " " + self.arg(element, "e")])

    def m_limLow(self, element: Element) -> str:
        base = self.arg(element, "e")
        limit = self.arg(element, "lim")
        if base.startswith("\\") and base[1:] in FUNCTIONS:
            return base + "_{" + limit + "}"
        return r"\underset{" + limit + "}{" + base + "}"

    def m_limUpp(self, element: Element) -> str:
        return r"\overset{" + self.arg(element, "lim") + "}{" + self.arg(element, "e") + "}"

    def m_acc(self, element: Element) -> str:
        mark = _prop(element, "m:accPr/m:chr", "\u0302")
        command = ACCENTS.get(mark)
        if command is None:
            return self.problem(f"accent U+{ord(mark[0]):04X}" if mark else "accent")
        content = self.arg(element, "e")
        if len(content.replace(" ", "")) > 1 and command in WIDE_ACCENTS and not content.startswith("\\"):
            command = WIDE_ACCENTS[command]
        return command + "{" + content + "}"

    def m_bar(self, element: Element) -> str:
        position = _prop(element, "m:barPr/m:pos", "bot")
        return (r"\overline{" if position == "top" else r"\underline{") + self.arg(element, "e") + "}"

    def m_groupChr(self, element: Element) -> str:
        position = _prop(element, "m:groupChrPr/m:pos", "bot")
        char = _prop(element, "m:groupChrPr/m:chr", "\u23df")
        content = self.arg(element, "e")
        if char in ("\u23df", "\u23de"):
            return (r"\underbrace{" if position == "bot" else r"\overbrace{") + content + "}"
        if char in ("→", "⟶"):
            return r"\xrightarrow{" + content + "}" if position == "top" else r"\underset{" + content + r"}{\longrightarrow}"
        return self.problem(f"group character U+{ord(char[0]):04X}" if char else "group character")

    def m_box(self, element: Element) -> str:
        return self.arg(element, "e")

    def m_borderBox(self, element: Element) -> str:
        return r"\boxed{" + self.arg(element, "e") + "}"

    def m_phant(self, element: Element) -> str:
        if _on(element, "m:phantPr/m:show") or element.find(M + "phantPr") is None:
            return self.arg(element, "e")
        return ""

    def m_oMath(self, element: Element) -> str:
        return self.children(element)
