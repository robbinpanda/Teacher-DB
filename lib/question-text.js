/**
 * @param {string} stem
 * @param {string} number
 */
export function stripLeadingQuestionNumber(stem, number) {
  if (!/^[1-9]\d*$/.test(number)) return stem.trimStart();
  return stem.replace(new RegExp("^\\s*" + number + "\\s*(?:[.．](?!\\d)|[、。])\\s*"), "").trimStart();
}
