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

export type VariationReview = {
  mode: "rules" | "multi_agent";
  status: "rules_passed" | "passed" | "revised";
  score: number | null;
  issues: string[];
  reviewer: string | null;
};

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

export type MissingQuestionImage = { page: number | null; role: "question" | "answer"; description: string; reason: string };

export type ExtractionIssue = {
  code: string; message: string; raw?: string;
  field?: string; page?: number | null;
  kind?: "unreadable" | "absent" | "incomplete" | "uncertain";
};

export type Question = {
  aiReview?: QuestionAiReview | null;
  extractionIssues?: ExtractionIssue[];
  extractionIssuesResolved?: boolean;
  missingImages?: MissingQuestionImage[];
  imageIssuesResolved?: boolean;
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
  folderId?: string | null;
  parentQuestionId?: string | null;
  parentExternalId?: string | null;
  variationKind?: string | null;
  variationReview?: VariationReview | null;
  confidence: number;
  needsHumanReview: boolean;
  status: "pending" | "approved" | "needs_attention";
};

export type QuestionReviewCategory = "缺图" | "缺条件" | "缺答案" | "答案错误" | "解析错误" | "公式错误" | "配图错误" | "其他问题";

export type QuestionAiReview = {
  mode?: "saved_content_v1";
  categories?: QuestionReviewCategory[];
  status: "pending" | "passed" | "issues" | "failed" | "stale";
  token: string;
  startedAt?: string;
  profileId?: string;
  extractionProfileId?: string;
  extractionModel?: string;
  priorNeedsHumanReview?: boolean;
  sourcePages: number[];
  answerPages: number[];
  reviewedAt?: string;
  traceId?: string;
  error?: string;
};

export type SourceDocument = {
  id: string;
  name: string;
  subject: string;
  grade: string;
  pageCount: number;
  status: "uploading" | "awaiting_model" | "extracting" | "reviewing" | "complete" | "failed";
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
  textbook?: string | null;
  school?: string | null;
  sourceRemoved?: boolean;
  origin?: "original" | "imported" | "generated";
};

export type QuestionFolder = {
  id: string;
  parentId: string | null;
  name: string;
  questionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TeacherProfile = {
  region: string;
  textbook: string;
  grades: string[];
};

export type BankFacet = { value: string; count: number };

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
  textbook?: string | null;
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
