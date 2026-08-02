import { ReviewWorkspace } from "../../../components/ReviewWorkspace";
import { getReviewData } from "../../../lib/question-repository";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

export const metadata = { title: "人工审核 · 拾题" };

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ documentId: string }>; searchParams: Promise<{ question?: string }> }) {
  const { documentId } = await params;
  const query = await searchParams;
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  const data = await getReviewData(documentId, ownerId);
  if (!data) notFound();
  return <ReviewWorkspace sourceDocument={data.document} pages={data.pages} initialQuestions={data.questions} initialActiveId={query.question} />;
}
