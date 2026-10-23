export type AuthoringReviewCheck = { id: string; requirement: string };

/** Small, explicit subject checks complement open-ended model review. */
export function authoringReviewChecks(knowledgeIds: string[]): AuthoringReviewCheck[] {
  const checks: AuthoringReviewCheck[] = [];
  if (knowledgeIds.includes("math.high.trigonometry.period")) checks.push(
    { id: "period.nonzero", requirement: "周期可为正或负的非零数；最小正周期要求正且最小。不得声称负周期无意义或不是周期，也不能把任意周期说成最小正周期。" },
    { id: "period.constant", requirement: "标准周期公式要求角系数 ω≠0 且振幅 A≠0。任一为零时，应讨论常函数（含原式定义域）和有无最小正周期，不能直接套公式。" },
    { id: "period.domain", requirement: "正切周期性针对整个定义域，平移一个周期通常跨越相邻连续区间；不得说周期结论只在每个连续区间内成立。定义域必须在周期平移下保持。" },
    { id: "period.absolute", requirement: "含绝对值或平方的函数可能缩短周期，需要恒等式、图象或定义核验最小性；|sin x|一般不能用恒等变换化为单一正弦/余弦函数，不能要求所有变式都先化为单一三角函数。" },
    { id: "period.minimum", requirement: "证明 T 为最小正周期必须使用适用的最小正周期定理，或排除所有更小的正周期；仅排除某一个较小值（如 T/2）不能证明最小性。若声称完成最小性证明，须说明任意周期的必要条件，而非只举一次反例。" },
  );
  return checks;
}
