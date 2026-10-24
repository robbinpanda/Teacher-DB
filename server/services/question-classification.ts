import { getSqlite } from "../../db";
import { ensureDatabase } from "../../db/bootstrap";
import type { EducationScope } from "../../lib/education-scope";
import { classificationSystemPrompt, parseClassification, parseModelJson, type QuestionClassification } from "../../lib/question-classification";
import { fingerprintRow, loadRetrievalRows } from "../../lib/knowledge-retrieval";
import { knowledgeCatalog, knowledgeCatalogVersion, questionMethods, questionCompetencies } from "../../lib/knowledge-catalog";
import { callTextModel } from "../../lib/text-model";
import { contentTypeForKey, getFile } from "../../lib/file-storage";

export async function classifyQuestion(ownerId: string, scope: EducationScope, questionId: string, profileId?: string, beforeSave?: () => void, beforeRequest?: () => void) {
  await ensureDatabase();
  const sqlite = getSqlite();
  const row = loadRetrievalRows(sqlite, ownerId, scope, undefined, [questionId])[0];
  if (!row) throw new Error("题目不存在、未审核或不在当前教学范围");
  const fingerprint = fingerprintRow(row, scope);
  const images: Array<{ page: number; dataUrl: string }> = [];
  const assets = JSON.parse(row.assetsJson) as Array<{ cropKey: string | null; role: string }>;
  if (assets.length > 8) throw new Error("题图超过 8 张，请先人工标注或整理题图");
  for (const asset of assets) {
    if (!asset.cropKey) throw new Error("题图尚未就绪，请先完成题图审核");
    const bytes = await getFile(asset.cropKey);
    if (bytes.length > 8 * 1024 * 1024) throw new Error("题图超过模型单图限制，请先缩小图片");
    images.push({ page: images.length + 1, dataUrl: `data:${contentTypeForKey(asset.cropKey)};base64,${bytes.toString("base64")}` });
  }
  const input = { scope, catalog: knowledgeCatalog(scope.subject, scope.stage), methods: questionMethods, competencies: questionCompetencies,
    question: { stem: row.stem, options: JSON.parse(row.optionsJson ?? "[]"), answer: row.answer, analysis: row.analysis } };
  const assertCurrent = () => {
    beforeSave?.();
    const current = loadRetrievalRows(getSqlite(), ownerId, scope, undefined, [questionId])[0];
    if (!current || fingerprintRow(current, scope) !== fingerprint) throw new Error("题目内容已变化，请重新读取后标注");
    if (current.classificationStatus === "confirmed" && current.classificationFingerprint === fingerprint) throw new Error("此版本已有教师确认标签，模型结果不能覆盖");
  };
  let repair: { error: string; previous: string } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await callTextModel({ ownerId, profileId, purpose: attempt ? "question_classification_repair" : "question_classification", jsonMode: true, maxOutputTokens: 6000,
      system: classificationSystemPrompt, images, beforeRequest: () => { assertCurrent(); beforeRequest?.(); }, text: JSON.stringify({ ...input, ...(repair ? { repair } : {}) }) });
    let classification: QuestionClassification;
    try { classification = parseClassification(parseModelJson(result.content), scope.subject, scope.stage); }
    catch (error) {
      if (attempt) throw error;
      repair = { error: error instanceof Error ? error.message.slice(0, 2500) : "标注格式不正确", previous: result.content.slice(0, 18000) };
      continue;
    }
    assertCurrent();
    saveClassification(ownerId, scope, questionId, fingerprint, classification, "suggested", result.profile.id, result.traceId);
    return { classification, fingerprint, status: "suggested" as const };
  }
  throw new Error("标注未通过校验");
}

export function saveClassification(ownerId: string, scope: EducationScope, questionId: string, fingerprint: string, value: unknown,
  status: "suggested" | "confirmed", profileId?: string, traceId?: string): QuestionClassification {
  const classification = parseClassification(value, scope.subject, scope.stage);
  const sqlite = getSqlite();
  sqlite.transaction(() => {
    const current = loadRetrievalRows(sqlite, ownerId, scope, undefined, [questionId])[0];
    if (!current || fingerprintRow(current, scope) !== fingerprint) throw new Error("题目内容已变化，请重新读取后标注");
    if (status === "suggested" && current.classificationStatus === "confirmed" && current.classificationFingerprint === fingerprint) throw new Error("此版本已有教师确认标签，模型结果不能覆盖");
    const time = new Date().toISOString();
    sqlite.prepare(`INSERT INTO question_classifications(question_id,owner_id,fingerprint,catalog_version,content_json,status,model_profile_id,trace_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(question_id) DO UPDATE SET fingerprint=excluded.fingerprint,catalog_version=excluded.catalog_version,
      content_json=excluded.content_json,status=excluded.status,model_profile_id=excluded.model_profile_id,trace_id=excluded.trace_id,updated_at=excluded.updated_at`)
      .run(questionId, ownerId, fingerprint, knowledgeCatalogVersion, JSON.stringify(classification), status, profileId ?? null, traceId ?? null, time, time);
    sqlite.prepare("DELETE FROM question_knowledge WHERE question_id=?").run(questionId);
    for (const item of classification.knowledge) sqlite.prepare("INSERT INTO question_knowledge(question_id,knowledge_id) VALUES(?,?)").run(questionId, item.id);
  })();
  return classification;
}
