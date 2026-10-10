import { getSqlite } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { validateSkillContent } from "../../../../../lib/teaching-skill-catalog";
import { activateTeachingSkill, approveSkillTrial, ownedSkill, skillTrials } from "../../../../../lib/teaching-skill-store";
import { runSkillTrial, refinePersonalSkill } from "../../../../../lib/teaching-skills";
import { readJsonPayload } from "../../../../../lib/request-payload";
import { requestOwner } from "../../../../../lib/server";

type Context = { params: Promise<{ skillId: string }> };
export async function GET(request: Request, context: Context) {
  await ensureDatabase();
  try {
    const skill = ownedSkill(getSqlite(), requestOwner(request), (await context.params).skillId);
    return Response.json({ skill, trials: skillTrials(getSqlite(), skill.id) }, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: "Skill 不存在" }, { status: 404 }); }
}
export async function PATCH(request: Request, context: Context) {
  const parsed = await readJsonPayload<Record<string, unknown>>(request);
  if (!parsed.ok) return parsed.response;
  await ensureDatabase();
  try {
    const db = getSqlite();
    const ownerId = requestOwner(request);
    const skill = ownedSkill(db, ownerId, (await context.params).skillId);
    const input = parsed.value;
    if (typeof input.revision !== "number" || !Number.isInteger(input.revision) || input.revision !== skill.revision) return Response.json({ error: "版本已变化，请刷新后再操作" }, { status: 409 });
    if (input.action === "save") {
      const content = validateSkillContent(input.content);
      if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 100) throw new Error("名称须为1–100字");
      const result = db.prepare("UPDATE teaching_skills SET name = ?, content = ?, revision = revision + 1, active = 0, updated_at = ? WHERE id = ? AND owner_id = ? AND revision = ?").run(input.name.trim(), content, new Date().toISOString(), skill.id, ownerId, input.revision);
      if (!result.changes) throw new Error("版本冲突，请刷新");
    } else if (input.action === "trial") {
      const trial = await runSkillTrial({ ownerId, skillId: skill.id, revision: skill.revision, profileId: typeof input.profileId === "string" && input.profileId ? input.profileId : undefined, reviewerProfileId: typeof input.reviewerProfileId === "string" && input.reviewerProfileId ? input.reviewerProfileId : undefined });
      return Response.json({ trial });
    } else if (input.action === "refine") {
      if (typeof input.feedback !== "string") throw new Error("请提供改进意见");
      await refinePersonalSkill({ ownerId, skillId: skill.id, revision: skill.revision, feedback: input.feedback, profileId: typeof input.profileId === "string" && input.profileId ? input.profileId : undefined });
    } else if (input.action === "review") {
      if (input.verdict !== "approved" && input.verdict !== "rejected") throw new Error("复核结论无效");
      if (input.confirmed !== true || typeof input.trialId !== "string" || typeof input.notes !== "string" || input.notes.length > 3000) throw new Error("请先确认已对照原图逐题核查，复核说明最多3000字");
      approveSkillTrial(db, { ownerId, skillId: skill.id, trialId: input.trialId, revision: skill.revision, verdict: input.verdict, notes: input.notes });
    } else if (input.action === "activate") {
      activateTeachingSkill(db, ownerId, skill.id, skill.revision);
    } else if (input.action === "deactivate") {
      db.prepare("UPDATE teaching_skills SET active = 0 WHERE id = ? AND owner_id = ?").run(skill.id, ownerId);
    } else throw new Error("操作无效");
    return Response.json({ skill: ownedSkill(db, ownerId, skill.id), trials: skillTrials(db, skill.id) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "操作失败" }, { status: 400 }); }
}
