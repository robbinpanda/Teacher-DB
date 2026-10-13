# 六模型 benchmark：逐项错误证据与提示词归因

日期：2026-10-13。对应 2026-10-12 同三卷测试。本文件展开旧评分中的所有未满分项；不新增模型调用，不修改原始返回，不把历史分数自动重算。

共 48 个检查，40 个检查至少有一个模型未满分。检查可重复涉及同一题，不能把下面的条目数当作错题数。

## 先修正结论的表达

- **确有内容差异，也确有提示词和评估口径问题，不能全部算作模型能力错误。** 修改数字/负号、遗漏题图、主动略去解析、留空请求人工审核、字段拆分、JSON 损坏、旧后端中断，应分别统计。
- Luna 崇明17的两个正确答案在 analysis 中，旧报告“没有提取答案”应限定为 answer 字段未抽取。Luna 崇明20解析中的未化简距离根式是正确等价式；与 answer 的错误结论分开判断。
- Luna 宝山17～21为空答案/解析且已标记审核：是本轮未完成提取，不能直接叫胡编或违规留空。
- 崇明13的数学矩阵截图与“表格”定义存在提示词歧义，图片扣分先列为待定；矩阵元素 -1 误为 +1 则仍是独立的文本差异。
- Haiku 奉贤14选出的10张是5个独立图的两组页面副本；不是选错图。声明数量9存在内部不一致，整卷中断及后6题未交付还受旧后端影响。
- 旧技术分混合了请求交付、后端拒收、转义质量，旧内容分又重复覆盖题干/答案/解析。旧总分应保留为历史诊断，不能当作纯模型准确率或据此直接确定最终名次。

## 当时实际提示词，而不是今天的代码

18 份 request-1.json 的 system 提示词 SHA-256 一致：`aef9572bf859b3a0d40f279acee8f519670ca0b77e47c9542727c40312ca8f4d`。首个请求均为 temperature=0、reasoning_effort=none、max_tokens=32768、stream=true；这里只确认保存的首次请求，不能推断提供商内部如何解释参数。

完整 system 见 [实际提示词及问题清单](2026-10-13-prompt-audit.md)。关键规则编号：

| 编号 | 已有要求 | 对判错的意义 |
| --- | --- | --- |
| P1 | 逐字转录，不概括、不缩写、不合并步骤、不省略重复内容 | 数字/符号改变或主动“略”已违反明确保真要求 |
| P2 | 看不清或没有答案/解析时留空，缺失与不确定时标记审核 | 留空且告警应统计为弃答/未完成，不能与编造混为一谈 |
| P3 | 公式、方程组不当图片；但任何行列/空间位置内容算表格，并禁 array/matrix 表格 | 数学矩阵/行列式边界存在歧义；需修订后复测 |
| P4 | 每题计数所有题图表格答案图，选候选 ID；给 missingImages | 未定义独立图数 vs 页面出现次数；重复副本去重规则不足 |
| P5 | 每条事件独立完整 JSON，只一个 meta 和末尾 done | 缺括号/重复事件违反协议，但旧整卷失败是后端放大结果 |
| P6 | 答案和解析分开、禁止自行总结 | 无单列答案时如何从解析结论复制到 answer 未写清 |
| P7 | 公式用 LaTeX + 单个 $，完整 JSON | 没有给出 JSON 层反斜线转义例子，合法的 \b/\f 可能损坏公式 |

本明细中的“原卷对照要点”是人工转写/判据，不是模型多数投票，也不保证原卷自身数学无误。页码均为 PDF 从1开始。摘录来自已解码的原始 question 字段，保留模型写法；控制字符显示为 ⟪U+0008⟫ 等，省略部分明确标记。可在本地核验页查看完整字段与原页。

## 逐项未满分明细

### 题干 · 宝山11

原页：p1、p8。原卷对照要点：三条约束 x+y≥2,x≤1,y≤2

**Qwen** — 旧分 0/1；旧理由：≥0。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`5819d1ce-d70d-4dc7-b15d-c42bfcc16bb9`；定位 question.number=11，字段 stem。

```text
（4分）已知 $O$ 是坐标原点，点 $A(-1, 1)$. 若点 $M(x, y)$ 为平面区域 $⟪U+0008⟫egin{cases} x+y \geqslant 0 \ x \leqslant 1 \ y \leqslant 2 \end{cases}$ 上的一个动点，则 $\overrightarrow{OA} \cdot \overrightarrow{OM}$ 的取值范围是______.
```

**MiMo** — 旧分 0/1；旧理由：漏第一条关系和常数。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`2ad5ea11-aade-4cd7-a058-da6a77378216`；定位 question.number=11，字段 stem。

```text
（4分）已知$O$是坐标原点，点$A（-1，1）$.若点$M（x，y）$为平面区域$\begin{cases}x+y\\x≤1\\y≤2\\\end{cases}$上的一个动点，则$\overrightarrow{OA}•\overrightarrow{OM}$的取值范围是＿＿＿＿＿.
```

**DeepSeek** — 旧分 0/1；旧理由：≥1。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`b1d99b7e-ef96-4a7e-b717-a50de6fbb707`；定位 question.number=11，字段 stem。

```text
已知 $O$ 是坐标原点，点 $A(-1,1)$．若点 $M(x,y)$ 为平面区域 $\begin{cases}x+y\geqslant 1\\x\leqslant 1\\y\leqslant 2\end{cases}$ 上的一个动点，则 $\overrightarrow{OA}\cdot\overrightarrow{OM}$ 的取值范围是______．
```

**Luna** — 旧分 0/1；旧理由：≥1。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.93。Trace：`71163256-17b5-4b11-99a9-bfaf6c163b36`；定位 question.number=11，字段 stem。

```text
（4分）已知 $O$ 是坐标原点，点 $A（-1，1）$。若点 $M（x，y）$ 为平面区域 $\begin{cases}x+y\geq1\\x\leq1\\y\leq2\end{cases}$ 上的一个动点，则 $\overrightarrow{OA}\cdot\overrightarrow{OM}$ 的取值范围是______。
```

**Ling** — 旧分 0/1；旧理由：≤1。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`79e4dfff-ddf6-4606-a500-c1829bd52637`；定位 question.number=11，字段 stem。

```text
已知 $O$ 是坐标原点，点 $A(-1, 1)$. 若点 $M(x, y)$ 为平面区域 $\begin{cases} x+y \leqslant 1 \\ x \leqslant 1 \\ y \leqslant 2 \end{cases}$ 上的一个动点，则 $\overrightarrow{OA} \cdot \overrightarrow{OM}$ 的取值范围是______.
```

### 题干 · 宝山15

原页：p2。原卷对照要点：原式为 -1+3-5+…+(-1)^n(2n-1)，-5 后没有额外 +5。

**MiMo** — 旧分 0/1；旧理由：多 +5。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`2ad5ea11-aade-4cd7-a058-da6a77378216`；定位 question.number=15，字段 stem。

```text
（5分）用数学归纳法证明$-1+3-5+5+⋯+（-1）^n（2n-1）=（-1）^nn$，$n∈N^*$成立．那么，“当$n=1$时，命题成立”是“对$n∈N^*$“时，命题成立”的（　　）
```

### 题干 · 宝山21

原页：p4。原卷对照要点：第(3)问 a_n=-n/2+sin n；负号位于分数前。

**MiMo** — 旧分 0/1；旧理由：漏负号。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.95。Trace：`2ad5ea11-aade-4cd7-a058-da6a77378216`；定位 question.number=21，字段 stem。

```text
定义：$\{a_n\}$是无穷数列，若存在正整数$k$使得对任意$n∈N^*$，均有$a_{n+k}＞a_n$（$a_{n+k}＜a_n$）则称$\{a_n\}$是近似递增（减）数列，其中$k$叫近似递增（减）数列$\{a_n\}$的间隔数.
（1）若$a_n=n+（-1）^n$，$\{a_n\}$是不是近似递增数列，并说明理由；
（2）已知数列$\{a_n\}$的通项公式为$a_n=\frac{1}{（-2）^{n-1}}+a$，其前$n$项的和为$S_n$，若$2$是近似递增数列$\{S_n\}$的间隔数，求$a$的取值范围；
（3）已知$a_n=\frac{n}{2}+sinn$，证明$\{a_n\}$是近似递减数列，并且$4$是它的最小间隔数.
```

**Haiku** — 旧分 0/1；旧理由：漏负号。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.85。Trace：`41fae78a-e182-4b0b-a241-67e8f53f60fb`；定位 question.number=21，字段 stem。

```text
定义：$\{a_n\}$ 是无穷数列，若存在正整数 $k$ 使得对任意 $n\in\mathbf N^*$，均有 $a_{n+k}>a_n$（$a_{n+k}<a_n$）则称 $\{a_n\}$ 是近似递增（减）数列，其中 $k$ 叫近似递增（减）数列 $\{a_n\}$ 的间隔数。
（1）若 $a_n=n+(-1)^n$，$\{a_n\}$ 是不是近似递增数列，并说明理由；
（2）已知数列 $\{a_n\}$ 的通项公式为 $a_n=\dfrac{1}{(-2)^{n-1}}+a$，其前 $n$ 项的和为 $S_n$，若 $2$ 是近似递增数列 $\{S_n\}$ 的间隔数，求 $a$ 的取值范围；
（3）已知 $a_n=\dfrac n2+\sin n$，证明 $\{a_n\}$ 是近似递减数列，并且 $4$ 是它的最小间隔数。
```

**Luna** — 旧分 0/1；旧理由：漏负号。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.61。Trace：`71163256-17b5-4b11-99a9-bfaf6c163b36`；定位 question.number=21，字段 stem。

```text
定义：$\{a_n\}$ 是无穷数列，若存在正整数 $k$ 使得对任意 $n\in\mathbb{N}^*$，均有 $a_{n+k}>a_n（a_{n+k}<a_n）$ 则称 $\{a_n\}$ 是近似递增（减）数列，其中 $k$ 叫近似递增（减）数列 $\{a_n\}$ 的间隔数。
（1）若 $a_n=n+（-1）^n$，$\{a_n\}$ 是否是近似递增数列，并说明理由；
（2）已知数列 $\{a_n\}$ 的通项公式为 $a_n=\frac{1}{（-2）^{n-1}}+a$，其前 $n$ 项的和为 $S_n$，若2是近似递增数列 $\{S_n\}$ 的间隔数，求 $a$ 的取值范围；
（3）已知 $a_n=\frac{n}{2}+\sin n$，证明 $\{a_n\}$ 是近似递减数列，并且4是它的最小间隔数。
```

### 题干 · 崇明3

原页：p1、p5。原卷对照要点：分子 |√3+i|+i 的绝对值边界

**Luna** — 旧分 0/1；旧理由：额外绝对值 |+i|。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.82。Trace：`8ecca318-ac7d-4c59-9439-d4811ec28c41`；定位 question.number=3，字段 stem。

```text
（3分）已知复数 $z$ 满足 $\frac{|\sqrt{3}+i|+|+i|}{z}=i$，$i$ 为虚数单位，则 $z=$______。
```

### 题干 · 崇明4

原页：p1、p5。原卷对照要点：2^x+1 的指数边界

**DeepSeek** — 旧分 0/1；旧理由：2^(x+1)。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.95。Trace：`32824381-6f1e-4cb4-9e84-1582916b6e8d`；定位 question.number=4，字段 stem。

```text
已知函数$f(x)=2^{x+1}$，其反函数为$y=f^{-1}(x)$，则$f^{-1}(3)=$____.
```

**Luna** — 旧分 0/1；旧理由：2^(x+1)。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.7。Trace：`8ecca318-ac7d-4c59-9439-d4811ec28c41`；定位 question.number=4，字段 stem。

```text
（3分）已知函数 $f(x)=2^{x+1}$，其反函数为 $y=f^{-1}(x)$，则 $f^{-1}(3)=$______。
```

### 题干 · 崇明13

原页：p1、p10。原卷对照要点：矩阵 -1 与方程 x-y=3

**Haiku** — 旧分 0/1；旧理由：方程漏 -y。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.7。Trace：`eb1c2ec4-a354-461d-8a91-67deb7523412`；定位 question.number=13，字段 stem。

```text
若矩阵 $\begin{pmatrix}a&-1\\2&b\end{pmatrix}$ 是线性方程组 $\begin{cases}x=3\\2x-y=1\end{cases}$ 的系数矩阵，则（　　）
```

**Ling** — 旧分 0/1；旧理由：矩阵 -1 变 +1。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`2f4911ae-04e4-4f51-88f2-019ef1678e65`；定位 question.number=13，字段 stem。

```text
若矩阵 $\left(\begin{array}{ll} a & 1 \\ 2 & b \end{array}\right)$ 是线性方程组 $\left\{\begin{array}{l} x-y=3 \\ 2 x-y=1 \end{array}\right.$ 的系数矩阵，则（ ）
```

### 题干 · 崇明19

原页：p3。原卷对照要点：第(2)问至多而非至少

**Luna** — 旧分 0/1；旧理由：至多变至少。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.71。Trace：`8ecca318-ac7d-4c59-9439-d4811ec28c41`；定位 question.number=19，字段 stem。

```text
某开发商欲将一块如图所示的四边形空地 $ABCD$ 沿着边界用固定高度的板材围成一个封闭的施工区域，经测量，边界 $AB$ 与 $AD$ 的长都是2千米，$\angle BAD=60^\circ$，$\angle BCD=120^\circ$。
（1）如果 $\angle ADC=105^\circ$，求 $BC$ 的长（结果精确到0.001千米）；
（2）围成该施工区域至少需要多少千米长度的板材？（不计损耗，结果精确到0.001千米）
```

### 题干 · 奉贤2

原页：p1、p6。原卷对照要点：参数方程 x=6+2cosθ

**Qwen** — 旧分 0/1；旧理由：6+3。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`d044a415-92c7-4319-8fbf-785010516721`；定位 question.number=2，字段 stem。

```text
（4分）已知圆的参数方程为 $\begin{cases} x=6+3\\ y=2\sin\theta \end{cases}$，则此圆的半径是_______.
```

**MiMo** — 旧分 0/1；旧理由：6+3。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.7。Trace：`edb198c5-24e3-442b-8118-b33e5e71e474`；定位 question.number=2，字段 stem。

```text
（4分）已知圆的参数方程为$\begin{cases} x=6+3\\ y=2\sin\theta \end{cases}$，则此圆的半径是______.
```

**DeepSeek** — 旧分 0/1；旧理由：漏系数2。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.95。Trace：`fb821d19-e239-4f50-9ec8-350dcc3dc7bd`；定位 question.number=2，字段 stem。

```text
已知圆的参数方程为$\begin{cases} x=6+\cos\theta \\ y=2\sin\theta \end{cases}$，则此圆的半径是______。
```

**Haiku** — 旧分 0/1；旧理由：漏系数2。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.6。Trace：`e7a2d91b-f25f-457a-b364-c47d544608bb`；定位 question.number=2，字段 stem。

```text
已知圆的参数方程为 $\begin{cases}x=6+\cos\theta\\y=2\sin\theta\end{cases}$，则此圆的半径是________.
```

**Luna** — 旧分 0/1；旧理由：漏系数2。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.97。Trace：`b814e9ec-cc03-4d64-a971-f25fc0a4b591`；定位 question.number=2，字段 stem。

```text
（4分）已知圆的参数方程为 $\begin{cases}x=6+\cos\theta\\y=2\sin\theta\end{cases}$，则此圆的半径是______。
```

**Ling** — 旧分 0/1；旧理由：漏系数2。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`d7d476fb-e328-413c-bf66-0452305774c5`；定位 question.number=2，字段 stem。

```text
（4分）已知圆的参数方程为$\begin{cases} x=6+\cos\theta \\ y=2\sin\theta \end{cases}$（$\theta$为参数），则此圆的半径是______．
```

### 题干 · 奉贤3

原页：p1、p6。原卷对照要点：2029² 的数字与指数边界

**Luna** — 旧分 0/1；旧理由：202²9²。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.62。Trace：`b814e9ec-cc03-4d64-a971-f25fc0a4b591`；定位 question.number=3，字段 stem。

```text
（4分）设 $z=2021+bi$（$i$为虚数单位），若 $z\cdot\overline z=202^2 9^2$，则实数$b=$______。
```

### 题干 · 奉贤5

原页：p1、p7。原卷对照要点：三条约束 x+y≥2,x≤1,y≤2

**Qwen** — 旧分 0/1；旧理由：≤4。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`d044a415-92c7-4319-8fbf-785010516721`；定位 question.number=5，字段 stem。

```text
（4分）已知 $O$ 是坐标原点，点 $A(-1, 1)$，若点 $M(x, y)$ 为平面区域 $\begin{cases} x+y \le 4\\ x \le 1\\ y \le 2 \end{cases}$ 上的一个动点，则 $\overrightarrow{OM} \cdot \overrightarrow{OA}$ 的取值范围为_______.
```

**MiMo** — 旧分 0/1；旧理由：三条约束不完整。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.7。Trace：`edb198c5-24e3-442b-8118-b33e5e71e474`；定位 question.number=5，字段 stem。

```text
（4分）已知$O$是坐标原点，点$A$（$-1$，1），若点$M$（$x$，$y$）为平面区域$\begin{cases} x+y\\ x\\ y \end{cases}$上的一个动点，则$\overrightarrow{OM}\cdot \overrightarrow{OA}$的取值范围为______.
```

**DeepSeek** — 旧分 0/1；旧理由：≥1。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`fb821d19-e239-4f50-9ec8-350dcc3dc7bd`；定位 question.number=5，字段 stem。

```text
已知$O$是坐标原点，点$A(-1,1)$，若点$M(x,y)$为平面区域$\begin{cases} x+y\geqslant 1 \\ x\leqslant 1 \\ y\leqslant 2 \end{cases}$上的一个动点，则$\overrightarrow{OM}\cdot\overrightarrow{OA}$的取值范围为______。
```

**Luna** — 旧分 0/1；旧理由：≥1。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.63。Trace：`b814e9ec-cc03-4d64-a971-f25fc0a4b591`；定位 question.number=5，字段 stem。

```text
（4分）已知$O$是坐标原点，点$A（-1，1）$，若点$M（x，y）$为平面区域$\begin{cases}x+y\ge1\\x\le1\\y\le2\end{cases}$上的一个动点，则$\overrightarrow{OM}\cdot\overrightarrow{OA}$的取值范围为______。
```

**Ling** — 旧分 0/1；旧理由：≤1。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`d7d476fb-e328-413c-bf66-0452305774c5`；定位 question.number=5，字段 stem。

```text
（4分）已知$O$是坐标原点，点$A(-1,1)$，若点$M(x,y)$为平面区域$\begin{cases} x+y\leqslant 1 \\ x\leqslant 1 \\ y\leqslant 2 \end{cases}$上的一个动点，则$\overrightarrow{OM}\cdot\overrightarrow{OA}$的取值范围为______．
```

### 题干 · 奉贤11

原页：p1、p2、p11。原卷对照要点：原条件 m,n∈R⁺；甲的中间式是 (m+n)/m+(m+n)/n；乙最后还有 1/[m(1-m)]。甲乙丙均为题干的一部分，不是可以任意删掉的解答注释。

**Haiku** — 旧分 0/1；旧理由：甲乙丙略去。

本次归类：**明确省略／保真度不足**。实际提示词已多次要求逐字转录且不压缩解析。这里的“略”或省掉整段代数推导属于省略，不一定是数学结论错误。

返回标记：needsHumanReview=true，confidence=0.75。Trace：`e7a2d91b-f25f-457a-b364-c47d544608bb`；定位 question.number=11，字段 stem。

```text
三个同学对问题“已知 $m,n\in\mathbf R^+$，且 $m+n=1$，求 $\dfrac1m+\dfrac1n$ 的最小值”提出各自的解题思路：甲、乙、丙（略）。丙：参考上述解题思路，可求得当 $x=$________时，$y=\dfrac{a^2}{x^2}+\dfrac{1}{100-x^2}$（$0<x<10$，$a>0$）有最小值。
```

**Luna** — 旧分 0/1；旧理由：甲的中间表达式被改变。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.62。Trace：`b814e9ec-cc03-4d64-a971-f25fc0a4b591`；定位 question.number=11，字段 stem。

```text
（5分）三个同学对问题“已知$m，n\in\mathbb R^+$，且$m+n=1$，求$\frac1m+\frac1n$的最小值”提出各自的解题思路：
甲：$\frac1m+\frac1n=\frac{m+n}{mn}=2+\frac nm+\frac mn$，可用基本不等式求解；
乙：$\frac1m+\frac1n=\frac{m+n}{mn}=\frac1{mn}=\frac1{m(1-m)}$，可用二次函数配方法求解；
丙：$\frac1m+\frac1n=(\frac1m+\frac1n)(m+n)=2+\frac nm+\frac mn$，可用基本不等式求解；参考上述解题思路，可求得当$x=$______时，$y=\frac{a^2}{x^2}+\frac1{100-x^2}$（$0<x<10，a>0$）有最小值
```

**Ling** — 旧分 0/1；旧理由：正数改 R*，乙末项遗漏。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.9。Trace：`d7d476fb-e328-413c-bf66-0452305774c5`；定位 question.number=11，字段 stem。

```text
（5分）三个同学对问题“已知$m,n\in\mathbf{R}^{*}$，且$m+n=1$，求$\frac{1}{m}+\frac{1}{n}$的最小值”提出各自的解题思路：
甲：$\frac{1}{m}+\frac{1}{n}=\frac{m+n}{m}+\frac{m+n}{n}=2+\frac{n}{m}+\frac{m}{n}$，可用基本不等式求解；
乙：$\frac{1}{m}+\frac{1}{n}=\frac{m+n}{mn}=\frac{1}{mn}$，可用二次函数配方法求解；
丙：$\frac{1}{m}+\frac{1}{n}=(\frac{1}{m}+\frac{1}{n})(m+n)=2+\frac{n}{m}+\frac{m}{n}$，可用基本不等式求解；参考上述解题思路，可求得当$x=$______时，$y=\frac{a^{2}}{x^{2}}+\frac{1}{100-x^{2}}$（$0<x<10$，$a>0$）有最小值______
```

### 题干 · 奉贤15

原页：p3。原卷对照要点：极限分子 a^{f(n)}

**DeepSeek** — 旧分 0/1；旧理由：分子变 f(n)。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.95。Trace：`fb821d19-e239-4f50-9ec8-350dcc3dc7bd`；定位 question.number=15，字段 stem。

```text
设函数$f(x)=\log_a(1-a^x)$，其中$a>0$，且$a\neq 1$，若$n\in\mathbf{N}^*$，则$\lim\limits_{n\to\infty}\frac{f(n)}{a^n+a}=$（    ）
```

**Haiku** — 旧分 未返回/1；旧理由：后续未完整返回。

本次归类：**未交付／后端中断影响**。本题记录未完整返回；不能称为本题内容已识别错误。Haiku 的后续输出受旧后端在第14题抛错影响。

返回标记：needsHumanReview=null，confidence=null。Trace：`e7a2d91b-f25f-457a-b364-c47d544608bb`；定位 question.number=15，字段 stem。

```text
（本题未完整返回）
```

### 答案字段 · 宝山17

原页：p12、p13。原卷对照要点：两问结论：6、arccos(√17/17)

**Luna** — 旧分 0/1；旧理由：答案空白。

本次归类：**未完成提取／已声明不确定**。字段确实为空，但 needsHumanReview=true；提示词允许看不清时留空。这是覆盖率缺失，不是编造答案，不能据此证明违反“不确定留空”规则。

返回标记：needsHumanReview=true，confidence=0.62。Trace：`71163256-17b5-4b11-99a9-bfaf6c163b36`；定位 question.number=17，字段 answer。

```text
（空字符串）
```

### 答案字段 · 宝山18

原页：p13、p14。原卷对照要点：公共区间 [π/4,π/2] 与最大值 √6

**Luna** — 旧分 0/1；旧理由：答案空白。

本次归类：**未完成提取／已声明不确定**。字段确实为空，但 needsHumanReview=true；提示词允许看不清时留空。这是覆盖率缺失，不是编造答案，不能据此证明违反“不确定留空”规则。

返回标记：needsHumanReview=true，confidence=0.6。Trace：`71163256-17b5-4b11-99a9-bfaf6c163b36`；定位 question.number=18，字段 answer。

```text
（空字符串）
```

### 答案字段 · 崇明17

原页：p12、p13。原卷对照要点：两问结论：arctan(√2/4)、2/3

**Luna** — 旧分 0/1；旧理由：只有页码说明，没有答案。

本次归类：**字段拆分歧义**。两个正确结论均已出现在 analysis；只是 answer 写成页码说明。应记答案字段未抽取，不能记整题答案丢失。提示词没有明确无独立答案栏时能否从解析末句复制结论。

返回标记：needsHumanReview=true，confidence=0.72。Trace：`8ecca318-ac7d-4c59-9439-d4811ec28c41`；定位 question.number=17，字段 answer。

```text
（题目对应参考答案与解析页面中相关条目：第12—13页；答案文本中未印出单独的简答结论。）
```

### 答案字段 · 崇明20

原页：p16。原卷对照要点：第(1)问 AF=3√2/2

**Qwen** — 旧分 0/1；旧理由：√10/2。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`1560011e-192d-4ab0-b7ea-af10797bfba6`；定位 question.number=20，字段 answer。

```text
(1) $\frac{\sqrt{10}}{2}$; (2) 见解析; (3) 见解析
```

**DeepSeek** — 旧分 0/1；旧理由：3/2。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.95。Trace：`32824381-6f1e-4cb4-9e84-1582916b6e8d`；定位 question.number=20，字段 answer。

```text
（1）$\frac{3}{2}$；（2）证明见解析；（3）证明见解析
```

**Luna** — 旧分 0/1；旧理由：√2/2。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.61。Trace：`8ecca318-ac7d-4c59-9439-d4811ec28c41`；定位 question.number=20，字段 answer。

```text
（1）$|AF|=\frac{\sqrt2}{2}$。
（2）点$P$在椭圆$\Gamma$上。
（3）$S_{\triangle PAC}\le\frac{\sqrt2}{2}$，且当且仅当$m=0$时取等号。
```

**Ling** — 旧分 0/1；旧理由：√2/2。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`2f4911ae-04e4-4f51-88f2-019ef1678e65`；定位 question.number=20，字段 answer。

```text
（1）$\frac{\sqrt{2}}{2}$；（2）证明见解析；（3）证明见解析
```

### 答案字段 · 奉贤11

原页：p11。原卷对照要点：所求 x 为正根 √(100a/(a+1))

**Qwen** — 旧分 0/1；旧理由：多负号。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`d044a415-92c7-4319-8fbf-785010516721`；定位 question.number=11，字段 answer。

```text
-\sqrt{\frac{100a}{a+1}}
```

### 答案字段 · 奉贤12

原页：p11。原卷对照要点：三值集合，首项 (-2+√5)/2

**Ling** — 旧分 0/1；旧理由：首项变 -(2+√5)/2。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.85。Trace：`d7d476fb-e328-413c-bf66-0452305774c5`；定位 question.number=12，字段 answer。

```text
$-\frac{2+\sqrt{5}}{2}$或$-\frac{1}{2}$或$-\frac{1}{6}$
```

### 答案字段 · 奉贤16

原页：p15。原卷对照要点：EC=1，线面角 arcsin(√30/6)

**Haiku** — 旧分 未返回/1；旧理由：后续未返回。

本次归类：**未交付／后端中断影响**。本题记录未完整返回；不能称为本题内容已识别错误。Haiku 的后续输出受旧后端在第14题抛错影响。

返回标记：needsHumanReview=null，confidence=null。Trace：`e7a2d91b-f25f-457a-b364-c47d544608bb`；定位 question.number=16，字段 answer。

```text
（本题未完整返回）
```

### 答案字段 · 奉贤18

原页：p17。原卷对照要点：运输成本函数、定义域及 b=1/10 两侧速度

**Haiku** — 旧分 未返回/1；旧理由：后续未返回。

本次归类：**未交付／后端中断影响**。本题记录未完整返回；不能称为本题内容已识别错误。Haiku 的后续输出受旧后端在第14题抛错影响。

返回标记：needsHumanReview=null，confidence=null。Trace：`e7a2d91b-f25f-457a-b364-c47d544608bb`；定位 question.number=18，字段 answer。

```text
（本题未完整返回）
```

### 解析 · 宝山11

原页：p8、p9。原卷对照要点：各0.5：约束不被改错；三个顶点及目标值保留

**Qwen** — 旧分 0.5/1；旧理由：约束错，顶点保留。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`5819d1ce-d70d-4dc7-b15d-c42bfcc16bb9`；定位 question.number=11，字段 analysis。

```text
【分析】先画出满足约束条件 $⟪U+0008⟫egin{cases} x+y \geqslant 0 \ x \leqslant 1 \ y \leqslant 2 \end{cases}$ 的平面区域，求出平面区域的角点后，逐一代入 $\overrightarrow{OA} \cdot \overrightarrow{OM}$ 分析比较后，即可得到 $\overrightarrow{OA} \cdot \overrightarrow{OM}$ 的取值范围. [[image:p8-1]]
…（中间原文省略）…
【解答】解：满足约束条件 $⟪U+0008⟫egin{cases} x+y \geqslant 0 \ x \leqslant 1 \ y \leqslant 2 \end{cases}$ 的平面区域如下图所示：[[image:p8-2]][[image:p8-3]]
```

**MiMo** — 旧分 0.5/1；旧理由：约束缺，顶点保留。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`2ad5ea11-aade-4cd7-a058-da6a77378216`；定位 question.number=11，字段 analysis。

```text
【分析】先画出满足约束条件$\begin{cases}x+y\\x≤1\\y≤2\\\end{cases}$的平面区域，求出平面区域的角点后，逐一代入$\overrightarrow{OA}•\overrightarrow{OM}$分析比较后，即可得到$\overrightarrow{OA}•\overrightarrow{OM}$的取值范围.
…（中间原文省略）…
【解答】解：满足约束条件$\begin{cases}x+y\\x≤1\\y≤2\\\end{cases}$的平面区域如下图所示：
```

**DeepSeek** — 旧分 0.5/1；旧理由：约束错，顶点保留。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`b1d99b7e-ef96-4a7e-b717-a50de6fbb707`；定位 question.number=11，字段 analysis。

```text
【分析】先画出满足约束条件 $\begin{cases}x+y\geqslant 1\\x\leqslant 1\\y\leqslant 2\end{cases}$ 的平面区域，求出平面区域的角点后，逐一代入 $\overrightarrow{OA}\cdot\overrightarrow{OM}$ 分析比较后，即可得到 $\overrightarrow{OA}\cdot\overrightarrow{OM}$ 的取值范围．
…（中间原文省略）…
【解答】解：满足约束条件 $\begin{cases}x+y\geqslant 1\\x\leqslant 1\\y\leqslant 2\end{cases}$ 的平面区域如下图所示：
```

**Luna** — 旧分 0.5/1；旧理由：约束错，顶点保留。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.93。Trace：`71163256-17b5-4b11-99a9-bfaf6c163b36`；定位 question.number=11，字段 analysis。

```text
【分析】先画出满足约束条件 $\begin{cases}x+y\geq1\\x\leq1\\y\leq2\end{cases}$ 的平面区域，求出平面区域的角点后，逐一代入 $\overrightarrow{OA}\cdot\overrightarrow{OM}$ 分析比较后，即可得到 $\overrightarrow{OA}\cdot\overrightarrow{OM}$ 的取值范围。
…（中间原文省略）…
【解答】解：满足约束条件 $\begin{cases}x+y\geq1\\x\leq1\\y\leq2\end{cases}$ 的平面区域如下图所示：
```

**Ling** — 旧分 0.5/1；旧理由：约束错，顶点保留。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`79e4dfff-ddf6-4606-a500-c1829bd52637`；定位 question.number=11，字段 analysis。

```text
【分析】先画出满足约束条件 $\begin{cases} x+y \leqslant 1 \\ x \leqslant 1 \\ y \leqslant 2 \end{cases}$ 的平面区域，求出平面区域的角点后，逐一代入 $\overrightarrow{OA} \cdot \overrightarrow{OM}$ 分析比较后，即可得到 $\overrightarrow{OA} \cdot \overrightarrow{OM}$ 的取值范围.
…（中间原文省略）…
【解答】解：满足约束条件 $\begin{cases} x+y \leqslant 1 \\ x \leqslant 1 \\ y \leqslant 2 \end{cases}$ 的平面区域如下图所示：
```

### 解析 · 宝山17

原页：p12、p13。原卷对照要点：p12：DB₁=(-1/2,√3/2,2)，DC₁=(-1/2,-√3/2,2)。DeepSeek 分别漏掉 DB₁ 第一分量、DC₁ 第二分量的负号。

**DeepSeek** — 旧分 0.5/1；旧理由：两个向量分别丢负号。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`b1d99b7e-ef96-4a7e-b717-a50de6fbb707`；定位 question.number=17，字段 analysis。

```text
$\overrightarrow{DB_1}=(\frac{1}{2},\frac{\sqrt{3}}{2},2)$，$\overrightarrow{DC_1}=(-\frac{1}{2},\frac{\sqrt{3}}{2},2)$．
…（中间原文省略）…
设平面 $C_1B_1D$ 的法向量为 $\vec{n}=(x,y,z)$，
…（中间原文省略）…
由 $\begin{cases}\vec{n}\cdot\overrightarrow{DB_1}=-x+\sqrt{3}y+4z=0\\\vec{n}\cdot\overrightarrow{DC_1}=-x-\sqrt{3}y+4z=0\end{cases}$，取 $z=1$，得 $\vec{n}=(4,0,1)$．
```

**Luna** — 旧分 0/1；旧理由：解析空白。

本次归类：**未完成提取／已声明不确定**。字段确实为空，但 needsHumanReview=true；提示词允许看不清时留空。这是覆盖率缺失，不是编造答案，不能据此证明违反“不确定留空”规则。

返回标记：needsHumanReview=true，confidence=0.62。Trace：`71163256-17b5-4b11-99a9-bfaf6c163b36`；定位 question.number=17，字段 analysis。

```text
（空字符串）
```

### 解析 · 宝山18

原页：p14。原卷对照要点：p14 印刷式：Φ-π/3=-π/6+(-1)^k kπ。只比较照录，不把原式当作已独立验证的通解公式。

**DeepSeek** — 旧分 0.5/1；旧理由：相位等式漏负号。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.95。Trace：`b1d99b7e-ef96-4a7e-b717-a50de6fbb707`；定位 question.number=18，字段 analysis。

```text
（2）$h(x)=\sqrt{2}[\sin(2x+\phi)+\cos 2x]$，把点 $(-\frac{\pi}{6},0)$ 代入化简可得 $\sin(\phi-\frac{\pi}{3})=-\frac{1}{2}$，结合题意可得 $\phi=\frac{\pi}{6}$，进而求得 $h(x)$ 的最大值．
…（中间原文省略）…
（2）$h(x)=\sqrt{2}[\sin(2x+\phi)+\cos 2x]$，把点 $(-\frac{\pi}{6},0)$ 代入得 $\sqrt{2}[\sin(-\frac{\pi}{3}+\phi)+\cos(-\frac{\pi}{3})]=0$，即 $\sin(\phi-\frac{\pi}{3})=-\frac{1}{2}$，
…（中间原文省略）…
$\therefore \phi-\frac{\pi}{3}=\frac{\pi}{6}+(-1)^kk\pi$，$k\in Z$，得 $\phi=\frac{\pi}{6}$，
```

**Luna** — 旧分 0/1；旧理由：解析空白。

本次归类：**未完成提取／已声明不确定**。字段确实为空，但 needsHumanReview=true；提示词允许看不清时留空。这是覆盖率缺失，不是编造答案，不能据此证明违反“不确定留空”规则。

返回标记：needsHumanReview=true，confidence=0.6。Trace：`71163256-17b5-4b11-99a9-bfaf6c163b36`；定位 question.number=18，字段 analysis。

```text
（空字符串）
```

**Ling** — 旧分 0.5/1；旧理由：相位等式漏 k。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`79e4dfff-ddf6-4606-a500-c1829bd52637`；定位 question.number=18，字段 analysis。

```text
（2）$h(x)=\sqrt{2}[\sin(2x+\Phi)+\cos 2x]$，把点 $(-\frac{\pi}{6}, 0)$ 代入化简可得 $\sin(\Phi-\frac{\pi}{3})=-\frac{1}{2}$，结合题意可得 $\Phi=\frac{\pi}{6}$，进而求得 $h(x)$ 的最大值.
…（中间原文省略）…
$\sqrt{2}[\sin(-\frac{\pi}{3}+\Phi)+\cos(-\frac{\pi}{3})]=0$，即 $\sin(\Phi-\frac{\pi}{3})=-\frac{1}{2}$，
…（中间原文省略）…
$\therefore \Phi-\frac{\pi}{3}=-\frac{\pi}{6}+(-1)^k \pi$，$k \in \mathbf{Z}$，得 $\Phi=\frac{\pi}{6}$，
```

### 解析 · 宝山21

原页：p17。原卷对照要点：p17：-(n+k)/2+sin(n+k)<-n/2+sin n；a>(-1/4)×(-1/2)^n；c_n=(-1/4)×(-1/2)^n。原卷另印着 3.23>32，不把照录 32 当作新增识别错误。

**Qwen** — 旧分 0/1；旧理由：(3)漏负号，(2)额外负号。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`5819d1ce-d70d-4dc7-b15d-c42bfcc16bb9`；定位 question.number=21，字段 analysis。

```text
（2）利用数列的 $S_n=⟪U+000C⟫rac{1-(-⟪U+000C⟫rac{1}{2})^n}{1+⟪U+000C⟫rac{1}{2}}+an$ 和 $S_{n+2}-S_n=a_{n+1}+a_{n+2}=-(-⟪U+000C⟫rac{1}{2})^{n+1}+2a>0$，进一步确定 $a$ 的范围.
…（中间原文省略）…
（3）利用由 $a_{n+k}<a_n$ 得：$⟪U+000C⟫rac{n+k}{2}+\sin(n+k)<⟪U+000C⟫rac{n}{2}+\sin n$，即 $k>2[\sin(n+k)-\sin n]$，进一步利用赋值法的应用求出结果.
…（中间原文省略）…
或 $S_{n+2}-S_n=a_{n+1}+a_{n+2}=-(-⟪U+000C⟫rac{1}{2})^{n+1}+2a>0$，
…（中间原文省略）…
即 $a>-(-⟪U+000C⟫rac{1}{4}) 	imes (-⟪U+000C⟫rac{1}{2})^n$ 恒成立.
…（中间原文省略）…
令 $c_n=(-⟪U+000C⟫rac{1}{4}) 	imes (-⟪U+000C⟫rac{1}{2})^n$，则 $(c_n)_{\max}=c_1=⟪U+000C⟫rac{1}{8}$，
…（中间原文省略）…
（3）由 $a_{n+k}<a_n$ 得：$⟪U+000C⟫rac{n+k}{2}+\sin(n+k)<⟪U+000C⟫rac{n}{2}+\sin n$，
```

**MiMo** — 旧分 0.5/1；旧理由：(3)漏负号。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.95。Trace：`2ad5ea11-aade-4cd7-a058-da6a77378216`；定位 question.number=21，字段 analysis。

```text
（2）利用数列的$S_n=\frac{1-（-\frac{1}{2}）^n}{1+\frac{1}{2}}+an$和$S_{n+2}-S_n=a_{n+1}+a_{n+2}=-（-\frac{1}{2}）^{n+1}+2a＞0$，进一步确定$a$的范围.
…（中间原文省略）…
（3）利用由$a_{n+k}＜a_n$得：$\frac{n+k}{2}+sin（n+k）＜\frac{n}{2}+sinn$，即$k＞2[sin（n+k）-sinn]$，进一步利用赋值法的应用求出结果.
…（中间原文省略）…
或$S_{n+2}-S_n=a_{n+1}+a_{n+2}=-（-\frac{1}{2}）^{n+1}+2a＞0$，
…（中间原文省略）…
令$c_n=（-\frac{1}{4}）×（-\frac{1}{2}）^n$，则$（c_n）_{max}=c_1=\frac{1}{8}$，
…（中间原文省略）…
（3）由$a_{n+k}＜a_n$得：$\frac{n+k}{2}+sin（n+k）＜\frac{n}{2}+sinn$，
```

**Haiku** — 旧分 0.5/1；旧理由：(3)漏负号。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.85。Trace：`41fae78a-e182-4b0b-a241-67e8f53f60fb`；定位 question.number=21，字段 analysis。

```text
（2）利用数列的 $S_n$ 和 $S_{n+2}-S_n>0$ 进一步确定 $a$ 的范围。
…（中间原文省略）…
（3）利用由 $a_{n+k}<a_n$ 得 $k>2[\sin(n+k)-\sin n]$，进一步利用赋值法的应用求出结果。
…（中间原文省略）…
(2) 由题意得 $S_n=\dfrac{1-(-\frac12)^n}{1+\frac12}+an=\dfrac23[1-(-\tfrac12)^n]+an$，或 $S_{n+2}-S_n=a_{n+1}+a_{n+2}=-(-\tfrac12)^{n+1}+2a>0$，即 $a>(-\tfrac14)\times(-\tfrac12)^n$ 恒成立。令 $c_n=(-\tfrac14)\times(-\tfrac12)^n$，则 $(c_n)_{\max}=c_1=\dfrac18$，即 $a$ 的取值范围是 $\left(\dfrac18,+\infty\right)$。
…（中间原文省略）…
(3) 由 $a_{n+k}<a_n$ 得 $\dfrac{n+k}{2}+\sin(n+k)<\dfrac{n}{2}+\sin n$，即 $k>2[\sin(n+k)-\sin n]$ ①。由于 $\sin n$ 和 $\sin(n+k)$ 均取不到 $\pm1$，所以 $k=4$ 时，上式恒成立，即数列 $\{a_n\}$ 是近似递减数列，4 是它的间隔数。
```

**Luna** — 旧分 0/1；旧理由：解析空白。

本次归类：**未完成提取／已声明不确定**。字段确实为空，但 needsHumanReview=true；提示词允许看不清时留空。这是覆盖率缺失，不是编造答案，不能据此证明违反“不确定留空”规则。

返回标记：needsHumanReview=true，confidence=0.61。Trace：`71163256-17b5-4b11-99a9-bfaf6c163b36`；定位 question.number=21，字段 analysis。

```text
（空字符串）
```

**Ling** — 旧分 0/1；旧理由：(3)漏负号，(2)多个负号遗漏。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.95。Trace：`79e4dfff-ddf6-4606-a500-c1829bd52637`；定位 question.number=21，字段 analysis。

```text
（2）利用数列的 $S_n=\frac{1-(-\frac{1}{2})^n}{1+\frac{1}{2}}+an$ 和 $S_{n+2}-S_n=a_{n+1}+a_{n+2}=(-\frac{1}{2})^{n+1}+2a>0$，进一步确定 $a$ 的范围.
…（中间原文省略）…
（3）利用由 $a_{n+k}<a_n$ 得：$\frac{n+k}{2}+\sin(n+k)<\frac{n}{2}+\sin n$，即 $k>2[\sin(n+k)-\sin n]$，进一步利用赋值法的应用求出结果.
…（中间原文省略）…
或 $S_{n+2}-S_n=a_{n+1}+a_{n+2}=(-\frac{1}{2})^{n+1}+2a>0$，
…（中间原文省略）…
即 $a>(-\frac{1}{4}) \times (-\frac{1}{2})^n$ 恒成立.
…（中间原文省略）…
令 $c_n=(\frac{1}{4}) \times (-\frac{1}{2})^n$，则 $(c_n)_{\max}=c_1=\frac{1}{8}$，
…（中间原文省略）…
（3）由 $a_{n+k}<a_n$ 得：$\frac{n+k}{2}+\sin(n+k)<\frac{n}{2}+\sin n$，
```

### 解析 · 崇明9

原页：p7。原卷对照要点：p7：【分析】印着 T/2；【解答】印着 |π-φ+2(k-m)π|≤π/3。Haiku 将推导概括为一句；MiMo/Luna 把 T 写成 π；DeepSeek 将约束右侧写为 π/2。Luna 解答的 ≤ 还变成 ≥（旧该项只扣了半分，没有全面覆盖）。

**MiMo** — 旧分 0.5/1；旧理由：T 误作 π。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.95。Trace：`c6c92344-3896-4123-ba60-eaf8918f7e2e`；定位 question.number=9，字段 analysis。

```text
【分析】先根据左加右减得到$g(x)$的解析式，然后根据三角函数的性质可知，两个相邻的最值点的函数值的差为2．此时它们横坐标差的绝对值为$\frac{\pi}{2}$，据此求出$\varphi$的值.
【解答】解：由已知得$f(x_1)=\sin x_1$，$g(x_2)=\sin(x_2-\varphi)$.
因为$|f(x_1)-g(x_2)|=2$，所以$f(x_1)$，$g(x_2)$一个取得最大值，另一个取最小值.
不妨设$x_1=\frac{\pi}{2}+2k\pi$，$k\in Z$，$x_2-\varphi=-\frac{\pi}{2}+2m\pi$，$m\in Z$，
由已知得$|x_1-x_2|=|\pi-\varphi+2(k-m)\pi|\leqslant\frac{\pi}{3}$，$k$，$m\in Z$．结合$\varphi>0$.
当$k=m$，$\varphi=\frac{2\pi}{3}$时成立.
故答案为：$\frac{2\pi}{3}$.
【点评】本题考查三角函数的图象变换规律及性质，同时考查学生的逻辑推理和计算能力．属于中档题.
```

**DeepSeek** — 旧分 0.5/1；旧理由：解答 π/3 误作 π/2。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.95。Trace：`32824381-6f1e-4cb4-9e84-1582916b6e8d`；定位 question.number=9，字段 analysis。

```text
【分析】先根据左加右减得到$g(x)$的解析式，然后根据三角函数的性质可知，两个相邻的最值点的函数值的差为2. 此时它们横坐标差的绝对值为$\frac{T}{2}$，据此求出$\varphi$的值.
【解答】解：由已知得$f(x_1)=\sin x_1$，$g(x_2)=\sin(x_2-\varphi)$.
因为$|f(x_1)-g(x_2)|=2$，所以$f(x_1)$，$g(x_2)$一个取得最大值，另一个取最小值.
不妨设$x_1=\frac{\pi}{2}+2k\pi$，$k\in Z$，$x_2-\varphi=-\frac{\pi}{2}+2m\pi$，$m\in Z$，
由已知得$|x_1-x_2|=|\pi-\varphi+2(k-m)\pi|\leqslant\frac{\pi}{2}$，$k,m\in Z$. 结合$\varphi>0$.
当$k=m$，$\varphi=\frac{2\pi}{3}$时成立.
故答案为：$\frac{2\pi}{3}$.
【点评】本题考查三角函数的图象变换规律及性质，同时考查学生的逻辑推理和计算能力. 属于中档题.
```

**Haiku** — 旧分 0/1；旧理由：半周期误作 π/2，极值点推导省略。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.8。Trace：`eb1c2ec4-a354-461d-8a91-67deb7523412`；定位 question.number=9，字段 analysis。

```text
两函数一个取最大值、一个取最小值，横坐标差的绝对值最小为半周期 $\dfrac\pi2$ 的情形相关，由已知推得 $\varphi$ 的最小值为 $\dfrac{2\pi}{3}$。
故答案为：$\dfrac{2\pi}{3}$。
```

**Luna** — 旧分 0.5/1；旧理由：T 误作 π；不等号改动另记录。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.84。Trace：`8ecca318-ac7d-4c59-9439-d4811ec28c41`；定位 question.number=9，字段 analysis。

```text
【分析】先根据左加右减得到 $g(x)$ 的解析式，然后根据三角函数的性质可知，两个相邻的最值点的函数值的差为2。此时它们横坐标差的绝对值为 $\frac{\pi}{2}$，据此求出 $\varphi$ 的值.
…（中间原文省略）…
由已知得 $|x_1-x_2|=|\pi-\varphi+2(k-m)\pi|\ge\frac{\pi}{3}$，$k,m\in\mathbb{Z}$. 结合 $\varphi>0$.
```

### 解析 · 崇明11

原页：p8、p9。原卷对照要点：p8 分析末式和 p9 解答末式均是 S=(1/2)|sin(2x-π/6)-1/2|。Luna 写成 |(1/2)sin(2x-π/6)-1/2|，常数项受外层 1/2 作用不同。中间步骤原卷也有可疑系数，未把其照录认作模型新增错误。

**Qwen** — 旧分 0.5/1；旧理由：解答漏绝对值。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`1560011e-192d-4ab0-b7ea-af10797bfba6`；定位 question.number=11，字段 analysis。

```text
【分析】将点 $A$ 置于直角坐标系中的原点，则运用平面向量坐标表示得到面积 $S=\frac{1}{2}|\sin(2x-\frac{\pi}{6})-\frac{1}{2}|$，进而可求得范围.
…（中间原文省略）…
$\therefore \triangle ABC$ 的面积 $S=\frac{1}{2}|AB||AC|\sin\angle CAB=\frac{1}{2}\times 1 \times |2\cos x| \times \sin(x-\frac{\pi}{6}) = \sqrt{3}\sin x\cos x - \cos^2 x = \frac{1}{2}[\frac{\sqrt{3}}{2}\sin 2x - \frac{1+\cos 2x}{2}] = \frac{1}{2}\sin(2x-\frac{\pi}{6}) - \frac{1}{2} \leqslant \frac{3}{4}$,
```

**MiMo** — 旧分 0/1；旧理由：分析漏绝对值，解答中间式也损坏。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`c6c92344-3896-4123-ba60-eaf8918f7e2e`；定位 question.number=11，字段 analysis。

```text
【分析】将点$A$置于直角坐标系中的原点，则运用平面向量坐标表示得到面积$S=\frac{1}{2}\sin(2x-\frac{\pi}{6})-\frac{1}{2}$，进而可求得其范围.
…（中间原文省略）…
$\therefore\triangle ABC$的面积$S=\frac{1}{2}|AB||AC|\sin\angle CAB=\frac{1}{2}\times1\times|2\cos x|\times|\sin(x-\frac{\pi}{6})|=\sqrt{3}\sin x\cos x-\cos^2x|=\frac{1}{2}\frac{\sqrt{3}}{2}\sin2x-\frac{1+\cos2x}{2}=\frac{1}{2}|\sin(2x-\frac{\pi}{6})-\frac{1}{2}|\leqslant\frac{3}{4}$，
```

**DeepSeek** — 旧分 0.5/1；旧理由：分析漏绝对值，解答末式保留。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.95。Trace：`32824381-6f1e-4cb4-9e84-1582916b6e8d`；定位 question.number=11，字段 analysis。

```text
【分析】将点$A$置于直角坐标系中的原点，则运用平面向量坐标表示得到面积$S=\frac{1}{2}\sin(2x-\frac{\pi}{6})-\frac{1}{2}$，进而可求得其范围.
…（中间原文省略）…
$\therefore \triangle ABC$的面积$S=\frac{1}{2}|AB||AC|\sin\angle CAB=\frac{1}{2}×1×2|\cos x|×|\sin(x-\frac{\pi}{6})|=|\sqrt{3}\sin x\cos x-\cos^2x|=\frac{1}{2}|\frac{\sqrt{3}}{2}\sin2x-\frac{1+\cos2x}{2}|=\frac{1}{2}|\sin(2x-\frac{\pi}{6})-\frac{1}{2}|\leqslant\frac{3}{4}$，
```

**Luna** — 旧分 0.5/1；旧理由：解答 1/2 移入绝对值改变常数系数。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=true，confidence=0.9。Trace：`8ecca318-ac7d-4c59-9439-d4811ec28c41`；定位 question.number=11，字段 analysis。

```text
【分析】将点 $A$ 置于直角坐标系中的原点，则运用平面向量坐标表示得到面积 $S=\frac{1}{2}|\sin(2x-\frac{\pi}{6})-\frac{1}{2}|$，进而可求得其范围.
…（中间原文省略）…
$\therefore\triangle ABC$ 的面积 $S=\frac{1}{2}|AB||AC|\sin\angle CAB=\frac{1}{2}\times1\times|2\cos x|\times|\sin(x-\frac{\pi}{6})|=\left|\sqrt{3}\sin x\cos x-\cos^2x\right|=\left|\frac{1}{2}\sin(2x-\frac{\pi}{6})-\frac{1}{2}\right|\le\frac{3}{4}$，
```

**Ling** — 旧分 0/1；旧理由：分析解答均漏绝对值。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`2f4911ae-04e4-4f51-88f2-019ef1678e65`；定位 question.number=11，字段 analysis。

```text
【分析】将点 $A$ 置于直角坐标系中的原点，则运用平面向量坐标表示得到面积 $S=\frac{1}{2} \sin \left(2 x-\frac{\pi}{6}\right)-\frac{1}{2}$，进而可求得其范围.
…（中间原文省略）…
$\therefore \triangle A B C$ 的面积 $S=\frac{1}{2}|A B||A C| \sin \angle C A B=\frac{1}{2} \times 1 \times 2|\cos x| \times \sin \left(x-\frac{\pi}{6}\right)=\sqrt{3} \sin x \cos x$ $-\cos ^{2} x=\frac{\sqrt{3}}{2} \sin 2 x-\frac{1+\cos 2 x}{2}=\frac{1}{2} \sin \left(2 x-\frac{\pi}{6}\right)-\frac{1}{2} \leqslant \frac{3}{4}$，
```

### 解析 · 崇明20

原页：p16。原卷对照要点：p16：AF=√[(1+1)²+(√2/2)²]=3√2/2；代入验证分子含 +2-x₁²。后两问原卷有直线方程、P 代入过程、韦达关系和面积不等式化简。

**Qwen** — 旧分 0.5/1；旧理由：AF错，后两问推导保留。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`1560011e-192d-4ab0-b7ea-af10797bfba6`；定位 question.number=20，字段 analysis。

```text
直线 $x=-1$ 与该椭圆交于点 $A, B$，点 $A$ 位于 $x$ 轴上方，可得 $A(-1, \frac{\sqrt{2}}{2})$，则 $|AF|=\sqrt{(1+1)^2+(\frac{\sqrt{2}}{2})^2}=\frac{\sqrt{10}}{2}$;
…（中间原文省略）…
由 $(\frac{3x_1-4}{2x_1-3})^2+2(\frac{y_1}{2x_1-3})^2=\frac{(3x_1-4)^2+2y_1^2}{(2x_1-3)^2}=\frac{9x_1^2-24x_1+16+2-x_1^2}{4x_1^2-12x_1+9}=2$，
```

**DeepSeek** — 旧分 0.5/1；旧理由：AF错，后两问推导保留。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.95。Trace：`32824381-6f1e-4cb4-9e84-1582916b6e8d`；定位 question.number=20，字段 analysis。

```text
直线$x=-1$与该椭圆交于点$A$，$B$，点$A$位于$x$轴上方，可得$A(-1,\frac{\sqrt{2}}{2})$，则$|AF|=\sqrt{(1+1)^2+(\frac{\sqrt{2}}{2})^2}=\frac{3}{2}$；
…（中间原文省略）…
由$(\frac{3x_1-4}{2x_1-3})^2+2(\frac{y_1}{2x_1-3})^2=\frac{(3x_1-4)^2+2y_1^2}{(2x_1-3)^2}=\frac{9x_1^2-24x_1+16+2-x_1^2}{4x_1^2-12x_1+9}=2$，
```

**Haiku** — 旧分 0.5/1；旧理由：AF正确，后两问主要代数推导略去。

本次归类：**明确省略／保真度不足**。实际提示词已多次要求逐字转录且不压缩解析。这里的“略”或省掉整段代数推导属于省略，不一定是数学结论错误。

返回标记：needsHumanReview=true，confidence=0.75。Trace：`eb1c2ec4-a354-461d-8a91-67deb7523412`；定位 question.number=20，字段 analysis。

```text
（1）$F(1,0)$，$A(-1,\dfrac{\sqrt2}{2})$，$|AF|=\sqrt{(1+1)^2+\dfrac12}=\dfrac{3\sqrt2}{2}$。
（2）设 $A(x_1,y_1)$，$B(x_1,-y_1)$，由 $AF$ 与 $BC$ 方程解得 $P\left(\dfrac{3x_1-4}{2x_1-3},\dfrac{y_1}{2x_1-3}\right)$，代入椭圆方程验证为 2，故 $P$ 在椭圆上。
（3）设 $AP$：$x=my+1$，联立得 $(2+m^2)y^2+2my-1=0$，三角形面积化简后由基本不等式得 $S\leqslant\dfrac{\sqrt2}{2}$。
```

**Luna** — 旧分 0.5/1；旧理由：AF未化简且与答案矛盾，后两问保留。

本次归类：**等价表达／末式省略**。距离根式本身正确且等于 3√2/2；原页化简末式被省略。若按数学正确性应接受，若按逐字转录则缺内容；answer 中 √2/2 的错误另列，不能把这里也叫距离算错。

返回标记：needsHumanReview=true，confidence=0.61。Trace：`8ecca318-ac7d-4c59-9439-d4811ec28c41`；定位 question.number=20，字段 analysis。

```text
直线 $x=-1$ 与该椭圆交于点 $A，B$，点 $A$ 位于 $x$ 轴上方，可得 $A（-1，\frac{\sqrt2}{2}）$，则 $|AF|=\sqrt{(1+1)^2+(\frac{\sqrt2}{2})^2}$；
…（中间原文省略）…
由 $\left(\frac{3x_1-4}{2x_1-3}\right)^2+2\left(\frac{y_1}{2x_1-3}\right)^2=\frac{(3x_1-4)^2+2y_1^2}{(2x_1-3)^2}=\frac{9x_1^2-24x_1+16+2-x_1^2}{4x_1^2-12x_1+9}=2$，
```

**Ling** — 旧分 0/1；旧理由：AF错，P 验证的 -x1² 变 -2x1²。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`2f4911ae-04e4-4f51-88f2-019ef1678e65`；定位 question.number=20，字段 analysis。

```text
直线 $x=-1$ 与该椭圆交于点 $A, B$，点 $A$ 位于 $x$ 轴上方，可得 $A\left(-1,\frac{\sqrt{2}}{2}\right)$，则 $|A F|=\sqrt{(1+1)^{2}+\left(\frac{\sqrt{2}}{2}\right)^{2}}=\frac{\sqrt{2}}{2}$；
…（中间原文省略）…
由 $\left(\frac{3 x_{1}-4}{2 x_{1}-3}\right)^{2}+2\left(\frac{y_{1}}{2 x_{1}-3}\right)^{2}=\frac{\left(3 x_{1}-4\right)^{2}+2 y_{1}^{2}}{(2 x_{1}-3)^{2}}=\frac{9 x_{1}^{2}-24 x_{1}+16+2-2 x_{1}^{2}}{4 x_{1}^{2}-12 x_{1}+9}=2$，
```

### 解析 · 奉贤11

原页：p11。原卷对照要点：p11 展开括号是 a²+1+x²/(100-x²)+a²(100-x²)/x²；x²/(100-x²) 后没有额外乘 a²。所求 x 为正根；填空下划线不能视作负号。

**Qwen** — 旧分 0.5/1；旧理由：前文写负根，后文正根。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=1。Trace：`d044a415-92c7-4319-8fbf-785010516721`；定位 question.number=11，字段 analysis。

```text
得当 $x=-\sqrt{\frac{100a}{a+1}}$ 时，$y=\frac{a^2}{x^2} + \frac{1}{100-x^2}$ ($0<x<10, a>0$) 有最小值
…（中间原文省略）…
【分析】由题中所给解题思路，配凑均值不等式的形式，当且仅当两数相等时，取最值.
…（中间原文省略）…
【解答】解：$y=\frac{a^2}{x^2} + \frac{1}{100-x^2} = (\frac{a^2}{x^2} + \frac{1}{100-x^2}) [x^2 + (100-x^2)] \times \frac{1}{100} = \frac{1}{100}[a^2+1+\frac{x^2}{100-x^2} + \frac{a^2(100-x^2)}{x^2}] \ge \frac{1}{100}[a^2+1+2\sqrt{a^2}]$
…（中间原文省略）…
∴ 当且仅当 $\frac{x^2}{100-x^2} = \frac{a^2(100-x^2)}{x^2}$，即 $x=\sqrt{\frac{100a}{a+1}}$ 时，$y=\frac{a^2}{x^2} + \frac{1}{100-x^2}$ ($0<x<10, a>0$) 有最小值.
```

**DeepSeek** — 旧分 0.5/1；旧理由：展开项多乘 a²。

本次归类：**内容与原文不符**。改变了可见数字、符号、条件或推导；逐字转录要求已明确。属于本轮输出缺陷，但单次样本不能证明换提示词或输入图质量后仍无法改进。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`fb821d19-e239-4f50-9ec8-350dcc3dc7bd`；定位 question.number=11，字段 analysis。

```text
【分析】由题中所给解题思路，配凑均值不等式的形式，当且仅当两数相等时，取最值。
【解答】解：$y=\frac{a^2}{x^2}+\frac{1}{100-x^2}=(\frac{a^2}{x^2}+\frac{1}{100-x^2})[x^2+(100-x^2)]\times\frac{1}{100}=\frac{1}{100}[a^2+1+\frac{x^2}{100-x^2}\cdot a^2+\frac{a^2(100-x^2)}{x^2}]\geqslant \frac{1}{100}[a^2+1+2\sqrt{a^2}]$
$\therefore$当且仅当$\frac{x^2}{100-x^2}=\frac{a^2(100-x^2)}{x^2}$，即$x=\sqrt{\frac{100a}{a+1}}$时，$y=\frac{a^2}{x^2}+\frac{1}{100-x^2}$（$0<x<10$，$a>0$）有最小值。
故答案为：$\sqrt{\frac{100a}{a+1}}$。
【点评】本题考查了“乘1法”与均值不等式的应用，属于基础题。
```

**Haiku** — 旧分 0.5/1；旧理由：略去展开式，仅保留等号条件。

本次归类：**明确省略／保真度不足**。实际提示词已多次要求逐字转录且不压缩解析。这里的“略”或省掉整段代数推导属于省略，不一定是数学结论错误。

返回标记：needsHumanReview=true，confidence=0.75。Trace：`e7a2d91b-f25f-457a-b364-c47d544608bb`；定位 question.number=11，字段 analysis。

```text
由 $y=\dfrac{1}{100}\left(\dfrac{a^2}{x^2}+\dfrac{1}{100-x^2}\right)[x^2+(100-x^2)]$，由均值不等式等号成立当且仅当 $\dfrac{x^2}{100-x^2}=\dfrac{a^2(100-x^2)}{x^2}$，得 $x=\sqrt{\dfrac{100a}{a+1}}$。
```

### 配图 · 宝山11

原页：p8、p9。原卷对照要点：需要的语义图片组：answer:p9-1

**Qwen** — 旧分 0/1；旧理由：多选 p8-1, p8-2, p8-3。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`5819d1ce-d70d-4dc7-b15d-c42bfcc16bb9`；定位 question.number=11，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p8-1",
      "role": "answer",
      "kind": "table",
      "label": "约束条件不等式组"
    },
    {
      "id": "p8-2",
      "role": "answer",
      "kind": "table",
      "label": "约束条件不等式组"
    },
    {
      "id": "p8-3",
      "role": "answer",
      "kind": "table",
      "label": "约束条件不等式组"
    },
    {
      "id": "p9-1",
      "role": "answer",
      "kind": "graph",
      "label": "平面区域图"
    }
  ],
  "expectedImageCount": 4,
  "missingImages": []
}
```

**Haiku** — 旧分 0/1；旧理由：多选 p8-1, p8-2, p8-3。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=0.85。Trace：`41fae78a-e182-4b0b-a241-67e8f53f60fb`；定位 question.number=11，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p8-1",
      "role": "question",
      "kind": "figure",
      "label": "约束条件方程组"
    },
    {
      "id": "p8-2",
      "role": "answer",
      "kind": "figure",
      "label": "平面区域图"
    },
    {
      "id": "p8-3",
      "role": "answer",
      "kind": "figure",
      "label": "平面区域解答图"
    },
    {
      "id": "p9-1",
      "role": "answer",
      "kind": "graph",
      "label": "平面区域坐标图"
    }
  ],
  "expectedImageCount": 4,
  "missingImages": []
}
```

**Ling** — 旧分 0/1；旧理由：多选 p8-2, p8-3。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`79e4dfff-ddf6-4606-a500-c1829bd52637`；定位 question.number=11，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p8-2",
      "role": "answer",
      "kind": "graph",
      "label": "平面区域示意图（分析）"
    },
    {
      "id": "p8-3",
      "role": "answer",
      "kind": "graph",
      "label": "平面区域示意图（解答）"
    },
    {
      "id": "p9-1",
      "role": "answer",
      "kind": "graph",
      "label": "线性规划区域与向量数量积图"
    }
  ],
  "expectedImageCount": 3,
  "missingImages": []
}
```

### 配图 · 宝山12

原页：p9。原卷对照要点：旧图片判据：本题无需要保存的独立插图；候选为公式/矩阵。矩阵边界的歧义见下文。

**Ling** — 旧分 0/1；旧理由：多选 p9-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`79e4dfff-ddf6-4606-a500-c1829bd52637`；定位 question.number=12，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p9-1",
      "role": "answer",
      "kind": "graph",
      "label": "向量坐标与区域示意图"
    }
  ],
  "expectedImageCount": 1,
  "missingImages": []
}
```

### 配图 · 宝山17

原页：p2、p12、p13。原卷对照要点：需要的语义图片组：question:p2-1 或 p12-1；answer:p13-1

**MiMo** — 旧分 0/1；旧理由：缺少组 question:p2-1/p12-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`2ad5ea11-aade-4cd7-a058-da6a77378216`；定位 question.number=17，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p13-1",
      "role": "answer",
      "kind": "figure",
      "label": "空间直角坐标系中的三棱柱图"
    }
  ],
  "expectedImageCount": 1,
  "missingImages": []
}
```

**Luna** — 旧分 0/1；旧理由：缺少组 answer:p13-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=true，confidence=0.62。Trace：`71163256-17b5-4b11-99a9-bfaf6c163b36`；定位 question.number=17，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p2-1",
      "role": "question",
      "kind": "figure",
      "label": "直三棱柱几何示意图"
    },
    {
      "id": "p12-1",
      "role": "question",
      "kind": "figure",
      "label": "直三棱柱几何示意图"
    }
  ],
  "expectedImageCount": 2,
  "missingImages": []
}
```

### 配图 · 宝山20

原页：p4、p15、p16。原卷对照要点：需要的语义图片组：question:p4-1 或 p15-1

**MiMo** — 旧分 0/1；旧理由：缺少组 question:p4-1/p15-1。

本次归类：**去重规则误用／已报告缺图**。模型在 missingImages 明说因题干图与答案页副本重复而全部不选。结果缺图，但不是无声漏图；应规定去重至少保留一份。自评0.6又高于缺图0.5上限，这是另一项规则违例，旧分数未单独计入。

返回标记：needsHumanReview=true，confidence=0.6。Trace：`2ad5ea11-aade-4cd7-a058-da6a77378216`；定位 question.number=20，字段 assets / missingImages。

```text
{
  "assets": [],
  "expectedImageCount": 1,
  "missingImages": [
    {
      "page": 4,
      "role": "question",
      "description": "第4页题干中椭圆$Γ$的坐标图（原卷题图）",
      "reason": "候选框p4-1与题干椭圆图对应，但与答案页p15-1为同一图的重复候选，为避免同一题图重复生成多张图片，未选入assets，需教师核实"
    }
  ]
}
```

**Haiku** — 旧分 0/1；旧理由：多选 p15-2, p15-4, p15-5, p16-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=0.85。Trace：`41fae78a-e182-4b0b-a241-67e8f53f60fb`；定位 question.number=20，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p4-1",
      "role": "question",
      "kind": "graph",
      "label": "椭圆示意图"
    },
    {
      "id": "p15-1",
      "role": "answer",
      "kind": "graph",
      "label": "椭圆解答图"
    },
    {
      "id": "p15-2",
      "role": "answer",
      "kind": "figure",
      "label": "弦长计算式"
    },
    {
      "id": "p15-4",
      "role": "answer",
      "kind": "figure",
      "label": "面积计算式"
    },
    {
      "id": "p15-5",
      "role": "answer",
      "kind": "figure",
      "label": "基本不等式式"
    },
    {
      "id": "p16-1",
      "role": "answer",
      "kind": "figure",
      "label": "距离条件式"
    }
  ],
  "expectedImageCount": 6,
  "missingImages": []
}
```

**Ling** — 旧分 0/1；旧理由：多选 p15-2, p15-4, p15-5, p16-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`79e4dfff-ddf6-4606-a500-c1829bd52637`；定位 question.number=20，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p4-1",
      "role": "question",
      "kind": "graph",
      "label": "椭圆与直线位置关系示意图"
    },
    {
      "id": "p15-1",
      "role": "answer",
      "kind": "graph",
      "label": "椭圆标准位置示意图"
    },
    {
      "id": "p15-2",
      "role": "answer",
      "kind": "figure",
      "label": "弦长与距离计算式"
    },
    {
      "id": "p15-4",
      "role": "answer",
      "kind": "figure",
      "label": "面积最值推导式"
    },
    {
      "id": "p15-5",
      "role": "answer",
      "kind": "figure",
      "label": "基本不等式取等条件"
    },
    {
      "id": "p16-1",
      "role": "answer",
      "kind": "figure",
      "label": "向量垂直证明式"
    }
  ],
  "expectedImageCount": 6,
  "missingImages": []
}
```

### 配图 · 崇明13

原页：p10。原卷对照要点：旧图片判据：本题无需要保存的独立插图；候选为公式/矩阵。矩阵边界的歧义见下文。

**Qwen** — 旧分 0/1；旧理由：多选 p10-1, p10-2, p10-3。

本次归类：**提示词冲突／图片扣分待定**。候选包含数学矩阵与方程组。旧规则既禁止公式截图，又用“任何依靠行列/空间位置…没有例外”定义表格并列出 matrix；矩阵截图究竟算不算错应先统一规则。纯方程组另有明确禁止，不应笼统把三个候选归为同一种错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`1560011e-192d-4ab0-b7ea-af10797bfba6`；定位 question.number=13，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p10-1",
      "role": "question",
      "kind": "figure",
      "label": "矩阵与方程组对应关系示意图"
    },
    {
      "id": "p10-2",
      "role": "answer",
      "kind": "figure",
      "label": "线性方程组"
    },
    {
      "id": "p10-3",
      "role": "answer",
      "kind": "figure",
      "label": "系数矩阵"
    }
  ],
  "expectedImageCount": 3,
  "missingImages": []
}
```

**Ling** — 旧分 0/1；旧理由：多选 p10-1, p10-2, p10-3。

本次归类：**提示词冲突／图片扣分待定**。候选包含数学矩阵与方程组。旧规则既禁止公式截图，又用“任何依靠行列/空间位置…没有例外”定义表格并列出 matrix；矩阵截图究竟算不算错应先统一规则。纯方程组另有明确禁止，不应笼统把三个候选归为同一种错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`2f4911ae-04e4-4f51-88f2-019ef1678e65`；定位 question.number=13，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p10-1",
      "role": "question",
      "kind": "figure",
      "label": "矩阵与方程组系数矩阵"
    },
    {
      "id": "p10-2",
      "role": "question",
      "kind": "figure",
      "label": "线性方程组"
    },
    {
      "id": "p10-3",
      "role": "answer",
      "kind": "figure",
      "label": "系数矩阵求解"
    }
  ],
  "expectedImageCount": 3,
  "missingImages": []
}
```

### 配图 · 崇明20

原页：p16。原卷对照要点：旧图片判据：本题无需要保存的独立插图；候选为公式/矩阵。矩阵边界的歧义见下文。

**Qwen** — 旧分 0/1；旧理由：多选 p16-1, p16-2。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`1560011e-192d-4ab0-b7ea-af10797bfba6`；定位 question.number=20，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p16-1",
      "role": "answer",
      "kind": "figure",
      "label": "椭圆与直线相交示意图"
    },
    {
      "id": "p16-2",
      "role": "answer",
      "kind": "figure",
      "label": "面积公式推导过程截图"
    }
  ],
  "expectedImageCount": 2,
  "missingImages": []
}
```

**Haiku** — 旧分 0/1；旧理由：多选 p16-1, p16-2。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=true，confidence=0.75。Trace：`eb1c2ec4-a354-461d-8a91-67deb7523412`；定位 question.number=20，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p16-1",
      "role": "answer",
      "kind": "figure",
      "label": "椭圆与直线示意计算"
    },
    {
      "id": "p16-2",
      "role": "answer",
      "kind": "figure",
      "label": "面积计算式"
    }
  ],
  "expectedImageCount": 2,
  "missingImages": []
}
```

**Luna** — 旧分 0/1；旧理由：多选 p16-1, p16-2。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=true，confidence=0.61。Trace：`8ecca318-ac7d-4c59-9439-d4811ec28c41`；定位 question.number=20，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p16-1",
      "role": "answer",
      "kind": "figure",
      "label": "答案中的距离公式表达式图像片段"
    },
    {
      "id": "p16-2",
      "role": "answer",
      "kind": "figure",
      "label": "答案中的三角形面积公式表达式图像片段"
    }
  ],
  "expectedImageCount": 2,
  "missingImages": []
}
```

**Ling** — 旧分 0/1；旧理由：多选 p16-1, p16-2。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`2f4911ae-04e4-4f51-88f2-019ef1678e65`；定位 question.number=20，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p16-1",
      "role": "answer",
      "kind": "figure",
      "label": "椭圆与线段AF计算"
    },
    {
      "id": "p16-2",
      "role": "answer",
      "kind": "figure",
      "label": "椭圆面积不等式证明"
    }
  ],
  "expectedImageCount": 2,
  "missingImages": []
}
```

### 配图 · 奉贤2

原页：p1、p6。原卷对照要点：旧图片判据：本题无需要保存的独立插图；候选为公式/矩阵。矩阵边界的歧义见下文。

**Qwen** — 旧分 0/1；旧理由：多选 p1-1, p6-1, p6-2。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`d044a415-92c7-4319-8fbf-785010516721`；定位 question.number=2，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p1-1",
      "role": "question",
      "kind": "figure",
      "label": "题目中的参数方程框图"
    },
    {
      "id": "p6-1",
      "role": "answer",
      "kind": "figure",
      "label": "解析中重写的参数方程框图"
    },
    {
      "id": "p6-2",
      "role": "answer",
      "kind": "figure",
      "label": "解析中用于推导的方程组框图"
    }
  ],
  "expectedImageCount": 3,
  "missingImages": []
}
```

**Haiku** — 旧分 0/1；旧理由：多选 p1-1, p6-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=true，confidence=0.6。Trace：`e7a2d91b-f25f-457a-b364-c47d544608bb`；定位 question.number=2，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p1-1",
      "role": "question",
      "kind": "figure",
      "label": "参数方程题干区域"
    },
    {
      "id": "p6-1",
      "role": "answer",
      "kind": "figure",
      "label": "参数方程解析配图"
    }
  ],
  "expectedImageCount": 2,
  "missingImages": []
}
```

**Ling** — 旧分 0/1；旧理由：多选 p6-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`d7d476fb-e328-413c-bf66-0452305774c5`；定位 question.number=2，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p6-1",
      "role": "question",
      "kind": "figure",
      "label": "圆的参数方程组"
    }
  ],
  "expectedImageCount": 1,
  "missingImages": []
}
```

### 配图 · 奉贤5

原页：p1、p7、p8。原卷对照要点：需要的语义图片组：answer:p8-1

**Qwen** — 旧分 0/1；旧理由：多选 p1-2, p7-1, p7-2。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`d044a415-92c7-4319-8fbf-785010516721`；定位 question.number=5，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p1-2",
      "role": "question",
      "kind": "figure",
      "label": "题目中的不等式组框图"
    },
    {
      "id": "p7-1",
      "role": "answer",
      "kind": "figure",
      "label": "解析中重写的约束条件框图"
    },
    {
      "id": "p7-2",
      "role": "answer",
      "kind": "figure",
      "label": "解析中用于构建目标函数的方程组框图"
    },
    {
      "id": "p8-1",
      "role": "answer",
      "kind": "graph",
      "label": "第5题解析中的可行域示意图"
    }
  ],
  "expectedImageCount": 4,
  "missingImages": []
}
```

**Haiku** — 旧分 0/1；旧理由：多选 p1-2, p7-1, p7-2。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=true，confidence=0.6。Trace：`e7a2d91b-f25f-457a-b364-c47d544608bb`；定位 question.number=5，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p1-2",
      "role": "question",
      "kind": "figure",
      "label": "线性规划约束区域"
    },
    {
      "id": "p7-1",
      "role": "answer",
      "kind": "figure",
      "label": "线性规划约束区域解析图"
    },
    {
      "id": "p7-2",
      "role": "answer",
      "kind": "figure",
      "label": "线性规划解析约束条件"
    },
    {
      "id": "p8-1",
      "role": "answer",
      "kind": "figure",
      "label": "可行域图"
    }
  ],
  "expectedImageCount": 4,
  "missingImages": []
}
```

**Ling** — 旧分 0/1；旧理由：多选 p7-1, p7-2。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`d7d476fb-e328-413c-bf66-0452305774c5`；定位 question.number=5，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p7-1",
      "role": "question",
      "kind": "figure",
      "label": "平面区域约束条件"
    },
    {
      "id": "p7-2",
      "role": "answer",
      "kind": "figure",
      "label": "可行域及最优解示意图"
    },
    {
      "id": "p8-1",
      "role": "answer",
      "kind": "figure",
      "label": "可行域阴影区域及顶点"
    }
  ],
  "expectedImageCount": 3,
  "missingImages": []
}
```

### 配图 · 奉贤9

原页：p1、p9、p10。原卷对照要点：需要的语义图片组：question:p1-3 或 p9-1；answer:p10-1

**MiMo** — 旧分 0/1；旧理由：缺少组 question:p1-3/p9-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`edb198c5-24e3-442b-8118-b33e5e71e474`；定位 question.number=9，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p10-1",
      "role": "answer",
      "kind": "figure",
      "label": "空间直角坐标系中的正方体图"
    }
  ],
  "expectedImageCount": 1,
  "missingImages": []
}
```

**Luna** — 旧分 0/1；旧理由：缺少组 question:p1-3/p9-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=true，confidence=0.61。Trace：`b814e9ec-cc03-4d64-a971-f25fc0a4b591`；定位 question.number=9，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p10-1",
      "role": "answer",
      "kind": "figure",
      "label": "空间直角坐标系中的正方体示意图"
    }
  ],
  "expectedImageCount": 2,
  "missingImages": []
}
```

### 配图 · 奉贤11

原页：p11。原卷对照要点：旧图片判据：本题无需要保存的独立插图；候选为公式/矩阵。矩阵边界的歧义见下文。

**Qwen** — 旧分 0/1；旧理由：多选 p11-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`d044a415-92c7-4319-8fbf-785010516721`；定位 question.number=11，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p11-1",
      "role": "answer",
      "kind": "figure",
      "label": "解析中最终答案的根式框图"
    }
  ],
  "expectedImageCount": 1,
  "missingImages": []
}
```

**Haiku** — 旧分 0/1；旧理由：多选 p11-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=true，confidence=0.75。Trace：`e7a2d91b-f25f-457a-b364-c47d544608bb`；定位 question.number=11，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p11-1",
      "role": "answer",
      "kind": "figure",
      "label": "均值不等式解析图"
    }
  ],
  "expectedImageCount": 1,
  "missingImages": []
}
```

**Ling** — 旧分 0/1；旧理由：多选 p11-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=true，confidence=0.9。Trace：`d7d476fb-e328-413c-bf66-0452305774c5`；定位 question.number=11，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p11-1",
      "role": "answer",
      "kind": "figure",
      "label": "最小值取值点"
    }
  ],
  "expectedImageCount": 1,
  "missingImages": []
}
```

### 配图 · 奉贤16

原页：p3、p14、p15。原卷对照要点：需要的语义图片组：question:p3-3 或 p14-1；answer:p15-1

**MiMo** — 旧分 0/1；旧理由：缺少组 question:p3-3/p14-1。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=0.9。Trace：`edb198c5-24e3-442b-8118-b33e5e71e474`；定位 question.number=16，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p15-1",
      "role": "answer",
      "kind": "figure",
      "label": "空间直角坐标系中的正四棱柱图"
    }
  ],
  "expectedImageCount": 1,
  "missingImages": []
}
```

**Haiku** — 旧分 未返回/1；旧理由：记录未完整返回。

本次归类：**未交付／后端中断影响**。本题记录未完整返回；不能称为本题内容已识别错误。Haiku 的后续输出受旧后端在第14题抛错影响。

返回标记：needsHumanReview=null，confidence=null。Trace：`e7a2d91b-f25f-457a-b364-c47d544608bb`；定位 question.number=16，字段 assets / missingImages。

```text
（本题未完整返回）
```

### 配图 · 奉贤18

原页：p17。原卷对照要点：旧图片判据：本题无需要保存的独立插图；候选为公式/矩阵。矩阵边界的歧义见下文。

**Qwen** — 旧分 0/1；旧理由：多选 p17-1, p17-2, p17-3, p17-4, p17-5。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`d044a415-92c7-4319-8fbf-785010516721`；定位 question.number=18，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p17-1",
      "role": "answer",
      "kind": "figure",
      "label": "解析中关于 $v$ 的表达式框图"
    },
    {
      "id": "p17-2",
      "role": "answer",
      "kind": "figure",
      "label": "解析中关于 $\\sqrt{\\frac{1000}{b}} \\le 100$ 的条件框图"
    },
    {
      "id": "p17-3",
      "role": "answer",
      "kind": "figure",
      "label": "解析中关于 $\\sqrt{\\frac{1000}{b}} > 100$ 的条件框图"
    },
    {
      "id": "p17-4",
      "role": "answer",
      "kind": "figure",
      "label": "解析中关于 $v$ 取值的结论框图"
    },
    {
      "id": "p17-5",
      "role": "answer",
      "kind": "figure",
      "label": "解析中关于 $b$ 的范围及对应速度的结论框图"
    }
  ],
  "expectedImageCount": 5,
  "missingImages": []
}
```

**Haiku** — 旧分 未返回/1；旧理由：记录未完整返回。

本次归类：**未交付／后端中断影响**。本题记录未完整返回；不能称为本题内容已识别错误。Haiku 的后续输出受旧后端在第14题抛错影响。

返回标记：needsHumanReview=null，confidence=null。Trace：`e7a2d91b-f25f-457a-b364-c47d544608bb`；定位 question.number=18，字段 assets / missingImages。

```text
（本题未完整返回）
```

**Ling** — 旧分 0/1；旧理由：多选 p17-1, p17-2, p17-3, p17-4, p17-5。

本次归类：**图片语义错漏**。按原卷比较所需图与返回候选的归属、用途。候选框存在不代表应选；数学式不是新增插图；题干图不能用带答案辅助线的图替代。若模型已反馈缺图，按未完成提取处理，不称为隐瞒错误。

返回标记：needsHumanReview=false，confidence=1。Trace：`d7d476fb-e328-413c-bf66-0452305774c5`；定位 question.number=18，字段 assets / missingImages。

```text
{
  "assets": [
    {
      "id": "p17-1",
      "role": "answer",
      "kind": "figure",
      "label": "最小值取值点"
    },
    {
      "id": "p17-2",
      "role": "answer",
      "kind": "figure",
      "label": "临界值比较"
    },
    {
      "id": "p17-3",
      "role": "answer",
      "kind": "figure",
      "label": "临界值比较续"
    },
    {
      "id": "p17-4",
      "role": "answer",
      "kind": "figure",
      "label": "最小值取值点续"
    },
    {
      "id": "p17-5",
      "role": "answer",
      "kind": "figure",
      "label": "分类讨论区间"
    }
  ],
  "expectedImageCount": 5,
  "missingImages": []
}
```

## 结构、转义与交付问题（技术分）

| 项目 | 具体返回与影响 | 归因及评分建议 |
| --- | --- | --- |
| Ling 崇明21题、奉贤20题 | 每行 question 外层少一个 }；补一个 } 后41条字段可读 | 完整 JSON 要求已明确；格式缺陷真实，旧后端把可读字段全部拒收是另一个问题 |
| Luna 崇明/奉贤 | done 后重复 meta / 重复 done；分别21/20题已存储但卷状态失败 | 协议违例真实；不等于题干或配图全错。后端容错已另行修复 |
| Haiku 奉贤14 | expectedImageCount=9，assets.length=10，needsHumanReview=true，confidence=0.6 | 计数内部不一致。10张图片覆盖5个独立图，不能把它们判成误选；后端中断造成后续缺失，不得据此判后续题目识别能力 |
| Qwen 宝山19题 | 题号1,3,4,5,6,7,8,9,10,11,12,13,14,16,17,18,19,20,21，含 U+0008 / U+000C | 例如原始 JSON 的单反斜线 begin/frac 被解码为退格/换页字符；JSON可能合法但公式损坏。需要提示词示例和解析校验双重改进 |
| Luna 宝山3题 | 题号1,12,16，同类 U+0008 / U+000C | 同上；不能把正常换行/制表符全部当作损坏 |

转义例子（以下代码保留 JSON 层写法）：

```json
{"stem":"$\frac{1}{2}$"}
```
上例 JSON 中的 `\f` 会被解释为 U+000C，得到换页字符 + rac；需要的 JSON 应为：

```json
{"stem":"$\\frac{1}{2}$"}
```

### 没有独立评分但需要说明的遗漏与原文问题

- Luna 宝山19、20、21同样 answer/analysis 为空；旧共同答案/解析检查只抽取其中几题，并非所有空字段分别扣分。
- Qwen 崇明9漏 p8 顶部“点评”段：这是逐字转录遗漏，但旧该题解析检查只核对两个公式点，没有据此扣分。
- 宝山21 p17 原印 `3.23>32`，且前一行“3.9>3，故不等式①成立”本身也可疑。应保存原文并另标疑似原卷错误，不能把照录者算错、纠错者自动算对。
- 奉贤20 p19 原卷组合数上标1000与模型改成1010的差异，旧报告已列为源文疑点，没有纳入这48项计分。
- MiMo 宝山20返回缺图且confidence=0.6高于提示词缺图上限0.5；Haiku/Luna部分needsHumanReview=true记录也高于0.65。旧评分并没有全面评估告警/置信度合规，不能以未扣分推断它们合规。

## 复核用法与证据位置

- 本地核验页：`tmp/benchmark-evidence-20261013/index.html`。含原卷页面与6模型完整相关题目字段，可逐检查/模型切换；仅保存在本机，没有把整卷页面上传 GitHub。
- 本报告及结构化摘录 JSON 可提交 GitHub；原始证据仍在 `tmp/openrouter-benchmark-20261012/model-traces/2026-10-12/<traceId>/output.txt` 与 `events.ndjson`。Ling两卷读取时只离线补外层 }，没有改动原文件；Haiku未返回项无原文可造。
- `2026-10-13-error-details.json` 包含旧评分、归类、精确字段摘录、trace与审核标记。所有源文件 SHA 与完整 prompt 指纹单独保留，便于确认复核的是同一批输入。
- 本次没有根据新口径擅自重排总分。建议先确认：是否要求逐字保真、矩阵是否属于公式、如何去重、留空怎样计分、answer是否允许复制analysis中的结论，再冻结新版基准。
