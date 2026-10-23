import { callTextModel } from "../../lib/text-model";
import { parseModelJson } from "../../lib/question-classification";
import { ChapterReviewConflictError } from "../../lib/authoring-content";

/** Repair malformed/contradictory structured answers once, without weakening the plan. */
export async function authoringModel<T>(input: Parameters<typeof callTextModel>[0], validate: (value: unknown) => T) {
  let repair: { error: string; previous: string } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await callTextModel({ ...input,
      purpose: attempt ? `${input.purpose}_repair` : input.purpose,
      system: `${input.system}\n若存在 repair，上一轮未通过校验。依据错误修正输出，保持原计划与所有约束。不能为了凑数选择不符合难度或目标的题；缺题就少选并写明 gaps，不能用占位题掩盖缺口。`,
      text: repair ? JSON.stringify({ ...JSON.parse(input.text), repair }) : input.text,
    });
    try { return { value: validate(parseModelJson(result.content)), traceId: result.traceId, modelProfileId: result.profile.id, modelDisplayName: result.profile.displayName }; }
    catch (error) {
      if (error instanceof ChapterReviewConflictError) throw error;
      if (attempt) throw error;
      repair = { error: error instanceof Error ? error.message.slice(0, 3000) : "返回格式不正确", previous: result.content.slice(0, 24000) };
    }
  }
  throw new Error("模型输出未通过校验");
}
