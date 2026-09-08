import { getSqlite } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { isEducationStage } from "../../../lib/education-taxonomy";
import { getPaperTemplates } from "../../../lib/paper-template-repository";
import { normalizePaperStyle, type PaperTemplateConfig } from "../../../lib/paper-templates";
import { now, requestOwner } from "../../../lib/server";
import { readJsonPayload } from "../../../lib/request-payload";

export const runtime = "nodejs";

function validConfig(config: unknown): config is PaperTemplateConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const candidate = config as Partial<PaperTemplateConfig>;
  return Array.isArray(candidate.sections) && candidate.sections.length > 0 && candidate.sections.length <= 12
    && candidate.sections.every((section) => !!section && typeof section === "object"
      && typeof section.id === "string" && section.id.trim().length > 0 && section.id.length <= 80
      && typeof section.title === "string" && section.title.trim().length > 0 && section.title.length <= 120
      && typeof section.scoreDetail === "string" && section.scoreDetail.trim().length > 0 && section.scoreDetail.length <= 500
      && Array.isArray(section.acceptedTypes) && section.acceptedTypes.length > 0
      && section.acceptedTypes.every((type) => ["single", "multiple", "fill", "answer"].includes(type))
      && Number.isFinite(section.defaultScore) && section.defaultScore >= 0 && section.defaultScore <= 100
      && (section.scoreSequence === undefined || (Array.isArray(section.scoreSequence)
        && section.scoreSequence.length <= 200
        && section.scoreSequence.every((score) => Number.isFinite(score) && score >= 0 && score <= 100))));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stage = url.searchParams.get("stage") || undefined;
  if (stage && !isEducationStage(stage)) return Response.json({ error: "学段无效" }, { status: 400 });
  return Response.json({ templates: await getPaperTemplates(requestOwner(request), url.searchParams.get("subject") || undefined, isEducationStage(stage) ? stage : undefined) });
}

export async function POST(request: Request) {
  const parsed = await readJsonPayload<{ id?: string; name?: string; subject?: string; stage?: string; description?: string; config?: PaperTemplateConfig }>(request);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;
  if ((payload.id !== undefined && typeof payload.id !== "string")
    || typeof payload.name !== "string"
    || (payload.subject !== undefined && typeof payload.subject !== "string")
    || (payload.stage !== undefined && typeof payload.stage !== "string")
    || (payload.description !== undefined && typeof payload.description !== "string")) {
    return Response.json({ error: "模板字段格式无效" }, { status: 400 });
  }
  const name = payload.name?.trim() || "";
  const subject = payload.subject?.trim() || "数学";
  if (!name || name.length > 60) return Response.json({ error: "模板名称需为 1-60 个字符" }, { status: 400 });
  if (subject.length > 32 || (payload.description?.length ?? 0) > 500 || (payload.id?.length ?? 0) > 100) {
    return Response.json({ error: "模板字段过长" }, { status: 400 });
  }
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
