import { QuestionBank } from "../../components/QuestionBank";
import { getBankData } from "../../lib/question-repository";
import { headers } from "next/headers";

export const metadata = { title: "我的题库 · 拾题" };

export default async function BankPage() {
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  const data = await getBankData(ownerId);
  return <QuestionBank initialQuestions={data.questions} initialPagination={data.pagination} stats={data.stats} availableTags={data.tags} sources={data.sources} />;
}
