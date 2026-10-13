/** Shared by extraction and image review so their formula/figure boundaries agree. */
export const FORMULA_AND_TABLE_PROMPT = [
  "数学矩阵、行列式、方程组、不等式组、分段函数属于数学公式，使用适当的 LaTeX 环境（如 matrix、pmatrix、bmatrix、vmatrix、cases、aligned、用于公式的 array）转录，不是表格或图片；不能仅因有行列、大括号或候选框就选为 asset。重复出现的公式仍逐字转录，不生成图片。",
  "数据表、统计表、频数/频率分布表、列联表、茎叶图、课程表、评分表以及复杂表头必须原样保存为 kind=table 的 asset。这里的表格指以单元格组织数据或类别的表，不包含数学矩阵和行列式。无论数据表多简单、是否能用 LaTeX 表达，都必须截图。",
  "严禁在 stem、options、answer、analysis 中用 LaTeX、Markdown 表格、纯文字行列或逗号列表重建数据表；不得用 tabular、array、matrix、\\multicolumn、\\multirow、\\hline、\\cline 绕过数据表截图规则。表格只能出现一次：选为 asset 后只转录前后文字与公式。数学公式可使用上述适当环境。",
].join("\n");

export const IMAGE_IDENTITY_PROMPT = [
  "role 表示教学用途，不按所在页分类：题干/选项所需的原始图为 question，即使副本在答案页；用于解答推导的配图为 answer。",
  "同一语义图的完全相同副本可以去重，优先保留清晰完整且符合教学用途的一个可用副本，绝不能把所有副本都删掉。答案新增辅助线、坐标标注或其他信息的图是不同版本，必须分别保留。不能确认完全相同时保留并标记复核。已有可用副本时，被去重的副本不属于 missingImages。",
  "先独立阅读原页，清点 uniqueImageCount（应保留的独立语义图/版本数，包含缺图，同一版本的完全相同副本只计一次），再选择候选。selectedImageCount 是 assets 中所选图片出现次数，必须等于 assets.length；为不同教学用途保留同图的多个副本时可以大于 uniqueImageCount，不能因此判错或删图。两个字段均为非负整数，不再输出 expectedImageCount。missingImages 每个尚无可用副本的独立图/版本只记录一次。候选为空不代表原页无图。",
].join("\n");

export const ANSWER_AND_UNCERTAINTY_PROMPT = [
  "每题返回 answer、analysis 和 answerSource。优先逐字复制原页显式答案，answerSource=answer；没有独立答案栏但解析中有明确写出的结论时，逐字复制这些结论到 answer，保留全部小问编号、条件和单位，answerSource=analysis，同时 analysis 仍保留完整原解析。不得自行生成答案或重写解法；允许内部验算以发现转录错误及验证下述题干补全。找不到可抄录的明确答案/结论时 answer 为空、answerSource=none。答案和解析条目必须关联原题号，绝不能伪造成新题。",
  "每个不确定项必须写入 uncertainties 数组（无疑点时 []），元素为 {field,page,kind,reason}：field 写字段及具体位置（如 analysis 或 options.A），page 写原卷页码，确实无法定位时 null；kind 只能为 unreadable（看不清）、absent（原卷没有该字段或明确结论）、incomplete（主动省略或未完成）、uncertain（关联/符号等存疑）；reason 简短说明并指出小问或步骤。空 answer、空 analysis 必须分别说明原因；部分缺失保留可读内容并指出缺口，不得整段丢弃。incomplete 只报告未完成，不允许为了缩短输出主动省略。任何疑点均 needsHumanReview=true。",
  "原页本身缺字、乱码或数学矛盾，且不满足题干补全规则时，保留可读原文，在 uncertainties 中用 kind=uncertain、reason 以‘原卷疑错：’开头说明具体位置和矛盾；needsHumanReview=true。不能因原参考答案这样写就忽略矛盾，也不能暗改答案或解析。",
].join("\n");

/** Perform this inside the first extraction call, before emitting each question. */
export const FIRST_PASS_ACCURACY_PROMPT = [
  "【首次输出前验收】先读完本题题干、全部小问及对应答案解析，再逐项回看原页后输出本题事件。不要把纠错留给后续审核。内部检查不输出思考过程，也不删减原解析。",
  "①条件：核对对象名称、每个数值及单位、参数范围、量词、角度、弧/线段和小问。‘长度为…’‘先赢…局’等位置不能无声留空；题内重复出现的同一对象和条件要对应。检查下一页顶部及跨页尾段，不能见到答案就停止。",
  "②公式：按结构核对分子/分母、根号覆盖范围、绝对值两侧、正负号、指数、上下标、向量箭头、交集/垂直符号。不把细小符号当噪点；相邻两式及最终答案做局部代入、数量级/符号检查，发现不一致先重读原图，不能靠记忆重写公式。已给坐标必须满足所列方程，导数正负区间、概率乘积及组合数下标必须自洽。原页也错则按原卷疑错处理。",
  "③图文：候选框只是位置提示，不证明内容是图。单独一行根式、计算式、方程组即使被框出，也只转LaTeX，不选asset；几何图、函数图及数据表保留完整边界、轴、点名和表头，按题干/解析用途对应，不能借邻题图片补缺。",
].join("\n");

export const EVIDENCE_BASED_STEM_REPAIR_PROMPT = [
  "【题干补全例外】逐字转录为默认；仅当stem有明显空缺、乱码或无法辨认的符号时，允许依据同一题答案、解析或配图补全。必须保留全部可见条件与句式，补入内容由明确引用或在现有结构下唯一反推，并与本题其余条件、各小问和答案验算一致。可恢复被解析明确使用的长度、坐标、角度或赛制数值；不能仅因‘这样能得到答案’、常见题型或其他题相似就补条件。多解、证据冲突、需增加未出现的假设或改动清晰可见条件时，禁止补全，保留原文并标记原卷疑错。",
  "返回 repairs 数组，无补全为[]；每项 {field,original,replacement,evidence}，field只能stem，original保留缺口附近原文，replacement记录对应补全文字，evidence为非空数组，每项{page,quote}逐字引用本题可见依据及原卷页码。直接在stem应用补全，记录供追溯；不得伪造依据。满足上述唯一性且无其他疑点的补全不必仅因补全而needsHumanReview=true；不满足规则的内容不能写入repairs冒充已确认。",
].join("\n");

export const JSON_LATEX_PROMPT = String.raw`同一个完整公式/方程组只用一对$包裹。cases、aligned等环境内部不能再插入$；行号①②放在公式外或用\text{①}，不能切断环境。先确认根号、分数、花括号与begin/end成对，再序列化JSON。
JSON 字符串中的每个数学反斜线必须再转义一层：原公式 $\frac{a}{b}$ 在原始 JSON 中写为 "$\\frac{a}{b}$"，不能写为 "$\frac{a}{b}$"（会把 \f 解析为控制字符）。LaTeX 的两个反斜线换行在原始 JSON 中写四个反斜线；文字换行使用 JSON 的 \n。每条事件必须闭合 question 和外层对象，再开始下一条。
以下是一条完整可解析的 question 事件外层与转义示例，仅展示 stem；实际事件必须补全下面规定的全部必填字段，内容以原卷为准：
{"event":"question","question":{"stem":"$\\frac{a}{b}$"}}
示例不提供题数、候选编号或置信度，不能从示例推断这些值。`;
