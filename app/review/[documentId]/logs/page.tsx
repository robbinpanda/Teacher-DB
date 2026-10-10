import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getReviewData } from "../../../../lib/backend-data";
import { DocumentModelLogs } from "../../../../components/review/DocumentModelLogs";

export const metadata = { title: "识别日志 · 拣题" };
export default async function ModelLogsPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const requestHeaders = await headers();
  const data = await getReviewData(documentId, requestHeaders.get("oai-authenticated-user-id") ?? "local-demo");
  if (!data) notFound();
  return <DocumentModelLogs documentId={documentId} documentName={data.document.name} documentError={data.document.error} />;
}
