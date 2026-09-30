type AssetRef = { id: string; role: string };

// Persist answer-image ordinals so package import can regenerate asset UUIDs.
export function mapCandidateImageMarkers(text: string, answerCandidateIds: string[]) {
  return text.replace(/\[\[image:([^\]]+)\]\]/g, (_match, id: string) => {
    const index = answerCandidateIds.indexOf(id);
    return index < 0 ? "" : `[[image:${index + 1}]]`;
  });
}

export function remapAnalysisImages(text: string, before: AssetRef[], after: AssetRef[]) {
  const oldAnswers = before.filter(a => a.role === "answer");
  const newAnswers = after.filter(a => a.role === "answer");
  return text.replace(/\[\[image:(\d+)\]\]/g, (_match, number: string) => {
    const old = oldAnswers[Number(number) - 1];
    const index = old ? newAnswers.findIndex(a => a.id === old.id) : -1;
    return index < 0 ? "" : `[[image:${index + 1}]]`;
  });
}

export function analysisImageParts(text: string, imageCount: number) {
  const parts: Array<{ text: string } | { image: number }> = [];
  const used = new Set<number>();
  let start = 0;
  for (const match of text.matchAll(/\[\[image:([^\]]+)\]\]/g)) {
    parts.push({ text: text.slice(start, match.index) });
    const index = Number(match[1]) - 1;
    if (Number.isInteger(index) && index >= 0 && index < imageCount && !used.has(index)) {
      used.add(index); parts.push({ image: index });
    }
    start = match.index! + match[0].length;
  }
  parts.push({ text: text.slice(start) });
  for (let index = 0; index < imageCount; index++) if (!used.has(index)) parts.push({ image: index });
  return parts;
}
