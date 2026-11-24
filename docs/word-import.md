# Word 试卷导入

教师可以直接上传 `.docx` 或旧版 `.doc` 试卷。公式能从 Word 文件中按结构读取的，就不再依赖识图重新辨认。

## 三类 Word 试卷

处理服务读取文件时会判断试卷属于哪一类：

| 类型 | 典型来源 | 页面怎么来 | 公式怎么读 |
|---|---|---|---|
| **公式对象卷** | 学科网“精品解析”、教师自己用 MathType 或 Word 公式编辑器做的卷子 | 系统用 KaTeX 重新排版 | 从 MathType / Word 公式中按结构精确读取，并锁定后交给模型 |
| **公式图片卷** | 旧版 `.doc`、部分转换卷，公式是嵌在文字里的小图片 | 系统重新排版，图片原位嵌入 | 模型按页面图片识别，摘要提示需重点核对 |
| **固定版式卷** | 由 PDF 转成的 Word（如各区“第二套”），图片按页面坐标摆放，或者整页就是一张图 | 用 LibreOffice 按原版式打印 | 纯按页面识别，和 PDF 卷一样 |

判断规则：
- **固定版式**：按页面坐标摆放的图片不少于 8 张，且至少占全部图片的一半；或者有一张图片接近整页大小（450×600 pt 以上）。
- **公式图片**：图片随文字排列（不浮动），并且高度不超过 36 pt，或者高度不超过 90 pt 且宽度至少是高度的 1.8 倍（分段函数、方程组这类宽而高的公式）。

## 流程

1. **上传**：`POST /api/documents` 接受 `.docx` 和 `.doc`，会检查文件头。Word 试卷一律由服务器处理，因此必须启用文档处理服务。
2. **读取**：worker 把文件交给处理服务的 `POST /v1/docx/parse`（`processor/word/`）。`.doc` 先由 LibreOffice 转成 `.docx`。读取结果包括：
   - 段落与表格文字，公式和图片在文字中用 `⟦F12⟧`、`⟦I3⟧` 占位；
   - 公式表；
   - 图片，按“配图 / 公式图片 / 预览图”分类，附带 Word 版面中的显示尺寸；
   - 转换报告，含版式类型。
3. **排版**：
   - 普通版式：服务器用 KaTeX 和 Chromium 排成 A4 PDF；
   - 固定版式：调用处理服务的 `POST /v1/docx/render`，由 LibreOffice 按原版式打印。

   两种情况的结果都保存为 `documents/<id>/word/rendered.pdf`，之后沿用 PDF 的分页、识别和审核流程。
4. **识别**：模型照常读取页面图片。普通版式的试卷还会附上一份“Word 原文”，其中：
   - 可靠的公式以 `⟦F编号⟧` 锁定，并附公式表；
   - 公式图片标为 `⟦式⟧`，要求模型按页面抄录；
   - 配图标为 `⟦图⟧`。

   模型写出占位时，系统换回精确的 LaTeX。固定版式的试卷不发原文。
5. **审核**：审核页顶部显示 Word 导入摘要，说明属于哪一类、公式数量、待核对数量，以及是否由 `.doc` 转换而来。

## 公式转换

- **MathType**（OLE `Equation Native`，MTEF v5）：`processor/word/mtef.py` 按公开的 MTEF v5 格式说明解析，`mtef_latex.py` 转成 LaTeX。不认识的内容一律报告为问题，不靠猜。实测中处理了以下几种写法：
  - MathType 6/7 的扩展记录（标签 ≥100，长度占 1 个字节）：其中的“TeX Input Language”是作者输入的 TeX，结构转换失败时用它兜底；
  - 不带 RULER 标签的制表位；
  - 修饰列表里夹着颜色记录；
  - 公式结束后残留的旧数据（MathType 会复用缓冲区）；
  - 用 MT Extra 私用区字形画的括号和竖线；
  - 单独占一个槽位的求和号。
- **Word 公式**（OMML）：`processor/word/omml.py`。
- **转换失败的公式**：保留 MathType 自带的预览图放回原位，并标记待核对。
- **KaTeX 排不出的公式**：同样降为待核对。
- **写法约定**：与题库一致，例如 `\leqslant`、`\overrightarrow`、`\mathbf{R}`；填空横线统一为 `\underline{\hspace{2em}}`。

## 本地运行

1. 安装 Node.js 22、Python 3.11+ 和 Chrome、Edge 或 Chromium。
2. 在项目目录运行 `npm ci`，然后运行 `npm run local:python`。首次启动会在 `.runtime/python` 安装文档处理依赖。
3. 在工作台选择「导入试卷」→「PDF / Word 试卷」，上传最大 60 MB 的文件。
4. 处理旧版 `.doc` 或固定版式试卷时，安装 LibreOffice。系统会查找 PATH 和 Windows 默认安装目录，也可通过 `JIANTI_SOFFICE_PATH` 指定可执行文件。

## 验证

- `processor/tests/test_word.py`（pytest）：MTEF 各种写法、OMML、docx 读取、公式图片和版式判断、接口鉴权；本机装有 LibreOffice 时还会测试 `.doc` 转换和原版式打印。
- `tests/word-import.test.mjs`：占位还原、模型附件（含 `⟦式⟧` 和固定版式）、排版 HTML、摘要。
- `npm run word:import:verify`：真实的处理服务、API 和 worker，从上传一直跑到分页完成，不调用模型。设置 `WORD_VERIFY_FILE=<路径>` 可以改用真实试卷。

## 限制

- 公式图片卷和固定版式卷的公式靠识图，不是精确读取。
- 文本框、图表、SmartArt 只给出提示，不提取内容。
- 旧版 Equation Editor 3 公式按待核对处理。
- 普通版式中，浮动图片放在其锚定段落之后，不还原左右环绕。
- 题目配图仍按页面坐标从页面上裁出，还没有直接使用 Word 中的原图。

## 参考

整体设计参考了 [JudgePeach/math-question-bank](https://github.com/JudgePeach/math-question-bank)：直接读取 docx、MathType 分档转换、导入报告、拆题前锁定公式。该项目采用 AGPL-3.0 许可，因此本项目只借鉴设计思路，代码全部自行编写。
