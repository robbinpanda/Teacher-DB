import { getSqlite } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import { isEducationStage, presetTags, type EducationStage } from "./education-taxonomy";

export type TagCatalogEntry = { name: string; isPreset: boolean };

export async function getTagCatalog(ownerId: string, subject: string, stage: EducationStage): Promise<TagCatalogEntry[]> {
  await ensureDatabase();
  const custom = getSqlite().prepare(
    "SELECT name FROM tag_catalog WHERE owner_id = ? AND subject = ? AND stage = ? ORDER BY name",
  ).all(ownerId, subject, stage) as Array<{ name: string }>;
  return [
    ...presetTags(subject, stage).map((name) => ({ name, isPreset: true })),
    ...custom.filter((item) => !presetTags(subject, stage).includes(item.name)).map((item) => ({ name: item.name, isPreset: false })),
  ];
}

export function validTagScope(stage: unknown): stage is EducationStage {
  return isEducationStage(stage);
}
