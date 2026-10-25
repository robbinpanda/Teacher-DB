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

test('rendering preserves a point on a circle and equal horizontal/vertical distances',()=>{
  const diagram={version:1,kind:'geometry',altText:'圆上的点P及等长半径',elements:[
    {type:'circle',center:[500,500],radius:250,label:''},
    {type:'point',at:[650,700],label:'P'},
    {type:'line',from:[500,500],to:[750,500],label:''},
    {type:'line',from:[500,500],to:[500,750],label:''},
  ]};
  const svg=renderQuestionDiagramSvg(parseQuestionDiagram(diagram));
  const circles=[...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map(m=>m.slice(1).map(Number));
  const [[cx,cy,r],[px,py]]=circles;
  assert.ok(Math.abs(Math.hypot(px-cx,py-cy)-r)<1e-8,'P must lie on the rendered circle');
  const lines=[...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)].map(m=>m.slice(1).map(Number));
  const lengths=lines.map(([x1,y1,x2,y2])=>Math.hypot(x2-x1,y2-y1));
  assert.deepEqual(lengths,[r,r]);
});
