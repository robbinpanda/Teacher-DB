import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { assets, questions, questionTags, tags } from "../../../../db/schema";
import { now } from "../../../../lib/server";
import type { Question } from "../../../../lib/types";

export async function PUT(request: Request, context: { params: Promise<{ questionId: string }> }) {
  await ensureDatabase();
  const { questionId } = await context.params;
  const payload = await request.json() as Question;
  const db = getDb();
    await db.update(questions).set({
      stem: payload.stem,
      optionsJson: JSON.stringify(payload.options ?? []),
      answer: payload.answer,
      analysis: payload.analysis,
      bboxJson: JSON.stringify(payload.bbox),
      status: payload.status,
      score: payload.score ?? 0,
      updatedAt: now(),
    }).where(eq(questions.id, questionId));
  for (const asset of payload.assets) {
    await db.insert(assets).values({
      id: asset.id,
      questionId,
      kind: asset.kind,
      label: asset.label,
      bboxJson: JSON.stringify(asset.bbox),
      createdAt: now(),
    }).onConflictDoUpdate({ target: assets.id, set: { bboxJson: JSON.stringify(asset.bbox), label: asset.label, kind: asset.kind } });
  }
  await db.delete(questionTags).where(eq(questionTags.questionId, questionId));
  for (const name of Array.from(new Set(payload.tags.map((tag) => tag.trim()).filter(Boolean)))) {
    const existing = await db.query.tags.findFirst({ where: eq(tags.name, name) });
    const tagId = existing?.id ?? crypto.randomUUID();
    if (!existing) await db.insert(tags).values({ id: tagId, name, createdAt: now() });
    await db.insert(questionTags).values({ questionId, tagId }).onConflictDoNothing();
  }
  return Response.json({ question: payload, saved: true });
}
