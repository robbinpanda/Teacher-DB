import type Database from "better-sqlite3";
import type { SourceDocument } from "./types";
import type { DocumentGroup, DocumentSort } from "./workbench-documents";

export type DocumentListOptions = { page?: number; pageSize?: number; group?: DocumentGroup; search?: string; sort?: DocumentSort };
export type DocumentListResult = {
  documents: SourceDocument[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  counts: Record<DocumentGroup, number>;
  stats: { approvedQuestions: number; pendingQuestions: number; processing: number };
};

const bucket = `CASE WHEN d.status IN ('complete','reviewing') AND
  (SELECT COUNT(DISTINCT r.page_number) FROM extraction_runs r WHERE r.document_id=d.id AND r.status='complete') >= d.page_count
  THEN CASE WHEN d.status='complete' THEN 'reviewed' ELSE 'pending_review' END ELSE 'preprocessing' END`;

/** Select a bounded ID window BEFORE joining questions/runs or hydrating rows. */
export function selectDocumentWindow(sqlite: Database.Database, ownerId: string, options: DocumentListOptions = {}) {
  const pageSize = Number.isFinite(options.pageSize) ? Math.max(1, Math.min(100, Math.floor(options.pageSize!))) : 50;
  const requestedPage = Number.isFinite(options.page) ? Math.max(1, Math.floor(options.page!)) : 1;
  const group = ["preprocessing","pending_review","reviewed"].includes(options.group ?? "") ? options.group! : "all";
  const base = "d.owner_id=? AND d.source_removed_at IS NULL";
  const counts: Record<DocumentGroup, number> = { all: 0, preprocessing: 0, pending_review: 0, reviewed: 0 };
  for (const row of sqlite.prepare(`SELECT ${bucket} AS bucket, COUNT(*) AS n FROM documents d WHERE ${base} GROUP BY bucket`).all(ownerId) as Array<{bucket: Exclude<DocumentGroup,"all">; n: number}>) {
    counts[row.bucket] = row.n; counts.all += row.n;
  }
  const clauses = [base]; const params: (string|number)[] = [ownerId];
  if(group!=="all"){clauses.push(`(${bucket})=?`);params.push(group);}
  const search = options.search?.trim().slice(0,180);
  if(search){clauses.push("d.name LIKE ? ESCAPE '\\'");params.push(`%${search.replace(/[\\%_]/g,"\\$&")}%`);}
  const where = clauses.join(" AND ");
  const total = search ? (sqlite.prepare(`SELECT COUNT(*) n FROM documents d WHERE ${where}`).get(...params) as {n:number}).n : counts[group];
  const totalPages = Math.max(1,Math.ceil(total/pageSize)); const page = Math.min(requestedPage,totalPages);
  const order = options.sort === "name" ? "d.name COLLATE NOCASE ASC, d.id ASC" : `d.created_at ${options.sort === "oldest" ? "ASC" : "DESC"},d.id ${options.sort === "oldest" ? "ASC" : "DESC"}`;
  const ids = (sqlite.prepare(`SELECT d.id FROM documents d LEFT JOIN document_jobs j ON j.document_id=d.id
    WHERE ${where} ORDER BY CASE WHEN j.status='processing' THEN 0 ELSE 1 END,${order} LIMIT ? OFFSET ?`)
    .all(...params,pageSize,(page-1)*pageSize) as Array<{id:string}>).map(row=>row.id);
  const stats = sqlite.prepare(`SELECT
    COALESCE(SUM(CASE WHEN q.status='approved' THEN 1 ELSE 0 END),0) AS approvedQuestions,
    COALESCE(SUM(CASE WHEN d.status='reviewing' AND d.source_removed_at IS NULL AND q.status<>'approved' THEN 1 ELSE 0 END),0) AS pendingQuestions
    FROM documents d JOIN questions q ON q.document_id=d.id WHERE d.owner_id=?`).get(ownerId) as { approvedQuestions:number; pendingQuestions:number };
  return { ids, pagination:{page,pageSize,total,totalPages},counts,stats:{...stats,processing:counts.preprocessing} };
}
