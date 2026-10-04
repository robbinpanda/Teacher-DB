import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { applyClassRoster } from "../lib/class-roster.ts";

test("名单冲突整体回滚，重复导入不新增学生，跨教师隔离，归档不可导入", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE teaching_classes (id TEXT, owner_id TEXT, archived INTEGER, updated_at TEXT);
    CREATE TABLE students (id TEXT PRIMARY KEY, owner_id TEXT, student_no TEXT, name TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE class_students (class_id TEXT, student_id TEXT, seat_number TEXT, joined_at TEXT, PRIMARY KEY(class_id, student_id));
    INSERT INTO teaching_classes VALUES ('c', 'owner', 0, 't0'), ('archived', 'owner', 1, 't0');`);
  const run = rows => db.transaction(() => applyClassRoster(db, "owner", "c", rows, "t1"))();
  const row = { studentNo: "001", name: "甲", seatNumber: "1" };
  run([row]); run([row]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM students").get().n, 1);
  assert.throws(() => run([{ studentNo: "002", name: "乙", seatNumber: null }, { ...row, name: "丙" }]), /冲突/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM students").get().n, 1);
  assert.equal(db.prepare("SELECT name FROM students").get().name, "甲");
  assert.throws(() => applyClassRoster(db, "other", "c", [row], "t2"), /不存在/);
  assert.throws(() => applyClassRoster(db, "owner", "archived", [row], "t2"), /归档/);
  db.close();
});
