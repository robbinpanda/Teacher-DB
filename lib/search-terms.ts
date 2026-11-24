/**
 * Turn a free-text bank search into AND-ed groups of OR-ed spellings.
 *
 * "2024交大附中高三期中" becomes [2024] AND [交大附中 | 上海交通大学附属中学 | …]
 * AND [高三] AND [期中 | 期中考试 | …], so word order, abbreviations and missing
 * spaces no longer decide whether a paper is found.
 */
export type SearchVocabularyEntry = { kind: "school" | "exam"; name: string; aliases: string[] };
/** `document` alternatives only match paper fields; a school's full name inside a stem means nothing. */
export type SearchAlternative = { text: string; scope: "all" | "document" };
export type SearchGroup = SearchAlternative[];

const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim();
const SEPARATORS = /[\s,，、;；|/·]+/;
const YEAR = /(?:19|20)\d{2}(?=年|届|学年|[^\d]|$)/g;
const SEMESTERS: Array<[RegExp, string[]]> = [
  [/第一学期|上学期/, ["上学期", "第一学期", "上"]],
  [/第二学期|下学期/, ["下学期", "第二学期", "下"]],
];

type Spelling = { text: string; entry: SearchVocabularyEntry };

function spellingsOf(vocabulary: SearchVocabularyEntry[]): Spelling[] {
  const list: Spelling[] = [];
  for (const entry of vocabulary) {
    for (const spelling of [entry.name, ...entry.aliases]) {
      const text = normalize(spelling).replace(/\s/g, "");
      if (text.length >= 2) list.push({ text, entry });
      const local = text.replace(/^上海市?/, "");
      if (local !== text && local.length >= 2) list.push({ text: local, entry });
    }
  }
  // Longest first, so 交大附中嘉定 wins over 交大附中.
  return list.sort((a, b) => b.text.length - a.text.length);
}

function entryGroup(entry: SearchVocabularyEntry, typed: string): SearchGroup {
  const texts = new Set([typed, entry.name, ...entry.aliases].map(text => normalize(text)).filter(Boolean));
  return [...texts].map(text => ({ text, scope: text === typed ? "all" : "document" }));
}

/** A fragment nobody registered: match it literally, plus any paper whose school/exam spelling contains it (交大 → 上海交通大学附属中学). */
function fragmentGroup(fragment: string, spellings: Spelling[]): SearchGroup {
  const group: SearchGroup = [{ text: fragment, scope: "all" }];
  if (fragment.length < 2) return group;
  const seen = new Set([fragment]);
  for (const { text, entry } of spellings) {
    if (!text.includes(fragment) || seen.has(entry.name)) continue;
    seen.add(entry.name);
    group.push({ text: entry.name, scope: "document" });
  }
  return group;
}

function splitFragment(fragment: string, spellings: Spelling[], groups: SearchGroup[]) {
  let rest = fragment;
  for (const [pattern, texts] of SEMESTERS) {
    if (!pattern.test(rest)) continue;
    rest = rest.replace(pattern, " ");
    groups.push(texts.map(text => ({ text, scope: text.length > 1 ? "all" : "document" })));
  }
  for (const { text, entry } of spellings) {
    if (!rest.includes(text)) continue;
    rest = rest.split(text).join(" ");
    groups.push(entryGroup(entry, text));
  }
  for (const leftover of rest.split(" ").map(part => part.trim()).filter(Boolean)) {
    groups.push(fragmentGroup(leftover, spellings));
  }
}

export function searchGroups(query: string, vocabulary: SearchVocabularyEntry[] = []): SearchGroup[] {
  const text = normalize(query);
  if (!text) return [];
  const spellings = spellingsOf(vocabulary);
  const groups: SearchGroup[] = [];
  for (const piece of text.split(SEPARATORS).filter(Boolean)) {
    // A year glued to Chinese (2024交大) is its own condition; other digits stay inside formulas.
    const years = piece.match(YEAR) ?? [];
    let rest = piece;
    for (const year of years) {
      groups.push([{ text: year, scope: "all" }]);
      rest = rest.replace(year, " ");
    }
    rest = rest.replace(/(^|\s)(年|届|学年)/g, " ");
    for (const fragment of rest.split(" ").filter(Boolean)) {
      if (/^[\x20-\x7e]+$/.test(fragment)) groups.push([{ text: fragment, scope: "all" }]);
      else splitFragment(fragment, spellings, groups);
    }
  }
  // Drop duplicate groups (高三 typed twice) so the SQL stays small.
  const unique = new Map(groups.map(group => [group.map(item => `${item.scope}:${item.text}`).join("|"), group]));
  return [...unique.values()];
}
