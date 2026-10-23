/** Conservative textual identity, not algebraic equivalence or image similarity. */
export function comparableQuestionText(value: string) {
  // Full-width ASCII has the same meaning; NFKC would also erase superscripts
  // and distinguishable symbols such as the real-number set ℝ versus R.
  const text = value.replace(/[\uFF01-\uFF5E]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0));
  const tokens = text.match(/\\[A-Za-z]+|\\[^\s]|[A-Za-z]+|\d+(?:\.\d+)?|[^\s]/gu) ?? [];
  return JSON.stringify(tokens.filter(token => !['$', '\\(', '\\)', '\\[', '\\]', '\\left', '\\right'].includes(token))
    .map(token => ['\\dfrac', '\\tfrac'].includes(token) ? '\\frac' : token));
}

type Option = { key: string; content: string };
type Asset = { id?: string; role?: string; cropKey?: string | null; sourceKey?: string | null; bbox?: unknown; box?: unknown; url?: string | null };
type QuestionIdentity = { id?: string; stem: string; type?: string; options?: Option[]; optionsJson?: string | null; assets?: Asset[]; assetsJson?: string | null };
function jsonArray<T>(value: string | null | undefined): T[] | null {
  if (!value) return [];
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : null; } catch { return null; }
}

export function questionIdentityKey(question: QuestionIdentity) {
  const options = question.options ?? jsonArray<Option>(question.optionsJson);
  const assets = question.assets ?? jsonArray<Asset>(question.assetsJson);
  // Malformed legacy metadata must not make distinct questions look identical.
  if (!options || !assets || options.some(option => !option || typeof option.key !== 'string' || typeof option.content !== 'string') || assets.some(asset => !asset || typeof asset !== 'object')) {
    return JSON.stringify(['unreadable', question.id, question.stem, question.optionsJson, question.assetsJson]);
  }
  return JSON.stringify([
    comparableQuestionText(question.stem),
    // Shuffling labels or correcting a single/multiple-choice metadata error
    // does not create another mathematical problem.
    options.map(option => comparableQuestionText(option.content)).sort(),
    // Answer illustrations do not change the question. A different question crop
    // does: identical "如图" stems alone cannot establish duplicate problems.
    assets.filter(asset => asset.role !== 'answer').map(asset => asset.cropKey ? ['crop', asset.cropKey]
      : asset.sourceKey ? ['source', asset.sourceKey, asset.bbox ?? asset.box ?? null]
      : ['unverified-image', question.id, asset.id, asset.url]),
  ]);
}
