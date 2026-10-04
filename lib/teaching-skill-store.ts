import type Database from "better-sqlite3";
import type { SkillRecognition, SkillReview } from "./teaching-skill-validation";

export const teachingSkillSchemaSql = `
CREATE TABLE IF NOT EXISTS teaching_skills (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, subject TEXT NOT NULL, grade TEXT NOT NULL,
  name TEXT NOT NULL, content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 0, sample_key TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS teaching_skills_owner_scope_idx ON teaching_skills(owner_id, subject, grade);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_skills_active_idx ON teaching_skills(owner_id, subject, grade) WHERE active = 1;
CREATE TABLE IF NOT EXISTS teaching_skill_trials (
  id TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES teaching_skills(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, content_snapshot TEXT NOT NULL, recognition_json TEXT NOT NULL,
  review_json TEXT NOT NULL, human_verdict TEXT NOT NULL DEFAULT 'pending', human_notes TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL, reviewer_name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS teaching_skill_trials_skill_idx ON teaching_skill_trials(skill_id, created_at);
CREATE TABLE IF NOT EXISTS teaching_skill_usages (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL, skill_id TEXT, revision INTEGER, content_snapshot TEXT NOT NULL, created_at TEXT NOT NULL
);`;

export type TeachingSkill = { id: string; ownerId: string; subject: string; grade: string; name: string; content: string; revision: number; active: number; sampleKey: string | null; createdAt: string; updatedAt: string };
export type SkillTrial = { id: string; skillId: string; revision: number; contentSnapshot: string; recognition: SkillRecognition; review: SkillReview; humanVerdict: string; humanNotes: string; modelName: string; reviewerName: string; createdAt: string };
export const skillColumns = "id, owner_id AS ownerId, subject, grade, name, content, revision, active, sample_key AS sampleKey, created_at AS createdAt, updated_at AS updatedAt";

export function ownedSkill(db: Database.Database, ownerId: string, id: string): TeachingSkill {
  const skill = db.prepare(`SELECT ${skillColumns} FROM teaching_skills WHERE id = ? AND owner_id = ?`).get(id, ownerId) as TeachingSkill | undefined;
  if (!skill) throw new Error("Skill 不存在");
  return skill;
}

export function skillTrials(db: Database.Database, skillId: string): SkillTrial[] {
  const rows = db.prepare(`SELECT id, skill_id AS skillId, revision, content_snapshot AS contentSnapshot, recognition_json AS recognitionJson, review_json AS reviewJson, human_verdict AS humanVerdict, human_notes AS humanNotes, model_name AS modelName, reviewer_name AS reviewerName, created_at AS createdAt FROM teaching_skill_trials WHERE skill_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20`).all(skillId) as Array<Omit<SkillTrial, "recognition" | "review"> & { recognitionJson: string; reviewJson: string }>;
  return rows.map(({ recognitionJson, reviewJson, ...row }) => ({ ...row, recognition: JSON.parse(recognitionJson), review: JSON.parse(reviewJson) }));
}

export function approveSkillTrial(db: Database.Database, input: { ownerId: string; skillId: string; trialId: string; revision: number; verdict: "approved" | "rejected"; notes: string }) {
  return db.transaction(() => {
    const skill = ownedSkill(db, input.ownerId, input.skillId);
    if (skill.revision !== input.revision) throw new Error("Skill 已更新，请刷新并重新试识别当前版本");
    const trial = skillTrials(db, skill.id).find(row => row.id === input.trialId && row.revision === skill.revision && row.contentSnapshot === skill.content);
    if (!trial) throw new Error("请先试识别当前版本，再对照原图复核");
    if (input.verdict === "approved" && (!trial.review.accurate || !trial.review.reasonable || trial.review.issues.length || trial.recognition.warnings.length || trial.recognition.questions.some(q => q.needsHumanReview)) && input.notes.trim().length < 10) throw new Error("模型存在疑点，请填写至少10字的人工核对依据后再通过");
    db.prepare("UPDATE teaching_skill_trials SET human_verdict = ?, human_notes = ? WHERE id = ?").run(input.verdict, input.notes, trial.id);
    // Approval alone does not silently enable a draft. Rejection disables an active version.
    if (input.verdict === "rejected") db.prepare("UPDATE teaching_skills SET active = 0 WHERE id = ?").run(skill.id);
  }).immediate();
}

export function activateTeachingSkill(db: Database.Database, ownerId: string, id: string, revision: number) {
  return db.transaction(() => {
    const skill = ownedSkill(db, ownerId, id);
    const latest = skillTrials(db, id).find(trial => trial.revision === skill.revision);
    if (skill.revision !== revision || !latest || latest.humanVerdict !== "approved" || latest.contentSnapshot !== skill.content) throw new Error("当前版本最新试识别尚未人工通过，不能启用");
    db.prepare("UPDATE teaching_skills SET active = 0 WHERE owner_id = ? AND subject = ? AND grade = ?").run(ownerId, skill.subject, skill.grade);
    db.prepare("UPDATE teaching_skills SET active = 1 WHERE id = ?").run(id);
  }).immediate();
}
