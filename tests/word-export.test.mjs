import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { normalizePaperSettings } from "../lib/paper-templates.ts";
import { buildPaperDocx, richTextLines } from "../lib/word-export.ts";
import { latexToOmml, serializeXml } from "../lib/word-math.ts";

const omml = (latex, display = false, bodySize) => serializeXml(latexToOmml(latex, display, bodySize), false);

/** Every opened element is closed in order: Word refuses a document with malformed equation XML. */
function assertWellFormed(xml) {
  const stack = [];
  for (const match of xml.matchAll(/<(\/?)([\w:]+)[^<>]*?(\/?)>/g)) {
    if (match[3]) continue;
    if (match[1]) assert.equal(stack.pop(), match[2], `unbalanced </${match[2]}>`);
    else stack.push(match[2]);
  }
  assert.deepEqual(stack, []);
}

/** Read one stored or deflated entry from a zip without a zip dependency. */
function zipEntry(bytes, name) {
  const buffer = Buffer.from(bytes);
  let offset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entries = buffer.readUInt16LE(offset + 10);
  offset = buffer.readUInt32LE(offset + 16);
  for (let index = 0; index < entries; index++) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const entryName = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (entryName === name) {
      const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      return method === 0 ? data : inflateRawSync(data);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

test("分式、根式与向量转换为 Word 原生公式结构", () => {
  const xml = omml("\\vec{a}\\cdot\\overrightarrow{AB}=\\frac{\\sqrt{3}}{2}");
  assertWellFormed(xml);
  assert.match(xml, /^<m:oMath>/);
  assert.equal((xml.match(/<m:acc>/g) ?? []).length, 2);
  assert.match(xml, /<m:f><m:fPr><m:type m:val="bar"\/><\/m:fPr><m:num><m:rad>/);
  assert.match(xml, /<m:degHide m:val="1"\/>/);
});

test("行内分式保持与正文等高，\\tfrac 与独立成行的公式不改字号", () => {
  // The renderer shows every inline \frac in display style, so the export does too.
  for (const command of ["\\dfrac", "\\frac"]) {
    const full = omml(`${command}{a+b}{2}`, false, 10.5);
    assert.equal((full.match(/<w:sz w:val="30"\/>/g) ?? []).length, 2);
    assert.match(full, /<m:r><w:rPr>.*?<\/w:rPr><m:t /);
  }
  assert.doesNotMatch(omml("\\tfrac{a+b}{2}", false, 10.5), /w:sz/);
  assert.doesNotMatch(omml("\\dfrac{a+b}{2}", true, 10.5), /w:sz/);
  assert.doesNotMatch(omml("\\dfrac{a+b}{2}"), /w:sz/);
  // The outer fraction sets the size once; a nested one inherits it instead of growing again.
  const nested = omml("\\dfrac{\\dfrac{1}{2}}{3}", false, 10.5);
  assert.doesNotMatch(nested, /w:val="43"/);
  assert.equal((nested.match(/<w:sz w:val="30"\/>/g) ?? []).length, 3);
});

test("\\left \\right 与分段函数生成可伸缩的定界符", () => {
  const interval = omml("\\left(\\dfrac{3}{2},\\sqrt{3}\\right]");
  assert.match(interval, /<m:d><m:dPr><m:begChr m:val="\("\/><m:endChr m:val="\]"\/><\/m:dPr><m:e>/);
  const cases = omml("f(x)=\\begin{cases}x^2, & x\\ge 0\\\\ -x, & x<0\\end{cases}");
  assertWellFormed(cases);
  assert.match(cases, /<m:begChr m:val="\{"\/><m:endChr m:val=""\/>/);
  assert.equal((cases.match(/<m:mr>/g) ?? []).length, 2);
  assert.equal((cases.match(/<m:mcJc m:val="left"\/>/g) ?? []).length, 2);
  assert.match(cases, /x&lt;0/);
  assert.match(omml("\\left|\\vec{a}\\right|"), /<m:begChr m:val="\|"\/><m:endChr m:val="\|"\/>/);
});

test("普通竖线不被当作关系符号", () => {
  const xml = omml("|\\vec{a}|=2");
  assert.doesNotMatch(xml, /∣/);
  assert.match(xml, /\|<\/m:t>/);
});

test("函数名、极限与求和带上各自的作用对象", () => {
  assert.match(omml("\\sin x"), /<m:func><m:fName><m:r><m:rPr><m:sty m:val="p"\/><\/m:rPr><m:t xml:space="preserve">sin<\/m:t><\/m:r><\/m:fName><m:e>/);
  assert.match(omml("\\lim_{x\\to 0}f(x)"), /<m:limLow><m:e>.*lim.*<\/m:e><m:lim>/);
  const sum = omml("\\sum_{i=1}^{n} a_i");
  assert.match(sum, /<m:nary><m:naryPr><m:chr m:val="∑"\/>/);
  assert.match(sum, /<m:e><m:sSub>/);
  assert.match(omml("\\int_0^1 x^2\\,\\mathrm{d}x"), /<m:chr m:val="∫"\/><m:limLoc m:val="subSup"\/>/);
});

test("撇号与角度写成普通字符，多行对齐保留对齐点", () => {
  assert.match(omml("f'(x)=30^\\circ"), /f′\(x\)=30°/);
  const aligned = omml("\\begin{aligned}a&=b+c\\\\&=d\\end{aligned}", true);
  assertWellFormed(aligned);
  assert.match(aligned, /^<m:oMathPara><m:oMath><m:eqArr>/);
  assert.equal((aligned.match(/<m:aln\/>/g) ?? []).length, 2);
});

test("字体变体、组合数与开方次数", () => {
  assert.match(omml("x\\in\\mathbb{R}"), /<m:scr m:val="double-struck"\/><m:sty m:val="p"\/>/);
  assert.match(omml("\\binom{n}{2}"), /<m:type m:val="noBar"\/>/);
  assert.match(omml("\\sqrt[3]{x}"), /<m:rad><m:deg><m:r><m:t xml:space="preserve">3<\/m:t><\/m:r><\/m:deg>/);
  assert.match(omml("\\overline{z}"), /<m:bar><m:barPr><m:pos m:val="top"\/>/);
  assert.match(omml("\\text{当 }x>0"), /<m:rPr><m:nor\/><\/m:rPr><m:t xml:space="preserve">当.<\/m:t>/);
});

test("KaTeX 无法解析的公式返回 null", () => {
  assert.equal(latexToOmml("\\frac{1}{", false), null);
});

test("文本、公式、填空与换行拆成段落内容", () => {
  const report = { formulas: 0, unconverted: false };
  const lines = richTextLines("已知 $x>0$，则 $\\underline{\\hspace{2em}}$.\n（1）求值：$$a^2+b^2$$（2）坏公式 $\\frac{1}{$", report);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[0].inlines.map(item => item.kind), ["text", "math", "text", "blank", "text"]);
  assert.equal(lines[2].display, true);
  assert.deepEqual(lines[3].inlines.map(item => item.kind), ["text", "raw"]);
  assert.equal(report.unconverted, true);
  assert.equal(report.formulas, 3);
});

const bbox = { x: 0, y: 0, width: 1, height: 1 };
const question = (id, type, stem, extra = {}) => ({
  id, number: "1", type, stem, answer: "", analysis: "", page: 1, bbox, regions: [], assets: [], tags: [],
  source: { subject: "数学" }, ...extra,
});
// 1x1 JPEG.
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z", "base64");

test("试卷导出为可打开的 docx：公式、选项制表位、题图与答案", async () => {
  const questions = [
    question("q1", "single", "若 $\\vec{a}\\perp\\vec{b}$，则 $\\dfrac{1}{2}$ 等于", {
      options: [{ key: "A", content: "$1$" }, { key: "B", content: "$2$" }, { key: "C", content: "$3$" }, { key: "D", content: "$4$" }],
      answer: "A", analysis: "由 $x^2=1$ 得.\n[[image:1]]",
      assets: [
        { id: "figure", kind: "figure", role: "question", page: 1, bbox, label: "" },
        { id: "solution", kind: "figure", role: "answer", page: 1, bbox, label: "解析图" },
        { id: "lost", kind: "figure", role: "question", page: 1, bbox, label: "" },
      ],
    }),
    question("q2", "fill", "函数的最小值为", { answer: "$0$" }),
    question("q3", "answer", "证明 $\\frac{1}{$ 成立.", { answer: "略", analysis: "略" }),
  ];
  const settings = normalizePaperSettings({}, questions);
  const images = new Map([
    ["figure", { data: jpeg, type: "jpg", width: 400, height: 300 }],
    ["solution", { data: jpeg, type: "jpg", width: 400, height: 300 }],
  ]);
  const student = await buildPaperDocx({ title: "单元测试卷", subtitle: "高一", questions, settings, includeAnswers: false, images });
  assert.equal(Buffer.from(student.bytes).subarray(0, 2).toString(), "PK");
  const xml = zipEntry(student.bytes, "word/document.xml").toString("utf8");
  assertWellFormed(xml);
  assert.equal((xml.match(/<m:oMath[ >]/g) ?? []).length, student.formulas - 1);
  assert.match(xml, /单元测试卷/);
  assert.match(xml, /A\. .*<w:tab\/>.*B\. .*<w:tab\/>.*C\. .*<w:tab\/>.*D\. /s);
  assert.match(xml, /\$\\frac\{1\}\{\$/);
  assert.equal((xml.match(/<w:drawing>/g) ?? []).length, 1);
  assert.doesNotMatch(xml, /答案：/);
  assert.deepEqual(student.unconvertedFormulas, ["3"]);
  assert.deepEqual(student.missingImages, ["1"]);

  const teacher = await buildPaperDocx({ title: "单元测试卷", subtitle: "高一", questions, settings, includeAnswers: true, images });
  const answers = zipEntry(teacher.bytes, "word/document.xml").toString("utf8");
  assertWellFormed(answers);
  assert.match(answers, /答案：/);
  assert.match(answers, /解析：/);
  assert.equal((answers.match(/<w:drawing>/g) ?? []).length, 2);
});

test("选项过长时自动减少每行个数；双栏试卷题目进入分栏节", async () => {
  const long = "这是一个比较长的选项内容用来测试换行";
  const questions = [question("q1", "single", "选择", { options: ["A", "B", "C", "D"].map(key => ({ key, content: long })) })];
  const settings = normalizePaperSettings({}, questions);
  const single = zipEntry((await buildPaperDocx({ title: "卷", subtitle: "", questions, settings, includeAnswers: false, images: new Map() })).bytes, "word/document.xml").toString("utf8");
  assert.equal((single.match(/<w:tab\/>/g) ?? []).length, 2);
  const twoColumns = { ...settings, style: { ...settings.style, columns: 2, pageSize: "A3", orientation: "landscape" } };
  const wide = zipEntry((await buildPaperDocx({ title: "卷", subtitle: "", questions, settings: twoColumns, includeAnswers: false, images: new Map() })).bytes, "word/document.xml").toString("utf8");
  assert.match(wide, /<w:cols [^>]*w:num="2"/);
  assert.match(wide, /<w:type w:val="continuous"\/>/);
});
