import { z } from "zod";
import { documentStatuses } from "./document-state.ts";

const text = z.string().nullable().optional();
export const progressResponseSchema = z.object({
  document: z.object({ id: z.string(), status: z.enum(documentStatuses), pageCount: z.number().int().min(0).max(250), error: text }).passthrough(),
  job: z.object({ status: z.enum(["queued", "processing", "retry_wait", "paused", "complete", "failed"]), nextAttemptAt: text, lastError: text }).passthrough().nullable().optional(),
  recognition: z.object({ questionTotal: z.number().int().positive().nullable(), completedQuestionNumbers: z.array(z.string().regex(/^[1-9]\d*$/)), completedQuestionCount: z.number().int().min(0), percent: z.number().min(0).max(100), phase: z.string(), lastEventAt: z.string().nullable(), message: z.string().nullable() }),
  pages: z.array(z.object({ pageId: z.string(), pageNumber: z.number().int().min(1).max(250), imageUrl: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), status: z.enum(["queued", "running", "retry_wait", "paused", "complete", "failed"]), attempt: z.number().int().min(0), error: text, nextAttemptAt: text, modelDisplayName: text, modelName: text, modelProvider: text }).passthrough()),
  processorAvailable: z.boolean().optional(),
  preparation: z.object({ status: z.enum(["queued", "processing", "retry_wait", "complete", "failed"]), completedPages: z.number().int().min(0), lastError: text, nextAttemptAt: text }).nullable().optional(),
}).passthrough();

export const extractionInputSchema = z.object({ documentId: z.string().trim().min(1).max(100), fileName: z.string().max(180).optional(), profileId: z.string().min(1).max(100).optional(), workerId: z.string().min(1).max(100).optional() }).strict();
export const uploadResponseSchema = z.object({ id: z.string().min(1), status: z.enum(documentStatuses).optional(), pageCount: z.number().int().min(0).max(250).optional(), preparationQueued: z.boolean().optional() }).passthrough();

export const uploadMetadataSchema = z.object({
  subject: z.string().max(60), grade: z.string().max(60), sourceExamType: z.string().max(120),
  sourceRegion: z.string().max(200), sourceTextbook: z.string().max(200), sourceSchool: z.string().max(200),
  sourceYear: z.number().int().min(1900).max(2200).nullable(),
});
