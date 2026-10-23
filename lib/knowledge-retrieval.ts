import type Database from "better-sqlite3";
import { documentScopeSql, type EducationScope } from "./education-scope.ts";
import { classificationFingerprint, parseClassification, type QuestionClassification } from "./question-classification.ts";
import { expandKnowledgeIds, knowledgeCatalog, resolveKnowledgeTerms } from "./knowledge-catalog.ts";
import { questionOptionText, trigonometryDiscoveryClues } from "./trigonometry-discovery.ts";

export type RetrievalRow = {
  id: string; type: string; stem: string; optionsJson: string | null; answer: string; analysis: string;
  documentId: string; documentName: string; grade: string; tagsJson: string; assetsJson: string;
  classificationJson: string | null; classificationFingerprint: string | null; classificationStatus: "confirmed" | "suggested" | null;
};
export type RetrievalOptions = {
  query?: string; knowledgeIds?: string[]; match?: "all" | "any";
  documentIds?: string[]; types?: string[]; difficulty?: number; confirmedOnly?: boolean;
  methods?: string[]; competencies?: string[];
  excludeIds?: string[]; limit?: number; offset?: number;
};
export type RetrievalHit = {
  id: string; type: string; stem: string; documentId: string; documentName: string; grade: string;
  score: number; reasons: string[]; classification: QuestionClassification | null;
  classificationStatus: "confirmed" | "suggested" | "stale" | "unclassified";
  matchedKnowledgeIds: string[]; evidenceKind: "confirmed" | "suggested" | "legacy" | "keyword";
};
export function fingerprintRow(row: RetrievalRow, scope: EducationScope) {
  return classificationFingerprint({ stem: row.stem, options: JSON.parse(row.optionsJson ?? "[]"), answer: row.answer,
    analysis: row.analysis, assets: JSON.parse(row.assetsJson), ...scope });
}

export function loadRetrievalRows(sqlite: Database.Database, ownerId: string, scope: EducationScope, documentIds?: string[], questionIds?: string[]) {
  const filter = documentScopeSql(scope);
  const conditions = ["d.owner_id = ?", "q.status = 'approved'"];
  const params: string[] = [ownerId];
  for (const [field, ids] of [["d.id", documentIds], ["q.id", questionIds]] as const) if (ids !== undefined) {
    if (!ids.length) return [];
    conditions.push(`${field} IN (${ids.map(() => "?").join(",")})`); params.push(...ids);
  }
  // The whole scoped bank participates. Do not reuse the editor's newest-2000 candidate cap.
  return sqlite.prepare(`SELECT q.id, q.type, q.stem, q.options_json AS optionsJson, q.answer, q.analysis,
    d.id AS documentId, d.name AS documentName, d.grade,
    (SELECT json_group_array(name) FROM (SELECT t.name FROM question_tags qt JOIN tags t ON t.id=qt.tag_id WHERE qt.question_id=q.id ORDER BY t.name)) AS tagsJson,
    (SELECT json_group_array(json(asset)) FROM (SELECT json_object('id',a.id,'cropKey',a.crop_key,'sourceKey',a.source_key,'role',a.role,'box',a.bbox_json) AS asset
      FROM question_assets a WHERE a.question_id=q.id ORDER BY a.id)) AS assetsJson,
    c.content_json AS classificationJson, c.fingerprint AS classificationFingerprint, c.status AS classificationStatus
    FROM questions q JOIN documents d ON d.id=q.document_id
    LEFT JOIN question_classifications c ON c.question_id=q.id AND c.owner_id=d.owner_id
    WHERE ${conditions.join(" AND ")}${filter.sql} ORDER BY q.id`).all(...params, ...filter.params) as RetrievalRow[];
}

/** Internal full-bank matches. Public search applies pagination with rankQuestions. */
export function matchQuestions(rows: RetrievalRow[], scope: EducationScope, options: RetrievalOptions = {}) {
  const nodes = knowledgeCatalog(scope.subject, scope.stage);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const requested = options.knowledgeIds?.length ? options.knowledgeIds : resolveKnowledgeTerms(options.query ?? "", nodes);
  if (requested.some(id => !byId.has(id))) throw new Error("检索知识点不属于当前学科、学段");
  const groups = requested.map(id => new Set(expandKnowledgeIds([id], nodes)));
  const terms = (options.query ?? "").normalize("NFKC").trim().split(/[\s,，;；]+/).filter(Boolean);
  const excluded = new Set(options.excludeIds ?? []);
  const hits: RetrievalHit[] = [];
  for (const row of rows) {
    if (excluded.has(row.id) || options.types?.length && !options.types.includes(row.type)) continue;
    let classification: QuestionClassification | null = null;
    let status: RetrievalHit["classificationStatus"] = row.classificationJson ? "stale" : "unclassified";
    if (row.classificationJson && row.classificationFingerprint === fingerprintRow(row, scope)) {
      try { classification = parseClassification(JSON.parse(row.classificationJson), scope.subject, scope.stage); status = row.classificationStatus ?? "suggested"; }
      catch { /* Legacy/invalid records cannot masquerade as verified coverage. */ }
    }
    if (options.confirmedOnly && status !== "confirmed" || options.difficulty !== undefined && classification?.difficulty !== options.difficulty) continue;
    if (options.methods?.some(method => !classification?.methods.includes(method as QuestionClassification["methods"][number])) || options.competencies?.some(competency => !classification?.competencies.includes(competency as QuestionClassification["competencies"][number]))) continue;
    const tags = JSON.parse(row.tagsJson) as string[];
    const exactIds = new Set(classification?.knowledge.map(item => item.id) ?? []);
    // Legacy strings may aid discovery, but never count as a confirmed knowledge assessment.
    const legacyIds = new Set(nodes.filter(node => tags.some(tag => node.label === tag || node.aliases.includes(tag))).map(node => node.id));
    const optionText = questionOptionText(row.optionsJson);
    const questionText = `${row.stem}\n${optionText}`.normalize("NFKC").replace(/图像/g, "图象");
    const text = `${questionText}\n${row.analysis}`.normalize("NFKC").replace(/图像/g, "图象");
    let discoveryClues: Map<string, string> | undefined;
    const reasons: string[] = [];
    const matched = new Set<string>();
    let score = 0;
    let evidenceKind: RetrievalHit["evidenceKind"] = "keyword";
    const groupMatches = groups.map(group => {
      for (const id of group) if (exactIds.has(id)) {
        matched.add(id); score += status === "confirmed" ? 120 : 80;
        reasons.push(`${status === "confirmed" ? "已确认" : "模型建议"}：${byId.get(id)!.label}；${classification!.knowledge.find(item => item.id === id)!.evidence}`);
        evidenceKind = status === "confirmed" ? "confirmed" : "suggested";
        return true;
      }
      if (options.confirmedOnly || options.difficulty !== undefined) return false;
      for (const id of group) if (legacyIds.has(id)) {
        score += 40; reasons.push(`原有标签：${byId.get(id)!.label}（未做结构化确认）`);
        if (evidenceKind === "keyword") evidenceKind = "legacy";
        return true;
      }
      for (const id of group) {
        const node = byId.get(id)!;
        if ([node.label, ...node.aliases].some(term => questionText.includes(term))) { score += 20; reasons.push(`题干或选项命中：${node.label}（待核对）`); return true; }
      }
      if (scope.subject === "数学" && scope.stage === "high") {
        discoveryClues ??= trigonometryDiscoveryClues(row.stem, optionText);
        for (const id of group) {
          const clue = discoveryClues.get(id);
          if (clue) { score += 18; reasons.push(`题干或选项线索：${byId.get(id)!.label}；${clue}（待核对）`); return true; }
        }
      }
      for (const id of group) {
        const node = byId.get(id)!;
        if ([node.label, ...node.aliases].some(term => text.includes(term))) { score += 10; reasons.push(`解析文字命中：${node.label}（待核对）`); return true; }
      }
      return false;
    });
    if (groups.length && !(options.match === "all" ? groupMatches.every(Boolean) : groupMatches.some(Boolean))) continue;
    if ((!groups.length || options.knowledgeIds?.length) && terms.length) {
      const haystack = `${text}\n${tags.join(" ")}`;
      if (!terms.every(term => haystack.includes(term))) continue;
      score += terms.length * 8; reasons.push(`文字命中：${terms.join("、")}（待核对）`);
    }
    if (!groups.length && !terms.length) reasons.push("当前教学范围内的已审核题目");
    if (!groups.length && classification) {
      score += status === "confirmed" ? 20 : 10;
      evidenceKind = status === "confirmed" ? "confirmed" : "suggested";
      reasons.push(`${status === "confirmed" ? "已确认" : "模型建议"}考点：${classification.knowledge.map(item => byId.get(item.id)!.label).join("、")}`);
    }
    if (options.methods?.length) reasons.push(`解题方法：${options.methods.join("、")}（${status === "confirmed" ? "教师确认" : "模型建议"}）`);
    if (options.competencies?.length) reasons.push(`考查能力：${options.competencies.join("、")}（${status === "confirmed" ? "教师确认" : "模型建议"}）`);
    hits.push({ id: row.id, type: row.type, stem: row.stem, documentId: row.documentId, documentName: row.documentName, grade: row.grade,
      score, reasons, classification, classificationStatus: status, matchedKnowledgeIds: [...matched], evidenceKind });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const difficultyCounts = [1, 2, 3, 4, 5].map(difficulty => {
    const classified = hits.filter(hit => hit.classification?.difficulty === difficulty && groups.every(group => hit.matchedKnowledgeIds.some(id => group.has(id))));
    return { difficulty, classified: classified.length, confirmed: classified.filter(hit => hit.classificationStatus === "confirmed").length };
  });
  return { total: hits.length, scanned: rows.length, difficultyCounts, hits, requestedKnowledgeIds: requested };
}
export function rankQuestions(rows: RetrievalRow[], scope: EducationScope, options: RetrievalOptions = {}) {
  const result = matchQuestions(rows, scope, options);
  const offset = Math.max(0, Math.trunc(options.offset ?? 0)), limit = Math.min(100, Math.max(1, options.limit ?? 30));
  return { ...result, hits: result.hits.slice(offset, offset + limit), pagination: { offset, limit, nextOffset: offset + limit < result.total ? offset + limit : null } };
}
