import { getSqlite } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { wholeDocumentSystemPrompt } from "../../../lib/document-extraction";
import { builtInTeachingSkill, validateSkillScope } from "../../../lib/teaching-skill-catalog";
import { skillColumns } from "../../../lib/teaching-skill-store";
import { createPersonalSkill } from "../../../lib/teaching-skills";
import { readFormDataPayload } from "../../../lib/request-payload";
import { requestOwner } from "../../../lib/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const params = new URL(request.url).searchParams;
    const scope = validateSkillScope(params.get("subject"), params.get("grade"));
    const base = builtInTeachingSkill(scope.subject, scope.grade);
    const skills = getSqlite().prepare(`SELECT ${skillColumns} FROM teaching_skills WHERE owner_id = ? AND subject = ? AND grade = ? ORDER BY updated_at DESC`).all(requestOwner(request), scope.subject, scope.grade);
    return Response.json({ base, protocol: wholeDocumentSystemPrompt, skills }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "读取失败" }, { status: 400 }); }
}
export async function POST(request: Request) {
  const parsed = await readFormDataPayload(request);
  if (!parsed.ok) return parsed.response;
  try {
    const scope = validateSkillScope(parsed.value.get("subject"), parsed.value.get("grade"));
    const file = parsed.value.get("file");
    if (!(file instanceof File)) throw new Error("请上传试卷图片以生成个人 Skill");
    const profileId = parsed.value.get("profileId");
    return Response.json({ skill: await createPersonalSkill({ ownerId: requestOwner(request), ...scope, file, profileId: typeof profileId === "string" && profileId ? profileId : undefined }) }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "生成失败" }, { status: 400 }); }
}
