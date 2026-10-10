export type ModelTraceSummary = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  model: string;
  provider: string;
  purpose: string;
  attempt?: number;
  status: "complete" | "failed" | "unfinished";
  callStatus?: string;
  validationStatus?: string;
  error?: string;
};
export type ModelTraceDetail = ModelTraceSummary & {
  result: unknown;
  validation: unknown;
  files: Array<{ name: string; bytes: number }>;
};
export type ModelTraceContent = {
  text: string;
  offset: number;
  nextOffset: number | null;
  bytes: number;
};
