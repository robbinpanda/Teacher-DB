/** Only an explicit JSON false means the model cleared the item for automatic approval. */
export function modelNeedsHumanReview(value: unknown) {
  return value !== false;
}
