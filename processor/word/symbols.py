"""Unicode math characters to LaTeX, following the conventions of the question bank
(\\leqslant, \\geqslant, \\overrightarrow, \\varnothing)."""
from __future__ import annotations

GREEK = {
    "α": r"\alpha", "β": r"\beta", "γ": r"\gamma", "δ": r"\delta", "ε": r"\varepsilon", "ϵ": r"\epsilon",
    "ζ": r"\zeta", "η": r"\eta", "θ": r"\theta", "ϑ": r"\vartheta", "ι": r"\iota", "κ": r"\kappa",
    "λ": r"\lambda", "μ": r"\mu", "ν": r"\nu", "ξ": r"\xi", "π": r"\pi", "ϖ": r"\varpi", "ρ": r"\rho",
    "ϱ": r"\varrho", "σ": r"\sigma", "ς": r"\varsigma", "τ": r"\tau", "υ": r"\upsilon", "φ": r"\varphi",
    "ϕ": r"\phi", "χ": r"\chi", "ψ": r"\psi", "ω": r"\omega",
    "Γ": r"\Gamma", "Δ": r"\Delta", "Θ": r"\Theta", "Λ": r"\Lambda", "Ξ": r"\Xi", "Π": r"\Pi",
    "Σ": r"\Sigma", "Υ": r"\Upsilon", "Φ": r"\Phi", "Ψ": r"\Psi", "Ω": r"\Omega",
}

SYMBOLS = {
    "≤": r"\leqslant", "≥": r"\geqslant", "⩽": r"\leqslant", "⩾": r"\geqslant", "≦": r"\leqq", "≧": r"\geqq",
    "≠": r"\ne", "≈": r"\approx", "≡": r"\equiv", "≅": r"\cong", "∼": r"\sim", "∽": r"\backsim", "≌": r"\cong",
    "≪": r"\ll", "≫": r"\gg", "∝": r"\propto",
    "±": r"\pm", "∓": r"\mp", "×": r"\times", "÷": r"\div", "⋅": r"\cdot", "·": r"\cdot", "∙": r"\cdot",
    "−": "-", "∗": "*", "∘": r"\circ", "°": r"^{\circ}", "′": "'", "″": "''",
    "∈": r"\in", "∉": r"\notin", "∋": r"\ni", "⊂": r"\subset", "⊃": r"\supset", "⊆": r"\subseteq",
    "⊇": r"\supseteq", "⊊": r"\subsetneqq", "⫋": r"\subsetneqq", "⊋": r"\supsetneqq", "⫌": r"\supsetneqq",
    "⊄": r"\not\subset", "⊈": r"\nsubseteq", "∩": r"\cap", "∪": r"\cup", "∅": r"\varnothing", "Ø": r"\varnothing",
    "∁": r"\complement", "∖": r"\setminus",
    "∀": r"\forall", "∃": r"\exists", "¬": r"\neg", "∧": r"\wedge", "∨": r"\vee",
    "⇒": r"\Rightarrow", "⇐": r"\Leftarrow", "⇔": r"\Leftrightarrow", "→": r"\to", "←": r"\leftarrow",
    "↔": r"\leftrightarrow", "↑": r"\uparrow", "↓": r"\downarrow", "⟹": r"\Longrightarrow", "⟺": r"\Longleftrightarrow",
    "∞": r"\infty", "∂": r"\partial", "∇": r"\nabla", "∠": r"\angle", "△": r"\triangle", "▵": r"\triangle",
    "⊥": r"\perp", "∥": r"\parallel", "⫽": r"\parallel", "∵": r"\because", "∴": r"\therefore",
    "⋯": r"\cdots", "…": r"\cdots", "⋮": r"\vdots", "⋱": r"\ddots",
    "∑": r"\sum", "∏": r"\prod", "∫": r"\int", "∬": r"\iint", "∭": r"\iiint", "∮": r"\oint", "√": r"\surd",
    "ℕ": r"\mathbb{N}", "ℤ": r"\mathbb{Z}", "ℚ": r"\mathbb{Q}", "ℝ": r"\mathbb{R}", "ℂ": r"\mathbb{C}",
    "ℓ": r"\ell", "ℏ": r"\hbar", "⊙": r"\odot", "⊕": r"\oplus", "⊗": r"\otimes", "□": r"\square",
    "⌒": r"\frown", "|": "|", "‖": r"\|", "〈": r"\langle", "〉": r"\rangle", "⟨": r"\langle", "⟩": r"\rangle",
    "{": r"\{", "}": r"\}", "%": r"\%", "#": r"\#", "&": r"\&", "$": r"\$", "_": r"\_", "~": r"\sim",
    "\\": r"\backslash", "^": r"\hat{}",
    "∣": "|", "⟂": r"\perp", "∆": r"\triangle", "∶": ":", "ˊ": "'", "＇": "'",
    "〈": r"\langle", "〉": r"\rangle", "﹣": "-", "－": "-", "‐": "-", "‑": "-",
}

# Angle brackets by code point: editors normalise U+2329/U+232A to U+3008/U+3009.
SYMBOLS[chr(0x2329)] = r"\langle"
SYMBOLS[chr(0x232A)] = r"\rangle"

FUNCTIONS = {
    "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
    "ln", "lg", "log", "exp", "max", "min", "sup", "inf", "lim", "det", "dim", "deg", "gcd", "arg", "ker",
}

ASCII_SAFE = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-=<>()[],.;:!?/|'*@\"")


def is_cjk(char: str) -> bool:
    code = ord(char)
    return (0x3000 <= code <= 0x303F or 0x3400 <= code <= 0x9FFF or 0xF900 <= code <= 0xFAFF
            or 0xFF00 <= code <= 0xFFEF or 0x2018 <= code <= 0x201F)


def symbol_latex(char: str) -> str | None:
    """LaTeX for one character, or None when it has no safe mapping."""
    if char in ASCII_SAFE:
        return char
    if char in GREEK:
        return GREEK[char]
    if char in SYMBOLS:
        return SYMBOLS[char]
    if char.isspace():
        return " "
    return None


def text_latex(value: str) -> str:
    """Escape plain text for use inside \\text{}."""
    out = []
    for char in value:
        if char in "{}%#&$_":
            out.append("\\" + char)
        elif char == "\\":
            out.append(r"\backslash ")
        elif char in "^~":
            out.append(" ")
        else:
            out.append(char)
    return "".join(out)


def join_tokens(tokens: list[str]) -> str:
    """Concatenate LaTeX pieces, keeping control words from swallowing letters."""
    out = ""
    for token in tokens:
        if not token:
            continue
        if out and _ends_with_control_word(out) and (token[0].isalpha()):
            out += " "
        out += token
    return out


def _ends_with_control_word(value: str) -> bool:
    index = len(value) - 1
    while index >= 0 and value[index].isalpha():
        index -= 1
    return index >= 0 and index < len(value) - 1 and value[index] == "\\" and (index == 0 or value[index - 1] != "\\")
