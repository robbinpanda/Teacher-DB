import type Database from "better-sqlite3";
import { documentScopeSql, type EducationScope } from "./education-scope.ts";
import { educationStages, gradesByStage } from "./education-taxonomy.ts";

export function resolveUploadDestination(scope: EducationScope, metadata: { subject?: unknown; grade?: unknown }) {
  if (metadata.subject && metadata.subject !== scope.subject) {
    throw new Error("试卷学科与目标题库不一致，请关闭导入窗口后重新选择目标题库");
  }
  const grade = metadata.grade || educationStages.find(item => item.value === scope.stage)!.defaultGrade;
  if (typeof grade !== "string" || !gradesByStage[scope.stage].includes(grade)) {
    throw new Error("试卷年级不属于目标题库的学段，请重新选择年级");
  }
  return { subject: scope.subject, grade };
}

export type ReusableDocument = {
  id: string;
  originalKey: string | null;
  pageCount: number;
  status: string;
};

/** Soft-deleted sources must never capture a later upload of the same PDF. */
export function findReusableDocument(
  sqlite: Database.Database,
  ownerId: string,
  checksum: string,
  scope?: EducationScope,
): ReusableDocument | undefined {
  const filter = documentScopeSql(scope, "documents");
  return sqlite.prepare(
    `SELECT id, original_key AS originalKey, page_count AS pageCount, status
       FROM documents
      WHERE owner_id = ? AND checksum = ? AND source_removed_at IS NULL${filter.sql}
      ORDER BY created_at DESC LIMIT 1`,
  ).get(ownerId, checksum, ...filter.params) as ReusableDocument | undefined;
}
