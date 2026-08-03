/**
 * Split a continuous rendered document into page-sized ranges. Nearby block
 * boundaries are preferred so a paragraph or table is less likely to be cut.
 *
 * @param {number} totalHeight
 * @param {number} pageHeight
 * @param {number[]} [candidateBreaks]
 * @returns {{ start: number, height: number }[]}
 */
export function computePageSlices(totalHeight, pageHeight, candidateBreaks = []) {
  if (!Number.isFinite(totalHeight) || totalHeight <= 0) throw new Error("totalHeight must be positive");
  if (!Number.isFinite(pageHeight) || pageHeight <= 0) throw new Error("pageHeight must be positive");

  const breaks = Array.from(new Set(candidateBreaks
    .filter((value) => Number.isFinite(value) && value > 0 && value < totalHeight)
    .map((value) => Math.round(value))))
    .sort((a, b) => a - b);
  const slices = [];
  let start = 0;

  while (start < totalHeight) {
    const remaining = totalHeight - start;
    if (remaining <= pageHeight * 1.12) {
      slices.push({ start, height: remaining });
      break;
    }

    const ideal = start + pageHeight;
    const minimum = start + pageHeight * 0.72;
    const maximum = start + pageHeight * 1.06;
    const nearby = breaks.filter((value) => value >= minimum && value <= maximum);
    const end = nearby.length
      ? nearby.reduce((best, value) => Math.abs(value - ideal) < Math.abs(best - ideal) ? value : best)
      : ideal;

    slices.push({ start, height: end - start });
    start = end;
    if (slices.length >= 250) throw new Error("document exceeds the 250-page safety limit");
  }

  return slices;
}
