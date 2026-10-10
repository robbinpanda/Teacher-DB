import { PaperBuilder } from "../../../components/PaperBuilder";
import { getApprovedQuestions } from "../../../lib/backend-data";
import { headers } from "next/headers";
import { getPaperTemplates } from "../../../lib/backend-data";

export const metadata = { title: "组卷 · 拣题" };

export default async function NewPaperPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const query = await searchParams;
  const requestedIds = (query.ids ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  const questions = await getApprovedQuestions(ownerId);
  const templates = await getPaperTemplates(ownerId);
  return <PaperBuilder questions={questions} initialIds={requestedIds} templates={templates} />;
}
