import { getSqlite } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import { contextualPresetTags, isEducationStage, type EducationStage } from "./education-taxonomy";

export type TagCatalogEntry = { name: string; isPreset: boolean };

export async function getTagCatalog(ownerId: string, subject: string, stage: EducationStage): Promise<TagCatalogEntry[]> {
  await ensureDatabase();
  const sqlite = getSqlite();
  const custom = sqlite.prepare(
    "SELECT name FROM tag_catalog WHERE owner_id = ? AND subject = ? AND stage = ? ORDER BY name",
  ).all(ownerId, subject, stage) as Array<{ name: string }>;
  const profile = sqlite.prepare(
    "SELECT preferred_region AS region, preferred_textbook AS textbook FROM app_settings WHERE owner_id = ?",
  ).get(ownerId) as { region: string | null; textbook: string | null } | undefined;
  const presets = contextualPresetTags(subject, stage, profile?.region, profile?.textbook);
  return [
    ...presets.map((name) => ({ name, isPreset: true })),
    ...custom.filter((item) => !presets.includes(item.name)).map((item) => ({ name: item.name, isPreset: false })),
  ];
}

export function validTagScope(stage: unknown): stage is EducationStage {
  return isEducationStage(stage);
}
