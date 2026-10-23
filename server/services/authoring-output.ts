import { getSqlite } from "../../db";
import { ensureDatabase } from "../../db/bootstrap";
import { getFile } from "../../lib/file-storage";
import type { EducationScope } from "../../lib/education-scope";
import { readAuthoringProject } from "./authoring";
import { readyAuthoringProject } from "./authoring-chapters";

export async function getAuthoringDocument(owner: string, id: string, scope?: EducationScope, print = false) {
  await ensureDatabase();
  const owned = getSqlite().prepare("SELECT subject,stage FROM authoring_projects WHERE id=? AND owner_id=?").get(id, owner) as EducationScope | undefined;
  if (!owned || scope && (scope.subject !== owned.subject || scope.stage !== owned.stage)) return null;
  const project = print ? readyAuthoringProject(owner, owned, id) : readAuthoringProject(owner, owned, id);
  if (!project?.plan) return null;
  // Print-only capabilities do not grant file API access. Embed only this work's reviewed images.
  if (print) for (const chapter of project.chapters) for (const question of chapter.content?.questions ?? []) for (const asset of question.assets) {
    if (!asset.cropKey) throw new Error("引用题图缺失，请先修复原题");
    const bytes = await getFile(asset.cropKey);
    const sharp = (await import("sharp")).default;
    asset.url = `data:image/png;base64,${(await sharp(bytes).png().toBuffer()).toString("base64")}`;
  }
  return { id: project.id, title: project.title, kind: project.kind, status: project.status, scope: owned, plan: project.plan, chapters: project.chapters };
}
export type AuthoringDocument = NonNullable<Awaited<ReturnType<typeof getAuthoringDocument>>>;
