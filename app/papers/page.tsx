import { headers } from "next/headers";
import { PaperLibrary } from "../../components/PaperLibrary";
import { getPaperLibrary } from "../../lib/paper-library";

export const metadata = { title: "试卷库 · 拾题" };

export default async function PapersPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const query = await searchParams;
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  const library = await getPaperLibrary(ownerId);
  return <PaperLibrary initialFolders={library.folders} initialPapers={library.papers} requestedFolderId={query.folder ?? null} />;
}
