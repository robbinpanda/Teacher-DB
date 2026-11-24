"""Turn a parsed MTEF tree into LaTeX.

Anything without a known meaning is reported in ``problems`` rather than
guessed, so the caller can keep the equation's preview image for review.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .mtef import Equation, Node, OPT_CHAR_FUNC_START
from .symbols import FUNCTIONS, is_cjk, join_tokens, symbol_latex, text_latex

# Typefaces (MTEF v5 style numbers).
FN_TEXT, FN_FUNCTION, FN_VARIABLE, FN_LCGREEK, FN_UCGREEK, FN_SYMBOL = 1, 2, 3, 4, 5, 6
FN_VECTOR, FN_NUMBER, FN_USER1, FN_USER2, FN_MTEXTRA, FN_TEXT_FE = 7, 8, 9, 10, 11, 12
FN_EXPAND, FN_MARKER, FN_SPACE = 22, 23, 24

# Template selectors.
T_ANGLE, T_PAREN, T_BRACE, T_BRACK, T_BAR, T_DBAR, T_FLOOR, T_CEILING, T_OBRACK = range(9)
T_INTERVAL, T_ROOT, T_FRACT, T_UBAR, T_OBAR, T_ARROW = 9, 10, 11, 12, 13, 14
T_INTEG, T_SUM, T_PROD, T_COPROD, T_UNION, T_INTER, T_INTOP, T_SUMOP, T_LIM = range(15, 24)
T_HBRACE, T_HBRACK, T_LDIV, T_SUB, T_SUP, T_SUBSUP, T_DIRAC = range(24, 31)
T_VEC, T_TILDE, T_HAT, T_ARC, T_JSTATUS, T_STRIKE, T_BOX = range(31, 38)

FENCES = {
    T_ANGLE: (r"\langle", r"\rangle"), T_PAREN: ("(", ")"), T_BRACE: (r"\{", r"\}"), T_BRACK: ("[", "]"),
    T_BAR: ("|", "|"), T_DBAR: (r"\|", r"\|"), T_FLOOR: (r"\lfloor", r"\rfloor"),
    T_CEILING: (r"\lceil", r"\rceil"), T_OBRACK: (r"[\![", r"]\!]"),
}
FENCE_CHARS = {"(": "(", ")": ")", "[": "[", "]": "]", "{": r"\{", "}": r"\}", "|": "|", "‖": r"\|",
               "〈": r"\langle", "〉": r"\rangle", "⟨": r"\langle", "⟩": r"\rangle", "⌊": r"\lfloor",
               "⌋": r"\rfloor", "⌈": r"\lceil", "⌉": r"\rceil"}
BIG_OPERATORS = {"∑": r"\sum", "∏": r"\prod", "∐": r"\coprod", "⋃": r"\bigcup", "⋂": r"\bigcap",
                 "∪": r"\bigcup", "∩": r"\bigcap", "∫": r"\int", "∬": r"\iint", "∭": r"\iiint", "∮": r"\oint"}
# Embellishments (MTEF v5 embellishment types).
EMBELLS = {
    2: r"\dot", 3: r"\ddot", 4: r"\dddot", 5: "'", 6: "''", 8: r"\tilde", 9: r"\hat",
    11: r"\vec", 12: r"\overleftarrow", 13: r"\overleftrightarrow", 17: r"\bar", 18: "'''",
}
# MT Extra private-use code points seen in school papers.
MT_EXTRA = {0xEB1A: r"\cdots", 0xEC0C: r"\cdots", 0xEB19: r"\ldots", 0xEC0B: r"\ldots", 0xF0A5: r"\infty",
            0xE98F: r"\parallel", 0xE9A1: r"\backsim", 0xEF04: r"\triangle", 0xEB26: r"\perp"}
SPACES = {0xE8D0: "", 0xE8D1: r"\,", 0xE8D2: r"\,", 0xE8D3: r"\:", 0xE8D4: r"\;", 0xE8D5: r"\quad",
          0xE8D6: r"\qquad", 0xEF00: "", 0xEF01: r"\,", 0xEF02: r"\,", 0xEF03: r"\;", 0xEF04: r"\quad",
          0xEF05: r"\qquad", 0xEF08: "", 0x2009: r"\,", 0x200A: r"\,", 0x2002: r"\;", 0x2003: r"\quad",
          0x00A0: " ", 0x0020: " "}


@dataclass
class Rendered:
    latex: str
    problems: list[str] = field(default_factory=list)


def equation_latex(equation: Equation) -> Rendered:
    renderer = _Renderer()
    parts = [renderer.line(line) for line in equation.lines if line.kind == "line"]
    pieces = [part for part in parts if part.strip()]
    latex = pieces[0] if len(pieces) == 1 else (r"\begin{array}{l}" + r"\\".join(pieces) + r"\end{array}" if pieces else "")
    if any(line.kind != "line" for line in equation.lines):
        others = [renderer.node_list([line]) for line in equation.lines if line.kind != "line"]
        latex = join_tokens([latex, *others])
    return Rendered(latex=_tidy(latex), problems=renderer.problems)


def _tidy(value: str) -> str:
    return " ".join(value.split()).strip()


class _Renderer:
    def __init__(self):
        self.problems: list[str] = []

    def problem(self, message: str) -> str:
        if message not in self.problems:
            self.problems.append(message)
        return ""

    # Containers -----------------------------------------------------------
    def line(self, node: Node | None) -> str:
        if node is None or node.null:
            return ""
        if node.kind != "line":
            return self.node_list([node])
        return self.node_list(node.children)

    def node_list(self, nodes: list[Node]) -> str:
        tokens: list[str] = []
        index = 0
        while index < len(nodes):
            node = nodes[index]
            if node.kind == "char" and self._groupable(node):
                end = index + 1
                while end < len(nodes) and self._same_run(node, nodes[end]):
                    end += 1
                tokens.append(self.run(nodes[index:end]))
                index = end
                continue
            if node.kind == "tmpl" and node.selector in (T_SUB, T_SUP, T_SUBSUP) and not node.variation & 0x1:
                # A script attaches to whatever precedes it; brace an empty base.
                script = self.scripts(node)
                if not tokens:
                    tokens.append("{}")
                tokens.append(script)
                index += 1
                continue
            tokens.append(self.node(node))
            index += 1
        return join_tokens(tokens)

    def node(self, node: Node) -> str:
        if node.kind == "char":
            return self.char(node)
        if node.kind == "line":
            return "{" + self.line(node) + "}"
        if node.kind == "tmpl":
            return self.template(node)
        if node.kind == "pile":
            return self.pile(node)
        if node.kind == "matrix":
            return self.matrix(node)
        return self.problem(f"unknown node {node.kind}")

    def pile(self, node: Node, cases: bool = False) -> str:
        rows = [self.line(child) for child in node.children if child.kind == "line"]
        if cases:
            return r"\begin{cases}" + r"\\".join(rows) + r"\end{cases}"
        align = {1: "l", 2: "c", 3: "r"}.get(node.halign, "l")
        return r"\begin{array}{" + align + "}" + r"\\".join(rows) + r"\end{array}"

    def matrix(self, node: Node, cases: bool = False) -> str:
        cells = [self.line(child) for child in node.children if child.kind == "line"]
        if node.rows < 1 or node.cols < 1 or len(cells) != node.rows * node.cols:
            return self.problem("matrix cell count mismatch")
        rows = ["&".join(cells[row * node.cols:(row + 1) * node.cols]) for row in range(node.rows)]
        if cases:
            return r"\begin{cases}" + r"\\".join(rows) + r"\end{cases}"
        return r"\begin{matrix}" + r"\\".join(rows) + r"\end{matrix}"

    # Characters -----------------------------------------------------------
    @staticmethod
    def _groupable(node: Node) -> bool:
        if node.mtcode is None or node.embells:
            return False
        char = chr(node.mtcode)
        if node.typeface in (FN_FUNCTION, FN_TEXT, FN_VECTOR) and char.isascii() and char.isalpha():
            return True
        return is_cjk(char) or (node.typeface in (FN_TEXT, FN_TEXT_FE) and node.typeface < 0)

    @staticmethod
    def _same_run(first: Node, other: Node) -> bool:
        if other.kind != "char" or other.mtcode is None or other.embells or other.typeface != first.typeface:
            return False
        if other.options & OPT_CHAR_FUNC_START:
            return False
        char, head = chr(other.mtcode), chr(first.mtcode)
        if is_cjk(head):
            return is_cjk(char) or char in "，。、；：！？（）《》“”"
        return char.isascii() and char.isalpha()

    def run(self, nodes: list[Node]) -> str:
        value = "".join(chr(node.mtcode) for node in nodes)
        face = nodes[0].typeface
        if is_cjk(value[0]):
            return r"\text{" + text_latex(value) + "}"
        if face == FN_VECTOR:
            return r"\mathbf{" + value + "}"
        if value in FUNCTIONS:
            return "\\" + value
        if face == FN_FUNCTION and len(value) > 1:
            return r"\operatorname{" + value + "}"
        if face == FN_FUNCTION and len(value) == 1:
            return r"\mathrm{" + value + "}"
        return r"\mathrm{" + value + "}"

    def char(self, node: Node) -> str:
        if node.mtcode is None:
            return self.problem("character without a code")
        code = node.mtcode
        latex = self.char_body(node)
        for kind in node.embells:
            accent = EMBELLS.get(kind)
            if accent is None:
                self.problem(f"embellishment {kind}")
            elif accent.startswith("'"):
                latex += accent
            else:
                latex = accent + "{" + latex + "}"
        if code > 0xFFFF:
            return self.problem(f"character U+{code:X}")
        return latex

    def char_body(self, node: Node) -> str:
        code = node.mtcode
        if node.typeface == FN_SPACE or code in SPACES:
            if code in SPACES:
                return SPACES[code]
            return self.problem(f"space U+{code:04X}")
        if 0xE000 <= code <= 0xF8FF:
            if code in MT_EXTRA:
                return MT_EXTRA[code]
            return self.problem(f"private character U+{code:04X}")
        char = chr(code)
        if is_cjk(char):
            return r"\text{" + text_latex(char) + "}"
        if node.typeface == FN_VECTOR and char.isalnum():
            return r"\mathbf{" + char + "}"
        if node.typeface in (FN_TEXT, FN_FUNCTION) and char.isalpha() and char.isascii():
            return r"\mathrm{" + char + "}"
        latex = symbol_latex(char)
        if latex is None:
            return self.problem(f"character U+{code:04X}")
        return latex

    # Templates ------------------------------------------------------------
    def slots(self, node: Node) -> tuple[list[Node], list[Node]]:
        lines = [child for child in node.children if child.kind in ("line", "pile", "matrix")]
        chars = [child for child in node.children if child.kind == "char"]
        return lines, chars

    def scripts(self, node: Node) -> str:
        lines, _ = self.slots(node)
        sub = self.line(lines[0]) if len(lines) > 0 else ""
        sup = self.line(lines[1]) if len(lines) > 1 else ""
        out = ""
        if sub:
            out += "_{" + sub + "}"
        if sup:
            out += "^{" + sup + "}"
        # An empty script box left in the equation prints nothing in MathType either.
        return out

    def template(self, node: Node) -> str:
        selector = node.selector
        lines, chars = self.slots(node)
        first = lines[0] if lines else None
        if selector in FENCES or selector == T_INTERVAL:
            return self.fence(node, lines, chars)
        if selector == T_ROOT:
            radicand = self.line(first)
            index = self.line(lines[1]) if len(lines) > 1 else ""
            return (r"\sqrt[" + index + "]{" if index else r"\sqrt{") + radicand + "}"
        if selector == T_FRACT:
            if len(lines) < 2:
                return self.problem("fraction without two parts")
            numerator, denominator = self.line(lines[0]), self.line(lines[1])
            if node.variation & 0x4:  # slash fraction
                return numerator + "/" + denominator
            return r"\frac{" + numerator + "}{" + denominator + "}"
        if selector in (T_SUB, T_SUP, T_SUBSUP):
            script = self.scripts(node)
            return "{}" + script
        if selector == T_UBAR:
            return r"\underline{" + self.line(first) + "}"
        if selector == T_OBAR:
            return r"\overline{" + self.line(first) + "}"
        if selector in (T_VEC, T_TILDE, T_HAT, T_ARC):
            return self.accent(node, first, chars)
        if selector == T_BOX:
            return r"\boxed{" + self.line(first) + "}"
        if selector == T_ARROW:
            top = self.line(lines[0]) if lines else ""
            bottom = self.line(lines[1]) if len(lines) > 1 else ""
            arrow = r"\xleftarrow" if chars and chr(chars[0].mtcode or 0) in "←⟵" else r"\xrightarrow"
            return arrow + ("[" + bottom + "]" if bottom else "") + "{" + top + "}"
        if selector in (T_INTEG, T_SUM, T_PROD, T_COPROD, T_UNION, T_INTER, T_INTOP, T_SUMOP):
            return self.big_operator(node, lines, chars)
        if selector == T_LIM:
            main = self.line(first)
            lower = self.line(lines[1]) if len(lines) > 1 else ""
            upper = self.line(lines[2]) if len(lines) > 2 else ""
            return main + (r"\limits" if lower or upper else "") + ("_{" + lower + "}" if lower else "") + ("^{" + upper + "}" if upper else "")
        if selector == T_HBRACE:
            main = self.line(first)
            label = self.line(lines[1]) if len(lines) > 1 else ""
            command = r"\overbrace" if node.variation & 0x1 else r"\underbrace"
            return command + "{" + main + "}" + (("^{" if command == r"\overbrace" else "_{") + label + "}" if label else "")
        return self.problem(f"template {selector}")

    def fence(self, node: Node, lines: list[Node], chars: list[Node]) -> str:
        if not lines:
            return self.problem("fence without content")
        content_node = lines[0]
        inner_nodes = content_node.children if content_node.kind == "line" else [content_node]
        cases = len(inner_nodes) == 1 and inner_nodes[0].kind in ("pile", "matrix")
        # The template says which sides exist; its glyphs (often MT Extra
        # private-use stretch pieces) only refine which bracket is drawn.
        glyphs = [FENCE_CHARS.get(chr(char.mtcode or 0)) for char in chars]
        if node.selector == T_INTERVAL:
            if len(glyphs) != 2 or None in glyphs:
                return self.problem("unknown interval fence")
            left, right = glyphs
        else:
            default_left, default_right = FENCES[node.selector]
            has_left = node.variation & 0x3 in (0, 0x1, 0x3)
            has_right = node.variation & 0x3 in (0, 0x2, 0x3)
            known = [glyph for glyph in glyphs if glyph]
            left = (known[0] if known and has_left else default_left) if has_left else None
            right = (known[-1] if known and has_right else default_right) if has_right else None
        if left == r"\{" and right is None and cases:
            inner = inner_nodes[0]
            return self.pile(inner, cases=True) if inner.kind == "pile" else self.matrix(inner, cases=True)
        content = self.line(content_node)
        return r"\left" + (left or ".") + " " + content + r"\right" + (right or ".")

    def accent(self, node: Node, first: Node | None, chars: list[Node]) -> str:
        content = self.line(first)
        mark = chr(chars[-1].mtcode) if chars and chars[-1].mtcode else ""
        if node.selector == T_VEC:
            if mark in ("\u20d7", "→", "\u20d1") or node.variation & 0x2 and not node.variation & 0x1:
                if node.variation & 0x8:
                    return r"\overset{\rightharpoonup}{" + content + "}"
                return r"\overrightarrow{" + content + "}"
            if mark in ("\u20d6", "←") or node.variation & 0x1 and not node.variation & 0x2:
                return r"\overleftarrow{" + content + "}"
            if node.variation & 0x3 == 0x3:
                return r"\overleftrightarrow{" + content + "}"
            return self.problem(f"vector variation {node.variation}")
        if node.selector == T_TILDE:
            return r"\widetilde{" + content + "}"
        if node.selector == T_HAT:
            return r"\widehat{" + content + "}"
        return r"\overset{\frown}{" + content + "}"

    def big_operator(self, node: Node, lines: list[Node], chars: list[Node]) -> str:
        # The operator glyph is either a direct character or the only character
        # of the last slot; the slots before it are main, lower and upper.
        operator_node = chars[-1] if chars else None
        slots = list(lines)
        if operator_node is None and slots:
            last = slots[-1]
            content = [child for child in last.children if child.kind == "char"] if last.kind == "line" else []
            if len(content) == 1 and len(last.children) == 1:
                operator_node = content[0]
                slots = slots[:-1]
        operator_char = chr(operator_node.mtcode) if operator_node is not None and operator_node.mtcode else ""
        operator = BIG_OPERATORS.get(operator_char)
        if operator is None:
            return self.problem(f"big operator {operator_char!r}")
        main = slots[0] if slots else None
        lower = slots[1] if len(slots) > 1 else None
        upper = slots[2] if len(slots) > 2 else None
        out = operator
        lower_latex, upper_latex = self.line(lower), self.line(upper)
        if lower_latex:
            out += "_{" + lower_latex + "}"
        if upper_latex:
            out += "^{" + upper_latex + "}"
        main_latex = self.line(main)
        return join_tokens([out, " " + main_latex]) if main_latex else out
