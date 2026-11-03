/**
 * Shared math/blank parsing used by the renderer, the extraction sanitizer and
 * the formatting screener. Kept dependency-free except for KaTeX validation so
 * the same rules apply in the browser, the server and tests.
 */
import katex from "katex";

export type MathToken =
  | { type: "text"; value: string }
  | { type: "math"; value: string; display: boolean };

export type BlankPart =
  | { type: "text"; value: string }
  | { type: "blank" };

/** Canonical storage form for one answer blank. Always used inside math mode. */
export const BLANK_LATEX = "\\underline{\\hspace{2em}}";

export const KATEX_MACROS: Record<string, string> = {
  "\\overparen": "\\overset{\\frown}{#1}",
  "\\overarc": "\\overset{\\frown}{#1}",
  "\\i": "i",
  "\\j": "j",
  "\\degree": "^{\\circ}",
};

const LATEX_COMMANDS = new Set([
  "frac", "dfrac", "tfrac", "cfrac", "sqrt", "pi", "alpha", "beta", "gamma", "delta",
  "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda",
  "mu", "nu", "xi", "omicron", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi",
  "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon",
  "Phi", "Psi", "Omega", "infty", "vec", "overrightarrow", "overleftarrow", "mathbf",
  "mathrm", "mathit", "mathbb", "mathcal", "text", "textrm", "textbf", "left", "right",
  "begin", "end", "therefore", "because", "geq", "geqslant", "leq", "leqslant", "neq",
  "approx", "equiv", "pm", "mp", "times", "div", "cdot", "ldots", "cdots", "angle",
  "triangle", "perp", "parallel", "sim", "subset", "subseteq", "cup", "cap", "in",
  "notin", "forall", "exists", "lim", "log", "ln", "lg", "sin", "cos", "tan", "cot",
  "sec", "csc", "arcsin", "arccos", "arctan", "circ", "sum", "prod", "int", "iint",
  "partial", "nabla", "overline", "underline", "hspace", "qquad", "quad", "boxed",
  "binom", "choose", "displaystyle", "complement", "emptyset", "varnothing", "square",
  "langle", "rangle", "leftrightarrow", "Leftrightarrow", "Rightarrow", "rightarrow",
  "to", "mapsto", "mid", "nmid", "ast", "star", "bullet", "prime", "degree", "overparen",
  "overarc", "phantom", "rule", "not", "subsetneqq", "supset", "supseteq", "parallel",
  "backslash", "setminus", "propto", "leqslant", "geqslant", "lvert", "rvert", "lVert",
  "rVert", "textstyle", "scriptstyle", "limits", "nolimits", "i", "j",
]);

function isEscapedAt(text: string, index: number) {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
}

function hasCjk(value: string) {
  return /[\u3400-\u9fff]/.test(value);
}

function looksLikeMath(value: string) {
  const source = value.trim();
  if (!source || source.length > 4_000) return false;
  // A lone currency mark followed by prose must stay text. Real question math
  // almost always contains a backslash, a script or a relation.
  if (!/[\\^_={}<>≤≥±×÷·√∞π]/.test(source)) return false;
  if (hasCjk(source) && !/\\[a-zA-Z]+/.test(source)) return false;
  return true;
}

/** A pair is rejected when the candidate body is plainly prose, not a formula. */
function plausibleMathBody(value: string) {
  if (!value.trim()) return false;
  // Reject only when a long Chinese passage was swallowed by a currency-like
  // dollar. Short labels such as §（5分）§ remain valid inline math, and a long
  // body with a relation/script is still a formula.
  if (value.length > 60 && hasCjk(value) && !/[\\=<>^_≤≥×÷]/.test(value)) return false;
  return true;
}

function findClosingDollar(text: string, from: number, display: boolean) {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] !== "$" || isEscapedAt(text, index)) continue;
    if (!display) return index;
    if (text[index + 1] === "$" && !isEscapedAt(text, index + 1)) return index;
  }
  return -1;
}

function findBracketClose(text: string, from: number, close: string) {
  for (let index = from; index < text.length; index += 1) {
    if (text.startsWith(close, index) && !isEscapedAt(text, index)) return index;
  }
  return -1;
}

/**
 * Split text into prose and math. A dollar is escaped only when preceded by an
 * odd number of backslashes; this is what makes `...\\$` (LaTeX row break then
 * the closing dollar) parse correctly, which the old look-behind regex missed.
 */
export function scanMathText(text: string): MathToken[] {
  const tokens: MathToken[] = [];
  const pushText = (value: string) => {
    if (value) tokens.push({ type: "text", value });
  };
  const pushMath = (value: string, display: boolean) => {
    if (value.trim()) tokens.push({ type: "math", value, display });
  };
  let textStart = 0;
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === "\\" && !isEscapedAt(text, index) && (text[index + 1] === "[" || text[index + 1] === "(")) {
      const display = text[index + 1] === "[";
      const close = display ? "\\]" : "\\)";
      const end = findBracketClose(text, index + 2, close);
      if (end >= 0) {
        pushText(text.slice(textStart, index));
        pushMath(text.slice(index + 2, end), display);
        index = end + 2;
        textStart = index;
        continue;
      }
    }
    if (character === "$" && !isEscapedAt(text, index)) {
      const display = text[index + 1] === "$" && !isEscapedAt(text, index + 1);
      const start = index + (display ? 2 : 1);
      const end = findClosingDollar(text, start, display);
      if (end >= 0 && plausibleMathBody(text.slice(start, end))) {
        pushText(text.slice(textStart, index));
        pushMath(text.slice(start, end), display);
        index = end + (display ? 2 : 1);
        textStart = index;
        continue;
      }
      // Unclosed formula at end of field: render what is left as math instead
      // of leaking a wall of raw LaTeX into the page. The screener still
      // records the missing delimiter for a proper data fix.
      if (end < 0 && looksLikeMath(text.slice(start))) {
        pushText(text.slice(textStart, index));
        pushMath(text.slice(start), display);
        index = text.length;
        textStart = index;
        continue;
      }
    }
    index += 1;
  }
  pushText(text.slice(textStart));
  return tokens;
}

const SPACING_CONTENT = String.raw`(?:\\(?:hspace|phantom|rule)\s*(?:\{[^{}]*\})?|\\(?:qquad|quad|,|;|:|!| )|\s|~)*`;
const OUTSIDE_BLANK = new RegExp(String.raw`(?:(?:\\_\s*){2,}|_{2,}|＿{2,}|\\underline\s*\{${SPACING_CONTENT}\}|\\hspace\s*\{[^{}]*\})`, "g");
const INSIDE_BLANK = new RegExp(String.raw`\\underline\s*\{${SPACING_CONTENT}\}`, "g");
const ONLY_SPACING = new RegExp(String.raw`^\s*(?:${SPACING_CONTENT})\s*$`);
const FRACTION = /\\(?:frac|dfrac|tfrac|cfrac|genfrac)\b/;
const FRACTION_COMMAND = /\\frac(?![a-zA-Z])/g;

function partsFor(value: string, pattern: RegExp) {
  const parts: BlankPart[] = [];
  const lastIndex = pattern.lastIndex;
  pattern.lastIndex = 0;
  let start = 0;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    if (match.index > start) parts.push({ type: "text", value: value.slice(start, match.index) });
    parts.push({ type: "blank" });
    start = match.index + match[0].length;
  }
  if (start < value.length) parts.push({ type: "text", value: value.slice(start) });
  pattern.lastIndex = lastIndex;
  return parts.length ? parts : [{ type: "text" as const, value }];
}

/** Split prose into text/blank pieces. */
export function splitOutsideBlanks(value: string): BlankPart[] {
  return partsFor(value, OUTSIDE_BLANK);
}

/** Split math source into text/blank pieces so blanks can use the same CSS. */
export function splitMathBlanks(value: string): BlankPart[] {
  if (ONLY_SPACING.test(value) && /\\[a-zA-Z]+/.test(value)) return [{ type: "blank" }];
  return partsFor(value, INSIDE_BLANK);
}

const BREAK_COMMANDS = [...LATEX_COMMANDS, "ne", "ni", "neg", "newline", "nleq", "ngeq", "top", "tilde", "textit", "tanh", "triangleq"]
  .filter((name) => (name.startsWith("n") || name.startsWith("t")) && name.length > 1);

/**
 * Literal `\n`/`\t` left by older extractions become real breaks, but never
 * when they begin a LaTeX command: `\triangle` must not become tab+`riangle`,
 * nor `\neq` a newline followed by `eq`.
 */
function normalizeLineBreaks(value: string) {
  return value.replace(/\\r\\n|\\([nt])([a-zA-Z]*)/g, (match, escape: string | undefined, rest: string | undefined, offset: number) => {
    if (isEscapedAt(value, offset)) return match;
    if (!escape) return "\n";
    const name = escape + (rest ?? "");
    if (BREAK_COMMANDS.some((command) => name.startsWith(command))) return match;
    return (escape === "n" ? "\n" : "\t") + (rest ?? "");
  });
}

/** Unescape punctuation that only exists to protect it from the math scanner. */
export function unescapeTextLiterals(value: string) {
  return value.replace(/\\([_%&#$])/g, "$1");
}

/** Display-only cleanup: real newlines instead of literal `\n`/`\t`. */
export function normalizeTextForDisplay(value: string) {
  return normalizeLineBreaks(value);
}

/**
 * Old answer-page transcriptions sometimes wrapped an already-filled answer in
 * `\underline{... $(1,1)$ ...}`. Splitting that across math tokens leaks raw
 * command text, so drop the outer underline for display; the screener can still
 * repair the stored form with page context.
 */
export function repairDisplayText(value: string) {
  // Answer-image markers are placed by AnalysisWithImages before text reaches
  // here; any marker left (for example a page-crop id in a stem) is noise.
  return normalizeTextForDisplay(value).replace(/[ \t]*\[\[image:[^\]]*\]\][ \t]*/g, "").replace(
    /\\underline\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
    (match, inner: string) => inner.includes("$") ? inner : match,
  );
}

function skipBalancedGroup(value: string, start: number) {
  if (value[start] !== "{") return start;
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") { index += 1; continue; }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function matchLatexRun(value: string, start: number) {
  if (value[start] !== "\\" || isEscapedAt(value, start)) return -1;
  const nameMatch = /^\\([a-zA-Z]+)/.exec(value.slice(start));
  if (!nameMatch) return -1;
  const name = nameMatch[1];
  if (!LATEX_COMMANDS.has(name)) return -1;
  let cursor = start + nameMatch[0].length;
  if (name === "begin") {
    const environment = /^\{([^{}]+)\}/.exec(value.slice(cursor));
    if (!environment) return -1;
    const end = value.indexOf(`\\end{${environment[1]}}`, cursor);
    return end < 0 ? -1 : end + `\\end{${environment[1]}}`.length;
  }
  if (name === "left") {
    const end = value.indexOf("\\right", cursor);
    if (end < 0) return -1;
    cursor = end + "\\right".length;
    if (value[cursor] === ".") cursor += 1;
    else if (value[cursor] === "\\") {
      const delimiter = /^\\[{}[\]()|.]/.exec(value.slice(cursor));
      if (delimiter) cursor += delimiter[0].length;
    } else if (cursor < value.length) cursor += 1;
    return cursor;
  }
  // Optional argument: \sqrt[3]{x}
  if (value[cursor] === "[") {
    const close = value.indexOf("]", cursor + 1);
    if (close > 0) cursor = close + 1;
  }
  for (;;) {
    if (value[cursor] === "{") {
      const next = skipBalancedGroup(value, cursor);
      if (next < 0) return -1;
      cursor = next;
      continue;
    }
    if (value[cursor] === "^" || value[cursor] === "_") {
      cursor += 1;
      if (value[cursor] === "{") {
        const next = skipBalancedGroup(value, cursor);
        if (next < 0) return -1;
        cursor = next;
      } else {
        cursor += 1;
      }
      continue;
    }
    break;
  }
  return cursor;
}

/**
 * Wrap recognizable bare LaTeX runs (for example an answer saved as
 * `\dfrac{2}{7}` with no dollar signs) so old data also renders.
 */
export function wrapBareLatex(value: string) {
  // A prose-free fragment that still carries scripts/relations is almost
  // certainly one formula whose delimiters were lost. Wrapping the whole
  // fragment keeps `g（x）_{max}=...` together instead of leaving `_{max}` raw.
  if (!value.includes("$") && !hasCjk(value) && /[\\^_=<>≤≥√]/.test(value)) return `$${value}$`;
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const slash = value.indexOf("\\", cursor);
    if (slash < 0) { output += value.slice(cursor); break; }
    output += value.slice(cursor, slash);
    const end = matchLatexRun(value, slash);
    if (end <= slash) { output += value[slash]; cursor = slash + 1; continue; }
    const run = value.slice(slash, end);
    // Never wrap a run that already contains a math delimiter: doing so would
    // create `$...$...$` and change which part is interpreted as math. Keep the
    // whole run untouched instead of descending into its inner commands.
    if (run.includes("$")) { output += run; cursor = end; continue; }
    output += `$${run}$`;
    cursor = end;
  }
  return output;
}

/**
 * Canonical text used for storage and for scrubbing extraction output:
 * blanks become `$\underline{\hspace{2em}}$`, bare formulas get delimiters,
 * literal `\n` becomes a real newline and inline fractions become display
 * fractions. Math delimiters are never nested.
 */
export function normalizeMathText(value: string) {
  const tokens = scanMathText(repairTrailingDollar(value));
  const output: string[] = [];
  const append = (next: string) => {
    if (!next) return;
    const previous = output.at(-1) ?? "";
    if (previous.endsWith("$") && next.startsWith("$")) output.push(" ");
    output.push(next);
  };
  for (const token of tokens) {
    if (token.type === "math") {
      const latex = normalizeLatex(token.value);
      append(token.display ? `$$${latex}$$` : `$${latex}$`);
      continue;
    }
    const text = normalizeLineBreaks(token.value);
    for (const part of splitOutsideBlanks(text)) {
      if (part.type === "blank") {
        append(`$${BLANK_LATEX}$`);
        continue;
      }
      append(wrapBareLatex(part.value));
    }
  }
  return output.join("");
}

/** Normalize one formula without wrapping it in delimiters. */
export function normalizeLatex(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed
    .replace(FRACTION_COMMAND, "\\dfrac")
    .replace(/\\tfrac(?![a-zA-Z])/g, "\\dfrac")
    .replace(/\\underline\s*\{\s*(?:\\quad|\\qquad|\\(?:hspace|phantom|rule)\s*(?:\{[^{}]*\})?|[\s~]*)\s*\}/g, BLANK_LATEX);
}

/** Add display style to inline fractions so they are not rendered small/flat. */
export function prepareLatex(value: string, display: boolean) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (!display && FRACTION.test(trimmed) && !/^\\displaystyle\b/.test(trimmed)) return `\\displaystyle ${trimmed}`;
  return trimmed;
}

/**
 * Repair the common "formula opens with $ but the closing dollar is missing"
 * case, but only when the scanner consumed the tail as an unclosed formula.
 * Other unbalanced cases are left for the page-aware screener.
 */
export function repairTrailingDollar(value: string) {
  let dollars = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "$" && !isEscapedAt(value, index)) dollars += 1;
  }
  if (dollars % 2 === 0) return value;
  const tokens = scanMathText(value);
  const last = tokens.at(-1);
  if (last?.type !== "math" || last.display) return value;
  if (!value.trimEnd().endsWith(last.value.trimEnd())) return value;
  return `${value.trimEnd()}$`;
}

export type MathFormatProblem =
  | { kind: "unbalanced_delimiter"; message: string }
  | { kind: "katex_error"; message: string }
  | { kind: "raw_latex"; message: string }
  | { kind: "raw_blank"; message: string };

/**
 * Report residual formatting problems. The screener uses this both to pick
 * candidates and to reject model patches that would leave broken math.
 */
export function findMathFormatProblems(value: string): MathFormatProblem[] {
  const problems: MathFormatProblem[] = [];
  for (const token of scanMathText(value)) {
    if (token.type === "math") {
      try {
        katex.renderToString(prepareLatex(token.value, token.display), {
          displayMode: token.display, throwOnError: true, strict: false, output: "html", macros: KATEX_MACROS,
        });
      } catch (error) {
        problems.push({ kind: "katex_error", message: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    if (/\\[a-zA-Z]+/.test(token.value.replace(/\\[nrt](?![a-zA-Z])/g, ""))) {
      problems.push({ kind: "raw_latex", message: token.value.slice(0, 160) });
    }
    if (/_{2,}|＿{2,}|(?:\\_){2,}/.test(token.value)) problems.push({ kind: "raw_blank", message: token.value.slice(0, 160) });
  }
  let dollars = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "$" && !isEscapedAt(value, index)) dollars += 1;
  }
  if (dollars % 2 === 1) problems.push({ kind: "unbalanced_delimiter", message: "dollar count is odd" });
  return problems;
}
