import { notFound } from "next/navigation";
import { PaperPrintable } from "../../../../components/PaperPrintable";
import { verifyPaperExportToken } from "../../../../lib/paper-export-token";
import { getPaperPrintData } from "../../../../lib/question-repository";

export const dynamic = "force-dynamic";
export const metadata = { title: "试卷 PDF · 拾题", robots: { index: false, follow: false } };

export default async function PaperPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ paperId: string }>;
  searchParams: Promise<{ token?: string; answers?: string }>;
}) {
  const { paperId } = await params;
  const query = await searchParams;
  const claims = verifyPaperExportToken(query.token, paperId);
  if (!claims) notFound();
  const paper = await getPaperPrintData(paperId, claims.ownerId);
  if (!paper) notFound();
  const answerSpaces = paper.settings.answerSpaces && typeof paper.settings.answerSpaces === "object"
    ? Object.fromEntries(Object.entries(paper.settings.answerSpaces).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
    : {};
  return (
    <main className="paper-print-root">
      <PaperPrintable title={paper.title} subtitle={paper.subtitle} questions={paper.questions} includeAnswers={query.answers === "1"} answerSpaces={answerSpaces} />
    </main>
  );
}
