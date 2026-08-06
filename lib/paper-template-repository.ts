import { getSqlite } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import type { EducationStage } from "./education-taxonomy";
import { normalizePaperStyle, presetPaperTemplates, type PaperTemplate, type PaperTemplateConfig } from "./paper-templates";

function parseConfig(value: string): PaperTemplateConfig | null {
  try {
    const config = JSON.parse(value) as PaperTemplateConfig;
    if (!Array.isArray(config.sections) || !Array.isArray(config.infoFields)) return null;
    return { ...config, style: normalizePaperStyle(config.style) };
  } catch {
    return null;
  }
}

export async function getPaperTemplates(ownerId: string, subject?: string, stage?: EducationStage) {
  await ensureDatabase();
  const rows = getSqlite().prepare(
    `SELECT id, name, subject, stage, kind, description, config_json AS configJson
       FROM paper_templates WHERE owner_id = ? ORDER BY updated_at DESC`,
  ).all(ownerId) as Array<{ id: string; name: string; subject: string; stage: EducationStage; kind: PaperTemplate["kind"]; description: string; configJson: string }>;
  const custom = rows.flatMap((row) => {
    const config = parseConfig(row.configJson);
    return config ? [{ ...row, isPreset: false as const, config }] : [];
  });
  return [...presetPaperTemplates, ...custom].filter((template) =>
    (!subject || template.subject === "*" || template.subject === subject)
    && (!stage || template.subject === "*" || template.stage === stage),
  );
}
