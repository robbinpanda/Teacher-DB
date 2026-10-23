import { notFound } from "next/navigation";
import { getAuthoringDocumentForToken } from "../../../../lib/backend-data";
import { AuthoringDocument } from "../../../../components/AuthoringDocument";
export const dynamic = "force-dynamic";
export const metadata = { title: "讲义与教辅 PDF · 拣题", robots: { index: false, follow: false } };
export default async function Print({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ token?: string; answers?: string }> }) {
  const { projectId } = await params, query = await searchParams;
  const document = await getAuthoringDocumentForToken(projectId, query.token).catch(() => null);
  if (!document) notFound();
  return <main className="paper-print-root"><AuthoringDocument document={document} answers={query.answers === "1"} /></main>;
}
