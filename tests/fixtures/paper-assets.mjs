import assert from 'node:assert/strict';
import { getSqlite } from '../../db/index.ts';
import { ensureDatabase } from '../../db/bootstrap.ts';
import { getPaperData, getApprovedQuestions } from '../../lib/question-repository.ts';
import { normalizePaperSettings } from '../../lib/paper-templates.ts';
import { POST } from '../../server/http/handlers/papers/route.ts';
import { deleteLibraryPaper } from '../../lib/paper-library.ts';

await ensureDatabase();
const db = getSqlite(), timestamp = new Date().toISOString();
db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES ('source','teacher','原卷','application/pdf','complete','数学','九年级',?,?)").run(timestamp, timestamp);
for (const id of ['q1', 'q2', 'unrelated']) db.prepare("INSERT INTO questions (id,document_id,number,type,stem,status,page_number,bbox_json,created_at,updated_at) VALUES (?,'source',?,'fill','题干','approved',1,'{}',?,?)").run(id, String(['q1','q2','unrelated'].indexOf(id)+1), timestamp, timestamp);
const settings = { templateId: 'preset-homework', subject: '数学', stage: 'middle', notice: '原有提示', infoFields: ['姓名'], answerSpaces: { q2: 55 }, sections: [{ id: 'section', title: '保留分组', questionIds: ['q2','q1'], defaultScore: 7, acceptedTypes: ['fill'] }], style: { bodySize: 14 } };
async function save(title) {
  return POST(new Request('http://localhost/api/papers', { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': 'teacher' }, body: JSON.stringify({ id: 'paper', title, subtitle: '保留副标题', questionIds: ['q2','q1'], settings }) }));
}
assert.equal((await save('首次保存')).status, 201);
assert.equal((await save('更新当前作品')).status, 200);
assert.equal(db.prepare('SELECT COUNT(*) FROM papers').pluck().get(), 1);
const paper = await getPaperData('paper', 'teacher');
assert.deepEqual(paper.questions.map(q => q.id), ['q2','q1']);
const restored = normalizePaperSettings(paper.settings, paper.questions);
assert.deepEqual(restored.sections[0].questionIds, ['q2','q1']);
assert.equal(restored.sections[0].title, '保留分组');
assert.equal(restored.style.bodySize, 14);
assert.equal(restored.answerSpaces.q2, 55);
assert.equal(paper.subtitle, '保留副标题');
assert.equal(await getPaperData('paper', 'other'), null);
assert.deepEqual(await getApprovedQuestions('teacher', []), []);
db.prepare("UPDATE questions SET status='pending' WHERE id='q1'").run();
assert.equal((await getPaperData('paper', 'teacher')).questions.length, 2);
assert.equal((await save('不应悄悄丢题')).status, 400);
await deleteLibraryPaper('teacher', 'paper');
assert.equal(db.prepare('SELECT COUNT(*) FROM questions').pluck().get(), 3);
assert.equal(db.prepare('SELECT COUNT(*) FROM paper_items').pluck().get(), 0);
db.close();
