import { sqliteTransaction } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { now, requestOwner } from "../../../../lib/server";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ runId: string }> }) {
  await ensureDatabase();
  const ownerId = requestOwner(request);
  const { runId } = await context.params;
  const timestamp = now();
  const outcome = sqliteTransaction((transaction) => {
    const run = transaction.prepare(
      "SELECT status FROM variation_runs WHERE id = ? AND owner_id = ?",
    ).get(runId, ownerId) as { status: string } | undefined;
    if (!run) return { status: 404, error: "变式题生成记录不存在" };
    if (run.status === "cancelled") return { status: 200, discarded: true };
    if (run.status !== "awaiting_teacher") return { status: 409, error: "这批候选题当前不可放弃" };
    transaction.prepare(
      "UPDATE variation_candidates SET status = 'rejected', updated_at = ? WHERE run_id = ? AND status = 'awaiting_teacher'",
    ).run(timestamp, runId);
    transaction.prepare(
      `UPDATE variation_runs SET status = 'cancelled', error = NULL, updated_at = ?, completed_at = ?
        WHERE id = ? AND owner_id = ?`,
    ).run(timestamp, timestamp, runId, ownerId);
    return { status: 200, discarded: true };
  });
  if ("error" in outcome) return Response.json({ error: outcome.error }, { status: outcome.status });
  return Response.json({ runId, discarded: true });
}
