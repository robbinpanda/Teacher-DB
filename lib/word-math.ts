/**
 * LaTeX -> Word native equations (OMML).
 *
 * The formula goes through the same KaTeX parser and macros as the on-screen
 * renderer, so anything a teacher sees in the bank converts the same way here.
 * KaTeX's MathML uses a small, closed set of elements; this module maps that
 * set onto OMML directly so brackets grow, piecewise functions keep their
 * brace, and the result stays editable in Word, WPS and MathType's converter.
 *
 * Dependency-free apart from KaTeX so it can be unit tested without a server.
 */
import katex from "katex";
import { KATEX_MACROS, prepareLatex } from "./math-format.ts";

export type XmlNode = { name: string; attrs?: Record<string, string>; children: Array<XmlNode | string> };

type MathNode = { tag: string; attrs: Record<string, string>; children: MathNode[]; text: string };
/**
 * `display` follows KaTeX's displaystyle (`\dfrac`). `fractionSize` is the run
 * size, in half-points, that makes such a fraction full height inside a line.
 */
type Context = { display: boolean; fractionSize: number | null };

/** Word sets an inline fraction's numerator and denominator at this share of the text size. */
const INLINE_FRACTION_SCALE = 0.7;

export const OMML_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/math";

const FUNCTION_APPLICATION = "\u2061";
const INVISIBLE_OPERATORS = /[\u2061-\u2064]/g;
const NARY_OPERATORS = new Set([..."∑∏∐∫∬∭∮∯∰⋃⋂⋁⋀⨁⨂⨀⨄⨆"]);
const LIMIT_NAMES = new Set(["lim", "max", "min", "sup", "inf", "limsup", "liminf", "arg max", "arg min"]);
const PRIMES = /^[′″‴⁗']+$/;

/** Accent characters KaTeX emits, mapped to the combining form Word expects. */
const ACCENTS: Record<string, string> = {
  "\u20D7": "\u20D7", "→": "\u20D7", "←": "\u20D6", "↔": "\u20E1", "⇀": "\u20D1", "↼": "\u20D0",
  "^": "\u0302", "ˆ": "\u0302", "~": "\u0303", "˜": "\u0303", "∼": "\u0303",
  "ˉ": "\u0304", "¯": "\u0304", "˙": "\u0307", "¨": "\u0308", "ˇ": "\u030C", "˘": "\u0306",
  "´": "\u0301", "`": "\u0300", "˚": "\u030A",
};
const OVER_BARS = new Set(["‾", "―", "_"]);
const GROUP_CHARACTERS: Record<string, string> = { "⏞": "⏞", "⏟": "⏟", "⌢": "⏜", "⏜": "⏜", "⌣": "⏝", "⏝": "⏝" };
const DELIMITERS: Record<string, string> = { "∣": "|", "∥": "‖" };

const element = (name: string, children: Array<XmlNode | string> = [], attrs?: Record<string, string>): XmlNode => ({ name, attrs, children });
const property = (name: string, value: string) => element(name, [], { "m:val": value });

function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos|nbsp);/g, (_, code: string) => {
    if (code === "lt") return "<";
    if (code === "gt") return ">";
    if (code === "amp") return "&";
    if (code === "quot") return '"';
    if (code === "apos") return "'";
    if (code === "nbsp") return "\u00A0";
    return String.fromCodePoint(code[1] === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
  });
}

/** KaTeX emits well-formed MathML without comments, CDATA or processing instructions. */
function parseMathml(source: string): MathNode {
  const root: MathNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  for (const match of source.matchAll(/<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g)) {
    const top = stack.at(-1)!;
    if (match[5] !== undefined) { top.text += decodeEntities(match[5]); continue; }
    if (match[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs: Record<string, string> = {};
    for (const attribute of match[3].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[attribute[1]] = decodeEntities(attribute[2]);
    const node: MathNode = { tag: match[2], attrs, children: [], text: "" };
    top.children.push(node);
    if (!match[4]) stack.push(node);
  }
  return root;
}

const TOKENS = new Set(["mi", "mn", "mo", "mtext", "ms"]);
const isToken = (node: MathNode | undefined) => Boolean(node && TOKENS.has(node.tag));
const isSpace = (node: MathNode | undefined) => node?.tag === "mspace";

function textContent(node: MathNode): string {
  return node.text + node.children.map(textContent).join("");
}

/** Text of a token-only subtree (ignoring spacing), or null when it has real structure. */
function plainText(node: MathNode | undefined): string | null {
  if (!node) return null;
  if (isToken(node)) return textContent(node).replace(INVISIBLE_OPERATORS, "");
  if (node.tag === "mrow" || node.tag === "mstyle" || node.tag === "mpadded") {
    let value = "";
    for (const child of node.children) {
      if (isSpace(child)) continue;
      const text = plainText(child);
      if (text === null) return null;
      value += text;
    }
    return value;
  }
  return null;
}

function runStyle(node: MathNode) {
  if (node.tag === "mtext" || node.tag === "ms") return "nor";
  const variant = node.attrs.mathvariant;
  if (variant) {
    if (variant === "normal") return "p";
    if (variant === "bold") return "b";
    if (variant === "italic") return "i";
    if (variant === "bold-italic") return "bi";
    if (variant === "double-struck") return "p|double-struck";
    if (variant === "script") return "|script";
    if (variant === "bold-script") return "b|script";
    if (variant === "fraktur") return "p|fraktur";
    if (variant === "bold-fraktur") return "b|fraktur";
    if (variant.includes("sans-serif")) return `${variant.includes("bold") ? "b" : "p"}|sans-serif`;
    if (variant === "monospace") return "p|monospace";
  }
  // MathML: a multi-letter identifier (sin, lim, ln) is upright.
  if (node.tag === "mi" && [...textContent(node)].length > 1) return "p";
  return "";
}

function run(text: string, style = "", align = false): XmlNode {
  const properties: XmlNode[] = [];
  if (style === "nor") properties.push(element("m:nor"));
  else if (style) {
    const [weight, script] = style.split("|");
    if (script) properties.push(property("m:scr", script));
    if (weight) properties.push(property("m:sty", weight));
  }
  if (align) properties.push(element("m:aln"));
  const children: XmlNode[] = properties.length ? [element("m:rPr", properties)] : [];
  children.push(element("m:t", [text], { "xml:space": "preserve" }));
  return element("m:r", children);
}

const isRun = (node: XmlNode | string | undefined): node is XmlNode => typeof node === "object" && node.name === "m:r";
const runProperties = (node: XmlNode) => JSON.stringify(node.children.slice(0, -1));
const PLAIN_RUN = "[]";
const runText = (node: XmlNode) => (node.children.at(-1) as XmlNode).children[0] as string;

/** Join neighbouring runs with identical formatting; Word spaces operators by character class. */
function mergeRuns(nodes: XmlNode[]) {
  const merged: XmlNode[] = [];
  for (const node of nodes) {
    const previous = merged.at(-1);
    if (isRun(node) && isRun(previous) && runProperties(node) === runProperties(previous) && !runProperties(node).includes("m:aln")) {
      (previous.children.at(-1) as XmlNode).children[0] = runText(previous) + runText(node);
    } else merged.push(node);
  }
  return merged;
}

/** Word draws a dotted placeholder box for an empty argument; keep it invisible instead. */
const filled = (nodes: XmlNode[]) => nodes.length ? nodes : [run("\u200B")];

/**
 * Word shrinks every inline fraction and ignores `m:argPr/m:scrLvl`, so `\dfrac`
 * would print at 70% height. An explicit size on the runs is what Word honours;
 * nested scripts and fractions still scale relative to it.
 */
function resize(nodes: XmlNode[], size: number): XmlNode[] {
  return nodes.map(node => {
    if (node.name !== "m:r") return { ...node, children: node.children.map(child => typeof child === "string" ? child : resize([child], size)[0]) };
    if (node.children.some(child => typeof child === "object" && child.name === "w:rPr")) return node;
    const formatting = element("w:rPr", [
      element("w:rFonts", [], { "w:ascii": "Cambria Math", "w:hAnsi": "Cambria Math" }),
      element("w:sz", [], { "w:val": String(size) }),
      element("w:szCs", [], { "w:val": String(size) }),
    ]);
    return { ...node, children: [...node.children.slice(0, -1), formatting, node.children.at(-1)!] };
  });
}

function spaceFor(node: MathNode) {
  const width = Number.parseFloat(node.attrs.width ?? "0");
  if (!Number.isFinite(width) || width < 0.15) return "";
  if (width >= 0.9) return "\u2003".repeat(Math.max(1, Math.round(width)));
  if (width >= 0.4) return "\u2002";
  if (width >= 0.25) return "\u2005";
  return "\u2009";
}

function naryOperator(node: MathNode | undefined) {
  if (!node) return null;
  const base = ["munder", "mover", "munderover", "msub", "msup", "msubsup"].includes(node.tag) ? node.children[0] : node;
  if (base?.tag !== "mo") return null;
  const character = textContent(base);
  return NARY_OPERATORS.has(character) ? character : null;
}

function nary(node: MathNode, body: XmlNode[], context: Context): XmlNode {
  const character = naryOperator(node)!;
  const stacked = node.tag.startsWith("mu") || node.tag === "mover";
  let lower: MathNode | undefined, upper: MathNode | undefined;
  if (node.tag === "munderover" || node.tag === "msubsup") [, lower, upper] = node.children;
  else if (node.tag === "munder" || node.tag === "msub") lower = node.children[1];
  else if (node.tag === "mover" || node.tag === "msup") upper = node.children[1];
  return element("m:nary", [
    element("m:naryPr", [
      property("m:chr", character),
      property("m:limLoc", stacked ? "undOvr" : "subSup"),
      property("m:subHide", lower ? "0" : "1"),
      property("m:supHide", upper ? "0" : "1"),
    ]),
    element("m:sub", lower ? filled(convertList([lower], context)) : []),
    element("m:sup", upper ? filled(convertList([upper], context)) : []),
    element("m:e", filled(body)),
  ]);
}

function delimiter(children: MathNode[], context: Context): XmlNode | null {
  const items = children.filter(child => !(child.tag === "mo" && !textContent(child).replace(INVISIBLE_OPERATORS, "") && child.attrs.fence !== "true"));
  const first = items[0];
  if (first?.tag !== "mo" || first.attrs.fence !== "true") return null;
  const last = items.length > 1 && items.at(-1)!.tag === "mo" && items.at(-1)!.attrs.fence === "true" ? items.at(-1)! : null;
  const inner = items.slice(1, last ? -1 : undefined);
  const groups: MathNode[][] = [[]];
  let separator: string | null = null;
  for (const child of inner) {
    if (child.tag === "mo" && child.attrs.fence === "true") { separator ??= textContent(child); groups.push([]); }
    else groups.at(-1)!.push(child);
  }
  const character = (node: MathNode | null) => { const value = node ? textContent(node) : ""; return DELIMITERS[value] ?? value; };
  return element("m:d", [
    element("m:dPr", [
      property("m:begChr", character(first)),
      ...(separator !== null ? [property("m:sepChr", DELIMITERS[separator] ?? separator)] : []),
      property("m:endChr", character(last)),
    ]),
    ...groups.map(group => element("m:e", filled(convertList(group, context)))),
  ]);
}

function table(node: MathNode, context: Context): XmlNode {
  const rows = node.children.filter(child => child.tag === "mtr" || child.tag === "mlabeledtr")
    .map(row => row.children.filter(cell => cell.tag === "mtd"));
  const alignments = (node.attrs.columnalign ?? "center").trim().split(/\s+/);
  const columns = Math.max(1, ...rows.map(row => row.length));
  const inner = { ...context, display: false };
  // aligned/align environments: right-left column pairs with no gap are one equation per row.
  if (columns > 1 && alignments[0] === "right" && alignments[1] === "left" && (node.attrs.columnspacing ?? "").trim().startsWith("0em")) {
    return element("m:eqArr", rows.map(row => {
      const parts: XmlNode[] = [];
      row.forEach((cell, index) => {
        const converted = convertList(cell.children, inner);
        const head = converted[0];
        if (index % 2 === 1 && isRun(head) && runProperties(head) === PLAIN_RUN) {
          const characters = [...runText(head)];
          parts.push(run(characters[0], "", true));
          if (characters.length > 1) parts.push(run(characters.slice(1).join("")));
          parts.push(...converted.slice(1));
        } else parts.push(...converted);
      });
      return element("m:e", filled(parts));
    }));
  }
  return element("m:m", [
    element("m:mPr", [
      property("m:plcHide", "1"),
      element("m:mcs", Array.from({ length: columns }, (_, index) => element("m:mc", [element("m:mcPr", [
        property("m:count", "1"),
        property("m:mcJc", ["left", "right"].includes(alignments[Math.min(index, alignments.length - 1)]) ? alignments[Math.min(index, alignments.length - 1)] : "center"),
      ])]))),
    ]),
    ...rows.map(row => element("m:mr", Array.from({ length: columns }, (_, index) =>
      element("m:e", row[index] ? filled(convertList(row[index].children, inner)) : [run("\u200B")])))),
  ]);
}

function scripts(node: MathNode, context: Context): XmlNode[] {
  const [base, first, second] = node.children;
  const inner = { ...context, display: false };
  const baseNodes = () => filled(convertList(base ? [base] : [], context));
  const baseName = plainText(base);
  if (node.tag === "msup") {
    const exponent = plainText(first);
    if (exponent !== null && PRIMES.test(exponent)) return [...baseNodes(), run(exponent.replace(/'/g, "′"))];
    if (exponent === "∘") return [...baseNodes(), run("°")];
    return [element("m:sSup", [element("m:e", baseNodes()), element("m:sup", filled(convertList(first ? [first] : [], inner)))])];
  }
  if (node.tag === "msub") {
    // Exam papers put the limit under "lim" even inline; KaTeX only does so in display mode.
    if (baseName !== null && LIMIT_NAMES.has(baseName)) {
      return [element("m:limLow", [element("m:e", baseNodes()), element("m:lim", filled(convertList(first ? [first] : [], inner)))])];
    }
    return [element("m:sSub", [element("m:e", baseNodes()), element("m:sub", filled(convertList(first ? [first] : [], inner)))])];
  }
  const exponent = plainText(second);
  if (exponent !== null && PRIMES.test(exponent)) {
    return [element("m:sSub", [element("m:e", [...baseNodes(), run(exponent.replace(/'/g, "′"))]), element("m:sub", filled(convertList(first ? [first] : [], inner)))])];
  }
  return [element("m:sSubSup", [
    element("m:e", baseNodes()),
    element("m:sub", filled(convertList(first ? [first] : [], inner))),
    element("m:sup", filled(convertList(second ? [second] : [], inner))),
  ])];
}

function groupCharacter(character: string, top: boolean, body: XmlNode[]) {
  return element("m:groupChr", [
    element("m:groupChrPr", [property("m:chr", character), property("m:pos", top ? "top" : "bot"), property("m:vertJc", top ? "bot" : "top")]),
    element("m:e", filled(body)),
  ]);
}

function stacked(node: MathNode, context: Context): XmlNode[] {
  const [base, first, second] = node.children;
  const inner = { ...context, display: false };
  const body = filled(convertList(base ? [base] : [], context));
  const limit = (name: "m:limLow" | "m:limUpp", content: XmlNode[], mark: MathNode | undefined) =>
    element(name, [element("m:e", content), element("m:lim", filled(convertList(mark ? [mark] : [], inner)))]);
  if (node.tag === "munderover") return [limit("m:limUpp", [limit("m:limLow", body, first)], second)];
  const mark = first && isToken(first) ? textContent(first) : null;
  if (node.tag === "mover") {
    if (mark !== null && OVER_BARS.has(mark)) return [element("m:bar", [element("m:barPr", [property("m:pos", "top")]), element("m:e", body)])];
    if (mark !== null && GROUP_CHARACTERS[mark]) return [groupCharacter(GROUP_CHARACTERS[mark], true, body)];
    if (mark !== null && ACCENTS[mark]) return [element("m:acc", [element("m:accPr", [property("m:chr", ACCENTS[mark])]), element("m:e", body)])];
    return [limit("m:limUpp", body, first)];
  }
  if (mark !== null && OVER_BARS.has(mark)) return [element("m:bar", [element("m:barPr", [property("m:pos", "bot")]), element("m:e", body)])];
  if (mark !== null && GROUP_CHARACTERS[mark]) return [groupCharacter(GROUP_CHARACTERS[mark], false, body)];
  return [limit("m:limLow", body, first)];
}

function enclose(node: MathNode, context: Context): XmlNode[] {
  const notation = (node.attrs.notation ?? "").split(/\s+/);
  const body = convertList(node.children, context);
  const strikes = [
    notation.includes("updiagonalstrike") && "m:strikeBLTR",
    notation.includes("downdiagonalstrike") && "m:strikeTLBR",
    notation.includes("horizontalstrike") && "m:strikeH",
  ].filter(Boolean) as string[];
  const boxed = notation.includes("box");
  if (!boxed && !strikes.length) return body;
  return [element("m:borderBox", [
    element("m:borderBoxPr", [
      ...(boxed ? [] : ["m:hideTop", "m:hideBot", "m:hideLeft", "m:hideRight"].map(name => property(name, "1"))),
      ...["m:strikeH", "m:strikeBLTR", "m:strikeTLBR"].filter(name => strikes.includes(name)).map(name => property(name, "1")),
    ]),
    element("m:e", filled(body)),
  ])];
}

function convertNode(node: MathNode, context: Context): XmlNode[] {
  switch (node.tag) {
    case "mi": case "mn": case "mo": case "mtext": case "ms": {
      let text = textContent(node).replace(INVISIBLE_OPERATORS, "");
      // KaTeX writes a plain `|` as U+2223, which Word spaces like a relation: |a| would print as ∣ a ∣.
      if (node.tag === "mi") text = text.replace(/[∣∥]/g, character => DELIMITERS[character]);
      return text ? [run(text, runStyle(node))] : [];
    }
    case "mspace": { const space = spaceFor(node); return space ? [run(space)] : []; }
    case "annotation": case "annotation-xml": return [];
    case "mrow": return delimiter(node.children, context) ? [delimiter(node.children, context)!] : convertList(node.children, context);
    case "mstyle": return convertList(node.children, node.attrs.displaystyle ? { ...context, display: node.attrs.displaystyle === "true" } : context);
    case "mfrac": {
      const [numerator, denominator] = node.children;
      const type = node.attrs.linethickness?.startsWith("0") ? "noBar" : node.attrs.bevelled === "true" ? "skw" : "bar";
      // Fractions nested inside a full-size one inherit its run size, so only the outermost resizes.
      const enlarge = context.display && context.fractionSize !== null;
      const inner = { display: false, fractionSize: enlarge ? null : context.fractionSize };
      const part = (child: MathNode | undefined) => {
        const nodes = filled(convertList(child ? [child] : [], inner));
        return enlarge ? resize(nodes, context.fractionSize!) : nodes;
      };
      return [element("m:f", [element("m:fPr", [property("m:type", type)]), element("m:num", part(numerator)), element("m:den", part(denominator))])];
    }
    case "msqrt": return [element("m:rad", [element("m:radPr", [property("m:degHide", "1")]), element("m:deg"), element("m:e", filled(convertList(node.children, context)))])];
    case "mroot": return [element("m:rad", [
      element("m:deg", filled(convertList(node.children[1] ? [node.children[1]] : [], { ...context, display: false }))),
      element("m:e", filled(convertList(node.children[0] ? [node.children[0]] : [], context))),
    ])];
    case "msub": case "msup": case "msubsup": return scripts(node, context);
    case "munder": case "mover": case "munderover": return stacked(node, context);
    case "mtable": return [table(node, context)];
    case "menclose": return enclose(node, context);
    case "mphantom": return [element("m:phant", [element("m:phantPr", [property("m:show", "0")]), element("m:e", filled(convertList(node.children, context)))])];
    default: {
      if (node.children.length) return convertList(node.children, context);
      const text = textContent(node);
      return text ? [run(text, "nor")] : [];
    }
  }
}

function convertList(nodes: MathNode[], context: Context): XmlNode[] {
  const output: XmlNode[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    let next = index + 1;
    while (isSpace(nodes[next])) next++;
    // Big operators and named functions take the following term as their operand, as Word does.
    if (naryOperator(node)) {
      if (nodes[next]) { output.push(nary(node, convertList([nodes[next]], context), context)); index = next; continue; }
      if (node.tag !== "mo") { output.push(nary(node, [], context)); continue; }
    }
    const application = nodes[index + 1];
    if (application?.tag === "mo" && textContent(application) === FUNCTION_APPLICATION && node.tag !== "mo") {
      let operand = index + 2;
      while (isSpace(nodes[operand])) operand++;
      const name = convertNode(node, context);
      if (nodes[operand] && name.length) {
        output.push(element("m:func", [element("m:fName", name), element("m:e", filled(convertList([nodes[operand]], context)))]));
        index = operand;
      } else { output.push(...name); index += 1; }
      continue;
    }
    output.push(...convertNode(node, context));
  }
  return mergeRuns(output);
}

/** Convert a MathML fragment (as produced by KaTeX) to an `m:oMath` element. */
export function mathmlToOmml(mathml: string, fractionSize: number | null = null): XmlNode {
  const root = parseMathml(mathml);
  const math = root.children.find(child => child.tag === "math") ?? root;
  return element("m:oMath", filled(convertList(math.children, { display: false, fractionSize })));
}

/**
 * Convert one formula. Returns null when KaTeX rejects the source, matching the
 * on-screen "公式待核对" case; callers decide how to show that in the document.
 *
 * `bodySize` (points) keeps `\dfrac` at full height inside a line of that size.
 * A formula on its own line is already laid out full size by Word.
 */
export function latexToOmml(latex: string, display: boolean, bodySize?: number): XmlNode | null {
  let html: string;
  try {
    html = katex.renderToString(prepareLatex(latex, display), {
      displayMode: display, throwOnError: true, strict: false, output: "mathml", trust: false, macros: { ...KATEX_MACROS },
    });
  } catch {
    return null;
  }
  const mathml = html.match(/<math[\s\S]*<\/math>/)?.[0];
  if (!mathml) return null;
  const math = mathmlToOmml(mathml, !display && bodySize ? Math.round(bodySize * 2 / INLINE_FRACTION_SCALE) : null);
  return display ? element("m:oMathPara", [math]) : math;
}

const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (value: string) => escapeText(value).replace(/"/g, "&quot;");

/** Serialize for tests and diagnostics; the document builder consumes the tree directly. */
export function serializeXml(node: XmlNode | string, namespaces = true): string {
  if (typeof node === "string") return escapeText(node);
  const attrs = Object.entries({ ...(namespaces ? { "xmlns:m": OMML_NAMESPACE } : {}), ...node.attrs })
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("");
  if (!node.children.length) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${node.children.map(child => serializeXml(child, false)).join("")}</${node.name}>`;
}
