import type { QuestionClassification } from "./question-classification.ts";
export type ClassificationBatchItem = {
  id:string; questionId:string; position:number; status:"pending"|"running"|"complete"|"skipped"|"failed";
  error:string|null; attempt:number; fingerprint:string;
  stem:string|null; documentName:string|null; classification:QuestionClassification|null;
  classificationStatus:"confirmed"|"suggested"|"stale"|"unclassified"; imageCount:number;
};
export type ClassificationBatch = { id:string; status:"running"|"paused"|"complete"|"needs_attention"; revision:number; profileId:string; createdAt:string; updatedAt:string; items:ClassificationBatchItem[] };
