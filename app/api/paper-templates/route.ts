import { getSqlite } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { isEducationStage } from "../../../lib/education-taxonomy";
import { getPaperTemplates } from "../../../lib/paper-template-repository";
import { normalizePaperStyle, type PaperTemplateConfig } from "../../../lib/paper-templates";
import { now, requestOwner } from "../../../lib/server";

export const runtime = "nodejs";

function validConfig(config: PaperTemplateConfig | undefined) {
  return !!config && Array.isArray(config.sections) && config.sections.length > 0 && config.sections.length <= 12
    && config.sections.every((section) => section.title?.trim() && section.scoreDetail?.trim()
      && Array.isArray(section.acceptedTypes) && section.acceptedTypes.length > 0
      && Number.isFinite(section.defaultScore) && section.defaultScore >= 0);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stage = url.searchParams.get("stage") || undefined;
  if (stage && !isEducationStage(stage)) return Response.json({ error: "学段无效" }, { status: 400 });
  return Response.json({ templates: await getPaperTemplates(requestOwner(request), url.searchParams.get("subject") || undefined, isEducationStage(stage) ? stage : undefined) });
}

export async function POST(request: Request) {
  const payload = await request.json() as { id?: string; name?: string; subject?: string; stage?: string; description?: string; config?: PaperTemplateConfig };
  const name = payload.name?.trim() || "";
  const subject = payload.subject?.trim() || "数学";
  if (!name || name.length > 60) return Response.json({ error: "模板名称需为 1-60 个字符" }, { status: 400 });
  if (!isEducationStage(payload.stage) || !validConfig(payload.config)) return Response.json({ error: "模板内容不完整" }, { status: 400 });
  await ensureDatabase();
  const ownerId = requestOwner(request);
  const id = payload.id?.trim() || crypto.randomUUID();
  const timestamp = now();
  const config = { ...payload.config, style: normalizePaperStyle(payload.config?.style) } as PaperTemplateConfig;
  const existing = getSqlite().prepare("SELECT owner_id AS ownerId FROM paper_templates WHERE id = ?").get(id) as { ownerId: string } | undefined;
  if (existing && existing.ownerId !== ownerId) return Response.json({ error: "模板不存在" }, { status: 404 });
  try {
    getSqlite().prepare(
      `INSERT INTO paper_templates (id, owner_id, name, subject, stage, kind, description, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'custom', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, subject = excluded.subject, stage = excluded.stage,
         description = excluded.description, config_json = excluded.config_json, updated_at = excluded.updated_at`,
    ).run(id, ownerId, name, subject, payload.stage, payload.description?.trim() || "教师自定义模板", JSON.stringify(config), timestamp, timestamp);
  } catch (error) {
    if (error instanceof Error && /UNIQUE/.test(error.message)) return Response.json({ error: "已有同名模板" }, { status: 409 });
    throw error;
  }
  return Response.json({ id, templates: await getPaperTemplates(ownerId, subject, payload.stage) }, { status: existing ? 200 : 201 });
}
