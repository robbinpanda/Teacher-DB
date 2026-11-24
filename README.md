<div align="center">

# 拣题 · Teacher-DB

### 本地优先的 AI 教师题库与智能组卷工作台

**把散落在 PDF、Word 试卷和照片里的题目，变成可检索、可复用、可导出原生公式 Word 试卷的个人题库。**

[![Release](https://img.shields.io/badge/version-v0.2-2d6a4f?style=flat-square)](docs/features.md)
[![Node](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=node.js&logoColor=white)](#环境要求)
[![Local-First](https://img.shields.io/badge/Local--First-SQLite-1d4e3b?style=flat-square)](#数据与安全)
[![Online](https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%E4%BD%93%E9%AA%8C-teacherdb.cn-0f766e?style=flat-square)](https://teacherdb.cn)

<!-- Pin public image URLs to a commit. GitHub renders these through Camo, avoiding direct raw.githubusercontent.com requests. Keep the repository links for the originals. -->

[![拣题：教师题库助手](https://cdn.jsdelivr.net/gh/robbinpanda/Teacher-DB@3ab7a8f59b875744959f69fca3068dd9e17daf12/public/og-cover.png)](public/og-cover.png)

[快速开始](#快速开始) · [v0.2 重磅更新](#v02-重磅更新) · [实卷演示](#真实使用场景) · [在线体验 teacherdb.cn](#在线体验最新功能与交流群) · [完整功能清单](docs/features.md)

</div>

> **想免部署直接体验最新功能？**
> 访问在线版 **[teacherdb.cn](https://teacherdb.cn)**，抢先体验公共基础题库、知识点 × 方法双轴检索、0–5 小数难度评分、相似题并排推荐、AI 讲义等持续更新的特性。[**扫码加入微信交流群**](#在线体验最新功能与交流群)即可免费领取邀请码注册账号！

---

## 为什么做「拣题」

老师手里往往攒了几百套试卷，但“有资料”不等于“有题库”：题目散落在 PDF 和 Word 里，找题靠翻文件夹，组卷靠截图、抄题和反复调排版。

**拣题**把整条备课链路串成一个开箱即用的本地工作台：

```text
导入 PDF / Word / 照片  →  AI 整卷识题  →  对照原卷审校  →  沉淀个人题库  →  检索 / 变式 / 出周测  →  导出可编辑 Word / PDF
```

原卷、页面图、题图、题库和模型密钥全部保存在本机；**AI 负责扛下机械录入，最终入库与排版仍由老师掌控**。

---

## v0.2 重磅更新

| 更新项 | 解决什么问题 |
| --- | --- |
| 📝 **Word 原生可编辑公式导出** | 保存组卷后选择 `Word`，分别下载学生卷与解析答案（`.docx`）。分式、根式、矩阵、分段函数全部输出为 **Word 原生 OMML 公式**（非图片），双击即可继续编辑。[详细说明](docs/word-export.md) |
| 📄 **Word 试卷直接导入** | 使用 `npm run local:python` 启动后可直接上传 `.docx` / `.doc`。精准读取 **OMML 与 MathType 公式**转 LaTeX，绕开截图 OCR 误识；审核页自动列出待核对公式。[详细说明](docs/word-import.md) |
| 🔎 **组合词搜题 & 近期用题排除** | 支持输入「`2025 期末 二次函数`」等多条件组合检索；题卡直接标注上次用题试卷与日期，一键排除近 7 / 30 / 90 天用过的题。 |
| ⚡ **一键出周测草稿** | 工作台点击「出一份周测」，按知识点、题量与近期使用情况自动成稿，左侧实时查看题型与知识点分布柱状图。 |
| ↩️ **8 秒防误删撤销** | 批量删题、清理试卷资源或清空选题篮时，底部弹出 8 秒撤销条，避免手滑丢数据。 |
| 🚦 **全局 RPM 限流与 429 自动退避** | API 与后台 Worker 共享每分钟请求预算（默认 `50 RPM`，可通过 `.env` 的 `JIANTI_MODEL_RPM` 调整），触发上游 429 时自动遵循 `Retry-After` 或指数退避。 |

> 预览、审核与 Word/PDF 导出共享同一套 LaTeX 规范化管线，保留换行附近的命令与各类填空下划线。

---

## 核心能力一览

| 模块 | 能力说明 |
| --- | --- |
| 📚 **多格式批量导入** | 支持 **PDF、Word（`.docx`/`.doc`）与多图拍照组卷**；支持长图自动分页、暂停/恢复、动态并发（1–100 份）与断点续跑 |
| 🧩 **识题规则（Skills）** | 内置 12 个年级、10 个学科默认规则；支持上传样卷生成个人 Skill，经试识别、模型与人工复核后启用 |
| ✨ **整卷上下文识题** | 全卷一起读题，一次性提取题干、LaTeX 公式、选项、答案、解析、知识点与题图/答案图 |
| ✅ **对照原卷审校** | 原卷与题目并排编辑，支持跨页题切换来源页、手工框选题图/答案图并生成高清裁剪图，答案图绝不漏入学生卷 |
| 🗂️ **紧凑题库管理** | 按「学段 × 学科」隔离空间；支持多词搜索、知识点/题型/年级/来源筛选、多层个人文件夹与紧凑单行列表操作 |
| 🪄 **可控变式生成** | 基于已复核原题生成可追溯变式，支持「命题 → 规则校验 → 独立审校评分（≥75 分）→ 人工采用」完整闭环 |
| 📋 **智能组卷与双导出** | 内置中高考/日常作业/周测模板，支持目标分值补齐、实时 A4 预览、解答题自动预留半页作答空间，导出 **Word / PDF** |
| 📦 **分享与迁移** | 导出 JSON、Markdown 或包含题图与目录结构的 `.jianti` 单文件共享包 |
| 📊 **成本透明可控** | 按月份与模型统计输入/缓存/输出 Token、识别页数与估算费用 |
| 🔒 **本地优先 & 加密** | SQLite 与文件全留本机；模型 API Key 经 AES-GCM 加密落盘，接口永不回传明文 |

---

## 真实使用场景

以下截图均来自实测运行：选取上海高三数学 5 套区级模考 + 5 套校级练习（[试卷来源](https://github.com/robbinpanda/Math-Papers-For-GaoKao)），通过 OpenCode Go 的 `deepseek-v4.1-flash` 一次性识别 **99 页、210 道题**。

### 1. 批量导入试卷，统一掌控识别与审核进度
选择学段、学科与模型后批量拖入 PDF / Word / 照片，实时查看处理进度、审核进度与一键出周测入口。

[![工作台：批量导入试卷并查看识别与审核进度](https://cdn.jsdelivr.net/gh/robbinpanda/Teacher-DB@6ec7e22512a540336b9bbe77fc3a5cfa063dcc54/docs/images/workspace.png)](docs/images/workspace.png)

### 2. 紧凑题库列表，高效筛题、辨重与选题
每行集中展示题型、来源、原题号、知识点、用题记录与题干，右侧一键变式、展开解析、编辑或加入选题篮。

[![我的题库：紧凑列表展示实卷题干、来源及右侧选题操作](https://cdn.jsdelivr.net/gh/robbinpanda/Teacher-DB@6ec7e22512a540336b9bbe77fc3a5cfa063dcc54/docs/images/question-bank.png)](docs/images/question-bank.png)

### 3. 实时预览 A4 成卷，一键导出可编辑 Word / PDF
左侧调整模板、题序与分值并查看题型/知识点分布，右侧所见即所得预览，顶部切换 `Word` / `PDF` 分别下载学生卷与解析答案。

[![组卷：调整模板、题目顺序并实时预览 A4 试卷](https://cdn.jsdelivr.net/gh/robbinpanda/Teacher-DB@6ec7e22512a540336b9bbe77fc3a5cfa063dcc54/docs/images/paper-builder.png)](docs/images/paper-builder.png)

### 4. 模型 Token 与成本一目了然
按月追踪各模型输入、缓存命中、输出 Token 与处理页次，配置单价后自动估算每页成本。

[![模型用量：按月份和模型统计 Token 与估算费用](https://cdn.jsdelivr.net/gh/robbinpanda/Teacher-DB@6ec7e22512a540336b9bbe77fc3a5cfa063dcc54/docs/images/model-usage.png)](docs/images/model-usage.png)

---

## 在线体验最新功能与交流群

除了在本地部署本开源项目，你也可以直接访问托管在线版 **[https://teacherdb.cn](https://teacherdb.cn)** 抢先体验更多正在演进的新特性：

| 对比项 | 开源本地版（本仓库 `Teacher-DB`） | 在线体验版（[teacherdb.cn](https://teacherdb.cn)） |
| --- | --- | --- |
| 部署方式 | 本机一键启动，数据 100% 留在本机 | 浏览器打开即用，免配环境与服务器 |
| 核心能力 | PDF / Word / 图片导入、审校、题库、周测、Word/PDF 导出 | 包含开源版全部稳定能力 |
| 抢先新功能 | 随成熟稳定后分批同步开放 | **公共基础题库、知识点 × 方法双轴标签、0–5 小数难度自动评分、相似题并排推荐、共享模型、AI 讲义工作台（内测）** |

### 扫码加群：领取 `teacherdb.cn` 注册邀请码 & 反馈交流

目前 **[teacherdb.cn](https://teacherdb.cn)** 开放邀请码注册。欢迎扫码加入 **Teacher-DB 使用反馈交流群**——**进群即可领取邀请码开通在线账号**，也欢迎和其他老师交流试卷导入、公式校对与组卷技巧，或直接提 Bug 和新需求：

<div align="center">

<a href="docs/images/wechat-group.jpg"><img src="https://cdn.jsdelivr.net/gh/robbinpanda/Teacher-DB@6ec7e22512a540336b9bbe77fc3a5cfa063dcc54/docs/images/wechat-group.jpg" alt="Teacher-DB 使用反馈交流群微信二维码" width="280"></a>

<sub>本期群二维码有效至 <b>2026 年 12 月 1 日</b>前；如已过期，欢迎在 <a href="https://github.com/robbinpanda/Teacher-DB/issues">GitHub Issues</a> 留言获取新码。</sub>

</div>

---

## 快速开始

### 环境要求

- **Node.js `22.13+`**（项目要求 Node.js 22）与 `npm`
- **Chrome、Edge 或 Chromium**（用于服务端生成 PDF；常见安装路径自动检测）
- 一个支持图片输入的视觉模型 API（启动后在界面内配置）
- *可选*：**Python 3.11+**（启用 Word 导入与后台 PDF 分页）；**LibreOffice**（导入旧版 `.doc` 与固定版式 Word 试卷）

### 方式一：Windows 一键启动

双击项目根目录的 `启动题库.cmd`。首次运行会自动安装依赖并完成构建，NestJS、Worker、网页全部就绪后自动打开浏览器；后续源码未变会直接复用构建。停止服务双击 `关闭题库.cmd`。

### 方式二：命令行启动（Windows / macOS / Linux）

```bash
# 1. 安装依赖并启动（纯 Node 模式：支持 PDF / 图片导入与 Word / PDF 导出）
npm install
npm run local
```

启动后访问 **<http://localhost:3050>**（默认网页端口 `3050`、API `3051`，可通过 `--web-port=... --api-port=...` 修改；开发热更新使用 `npm run dev`，生产构建使用 `npm run build && npm start`）。

如需启用 **Word 试卷导入（`.docx`/`.doc`）与后台 PDF 分页**（关闭网页也不中断渲染）：

```bash
npm run local:python
```

### 首次使用 5 步上手

1. 打开左侧「**模型配置**」，新增识题模型。
2. 选择 OpenCode 普通付费、OpenCode Go 套餐、OpenRouter 或自定义模型，填写 API Key（自定义模型需填协议与 Base URL）并执行连接测试。
3. 回到「**工作台**」，选择学段、学科、模型和并发数。
4. 点击「**导入试卷**」批量上传 PDF / Word（Python 模式），或通过「图片组卷」添加 JPG / PNG / WebP 照片；未配模型也可先上传分页，配好后直接重试。
5. 对照原卷审校入库，随后在题库检索、生成变式或组卷导出 Word / PDF。

> **支持的模型协议**：OpenAI Chat Completions · OpenAI Responses · Anthropic Messages · Gemini GenerateContent（含流式）。自定义 Base URL 须使用 HTTPS（本机 `localhost` / `127.0.0.1` / `::1` 允许 HTTP）。详见 [模型服务适配](docs/model-services.md) 与 [架构说明](docs/architecture.md)。

---

## 更多工作流细节

<details>
<summary><b>展开查看：导入识别、审核入库、变式审校、个人 Skills 与组卷规则详解</b></summary>

### 导入与识别
- 图片组卷在浏览器中按预览顺序生成 PDF，单张最大 20 MB / 4000 万像素，每份最多 100 页，合成文件最大 100 MB；Word 原卷（Python 模式）单份最大 60 MB。
- 默认模式使用浏览器 PDF.js 逐页渲染（最多同时 2 份，成功或失败即释放 Worker 与画布）；Python 模式由 FastAPI 在后台分页。
- 每份试卷在整卷上下文中识别，题目、答案与解析以事务一次性落库；任务状态持久化，服务重启后可断点续跑。

### 审核与入库
- 对照原卷修改题号、题型、题干、选项、答案、解析、分值和标签；支持跨页题切换来源页并手工框选题目范围、题图或答案图（生成真实 JPEG 裁剪图）。
- 审核页提供「AI 复核本题图片」：从原页像素提取候选框后交由模型判断题号归属与用途，预览确认后写入。
- 只有确认通过的题目才会进入正式题库。

### 检索、变式与共享
- 全文检索覆盖题干、答案、标签与来源，支持多层个人文件夹以及年级/地区/教材智能筛选。
- 变式生成可独立指定命题模型与审校模型：默认「独立审校」执行修订与独立评分（须 ≥ 75 分且全部校验通过），老师挑选采用后入库；单次超时下限 180 秒（最长 300 秒），网络抖动按幂等请求恢复防重复计费。
- 支持导出 JSON、Markdown 或带裁剪题图的 `.jianti` 单文件共享包。

### 个人识题规则（Skills）
在「设置与用量 → 识题规则」按年级与学科管理方案，支持上传试卷样例（≤ 12 MB）生成草稿、试识别并排复核、根据人工意见迭代优化并启用唯一生效版本，且支持 `SKILL.md` 导出。

### 组卷与输出
- 内置中考数学、高考数学、日常作业与课堂测试模板，支持目标分值智能补齐。
- 导出按题目实际占高分页，解答题下方独立保留至少半页作答空间；保存后可选择 PDF 或 Word 分别下载学生卷与解析答案。
- 作品通过 `paper_items` 实时引用题目，删除试卷不会删除题库原题。详见 [教学资源管理路线图](docs/resource-library-roadmap.md)。

</details>

---

## 数据与安全

默认数据存放在项目根目录的 `data/`（可通过 `JIANTI_DATA_DIR` 迁移到其他磁盘或 NAS）：

```text
data/
├── teacher-question-bank.sqlite3   # 题库与业务数据（WAL + 外键 + 原子事务）
├── files/                          # 原卷、页面图与裁剪图
└── .model-key-secret               # 本机自动生成的密钥加密材料
```

- 模型 API Key 使用 **AES-GCM** 加密存储，接口只返回脱敏片段；长期部署建议在 `.env` 中固定 `MODEL_KEY_ENCRYPTION_SECRET`。
- 运行日志自动写入 `.runtime/logs/local-3050/`（单文件 5 MB 轮转），不记录试卷正文与 API Key。
- 请定期备份整个 `data/` 目录，切勿提交到 Git。本地默认单教师模式；若自建公网多用户服务，请参考 [架构说明](docs/architecture.md) 通过可信反代提供鉴权。

---

## 诊断、备份与常用命令

```bash
npm run doctor                                              # 检查 Node、数据库、目录与浏览器环境
npm run backup                                              # 创建并立即校验数据快照备份
npm run backup -- D:\teacher-db-backups\backup-2026-11-24   # 备份到指定目录
npm run backup:verify -- D:\teacher-db-backups\backup-2026-11-24
npm run restore -- D:\teacher-db-backups\backup-2026-11-24 --confirm  # 恢复（自动保留旧数据副本）
```

| 命令 | 用途 |
| --- | --- |
| `npm run local` / `npm run local:python` | 一键构建并启动本地服务（后者启用 Word 导入与后台 PDF 分页） |
| `npm run dev` | 启动开发热更新服务器（端口 `3050`） |
| `npm run build` / `npm start` | 创建生产构建 / 启动生产服务 |
| `npm test` / `npm run lint` | 运行自动化单元测试 / ESLint 检查 |
| `npm run word:verify` / `npm run word:import:verify` | 端到端验证 Word 导出与 Word 导入链路 |
| `npm run doctor` / `npm run backup` | 环境诊断 / 数据备份校验 |

---

## 技术栈与项目结构

- **前端与全栈**：Next.js 16 · React 19 · TypeScript 5 · Tailwind CSS 4 · KaTeX
- **后端与存储**：NestJS 11 · SQLite (`better-sqlite3`) · Drizzle ORM · Node.js 22
- **文档与媒体**：`docx`（原生 OMML 公式导出）· FastAPI + `processor/word`（MathType/OMML 解析）· PDF.js · Sharp · Chromium

> 不依赖 Cloudflare、外部云存储或特定托管平台，可运行在 Windows、macOS、Linux、NAS 或普通 VPS。

<details>
<summary><b>展开查看：目录结构、当前边界与文档索引</b></summary>

```text
app/          Next.js 页面与 API 路由
components/   工作台、审核、题库、组卷等界面组件
db/           Drizzle Schema 与数据库初始化
drizzle/      版本化 SQL 迁移
lib/          识别、队列、题库、组卷、Word 导入导出与限流逻辑
processor/    可选 Python 文档处理服务（PDF 后台分页、Word/MathType 解析）
scripts/      诊断、备份、恢复与端到端验证脚本
tests/        Node.js 自动化测试与浏览器测试
docs/         功能清单、Word 专题说明与截图
```

### 当前边界
- 默认纯 Node 模式支持 PDF 和图片组卷；Word 导入需要 Python 模式，旧版 `.doc` 和固定版式 Word 试卷还需本机安装 LibreOffice。
- 自动跨页合并只检查相邻下一页；极少数跨三页以上或题号模糊的题目需人工微调。
- 服务端 PDF 导出依赖 Chromium 系浏览器；极简 Linux 容器需自行安装并配置 `CHROMIUM_EXECUTABLE_PATH`。
- AI 识题仍可能存在误差，正式印发前建议在审核页核对关键公式、题图与答案。

### 相关文档
- [完整功能实现清单](docs/features.md)
- [Word 导出技术说明](docs/word-export.md)
- [Word 导入技术说明](docs/word-import.md)
- [系统架构说明](docs/architecture.md)
- [模型服务适配](docs/model-services.md)
- [教学资源管理路线图](docs/resource-library-roadmap.md)

</details>
