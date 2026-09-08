import { getSqlite, sqliteTransaction } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { stageFromGrade } from "../../../../../lib/education-taxonomy";
import { getApprovedQuestions } from "../../../../../lib/question-repository";
import { boundedText } from "../../../../../lib/question-variations";
import { isVariationQuestion } from "../../../../../lib/question-provenance";
import { getTagCatalog } from "../../../../../lib/tag-catalog";
import { now, requestOwner } from "../../../../../lib/server";
import type { VariationReview } from "../../../../../lib/types";
import { renderQuestionDiagramPng } from "../../../../../lib/question-diagram-renderer";
import {
  runVariationWorkflow,
  variationDifficultyLabels,
  variationSourceSnapshotHash,
  type VariationDifficulty,
  type VariationDiagramMode,
  type VariationQualityMode,
} from "../../../../../lib/variation-workflow";

export const runtime = "nodejs";

type CandidateRow = { id: string; ordinal: number; contentJson: string; reviewJson: string; status: string };
type RunRow = {
  id: string;
  qualityMode: VariationQualityMode;
  status: string;
  resultJson: string | null;
  error: string | null;
  updatedAt: string;
};

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

async function runResponse(ownerId: string, run: RunRow, cached = false) {
  const candidates = getSqlite().prepare(
    `SELECT vc.id, vc.ordinal, vc.content_json AS contentJson, vc.review_json AS reviewJson, vc.status
       FROM variation_candidates vc JOIN variation_runs vr ON vr.id = vc.run_id
      WHERE vc.run_id = ? AND vr.owner_id = ? ORDER BY vc.ordinal`,
  ).all(run.id, ownerId) as CandidateRow[];
  return {
    runId: run.id,
    status: run.status,
    qualityMode: run.qualityMode,
    cached,
    workflow: parseJson<Record<string, unknown>>(run.resultJson ?? "{}", {}),
    candidates: await Promise.all(candidates.map(async (candidate) => {
      const question = parseJson<Record<string, unknown>>(candidate.contentJson, {});
      const diagramBytes = question.diagram ? await renderQuestionDiagramPng(question.diagram) : null;
      return {
        id: candidate.id,
        ordinal: candidate.ordinal,
        status: candidate.status,
        question,
        diagramPreviewUrl: diagramBytes ? `data:image/png;base64,${diagramBytes.toString("base64")}` : null,
        review: parseJson<VariationReview | null>(candidate.reviewJson, null),
      };
    })),
  };
}

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/超过 \d+ 秒|超时|AbortError/i.test(message)) return 504;
  if (/HTTP 429|限流/i.test(message)) return 429;
  if (/模型|Agent|审校|候选/i.test(message)) return 502;
  return 422;
}

export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  await ensureDatabase();
  const ownerId = requestOwner(request);
  let runId = "";
  try {
    const { questionId } = await context.params;
    const payload = await request.json().catch(() => ({})) as {
      count?: unknown;
      difficulty?: unknown;
      focus?: unknown;
      instructions?: unknown;
      qualityMode?: unknown;
      diagramMode?: unknown;
      profileId?: unknown;
      reviewerProfileId?: unknown;
      idempotencyKey?: unknown;
    };
    const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim() : "";
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
      return Response.json({ error: "缺少有效的生成请求标识，请刷新页面后重试" }, { status: 400 });
    }
    const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    getSqlite().prepare(
      `UPDATE variation_runs SET status = 'failed', error = '生成进程意外中断，请重新发起', updated_at = ?
        WHERE owner_id = ? AND idempotency_key = ? AND status IN ('generating', 'validating', 'reviewing') AND updated_at < ?`,
    ).run(now(), ownerId, idempotencyKey, staleBefore);
    const existing = getSqlite().prepare(
      `SELECT id, quality_mode AS qualityMode, status, result_json AS resultJson, error, updated_at AS updatedAt
         FROM variation_runs WHERE owner_id = ? AND idempotency_key = ?`,
    ).get(ownerId, idempotencyKey) as RunRow | undefined;
    if (existing) {
      if (existing.status === "awaiting_teacher") return Response.json(await runResponse(ownerId, existing, true));
      const error = existing.status === "failed"
        ? existing.error ?? "上次生成失败，请重新发起"
        : existing.status === "cancelled"
          ? "这批候选题已经放弃，请重新发起"
          : existing.status === "complete"
            ? "这批候选题已经处理完成"
            : "同一批变式题正在生成，请稍候";
      return Response.json({ error, runId: existing.id, status: existing.status }, { status: 409 });
    }

    const [source] = await getApprovedQuestions(ownerId, [questionId]);
    if (!source) return Response.json({ error: "原题不存在或尚未入库" }, { status: 404 });
    if (source.needsHumanReview) return Response.json({ error: "请先完成人工核对，再基于这道题生成变式" }, { status: 409 });
    if (isVariationQuestion(source)) return Response.json({ error: "为避免知识点逐代漂移，暂不支持继续改写 AI 变式题" }, { status: 409 });
    const count = Number(payload.count);
    if (!Number.isInteger(count) || count < 1 || count > 3) throw new Error("单次只能生成 1–3 道变式题");
    const difficulty = String(payload.difficulty ?? "similar") as VariationDifficulty;
    if (!(difficulty in variationDifficultyLabels)) throw new Error("难度选项无效");
    const qualityMode = String(payload.qualityMode ?? "reviewed") as VariationQualityMode;
    if (qualityMode !== "quick" && qualityMode !== "reviewed") throw new Error("质量模式无效");
    const diagramMode = String(payload.diagramMode ?? "auto") as VariationDiagramMode;
    if (diagramMode !== "auto" && diagramMode !== "never") throw new Error("题图模式无效");
    const focus = boundedText(payload.focus, 120);
    const instructions = boundedText(payload.instructions, 500);
    const profileId = typeof payload.profileId === "string" && payload.profileId.length <= 100 ? payload.profileId : undefined;
    const reviewerProfileId = typeof payload.reviewerProfileId === "string" && payload.reviewerProfileId.length <= 100
      ? payload.reviewerProfileId
      : undefined;
    const allowedTags = (await getTagCatalog(ownerId, source.source.subject, stageFromGrade(source.source.grade))).map((tag) => tag.name);
    const timestamp = now();
    runId = crypto.randomUUID();
    getSqlite().prepare(
      `INSERT INTO variation_runs
        (id, owner_id, source_question_id, source_snapshot_hash, idempotency_key, quality_mode, requested_count,
         difficulty, focus, instructions, generator_profile_id, reviewer_profile_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating', ?, ?)`,
    ).run(
      runId, ownerId, source.id, variationSourceSnapshotHash(source), idempotencyKey, qualityMode, count,
      difficulty, focus, instructions, profileId ?? null, reviewerProfileId ?? null, timestamp, timestamp,
    );
    const outcome = await runVariationWorkflow({
      ownerId,
      source,
      count,
      difficulty,
      focus,
      instructions,
      allowedTags,
      qualityMode,
      diagramMode,
      generatorProfileId: profileId,
      reviewerProfileId,
      onStage: (stage) => getSqlite().prepare(
        "UPDATE variation_runs SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
      ).run(stage, now(), runId, ownerId),
    });
    const currentSource = (await getApprovedQuestions(ownerId, [source.id]))[0];
    if (!currentSource || isVariationQuestion(currentSource) || variationSourceSnapshotHash(currentSource) !== variationSourceSnapshotHash(source)) {
      throw new Error("生成期间原题发生变化，本批候选题未保存，请重新生成");
    }
    const completedAt = now();
    const summary = {
      generator: outcome.generator,
      reviewer: outcome.reviewer,
      rejectedCandidateCount: outcome.rejectedCandidates.length,
      passed: outcome.reviews.filter((review) => review.status === "passed").length,
      revised: outcome.reviews.filter((review) => review.status === "revised").length,
      rulesPassed: outcome.reviews.filter((review) => review.status === "rules_passed").length,
      diagrams: outcome.variations.filter((variation) => variation.diagram).length,
    };
    sqliteTransaction((sqlite) => {
      outcome.variations.forEach((variation, index) => {
        sqlite.prepare(
          `INSERT INTO variation_candidates
            (id, run_id, ordinal, content_json, review_json, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'awaiting_teacher', ?, ?)`,
        ).run(
          crypto.randomUUID(), runId, index + 1, JSON.stringify(variation), JSON.stringify(outcome.reviews[index]),
          completedAt, completedAt,
        );
      });
      sqlite.prepare(
        `UPDATE variation_runs SET status = 'awaiting_teacher', generator_profile_id = ?, reviewer_profile_id = ?,
           result_json = ?, updated_at = ?, completed_at = ? WHERE id = ? AND owner_id = ?`,
      ).run(
        outcome.generatorProfileId, outcome.reviewerProfileId, JSON.stringify(summary), completedAt, completedAt, runId, ownerId,
      );
    });
    const run = getSqlite().prepare(
      `SELECT id, quality_mode AS qualityMode, status, result_json AS resultJson, error, updated_at AS updatedAt
         FROM variation_runs WHERE id = ? AND owner_id = ?`,
    ).get(runId, ownerId) as RunRow;
    return Response.json(await runResponse(ownerId, run), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "变式题工作流失败";
    if (runId) getSqlite().prepare(
      "UPDATE variation_runs SET status = 'failed', error = ?, updated_at = ?, completed_at = ? WHERE id = ? AND owner_id = ?",
    ).run(message.slice(0, 1000), now(), now(), runId, ownerId);
    return Response.json({ error: message, runId: runId || undefined }, { status: errorStatus(error) });
  }
}
