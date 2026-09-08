import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { parseQuestionDiagram, renderQuestionDiagramSvg } from "../lib/question-diagrams.ts";

const valid = {
  version: 1,
  kind: "geometry",
  altText: "三角形 ABC，其中 AB 有箭头",
  elements: [
    { type: "polygon", points: [[160, 760], [500, 160], [840, 760]], label: "△ABC" },
    { type: "point", at: [160, 760], label: "A" },
    { type: "point", at: [500, 160], label: "B" },
    { type: "line", from: [160, 760], to: [500, 160], label: "", arrowEnd: true },
  ],
};

test("validates and renders the restricted question diagram DSL", () => {
  const diagram = parseQuestionDiagram(valid);
  assert.equal(diagram.kind, "geometry");
  const svg = renderQuestionDiagramSvg(diagram);
  assert.match(svg, /^<svg/);
  assert.match(svg, /marker-end="url\(#arrow\)"/);
  assert.doesNotMatch(svg, /<script|\b(?:href|src)=["'](?:javascript:|https?:)/i);
});

test("the open-source image engine rasterizes diagrams into stable PNG dimensions", async () => {
  const diagram = parseQuestionDiagram(valid);
  const png = await sharp(Buffer.from(renderQuestionDiagramSvg(diagram))).png().toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.deepEqual([metadata.width, metadata.height], [720, 480]);
});

test("rejects executable or out-of-bounds diagram content", () => {
  assert.throws(() => parseQuestionDiagram({
    ...valid,
    elements: [{ type: "text", at: [100, 100], text: "ok", href: "javascript:alert(1)" }],
  }), /不支持的字段/);
  assert.throws(() => parseQuestionDiagram({ ...valid, elements: [{ type: "point", at: [-1, 20], label: "A" }] }), /0–1000/);
});

test("escapes labels before placing them in SVG", () => {
  const diagram = parseQuestionDiagram({ ...valid, altText: "<不可信>", elements: [{ type: "text", at: [100, 100], text: "<b>&文字" }] });
  const svg = renderQuestionDiagramSvg(diagram);
  assert.match(svg, /&lt;b&gt;&amp;文字/);
  assert.doesNotMatch(svg, /<b>/);
});
