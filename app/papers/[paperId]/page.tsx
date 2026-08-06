import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PaperBuilder } from "../../../components/PaperBuilder";
import { getPaperTemplates } from "../../../lib/paper-template-repository";
import { normalizePaperSettings } from "../../../lib/paper-templates";
import { getApprovedQuestions, getPaperData } from "../../../lib/question-repository";

export const metadata = { title: "编辑试卷 · 拾题" };

export default async function EditPaperPage({ params }: { params: Promise<{ paperId: string }> }) {
  const { paperId } = await params;
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  const [paper, questions, templates] = await Promise.all([
    getPaperData(paperId, ownerId),
    getApprovedQuestions(ownerId),
    getPaperTemplates(ownerId),
  ]);
  if (!paper) notFound();
  const settings = normalizePaperSettings(paper.settings, questions);
  const initialIds = settings.sections.flatMap((section) => section.questionIds);
  return <PaperBuilder questions={questions} initialIds={initialIds} templates={templates} initialPaper={{ id: paper.id, title: paper.title, subtitle: paper.subtitle, settings }} />;
}
