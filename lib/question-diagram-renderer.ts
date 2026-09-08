import "server-only";

import sharp from "sharp";
import { parseQuestionDiagram, renderQuestionDiagramSvg, type QuestionDiagram } from "./question-diagrams.ts";

export async function renderQuestionDiagramPng(input: QuestionDiagram | unknown) {
  const diagram = parseQuestionDiagram(input);
  if (!diagram) throw new Error("题图数据为空");
  const svg = renderQuestionDiagramSvg(diagram);
  return sharp(Buffer.from(svg), { failOn: "error" }).png({ compressionLevel: 9, palette: true }).toBuffer();
}
