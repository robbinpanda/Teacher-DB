import { getSqlite } from "../../db";
import { callTextModel } from "../../lib/text-model";
import { formatImportedPaperName, PAPER_NAME_PROMPT } from "../../lib/import-paper-name";

export async function nameImportedDocument(ownerId: string, documentId: string, original: string) {
  // Never borrow another owner's credentials or change their selected extraction model.
  const profiles = getSqlite().prepare(`SELECT p.id,p.model FROM model_profiles p
    LEFT JOIN app_settings s ON s.owner_id=p.owner_id
    WHERE p.owner_id=? AND p.enabled=1 AND p.api_key_ciphertext IS NOT NULL AND p.api_key_iv IS NOT NULL
    ORDER BY CASE WHEN p.id=s.selected_model_profile_id THEN 0 ELSE 1 END,
      CASE WHEN p.service='opencode-go' THEN 0 ELSE 1 END,p.id`).all(ownerId) as Array<{id:string;model:string}>;
  const profile = profiles.find(p => p.model.trim().toLowerCase().split("/").at(-1) === "mimo-v2.6-flash");
  if (!profile) return { name: original, namingWarning: "未配置可用的 MiMo 2.6 Flash，已保留原文件名" };
  try {
    const response = await callTextModel({ ownerId, profileId: profile.id, documentId,
      purpose: "document_naming", system: PAPER_NAME_PROMPT, text: JSON.stringify({ filename: original }),
      jsonMode: true, maxOutputTokens: 400, temperature: 0, timeoutMs: 20_000 });
    const json = response.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return { name: formatImportedPaperName(original, JSON.parse(json)) };
  } catch {
    return { name: original, namingWarning: "文件名识别未完成，已保留原文件名；原卷正常导入" };
  }
}
