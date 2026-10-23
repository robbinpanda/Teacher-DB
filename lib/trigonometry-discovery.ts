/** Discovery clues are not classifications and must never satisfy confirmed coverage. */
export function questionOptionText(optionsJson: string | null) {
  try {
    const values: unknown = JSON.parse(optionsJson ?? "[]");
    return Array.isArray(values) ? values.flatMap(value => value && typeof value === "object" && "content" in value && typeof value.content === "string" ? [value.content] : []).join("\n") : "";
  } catch { return ""; }
}

export function trigonometryDiscoveryClues(stem: string, options: string) {
  const clues = new Map<string, string>();
  const text = `${stem}\n${options}`.normalize("NFKC").replace(/图像/g, "图象");
  // Require trigonometry in the question itself: a solution mentioning an angle must
  // not turn a hyperbola's asymptote or a geometric reflection into a trig graph.
  if (!/\\(?:sin|cos|tan)(?![A-Za-z])|\b(?:sin|cos|tan)(?=[\s(\\^0-9α-ωΑ-ΩxyzABC])|正弦|余弦|正切/.test(text)) return clues;
  const rules: Array<[string, RegExp]> = [
    ["period", /最小正周期|周期/],
    ["symmetry", /对称轴|对称中心|奇偶性|奇函数|偶函数|关于.{0,20}对称/],
    ["monotonicity", /单调区间|单调递增|单调递减|单调性|增函数|减函数|递增区间|递减区间/],
    ["extrema", /最大值|最小值|最值|值域|最高点|最低点/],
    ["parameters", /平移|伸缩|振幅|初相位|相位|由图.{0,8}解析式/],
    ["graphs", /图象|渐近线|五点作图/],
    ["model", /摩天轮|潮汐|简谐振动|简谐运动|匀速圆周运动|纯音|复合音|周期现象/],
  ];
  for (const [topic, pattern] of rules) {
    const matched = text.match(pattern);
    if (matched) clues.set(`math.high.trigonometry.${topic}`, `三角函数式与“${matched[0]}”同时出现在题干或选项中`);
  }
  const math = text.replace(/\\(?:left|right)/g, "")
    .replace(/\\(?:dfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1/$2)")
    .replace(/\\([A-Za-z]+)/g, "$1").replace(/[{}\s$]/g, "");
  const argumentsByFunction = new Map<string, Set<string>>();
  // Deliberately narrow: identical atomic angles or an identical half-angle.
  // sin(alpha+beta), sin(2alpha) and sin(alpha) must not be conflated.
  const functions = /(sin|cos|tan)(?:\^[234])?(\((?:alpha|beta|theta|phi|[xyzABCαβθφ])(?:\/[2-9])?\)|(?:alpha|beta|theta|phi|[xyzABCαβθφ]))(?![A-Za-z0-9α-ωΑ-Ω])/g;
  for (const match of math.matchAll(functions)) {
    const argument = match[2].replace(/^\(|\)$/g, "");
    const names = argumentsByFunction.get(argument) ?? new Set<string>();
    names.add(match[1]); argumentsByFunction.set(argument, names);
  }
  for (const [argument, names] of argumentsByFunction) if (names.size >= 2) {
    clues.set("math.high.trigonometry.same-angle", `题干或选项含同一角 ${argument} 的 ${[...names].join("、")}，可核对是否使用同角关系`);
    break;
  }
  return clues;
}
