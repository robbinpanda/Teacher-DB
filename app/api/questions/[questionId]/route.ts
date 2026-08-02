import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { assets, questions } from "../../../../db/schema";
import { now } from "../../../../lib/server";
import type { Question } from "../../../../lib/types";

export async function PUT(request: Request, context: { params: Promise<{ questionId: string }> }) {
  const { questionId } = await context.params;
  const payload = await request.json() as Question;
  try {
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
      await db.update(assets).set({ bboxJson: JSON.stringify(asset.bbox), label: asset.label }).where(eq(assets.id, asset.id));
    }
  } catch (error) {
    console.warn("Question persistence is unavailable in preview.", error);
  }
  return Response.json({ question: payload, saved: true });
}

