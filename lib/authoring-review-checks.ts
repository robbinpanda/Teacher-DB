export type AuthoringReviewCheck = { id: string; requirement: string };

const topicChecks: Record<string, Array<[string, string]>> = {
  angle: [
    ["units", "角度与弧度不得混用：π 弧度对应 180°。弧长 l=rθ、扇形面积 S=r²θ/2 中 θ 是相应几何圆心角的非负弧度数；有向角为负时不能直接得到负的几何长度或面积。"],
    ["terminal", "终边相同的角相差 2kπ（k 为整数）；象限角必须排除坐标轴上的角。若由 α 的象限判断 α/2 或 nα，必须考虑所有整数周期，不能只取主值。"],
  ],
  definition: [
    ["domain", "由终边点 (x,y) 定义时 r=√(x²+y²)>0，sinα=y/r、cosα=x/r，tanα=y/x 要求 x≠0。单位圆坐标解释、象限符号与特殊角值必须一致；正切在 π/2+kπ 处无定义。"],
  ],
  "same-angle": [
    ["sign", "sin²α+cos²α=1；tanα=sinα/cosα 要求 cosα≠0。从平方关系开方必须按角的范围判正负，不能默认正根。分式约分、除以 sinα 或 cosα 前要检查其是否为零。"],
  ],
  reduction: [
    ["sign", "诱导公式须核对函数名与符号：sin(-x)=-sin x、cos(-x)=cos x、sin(π-x)=sin x、cos(π-x)=-cos x、sin(π/2-x)=cos x、cos(π/2+x)=-sin x。不能把口诀当作不带象限条件的恒等式，正切仍须检查定义域。"],
  ],
  graphs: [
    ["domain", "基本正弦、余弦图象的定义域为 R、值域为 [-1,1]；正切的定义域排除 π/2+kπ，值域为 R，渐近线不能连接成函数图象。作图关键点、零点、极值和曲线走向必须与函数式一致。"],
  ],
  symmetry: [
    ["domain", "判断奇偶性先检查定义域关于原点对称；f(-x)=±f(x) 必须对全部定义域成立。图象平移后的对称中心或对称轴不等于函数关于原点的奇偶性。"],
    ["axes", "涉及基本函数对称性时，正弦对称轴 x=π/2+kπ、中心 (kπ,0)，余弦对称轴 x=kπ、中心 (π/2+kπ,0)，正切没有竖直对称轴、中心为 (kπ/2,0)。复合函数须同步变换横纵坐标；中心不要求属于函数图象。"],
  ],
  monotonicity: [
    ["interval", "复合三角函数的单调区间必须由内层角的不等式求解，再与题设定义域相交；除以负角系数时不等号反向，负振幅会交换增减性。正切只能在各个连续分支讨论单调，不能跨越渐近线声称单调。"],
  ],
  extrema: [
    ["attainment", "给定自变量区间时，先确定内层角实际能到达的范围，再检查端点、区间内极值点和开闭端点，区分上/下确界与能取得的最值。不能无条件套用 [-|A|+b,|A|+b]，含参情形须讨论临界位置与退化常函数。"],
  ],
  parameters: [
    ["shift", "从 sin x 到 A sin(ωx+φ) 的平移量取决于变换顺序：完成横向伸缩后，平移量是 -φ/ω（ω≠0），不能直接把 φ 当作最终平移距离。振幅为 |A|，周期涉及 |ω|；若按 A>0、ω>0 约定求参数须明确写出。"],
    ["uniqueness", "由图确定参数须识别所给点是否相邻零点/极值、是否跨越完整周期；两零点的距离不一定就是周期。相位一般只确定到模 2π，唯一值需要指定区间；部分图象或不充分条件不能强行确定唯一解析式。"],
  ],
  sum: [
    ["formulas", "正弦和差公式为 sin(α±β)=sinαcosβ±cosαsinβ，余弦为 cos(α±β)=cosαcosβ∓sinαsinβ。正切和差公式要求 tanα、tanβ、tan(α±β) 均有定义且分母非零；逆用公式不能丢失这些条件。"],
  ],
  double: [
    ["conditions", "核对 sin2x=2sin x cos x，cos2x=cos²x-sin²x=1-2sin²x=2cos²x-1；tan2x=2tan x/(1-tan²x) 仅在右式和左式均有定义时适用。降幂时常数项与系数不能漏，开方或消去因子须检查符号及零值。"],
  ],
  identity: [
    ["equivalence", "恒等变换每步须保留定义域；平方、开方、约分、换元不得产生未检验的增根或漏解。半角公式的根号正负由半角所在象限确定。积化和差、和差化积、半角公式可推导应用，不能宣称均为课标要求背诵的公式。"],
    ["auxiliary", "用辅助角化 a sin x+b cos x 时 R=√(a²+b²)，R>0 时 cosφ=a/R、sinφ=b/R；只用 tanφ=b/a 不能确定象限，a=0 时不能相除。a=b=0 是退化情形，求最值还须检查 x 的范围是否允许取得极值。"],
  ],
  model: [
    ["meaning", "周期模型须说明自变量、因变量及单位、适用时间范围，振幅、周期、平衡位置和初始相位要符合实际情境。初始值相同可能有不同运动方向；有方向条件时须一并核验，不能把数学模型任意外推到无实际意义的区间。"],
  ],
  "triangle.sine": [
    ["ambiguity", "正弦定理 a/sin A=b/sin B=c/sin C=2R 适用于非退化三角形。已知两边和其中一边对角时可能无解、一解或两解；反正弦主值不能代替全部角，须用角范围、角和及边角大小关系筛选。"],
  ],
  "triangle.cosine": [
    ["validity", "余弦定理 a²=b²+c²-2bc cos A 中边角必须对应。参数解需满足边长为正、三角形不等式、角在 (0,π) 内；代数解不一定构成非退化三角形。"],
  ],
  "triangle.application": [
    ["geometry", "面积公式 S=bc sin A/2 中 A 必须是 b、c 的夹角。测量模型需核对仰俯角、方向角、实际距离与单位；解出的边角要与原几何条件一致，讨论多解和退化情形，不得仅凭示意图假设垂直、相等或比例。"],
  ],
};

/** Small, explicit subject checks complement open-ended model review. */
export function authoringReviewChecks(knowledgeIds: string[]): AuthoringReviewCheck[] {
  const checks: AuthoringReviewCheck[] = [];
  const selected = new Set(knowledgeIds);
  for (const [topic, requirements] of Object.entries(topicChecks)) {
    const id = topic.startsWith("triangle.") ? `math.high.${topic}` : `math.high.trigonometry.${topic}`;
    const parent = topic.startsWith("triangle.") ? "math.high.triangle" : "math.high.trigonometry";
    if (selected.has(id) || selected.has(parent)) for (const [key, requirement] of requirements) checks.push({ id: `${topic}.${key}`, requirement });
  }
  if (selected.has("math.high.trigonometry.period") || selected.has("math.high.trigonometry")) checks.push(
    { id: "period.nonzero", requirement: "区分任意周期与最小正周期，最小正周期要求正且最小。采用非零周期约定且声称 −T 也为周期时，必须核对定义域的双向平移不变性；仅由正向包含不能推出负向包含，例如 D=[0,+∞) 的常函数。若教材明确只把正平移量称作周期，不能仅因这种术语约定判错，但不能混用两种约定进行推导。" },
    { id: "period.constant", requirement: "标准周期公式要求角系数 ω≠0 且振幅 A≠0。任一为零时须保留原式定义域：正弦余弦在 R 上退化为常函数时无最小正周期；0·tan x 的原定义域仍有缺点，不能擅自补成 R，定义域平移保持使其最小正周期仍为 π。不能把所有退化情形一概说成任意非零数都是周期。" },
    { id: "period.domain", requirement: "正切周期性针对整个定义域，平移一个周期通常跨越相邻连续区间；不得说周期结论只在每个连续区间内成立。定义域必须在周期平移下保持。" },
    { id: "period.absolute", requirement: "含绝对值或平方的函数可能缩短周期，需要恒等式、图象或定义核验最小性；|sin x|一般不能用恒等变换化为单一正弦/余弦函数，不能要求所有变式都先化为单一三角函数。" },
    { id: "period.minimum", requirement: "最小性可引用适用的最小正周期定理，或对任意周期推导必要条件。为任意 T 取特殊自变量（如 x=0 或极值点）得到必要条件是有效证明，不等于仅排除一个 T/2；不要求展开显然的代入步骤。正周期推导须核对负角系数：由 ωT=2kπ 得 T=2kπ/ω，T>0 时 k 与 ω 同号；改写为 2π|k|/|ω| 可行，但不能在原式中无条件令同一个 k 为正。" },
  );
  return checks;
}
