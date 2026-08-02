export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type QuestionType = "single" | "multiple" | "fill" | "answer";

export type QuestionAsset = {
  id: string;
  kind: "figure" | "table" | "graph";
  page: number;
  bbox: BoundingBox;
  label: string;
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
  assets: QuestionAsset[];
  tags: string[];
  confidence: number;
  status: "pending" | "approved" | "needs_attention";
  score?: number;
};

export type SourceDocument = {
  id: string;
  name: string;
  subject: string;
  grade: string;
  pageCount: number;
  status: "uploading" | "extracting" | "reviewing" | "complete";
  createdAt: string;
  questionCount: number;
  approvedCount: number;
};

