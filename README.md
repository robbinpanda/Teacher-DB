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

## 尚待完成

目前题库、审核和组卷仍有部分演示数据。下一阶段会依次替换为真实查询，补齐裁剪图生成、来源全文筛选、JSON/Markdown/PDF 导出、后台任务恢复和自动化测试。旧版 `.doc` 将通过可选 LibreOffice 工作进程支持，而不是在浏览器中强行解析。
