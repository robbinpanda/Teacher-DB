import type { QuestionWithSource, VariationReview } from "./types.ts";
import type { PaperSettings } from "./paper-templates.ts";

export type WholePaperSource = {
  id: string; kind: "uploaded" | "assembled"; title: string; fingerprint: string; settings: PaperSettings;
  items: Array<{ source: QuestionWithSource; fingerprint: string; number: string; score: number; sectionId: string; sectionTitle: string }>;
};
export type WholePaperVariationItem = {
  id: string; position: number; source: QuestionWithSource; number: string; score: number; sectionTitle: string;
  status: "pending" | "running" | "awaiting_teacher" | "accepting" | "accepted" | "failed";
  revision: number; attempt: number; stage: string | null; error: string | null;
  runId: string | null; promotedQuestionId: string | null;
  retryFeedback?: string | null;
  retryAllowQuestionChanges?: boolean;
  candidate: { id: string; question: { stem: string; type: string; options: Array<{ key: string; content: string }>; answer: string; analysis: string; changeNote: string; diagram?: unknown }; review: VariationReview; diagramPreviewUrl?: string | null } | null;
};
export type WholePaperVariation = { sourceTitle: string; items: WholePaperVariationItem[] };
