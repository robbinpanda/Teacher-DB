import { getSqlite } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { chinaRegions, gradesByStage, isChinaRegion } from "../../../lib/education-taxonomy";
import { now, requestOwner } from "../../../lib/server";

export const runtime = "nodejs";

const validGrades = new Set(Object.values(gradesByStage).flat());

function profile(ownerId: string) {
  const row = getSqlite().prepare(
    "SELECT preferred_region AS region, preferred_textbook AS textbook, preferred_grades_json AS gradesJson FROM app_settings WHERE owner_id = ?",
  ).get(ownerId) as { region: string | null; textbook: string | null; gradesJson: string } | undefined;
  let grades: string[] = [];
  try { grades = JSON.parse(row?.gradesJson ?? "[]") as string[]; } catch { grades = []; }
  return { region: row?.region ?? "全国", textbook: row?.textbook ?? "人教版", grades };
}

export async function GET(request: Request) {
  await ensureDatabase();
  return Response.json({ profile: profile(requestOwner(request)), regions: chinaRegions });
}

export async function PATCH(request: Request) {
  await ensureDatabase();
  try {
    const payload = await request.json().catch(() => ({})) as { region?: unknown; textbook?: unknown; grades?: unknown };
    const region = payload.region ?? "全国";
    if (!isChinaRegion(region)) throw new Error("地区选项无效");
    const textbook = typeof payload.textbook === "string" ? payload.textbook.trim() : "";
    if (!textbook || textbook.length > 32 || /[\u0000-\u001f]/.test(textbook)) throw new Error("教材版本无效");
    if (!Array.isArray(payload.grades)) throw new Error("任教年级格式无效");
    const grades = Array.from(new Set(payload.grades.map(String).filter((grade) => validGrades.has(grade)))).slice(0, 12);
    if (grades.length !== payload.grades.length) throw new Error("任教年级包含无效选项");
    const ownerId = requestOwner(request);
    const timestamp = now();
    getSqlite().prepare(
      `INSERT INTO app_settings (owner_id, preferred_region, preferred_textbook, preferred_grades_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_id) DO UPDATE SET preferred_region = excluded.preferred_region,
         preferred_textbook = excluded.preferred_textbook, preferred_grades_json = excluded.preferred_grades_json,
         updated_at = excluded.updated_at`,
    ).run(ownerId, region, textbook, JSON.stringify(grades), timestamp);
    return Response.json({ profile: { region, textbook, grades } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存教学画像失败" }, { status: 400 });
  }
}
