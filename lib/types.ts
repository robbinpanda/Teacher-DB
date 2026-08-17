export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type QuestionRegion = {
  page: number;
  bbox: BoundingBox;
};

export type QuestionType = "single" | "multiple" | "fill" | "answer";

export type QuestionAsset = {
  id: string;
  kind: "figure" | "table" | "graph";
  role: "question" | "answer";
  page: number;
  bbox: BoundingBox;
  label: string;
  sourceKey?: string | null;
  cropKey?: string | null;
  url?: string | null;
  width?: number;
  height?: number;
};

export type Question = {
  id: string;
  number: string;
  type: QuestionType;
  stem: string;
  options?: Array<{ key: string; content: string }>;
  answer: string;
  analysis: string;
  page: number;
  bbox: BoundingBox;
  regions: QuestionRegion[];
  assets: QuestionAsset[];
  tags: string[];
  confidence: number;
  needsHumanReview: boolean;
  status: "pending" | "approved" | "needs_attention";
};

export type SourceDocument = {
  id: string;
  name: string;
  subject: string;
  grade: string;
  pageCount: number;
  status: "uploading" | "extracting" | "reviewing" | "complete" | "failed";
  createdAt: string;
  questionCount: number;
  approvedCount: number;
  completedPageCount: number;
  failedPageCount: number;
  retryWaitPageCount: number;
  recognitionQuestionTotal?: number | null;
  recognizedQuestionCount?: number;
  recognitionPhase?: string | null;
  recognitionMessage?: string | null;
  jobStatus?: string | null;
  jobAttempt?: number | null;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  modelProfileId?: string | null;
  modelDisplayName?: string | null;
  modelName?: string | null;
  modelProvider?: string | null;
};

export type QuestionSource = {
  documentId: string;
  documentName: string;
  subject: string;
  grade: string;
  year?: number | null;
  examType?: string | null;
  region?: string | null;
  school?: string | null;
  sourceRemoved?: boolean;
};

export type QuestionWithSource = Question & {
  source: QuestionSource;
};

export type ReviewPage = {
  id: string;
  pageNumber: number;
  imageUrl: string;
  width: number;
  height: number;
  extractionStatus: "queued" | "running" | "retry_wait" | "paused" | "complete" | "failed";
  extractionAttempt: number;
  extractionError?: string | null;
  nextAttemptAt?: string | null;
  modelDisplayName?: string | null;
  modelName?: string | null;
  modelProvider?: string | null;
};

export type ReviewDocument = {
  id: string;
  name: string;
  subject: string;
  grade: string;
  year?: number | null;
  examType?: string | null;
  region?: string | null;
  school?: string | null;
  status: string;
  pageCount: number;
  questionCount: number;
  approvedCount: number;
  completedPageCount: number;
  failedPageCount: number;
  error?: string | null;
  jobStatus?: string | null;
  nextAttemptAt?: string | null;
  recognitionQuestionTotal?: number | null;
  recognizedQuestionNumbersJson?: string | null;
  recognitionPhase?: string | null;
  recognitionLastEventAt?: string | null;
  recognitionMessage?: string | null;
  modelProfileId?: string | null;
  modelDisplayName?: string | null;
  modelName?: string | null;
  modelProvider?: string | null;
};
