import { headers } from "next/headers";
import { Workbench } from "../components/Workbench";
import { getBankData, getDocuments } from "../lib/backend-data";

export const metadata = { title: "工作台 · 拣题" };

export default async function Home() {
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  const [documents, bankData] = await Promise.all([getDocuments(ownerId), getBankData(ownerId)]);
  return <Workbench initialDocuments={documents} approvedQuestions={bankData.stats.approved} />;
}
