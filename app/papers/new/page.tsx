import { PaperBuilder } from "../../../components/PaperBuilder";
import { getApprovedQuestions } from "../../../lib/question-repository";
import { headers } from "next/headers";

export const metadata = { title: "智能组卷 · 拾题" };

export default async function NewPaperPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const query = await searchParams;
  const requestedIds = (query.ids ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  const questions = await getApprovedQuestions(ownerId);
  return <PaperBuilder questions={questions} initialIds={requestedIds} />;
}
