export const documentStatuses = ["uploading", "awaiting_model", "extracting", "reviewing", "failed", "complete"] as const;
export type DocumentStatus = typeof documentStatuses[number];

const transitions: Record<DocumentStatus, readonly DocumentStatus[]> = {
  uploading: ["awaiting_model", "extracting", "failed"],
  awaiting_model: ["uploading", "extracting", "failed"],
  extracting: ["uploading", "reviewing", "failed"],
  reviewing: ["uploading", "extracting", "complete", "failed"],
  failed: ["uploading", "extracting", "reviewing"],
  complete: ["reviewing", "extracting"],
};
export function canTransitionDocument(from: string, to: string) {
  return from === to || (transitions[from as DocumentStatus]?.includes(to as DocumentStatus) ?? false);
}
