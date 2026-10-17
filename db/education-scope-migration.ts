import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { documentStageSql, normalizeEducationScope, type EducationScope } from "../lib/education-scope.ts";

/** Preserve every resource and directory path when splitting legacy shared folders. */
export function migrateEducationScopes(sqlite: Database.Database) {
  for (const table of ["question_folders", "paper_folders"]) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN subject TEXT NOT NULL DEFAULT '数学';
      ALTER TABLE ${table} ADD COLUMN stage TEXT NOT NULL DEFAULT 'middle';
      CREATE INDEX ${table}_scope_idx ON ${table}(owner_id, subject, stage, parent_id);`);
  }
  sqlite.exec("CREATE INDEX documents_education_scope_idx ON documents(owner_id, subject, grade, created_at)");
  // Older assembled papers may predate settings.subject/settings.stage.
  for (const paper of sqlite.prepare("SELECT id, settings_json FROM papers").all() as Array<{ id: string; settings_json: string }>) {
    let settings: Record<string, unknown> = {};
    try { const parsed = JSON.parse(paper.settings_json); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) settings = parsed; } catch { /* legacy defaults */ }
    const source = sqlite.prepare(`SELECT d.subject, ${documentStageSql()} AS stage FROM paper_items pi
      JOIN questions q ON q.id = pi.question_id JOIN documents d ON d.id = q.document_id
      WHERE pi.paper_id = ? ORDER BY pi.position LIMIT 1`).get(paper.id) as EducationScope | undefined;
    const scope = normalizeEducationScope({ subject: settings.subject ?? source?.subject, stage: settings.stage ?? source?.stage });
    sqlite.prepare("UPDATE papers SET settings_json = ? WHERE id = ?").run(JSON.stringify({ ...settings, ...scope }), paper.id);
  }
  for (const table of ["question_folders", "paper_folders"] as const) {
    type Folder = { id: string; owner_id: string; parent_id: string | null; name: string; created_at: string; updated_at: string };
    const folders = new Map((sqlite.prepare(`SELECT * FROM ${table}`).all() as Folder[]).map(row => [row.id, row]));
    const mapped = new Map<string, string>();
    const assigned = new Set<string>();
    function folderFor(id: string, scope: EducationScope): string {
      const key = JSON.stringify([id, scope.subject, scope.stage]);
      if (mapped.has(key)) return mapped.get(key)!;
      const folder = folders.get(id);
      if (!folder) throw new Error("历史文件夹不存在");
      const target = assigned.has(id) ? randomUUID() : id;
      mapped.set(key, target);
      assigned.add(id);
      const parent = folder.parent_id ? folderFor(folder.parent_id, scope) : null;
      if (target === id) sqlite.prepare(`UPDATE ${table} SET subject = ?, stage = ?, parent_id = ? WHERE id = ?`).run(scope.subject, scope.stage, parent, id);
      else sqlite.prepare(`INSERT INTO ${table} (id, owner_id, parent_id, name, created_at, updated_at, subject, stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(target, folder.owner_id, parent, folder.name, folder.created_at, folder.updated_at, scope.subject, scope.stage);
      return target;
    }
    const resources = table === "question_folders"
      ? sqlite.prepare(`SELECT q.id, q.folder_id AS folderId, d.subject, ${documentStageSql()} AS stage, 'questions' AS resource
          FROM questions q JOIN documents d ON d.id = q.document_id WHERE q.folder_id IS NOT NULL`).all()
      : sqlite.prepare(`SELECT d.id, d.paper_folder_id AS folderId, d.subject, ${documentStageSql()} AS stage, 'documents' AS resource
          FROM documents d WHERE d.paper_folder_id IS NOT NULL
          UNION ALL SELECT id, folder_id, json_extract(settings_json, '$.subject'), json_extract(settings_json, '$.stage'), 'papers'
          FROM papers WHERE folder_id IS NOT NULL`).all();
    for (const row of resources as Array<EducationScope & { id: string; folderId: string; resource: string }>) {
      const target = folderFor(row.folderId, normalizeEducationScope(row));
      const column = row.resource === "documents" ? "paper_folder_id" : "folder_id";
      sqlite.prepare(`UPDATE ${row.resource} SET ${column} = ? WHERE id = ?`).run(target, row.id);
    }
    // Empty descendants inherit their parent's scope; empty roots use the legacy default.
    for (const folder of folders.values()) {
      if (assigned.has(folder.id)) continue;
      let ancestor = folder.parent_id;
      while (ancestor && !assigned.has(ancestor)) ancestor = folders.get(ancestor)?.parent_id ?? null;
      const scope = ancestor ? sqlite.prepare(`SELECT subject, stage FROM ${table} WHERE id = ?`).get(ancestor) as EducationScope : normalizeEducationScope({});
      folderFor(folder.id, scope);
    }
  }
}
