import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAuthoringDocument } from "../../../../lib/backend-data";
import { scopeFromCookieHeader, normalizeEducationScope } from "../../../../lib/education-scope";
import { AuthoringDocument } from "../../../../components/AuthoringDocument";
export const dynamic = "force-dynamic";
export default async function Preview({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ subject?: string; stage?: string; answers?: string }> }) {
  const { projectId } = await params, query = await searchParams, requestHeaders = await headers();
  const cookieScope = scopeFromCookieHeader(requestHeaders.get("cookie"));
  const scope = normalizeEducationScope({ subject: query.subject ?? cookieScope.subject, stage: query.stage ?? cookieScope.stage });
  const document = await getAuthoringDocument(projectId, requestHeaders.get("oai-authenticated-user-id") ?? "local-demo", scope);
  if (!document) notFound();
  const scoped = new URLSearchParams(scope).toString();
  return <main className="authoring-preview"><nav className="authoring-preview-actions"><Link className="btn" href="/studio">返回备课工作台</Link><Link className="btn" href={`?${scoped}&answers=${query.answers === "1" ? "0" : "1"}`}>{query.answers === "1" ? "查看学生版" : "查看教师版"}</Link>{document.status === "completed" && <a className="btn btn-primary" href={`/api/authoring/${projectId}/pdf?${scoped}&answers=${query.answers ?? "0"}`}>导出此版本 PDF</a>}</nav><AuthoringDocument document={document} answers={query.answers === "1"} /></main>;
}
