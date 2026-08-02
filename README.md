# 拾题 · 教师题库助手

面向教师的本地优先题库工具。上传 PDF、DOCX 或图片后，浏览器把原卷渲染成高清页面，再调用 OpenAI-compatible 多模态模型提取题干、LaTeX 公式、答案、题图坐标和标签，最后进入人工审核、题库检索和组卷流程。

## 技术架构

- Next.js 16 + React 19 + TypeScript，运行于标准 Node.js 22
- `better-sqlite3` 本地 SQLite，启用 WAL、外键、5 秒忙等待和原子事务
- `data/files` 保存原卷、逐页图和后续裁剪图；`SHITI_DATA_DIR` 可修改数据根目录
- Drizzle schema 和 SQL 迁移描述数据结构，运行时会幂等建表和升级
- OpenAI-compatible `/chat/completions` 多模态模型适配器
- API Key 使用 AES-GCM 加密后存入 SQLite，接口只返回脱敏值

项目不依赖 Cloudflare Sites、D1、R2、Vinext 或 Miniflare，可在 Windows、Linux、macOS、NAS 或普通 VPS 上运行。

## 当前已实现

- PDF、DOCX、PNG、JPG、WEBP 浏览器端逐页渲染
- 原卷/页面本地落盘，SHA-256 去重和页面校验
- SQLite 自动建库与兼容升级
- 内置 OpenCode MiMo V2.5 Free 模型元数据（免费模型仍需用户自己的 OpenCode Zen API Key）
- 自定义多模态 API Base URL、Model Name、API Key 和超时配置
- AES-GCM 密钥加密、模型切换与真实图片连通性测试
- 所有模型调用固定 `reasoning_effort: "none"`
- 每页抽题幂等键、尝试次数、原始响应、失败原因和事务入库
- 题目 JSON、LaTeX、页面/题图坐标、置信度、标签和人工审核界面
- 答案页通过 `answerUpdates` 按题号回填，不会伪造为新题
- 人工修改题号、题型、题干、选项、答案、解析、分值和标签，并可手动补题
- 题图框拖拽调整后使用 Sharp 生成真实 JPEG 裁剪文件
- 已审核题库的题型、标签、来源全文筛选，以及 JSON / Markdown 下载
- 从题库选题、排序、智能补齐到 100 分、自动保存试卷、打印或保存 PDF

## 本地运行

1. 安装并启动：

       npm install
       npm run dev

2. 打开 `http://localhost:3000`。

生产构建：

    npm run build
    npm start

首次访问数据接口时会创建 `data/teacher-question-bank.sqlite3`、`data/files` 和本机加密密钥。生产环境建议复制 `.env.example` 并设置固定的 `MODEL_KEY_ENCRYPTION_SECRET`。整个 `data` 目录都应纳入备份，但不能提交 Git。

## 模型配置

进入“模型设置”：

- MiMo V2.5 Free 已预填 endpoint 和 model id，但按 OpenCode Zen 当前规则仍需绑定个人 API Key。
- 也可添加任何支持图片输入、兼容 `/chat/completions` 的模型。
- 自定义 Base URL 必须为 HTTPS；仅 `localhost`/`127.0.0.1`/`::1` 允许 HTTP。
- 应用不会向浏览器回传 API Key 明文。

## 数据与迁移

数据模型位于 `db/schema.ts`，运行时幂等初始化位于 `db/bootstrap.ts`，版本化迁移位于 `drizzle/`。核心实体包括 documents、pages、extraction_runs、questions、question_assets、tags、model_profiles、papers 和 paper_items。

## 验证

    npm test

开发服务器运行时，还可以执行会自动创建并清理隔离数据的接口回归：

    npm run test:runtime

## 当前边界

- `.docx` 由浏览器中的 `docx-preview` 渲染；复杂 Word 浮动对象、特殊字体或旧版 `.doc` 仍建议先转成 PDF。旧版 `.doc` 当前会明确报错，不会静默生成错误页面。
- 题目跨页断开时不会自动猜测缺失内容，需要在审核页人工合并或补录。
- “打印 / 保存 PDF”调用浏览器标准打印能力，教师可直接选择“另存为 PDF”；服务端无头 PDF 队列尚未加入。
- 本地模式是单教师 `local-demo` 空间。部署为多用户系统时，需要由可信反向代理提供 `oai-authenticated-user-id`，不能让公网客户端自行伪造该请求头。
