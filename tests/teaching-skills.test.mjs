import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { subjects } from "../lib/education-taxonomy.ts";
import { builtInTeachingSkill, skillGrades, validateSkillScope, validateSkillContent } from "../lib/teaching-skill-catalog.ts";
import { parseSkillRecognition, parseSkillReview } from "../lib/teaching-skill-validation.ts";
import { teachingSkillSchemaSql, ownedSkill, approveSkillTrial, activateTeachingSkill } from "../lib/teaching-skill-store.ts";

test("120 个年级学科 Skill 均可查看、内容有差异且拒绝无效范围", () => {
  const content = subjects.flatMap(subject => skillGrades.map(grade => builtInTeachingSkill(subject, grade)));
  assert.equal(content.length, 120);
  assert.equal(new Set(content).size, 120);
  assert.ok(content.every(value => value.startsWith("---\nname:") && value.includes("## 年级差异") && value.includes("## 学科差异")));
  assert.throws(() => validateSkillScope("__proto__", "九年级"));
  assert.throws(() => validateSkillScope("数学", "初中"));
  assert.throws(() => validateSkillContent("短"));
});

const recognition = { questions: [{ number: "1", stem: "2+2=?", options: [], answer: "", analysis: "", evidence: "上方第一题", needsHumanReview: false }], warnings: [] };
const review = { accurate: true, reasonable: true, summary: "逐项吻合", issues: [] };
test("试识别与审校解析拒绝空题、重复题号和隐式布尔转换", () => {
  assert.deepEqual(parseSkillRecognition(JSON.stringify(recognition)), recognition);
  assert.deepEqual(parseSkillReview(JSON.stringify(review)), review);
  assert.throws(() => parseSkillRecognition(JSON.stringify({ ...recognition, questions: [] })));
  assert.throws(() => parseSkillRecognition(JSON.stringify({ ...recognition, questions: [...recognition.questions, ...recognition.questions] })));
  assert.throws(() => parseSkillReview(JSON.stringify({ ...review, accurate: "true" })));
});

test("个人 Skill 租户隔离、疑点人工说明、版本审批及每范围唯一启用", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE documents(id TEXT PRIMARY KEY)");
  db.exec(teachingSkillSchemaSql);
  const insert = db.prepare("INSERT INTO teaching_skills(id, owner_id, subject, grade, name, content, created_at, updated_at) VALUES (?, ?, '数学', '九年级', '技能', 'content', 't0', 't0')");
  insert.run("a", "teacher1"); insert.run("b", "teacher1"); insert.run("c", "teacher2");
  assert.throws(() => ownedSkill(db, "teacher2", "a"), /不存在/);
  assert.throws(() => activateTeachingSkill(db, "teacher1", "a", 1), /尚未人工通过/);
  const trial = db.prepare("INSERT INTO teaching_skill_trials(id, skill_id, revision, content_snapshot, recognition_json, review_json, model_name, reviewer_name, created_at) VALUES (?, ?, 1, 'content', ?, ?, 'model', 'reviewer', 't1')");
  trial.run("ta", "a", JSON.stringify(recognition), JSON.stringify({ ...review, accurate: false }));
  const approve = { ownerId: "teacher1", skillId: "a", trialId: "ta", revision: 1, verdict: "approved", notes: "" };
  assert.throws(() => approveSkillTrial(db, approve), /核对依据/);
  approveSkillTrial(db, { ...approve, notes: "对照原卷检查所有题目，模型疑点是误报。" });
  assert.equal(ownedSkill(db, "teacher1", "a").active, 0);
  activateTeachingSkill(db, "teacher1", "a", 1);
  trial.run("tb", "b", JSON.stringify(recognition), JSON.stringify(review));
  approveSkillTrial(db, { ...approve, skillId: "b", trialId: "tb" });
  activateTeachingSkill(db, "teacher1", "b", 1);
  assert.equal(ownedSkill(db, "teacher1", "a").active, 0);
  assert.equal(ownedSkill(db, "teacher1", "b").active, 1);
  assert.equal(ownedSkill(db, "teacher2", "c").active, 0);
  db.prepare("UPDATE teaching_skills SET revision = 2, active = 0 WHERE id = 'b'").run();
  assert.throws(() => activateTeachingSkill(db, "teacher1", "b", 2), /尚未人工通过/);
  assert.throws(() => approveSkillTrial(db, { ...approve, skillId: "b", trialId: "tb" }), /已更新/);
  db.close();
});
