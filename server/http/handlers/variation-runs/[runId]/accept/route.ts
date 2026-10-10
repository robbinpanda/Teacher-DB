import { getSqlite, sqliteTransaction } from "../../../../../../db";
import { ensureDatabase } from "../../../../../../db/bootstrap";
import { stageFromGrade } from "../../../../../../lib/education-taxonomy";
import { getApprovedQuestions } from "../../../../../../lib/question-repository";
import { parseVariationModelContent, type ValidatedVariation } from "../../../../../../lib/question-variations";
import { getTagCatalog } from "../../../../../../lib/tag-catalog";
import { now, requestOwner } from "../../../../../../lib/server";
import type { VariationReview } from "../../../../../../lib/types";
import { variationSourceContentHash, variationSourceSnapshotHash } from "../../../../../../lib/variation-workflow";
import { deleteFile, putFile } from "../../../../../../lib/file-storage";
import { renderQuestionDiagramPng } from "../../../../../../lib/question-diagram-renderer";
import { isVariationQuestion } from "../../../../../../lib/question-provenance";


type RunRow = {
  id: string;
  sourceQuestionId: string | null;
  sourceSnapshotHash: string;
  status: string;
  qualityMode: string;
  difficulty: string;
};

type CandidateRow = {
  id: string;
  ordinal: number;
  contentJson: string;
  reviewJson: string;
  status: string;
};

function lockedSourceHash(transaction: Parameters<Parameters<typeof sqliteTransaction>[0]>[0], sourceQuestionId: string, ownerId: string) {
  const row = transaction.prepare(
    `SELECT q.id, q.type, q.stem, q.options_json AS optionsJson, q.answer, q.analysis, q.status,
            q.needs_human_review AS needsHumanReview, q.parent_question_id AS parentQuestionId,
            q.parent_external_id AS parentExternalId, q.variation_kind AS variationKind, q.variation_review_json AS variationReview
       FROM questions q JOIN documents d ON d.id = q.document_id
      WHERE q.id = ? AND d.owner_id = ?`,
  ).get(sourceQuestionId, ownerId) as {
    id: string; type: string; stem: string; optionsJson: string | null; answer: string; analysis: string;
    status: string; needsHumanReview: number | null; parentQuestionId: string | null;
    parentExternalId: string | null; variationKind: string | null; variationReview: string | null;
  } | undefined;
  if (!row || row.status !== "approved" || row.needsHumanReview !== 0 || isVariationQuestion(row)) return null;
  const tags = (transaction.prepare(
    `SELECT t.name FROM question_tags qt JOIN tags t ON t.id = qt.tag_id
      WHERE qt.question_id = ? ORDER BY t.name`,
  ).all(sourceQuestionId) as Array<{ name: string }>).map((tag) => tag.name);
  const assets = (transaction.prepare(
    `SELECT a.id, a.crop_key AS cropKey, a.source_key AS sourceKey FROM question_assets a
      WHERE a.question_id = ? ORDER BY a.position, a.created_at, a.id`,
  ).all(sourceQuestionId) as Array<{ id: string; cropKey: string | null; sourceKey: string | null }>)
    .map((asset) => asset.cropKey ?? asset.sourceKey ?? asset.id);
  let options: Array<{ key: string; content: string }> = [];
  try { options = JSON.parse(row.optionsJson ?? "[]") as Array<{ key: string; content: string }>; } catch { return null; }
  return variationSourceContentHash({
    id: row.id,
    type: row.type,
    stem: row.stem,
    options,
    answer: row.answer,
    analysis: row.analysis,
    tags,
    assets,
  });
}

function selectedIds(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error("请选择 1–3 道候选题入库");
  }
  const ids = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("候选题选择无效");
  }
  return ids;
}

function parseReview(value: string): VariationReview {
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { throw new Error("候选题审校记录损坏，请重新生成"); }
  const review = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  const mode = review?.mode;
  const status = review?.status;
  const score = review?.score;
  if ((mode !== "rules" && mode !== "multi_agent")
    || !["rules_passed", "passed", "revised"].includes(String(status))
    || (score !== null && (!Number.isInteger(score) || Number(score) < 0 || Number(score) > 100))
    || !Array.isArray(review?.issues)) {
    throw new Error("候选题审校记录无效，请重新生成");
  }
  return {
    mode,
    status: status as VariationReview["status"],
    score: score === null ? null : Number(score),
    issues: review.issues.map(String).slice(0, 5),
    reviewer: typeof review.reviewer === "string" ? review.reviewer : null,
  };
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  await ensureDatabase();
  const ownerId = requestOwner(request);
  const storedDiagramKeys: string[] = [];
  let diagramsCommitted = false;
  try {
    const { runId } = await context.params;
    const payload = await request.json().catch(() => ({})) as { candidateIds?: unknown };
    const requestedIds = selectedIds(payload.candidateIds);
    const sqlite = getSqlite();
    const run = sqlite.prepare(
      `SELECT id, source_question_id AS sourceQuestionId, source_snapshot_hash AS sourceSnapshotHash,
              status, quality_mode AS qualityMode, difficulty
         FROM variation_runs WHERE id = ? AND owner_id = ?`,
    ).get(runId, ownerId) as RunRow | undefined;
    if (!run) return Response.json({ error: "变式题生成记录不存在" }, { status: 404 });
    if (run.status === "complete") return Response.json({ error: "这批候选题已经入库" }, { status: 409 });
    if (run.status !== "awaiting_teacher") return Response.json({ error: "这批候选题当前不可采用" }, { status: 409 });
    if (!run.sourceQuestionId) return Response.json({ error: "原题已不存在，无法采用本批候选题" }, { status: 409 });

    const candidates = sqlite.prepare(
      `SELECT id, ordinal, content_json AS contentJson, review_json AS reviewJson, status
         FROM variation_candidates WHERE run_id = ? ORDER BY ordinal`,
    ).all(runId) as CandidateRow[];
    const selectedRows = requestedIds.map((id) => candidates.find((candidate) => candidate.id === id));
    if (selectedRows.some((candidate) => !candidate || candidate.status !== "awaiting_teacher")) {
      return Response.json({ error: "候选题不存在、已处理或不属于本批次" }, { status: 409 });
    }

    const [source] = await getApprovedQuestions(ownerId, [run.sourceQuestionId]);
    if (!source || source.needsHumanReview || isVariationQuestion(source)) {
      return Response.json({ error: "原题已不存在、尚未复核或不再适合作为变式来源" }, { status: 409 });
    }
    if (variationSourceSnapshotHash(source) !== run.sourceSnapshotHash) {
      return Response.json({ error: "原题在生成后发生了变化，请放弃本批并重新生成" }, { status: 409 });
    }
    const allowedTags = (await getTagCatalog(ownerId, source.source.subject, stageFromGrade(source.source.grade))).map((tag) => tag.name);
    const parsedContents = selectedRows.map((candidate) => JSON.parse(candidate!.contentJson) as unknown);
    const variations = parseVariationModelContent({
      content: JSON.stringify({ variations: parsedContents }),
      count: selectedRows.length,
      sourceType: source.type,
      sourceStem: source.stem,
      allowedTags,
      fallbackTags: source.tags,
    });
    const reviews = selectedRows.map((candidate) => parseReview(candidate!.reviewJson));
    const timestamp = now();
    const documentId = crypto.randomUUID();
    const promotedIds = variations.map(() => crypto.randomUUID());
    const preparedDiagrams: Array<{ key: string; label: string } | null> = [];
    for (const [index, variation] of variations.entries()) {
      if (!variation.diagram) {
        preparedDiagrams.push(null);
        continue;
      }
      const key = `documents/${documentId}/generated/${promotedIds[index]}/diagram.png`;
      await putFile(key, await renderQuestionDiagramPng(variation.diagram));
      storedDiagramKeys.push(key);
      preparedDiagrams.push({ key, label: variation.diagram.altText });
    }

    sqliteTransaction((transaction) => {
      const locked = transaction.prepare(
        "SELECT status, source_snapshot_hash AS sourceSnapshotHash FROM variation_runs WHERE id = ? AND owner_id = ?",
      ).get(runId, ownerId) as { status: string; sourceSnapshotHash: string } | undefined;
      if (!locked || locked.status !== "awaiting_teacher" || locked.sourceSnapshotHash !== run.sourceSnapshotHash) {
        throw new Error("本批候选题已被其他操作处理，请刷新题库");
      }
      if (lockedSourceHash(transaction, run.sourceQuestionId!, ownerId) !== run.sourceSnapshotHash) {
        throw new Error("原题在采用前发生了变化，请放弃本批并重新生成");
      }
      const currentCandidates = transaction.prepare(
        `SELECT id FROM variation_candidates WHERE run_id = ? AND status = 'awaiting_teacher'`,
      ).all(runId) as Array<{ id: string }>;
      const available = new Set(currentCandidates.map((candidate) => candidate.id));
      if (requestedIds.some((id) => !available.has(id))) throw new Error("部分候选题已被处理，请刷新题库");

      transaction.prepare(
        `INSERT INTO documents
          (id, owner_id, name, mime_type, status, page_count, subject, grade, source_year, source_exam_type,
           source_region, source_textbook, source_school, source_removed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'application/x-jianti-generated', 'complete', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        documentId, ownerId, `AI 变式 · ${source.source.documentName}`.slice(0, 180), source.source.subject,
        source.source.grade, source.source.year, source.source.examType, source.source.region,
        source.source.textbook, source.source.school, timestamp, timestamp, timestamp,
      );

      variations.forEach((variation: ValidatedVariation, index) => {
        const review = reviews[index];
        const questionId = promotedIds[index];
        transaction.prepare(
          `INSERT INTO questions
            (id, document_id, number, type, stem, options_json, answer, analysis, page_number, bbox_json,
             status, needs_human_review, confidence, score, folder_id, parent_question_id, variation_kind,
             variation_review_status, variation_review_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'approved', 0, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          questionId, documentId, String(index + 1), variation.type, variation.stem, JSON.stringify(variation.options),
          variation.answer, variation.analysis, JSON.stringify({ x: 0, y: 0, width: 100, height: 100 }),
          review.score === null ? 0.85 : review.score / 100, source.folderId, source.id,
          `${run.difficulty}:${variation.changeNote}`, review.status, JSON.stringify(review), timestamp, timestamp,
        );
        for (const tag of variation.tags) {
          transaction.prepare("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)")
            .run(crypto.randomUUID(), tag, timestamp);
          transaction.prepare("INSERT OR IGNORE INTO question_tags (question_id, tag_id) SELECT ?, id FROM tags WHERE name = ?")
            .run(questionId, tag);
        }
        const diagram = preparedDiagrams[index];
        if (diagram) {
          transaction.prepare(
            `INSERT INTO question_assets
              (id, question_id, page_id, kind, role, label, source_key, crop_key, bbox_json, position, created_at)
             VALUES (?, ?, NULL, ?, 'question', ?, ?, ?, ?, 0, ?)`,
          ).run(
            crypto.randomUUID(), questionId, variation.diagram?.kind === "geometry" ? "figure" : "graph",
            diagram.label, diagram.key, diagram.key,
            JSON.stringify({ x: 0, y: 0, width: 100, height: 100 }), timestamp,
          );
        }
        transaction.prepare(
          "UPDATE variation_candidates SET status = 'accepted', promoted_question_id = ?, updated_at = ? WHERE id = ? AND run_id = ?",
        ).run(questionId, timestamp, selectedRows[index]!.id, runId);
      });
      transaction.prepare(
        `UPDATE variation_candidates SET status = 'rejected', updated_at = ?
          WHERE run_id = ? AND status = 'awaiting_teacher'`,
      ).run(timestamp, runId);
      transaction.prepare(
        `UPDATE variation_runs SET status = 'complete', updated_at = ?, completed_at = ?
          WHERE id = ? AND owner_id = ?`,
      ).run(timestamp, timestamp, runId, ownerId);
    });
    diagramsCommitted = true;

    return Response.json({
      runId,
      accepted: promotedIds.length,
      questions: await getApprovedQuestions(ownerId, promotedIds),
    });
  } catch (error) {
    if (!diagramsCommitted) await Promise.allSettled(storedDiagramKeys.map((key) => deleteFile(key)));
    const message = error instanceof Error ? error.message : "候选题入库失败";
    return Response.json({ error: message }, { status: /不存在/.test(message) ? 404 : /已|变化|处理|当前/.test(message) ? 409 : 422 });
  }
}
