// Preview by default; --apply backs up the live database before renaming documents.
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const apply = process.argv.includes('--apply');
const db = new Database(path.resolve(process.env.JIANTI_DATA_DIR ?? 'data', 'teacher-question-bank.sqlite3'), { readonly: !apply });
db.pragma('busy_timeout = 10000');
const rows = db.prepare("SELECT id,name FROM documents WHERE owner_id='local-demo' AND source_removed_at IS NULL ORDER BY name,id").all();
const districtPattern = /(浦东新区|浦东区|黄浦区|徐汇区|长宁区|静安区|普陀区|虹口区|杨浦区|闵行区|宝山区|嘉定区|金山区|松江区|青浦区|奉贤区|崇明区)/g;
const skipped = [];
const changes = [];
for (const row of rows) {
  const reordered = row.name.replace(/^(20\d{2}年)(上海市.*?)(一模|二模)(（.*）)?$/, '$1$3$2$4');
  if (reordered !== row.name) {
    changes.push({ id: row.id, before: row.name, after: reordered });
    continue;
  }
  // The imported cohort is authoritative: 2021's first mock may take place in 2020.
  const prefix = row.name.match(/^(一模|二模)_(20\d{2})届__/);
  if (!prefix) { skipped.push(row); continue; }
  const expanded = row.name.replace('长宁、金山区', '长宁区、金山区');
  const districts = [...new Set([...expanded.matchAll(districtPattern)].map(m => m[1] === '浦东区' ? '浦东新区' : m[1]))];
  let suffix = '';
  if (/答案\.pdf$/i.test(row.name)) suffix = '（答案）';
  if (!districts.length) {
    const spring = row.name.match(/一模暨春考数学试卷(\d+)/);
    if (spring) suffix = `（春考模拟卷${spring[1]}）`;
    else if (/二模暨秋考模拟/.test(row.name)) suffix = '（秋考模拟）';
    else throw new Error(`Cannot determine district or citywide paper: ${row.name}`);
  }
  changes.push({ id: row.id, before: row.name, after: `${prefix[2]}年${prefix[1]}上海市${districts.join('、')}${suffix}` });
}
const names = [...changes.map(row => row.after), ...skipped.map(row => row.name)];
if (new Set(names).size !== names.length) throw new Error('Duplicate normalized names; inspect versions before applying');
console.log(JSON.stringify({ total: rows.length, renamed: changes.length, skipped: skipped.length, changes }, null, 2));
if (apply && changes.length) {
  const backupDir = path.resolve('backups', `paper-names-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(backupDir, { recursive: true });
  await db.backup(path.join(backupDir, 'before.sqlite3'));
  writeFileSync(path.join(backupDir, 'names.json'), JSON.stringify(changes, null, 2));
  db.transaction(() => {
    const update = db.prepare("UPDATE documents SET name=?,updated_at=? WHERE id=? AND name=? AND owner_id='local-demo' AND source_removed_at IS NULL");
    const timestamp = new Date().toISOString();
    for (const row of changes) {
      if (update.run(row.after, timestamp, row.id, row.before).changes !== 1) throw new Error(`Document changed concurrently: ${row.id}`);
    }
    const read = db.prepare('SELECT name FROM documents WHERE id=?');
    for (const row of changes) if (read.get(row.id)?.name !== row.after) throw new Error(`Rename verification failed: ${row.id}`);
  }).immediate();
  console.log(JSON.stringify({ applied: changes.length, backupDir }));
}
db.close();
