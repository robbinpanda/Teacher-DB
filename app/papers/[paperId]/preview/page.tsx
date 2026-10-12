import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPaperData } from "../../../../lib/backend-data";
import { normalizePaperSettings } from "../../../../lib/paper-templates";
import { PaperPrintable } from "../../../../components/PaperPrintable";

export const metadata = { title: "预览试卷 · 拣题" };
export default async function PaperPreview({ params, searchParams }: { params: Promise<{ paperId: string }>; searchParams: Promise<{ answers?: string }> }) {
  const { paperId } = await params;
  const query = await searchParams;
  const ownerId = (await headers()).get("oai-authenticated-user-id") ?? "local-demo";
  const paper = await getPaperData(paperId, ownerId);
  if (!paper) notFound();
  return <main className="paper-preview-page"><nav className="resource-actions"><Link className="btn" href="/papers">返回试卷库</Link><Link className="btn" href={`/papers/${paperId}`}>继续编辑</Link><Link className="btn" href={`/papers/${paperId}/preview${query.answers === "1" ? "" : "?answers=1"}`}>{query.answers === "1" ? "查看试卷" : "查看答案解析"}</Link></nav><PaperPrintable title={paper.title} subtitle={paper.subtitle} questions={paper.questions} settings={normalizePaperSettings(paper.settings, paper.questions)} includeAnswers={query.answers === "1"} /></main>;
}
