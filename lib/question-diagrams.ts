export type DiagramPoint = [number, number];

export type QuestionDiagramElement =
  | { type: "line"; from: DiagramPoint; to: DiagramPoint; label: string; dashed: boolean; arrowEnd: boolean }
  | { type: "point"; at: DiagramPoint; label: string }
  | { type: "circle"; center: DiagramPoint; radius: number; label: string }
  | { type: "polygon"; points: DiagramPoint[]; label: string }
  | { type: "polyline"; points: DiagramPoint[]; label: string; dashed: boolean; arrowEnd: boolean }
  | { type: "axes"; origin: DiagramPoint; xLabel: string; yLabel: string; grid: boolean }
  | { type: "text"; at: DiagramPoint; text: string };

export type QuestionDiagram = {
  version: 1;
  kind: "geometry" | "coordinate" | "chart";
  altText: string;
  elements: QuestionDiagramElement[];
};

const canvasWidth = 720;
const canvasHeight = 480;
const maxElements = 48;
const maxPointsPerElement = 96;

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}结构无效`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${label}包含不支持的字段：${extras.slice(0, 3).join("、")}`);
}

function text(value: unknown, limit: number, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if ((required && !result) || result.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) {
    throw new Error("题图文字为空、包含控制字符或长度超限");
  }
  return result;
}

function bool(value: unknown) {
  return value === true;
}

function coordinate(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000) throw new Error(`${label}必须在 0–1000 之间`);
  return Math.round(number * 1000) / 1000;
}

function point(value: unknown, label: string): DiagramPoint {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label}必须是 [x,y]`);
  return [coordinate(value[0], `${label}.x`), coordinate(value[1], `${label}.y`)];
}

function points(value: unknown, label: string, minimum = 2) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maxPointsPerElement) {
    throw new Error(`${label}点数必须在 ${minimum}–${maxPointsPerElement} 之间`);
  }
  return value.map((item, index) => point(item, `${label}[${index}]`));
}

export function parseQuestionDiagram(value: unknown): QuestionDiagram | null {
  if (value === undefined || value === null) return null;
  const root = record(value, "题图");
  exactKeys(root, ["version", "kind", "altText", "elements"], "题图");
  if (root.version !== 1) throw new Error("题图版本无效");
  const kind = String(root.kind);
  if (kind !== "geometry" && kind !== "coordinate" && kind !== "chart") throw new Error("题图类型无效");
  if (!Array.isArray(root.elements) || root.elements.length < 1 || root.elements.length > maxElements) {
    throw new Error(`题图图元数量必须在 1–${maxElements} 之间`);
  }
  const elements = root.elements.map((raw, index): QuestionDiagramElement => {
    const item = record(raw, `题图图元 ${index + 1}`);
    const type = String(item.type);
    const label = `题图图元 ${index + 1}`;
    if (type === "line") {
      exactKeys(item, ["type", "from", "to", "label", "dashed", "arrowEnd"], label);
      return { type, from: point(item.from, `${label}.from`), to: point(item.to, `${label}.to`), label: text(item.label, 40), dashed: bool(item.dashed), arrowEnd: bool(item.arrowEnd) };
    }
    if (type === "point") {
      exactKeys(item, ["type", "at", "label"], label);
      return { type, at: point(item.at, `${label}.at`), label: text(item.label, 40) };
    }
    if (type === "circle") {
      exactKeys(item, ["type", "center", "radius", "label"], label);
      const radius = Number(item.radius);
      if (!Number.isFinite(radius) || radius <= 0 || radius > 1000) throw new Error(`${label}.radius 无效`);
      return { type, center: point(item.center, `${label}.center`), radius: Math.round(radius * 1000) / 1000, label: text(item.label, 40) };
    }
    if (type === "polygon") {
      exactKeys(item, ["type", "points", "label"], label);
      return { type, points: points(item.points, `${label}.points`, 3), label: text(item.label, 40) };
    }
    if (type === "polyline") {
      exactKeys(item, ["type", "points", "label", "dashed", "arrowEnd"], label);
      return { type, points: points(item.points, `${label}.points`), label: text(item.label, 40), dashed: bool(item.dashed), arrowEnd: bool(item.arrowEnd) };
    }
    if (type === "axes") {
      exactKeys(item, ["type", "origin", "xLabel", "yLabel", "grid"], label);
      return { type, origin: point(item.origin, `${label}.origin`), xLabel: text(item.xLabel, 20) || "x", yLabel: text(item.yLabel, 20) || "y", grid: bool(item.grid) };
    }
    if (type === "text") {
      exactKeys(item, ["type", "at", "text"], label);
      return { type, at: point(item.at, `${label}.at`), text: text(item.text, 80, true) };
    }
    throw new Error(`${label}类型不受支持`);
  });
  return { version: 1, kind, altText: text(root.altText, 180, true), elements };
}

function xml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function scaled([x, y]: DiagramPoint): DiagramPoint {
  return [x / 1000 * canvasWidth, y / 1000 * canvasHeight];
}

function labelSvg(label: string, at: DiagramPoint) {
  if (!label) return "";
  const [x, y] = scaled(at);
  return `<text x="${x + 7}" y="${y - 7}" font-size="18" font-family="Arial, 'Noto Sans CJK SC', sans-serif" fill="#17211d">${xml(label)}</text>`;
}

export function renderQuestionDiagramSvg(input: QuestionDiagram) {
  const diagram = parseQuestionDiagram(input)!;
  const body: string[] = [];
  for (const element of diagram.elements) {
    if (element.type === "axes") {
      const [x, y] = scaled(element.origin);
      if (element.grid) {
        for (let gx = 40; gx < canvasWidth; gx += 40) body.push(`<line x1="${gx}" y1="0" x2="${gx}" y2="${canvasHeight}" class="grid"/>`);
        for (let gy = 40; gy < canvasHeight; gy += 40) body.push(`<line x1="0" y1="${gy}" x2="${canvasWidth}" y2="${gy}" class="grid"/>`);
      }
      body.push(`<line x1="18" y1="${y}" x2="${canvasWidth - 18}" y2="${y}" class="shape" marker-end="url(#arrow)"/>`);
      body.push(`<line x1="${x}" y1="${canvasHeight - 18}" x2="${x}" y2="18" class="shape" marker-end="url(#arrow)"/>`);
      body.push(`<text x="${canvasWidth - 32}" y="${Math.max(20, y - 9)}" class="axis-label">${xml(element.xLabel)}</text>`);
      body.push(`<text x="${Math.min(canvasWidth - 25, x + 10)}" y="28" class="axis-label">${xml(element.yLabel)}</text>`);
      continue;
    }
    if (element.type === "line") {
      const [x1, y1] = scaled(element.from); const [x2, y2] = scaled(element.to);
      body.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="shape${element.dashed ? " dashed" : ""}"${element.arrowEnd ? ' marker-end="url(#arrow)"' : ""}/>`);
      body.push(labelSvg(element.label, [(element.from[0] + element.to[0]) / 2, (element.from[1] + element.to[1]) / 2]));
      continue;
    }
    if (element.type === "point") {
      const [x, y] = scaled(element.at);
      body.push(`<circle cx="${x}" cy="${y}" r="4.5" fill="#111915"/>${labelSvg(element.label, element.at)}`);
      continue;
    }
    if (element.type === "circle") {
      const [cx, cy] = scaled(element.center);
      const radius = element.radius / 1000 * Math.min(canvasWidth, canvasHeight);
      body.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" class="shape" fill="none"/>${labelSvg(element.label, [element.center[0] + element.radius, element.center[1]])}`);
      continue;
    }
    if (element.type === "polygon" || element.type === "polyline") {
      const list = element.points.map((item) => scaled(item).join(",")).join(" ");
      const tag = element.type === "polygon" ? "polygon" : "polyline";
      const classes = `shape${element.type === "polyline" && element.dashed ? " dashed" : ""}`;
      const arrow = element.type === "polyline" && element.arrowEnd ? ' marker-end="url(#arrow)"' : "";
      body.push(`<${tag} points="${list}" class="${classes}" fill="${element.type === "polygon" ? "#f7faf8" : "none"}"${arrow}/>`);
      body.push(labelSvg(element.label, element.points[0]));
      continue;
    }
    const [x, y] = scaled(element.at);
    body.push(`<text x="${x}" y="${y}" class="annotation">${xml(element.text)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" role="img" aria-label="${xml(diagram.altText)}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#17211d"/></marker><style>.shape{stroke:#17211d;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}.dashed{stroke-dasharray:9 7}.grid{stroke:#dfe7e3;stroke-width:1}.axis-label,.annotation{font:18px Arial,'Noto Sans CJK SC',sans-serif;fill:#17211d}</style></defs><rect width="100%" height="100%" fill="white"/>${body.join("")}</svg>`;
}

export const questionDiagramSize = { width: canvasWidth, height: canvasHeight } as const;
