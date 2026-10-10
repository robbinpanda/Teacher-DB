import { notFound } from "next/navigation";
import { PaperPrintable } from "../../../../components/PaperPrintable";
import { getPaperPrintDataForToken } from "../../../../lib/backend-data";
import { normalizePaperSettings } from "../../../../lib/paper-templates";

export const dynamic = "force-dynamic";
export const metadata = { title: "试卷 PDF · 拣题", robots: { index: false, follow: false } };

export default async function PaperPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ paperId: string }>;
  searchParams: Promise<{ token?: string; answers?: string }>;
}) {
  const { paperId } = await params;
  const query = await searchParams;
  const paper = await getPaperPrintDataForToken(paperId, query.token).catch(() => null);
  if (!paper) notFound();
  const settings = normalizePaperSettings(paper.settings, paper.questions);
  return (
    <main className="paper-print-root">
      <PaperPrintable title={paper.title} subtitle={paper.subtitle} questions={paper.questions} settings={settings} includeAnswers={query.answers === "1"} />
    </main>
  );
}
