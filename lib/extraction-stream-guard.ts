/** Stop runaway filler without rejecting normal LaTeX or ordinary answer blanks. */
export function hasRunawayFiller(text: string) {
  return /(?:\\*[_—-]){512,}$/.test(text.slice(-4096));
}
