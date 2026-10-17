import { isEducationStage, subjects, type EducationStage } from "./education-taxonomy.ts";

export type EducationScope = { subject: string; stage: EducationStage };
export const defaultEducationScope: EducationScope = { subject: "数学", stage: "middle" };
export const educationScopeCookie = "teacher-db-scope";

export function normalizeEducationScope(value: { subject?: unknown; stage?: unknown }): EducationScope {
  return {
    subject: typeof value.subject === "string" && (subjects as readonly string[]).includes(value.subject) ? value.subject : defaultEducationScope.subject,
    stage: isEducationStage(value.stage) ? value.stage : defaultEducationScope.stage,
  };
}

export function scopeFromCookieHeader(cookie: string | null): EducationScope {
  const value = cookie?.split(";").map(item => item.trim()).find(item => item.startsWith(`${educationScopeCookie}=`));
  try { return normalizeEducationScope(JSON.parse(decodeURIComponent(value?.slice(educationScopeCookie.length + 1) ?? "{}"))); }
  catch { return { ...defaultEducationScope }; }
}

export function requestEducationScope(request: Request): EducationScope {
  const fallback = scopeFromCookieHeader(request.headers.get("cookie"));
  const params = new URL(request.url).searchParams;
  return normalizeEducationScope({ subject: params.get("subject") ?? fallback.subject, stage: params.get("stage") ?? fallback.stage });
}

/** Same classification as stageFromGrade, including legacy records without a grade. */
export function documentStageSql(alias = "d") {
  return `CASE WHEN ${alias}.grade LIKE '%高%' THEN 'high'
    WHEN ${alias}.grade LIKE '%初%' OR ${alias}.grade LIKE '%中学%' OR ${alias}.grade LIKE '%初中%'
      OR ${alias}.grade LIKE '%七%' OR ${alias}.grade LIKE '%八%' OR ${alias}.grade LIKE '%九%' THEN 'middle'
    WHEN ${alias}.grade LIKE '%小学%' OR ${alias}.grade LIKE '%一%' OR ${alias}.grade LIKE '%二%'
      OR ${alias}.grade LIKE '%三%' OR ${alias}.grade LIKE '%四%' OR ${alias}.grade LIKE '%五%' OR ${alias}.grade LIKE '%六%' THEN 'primary'
    ELSE 'middle' END`;
}

export function documentScopeSql(scope?: EducationScope, alias = "d") {
  return scope ? { sql: ` AND COALESCE(NULLIF(${alias}.subject, ''), '数学') = ? AND (${documentStageSql(alias)}) = ?`, params: [scope.subject, scope.stage] } : { sql: "", params: [] as string[] };
}
