import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getUploadedPaperData } from "../../../../lib/backend-data";
import { defaultPaperStyle, normalizePaperSettings, type PaperSection } from "../../../../lib/paper-templates";
import { PaperPrintable } from "../../../../components/PaperPrintable";

export const metadata = { title: "试卷阅读 · 拣题" };

export default async function UploadedPaperPage({ params, searchParams }: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ answers?: string }>;
}) {
  const { documentId } = await params;
  const query = await searchParams;
  const ownerId = (await headers()).get("oai-authenticated-user-id") ?? "local-demo";
  const paper = await getUploadedPaperData(documentId, ownerId);
  if (!paper) notFound();
  // Keep original ordering and numbering; do not assign invented exam scores.
  const sections: PaperSection[] = [];
  const labels = { single: "单项选择题", multiple: "多项选择题", fill: "填空题", answer: "解答题" };
  for (const question of paper.questions) {
    let section = sections.at(-1);
    if (!section || section.acceptedTypes[0] !== question.type) {
      section = { id: `source-${sections.length}`, title: labels[question.type], scoreDetail: "", acceptedTypes: [question.type], defaultScore: 0, questionIds: [] };
      sections.push(section);
    }
    section.questionIds.push(question.id);
  }
  const settings = normalizePaperSettings({ sections, notice: "", compact: false, infoFields: ["姓名", "班级"], style: { ...defaultPaperStyle, scoreStyle: "hidden" } }, paper.questions);
  const processing = ["uploading", "awaiting_model", "extracting"].includes(paper.status);
  const baseUrl = `/papers/uploaded/${documentId}`;
  return <main className="paper-preview-page">
    <nav className="resource-actions no-print">
      <Link className="btn" href="/papers">返回试卷库</Link>
      {paper.questions.length > 0 && <Link className="btn" href={`${baseUrl}${query.answers === "1" ? "" : "?answers=1"}`}>{query.answers === "1" ? "查看试卷" : "查看答案解析"}</Link>}
    </nav>
    {processing && paper.questions.length > 0 && <p className="paper-reading-notice no-print" role="status">试卷仍在处理中，当前展示已处理的 {paper.questions.length} 道题，刷新后可查看最新内容。</p>}
    {paper.questions.length > 0
      ? <PaperPrintable title={paper.title} subtitle={[paper.subject, paper.grade].filter(Boolean).join(" · ")} questions={paper.questions} settings={settings} includeAnswers={query.answers === "1"} preserveQuestionNumbers />
      : <section className="empty-state"><h1>{paper.title}</h1><h2>{processing ? "试卷正在处理中" : "暂时没有可展示的题目"}</h2><p>{processing ? "处理完成后，这里会直接展示排版后的试卷。" : paper.status === "failed" ? "本次处理未完成，可在工作台重新处理后查看。" : "这份试卷还没有保存的识别结果。"}</p></section>}
  </main>;
}
