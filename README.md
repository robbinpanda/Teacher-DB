# 拾题 · 教师题库助手

面向教师的本地优先题库工具。批量上传 PDF 试卷后，浏览器把原卷渲染成高清页面，再调用多模态模型提取题干、LaTeX 公式、答案、题图坐标和标签，最后进入人工审核、题库检索和组卷流程。为保证页面证据与原卷一致，当前产品范围只接收 PDF。

## 技术架构

- Next.js 16 + React 19 + TypeScript，运行于标准 Node.js 22
- `better-sqlite3` 本地 SQLite，启用 WAL、外键、5 秒忙等待和原子事务
- `data/files` 保存原卷、逐页图和后续裁剪图；`SHITI_DATA_DIR` 可修改数据根目录
- Drizzle schema 和 SQL 迁移描述数据结构，运行时会幂等建表和升级
- Chat Completions、OpenAI Responses、Anthropic Messages 三种多模态模型协议适配器
- API Key 使用 AES-GCM 加密后存入 SQLite，接口只返回脱敏值

项目不依赖 Cloudflare Sites、D1、R2、Vinext 或 Miniflare，可在 Windows、Linux、macOS、NAS 或普通 VPS 上运行。

## 功能概览

- 批量导入 PDF 试卷，自动完成分页渲染、识题、跨页合并和可靠重试。
- 在原卷旁审核题目、答案、解析、标签与题图范围，确认后进入可检索题库。
- 从题库选题、智能补齐、套用模板并生成可打印或下载的 A4 试卷。
- 本地保存原卷、页面、题图、数据库与模型配置，并提供健康检查、备份和恢复工具。

完整能力、可靠性机制和当前实现范围见 [功能实现清单](docs/features.md)。

## 本地运行

Windows 用户可以直接双击项目根目录中的 `启动题库.cmd`。脚本会在首次运行时自动安装依赖，并在服务就绪后打开浏览器。

1. 安装并启动：

       npm install
       npm run dev

2. 打开 `http://localhost:3050`。

生产构建：

    npm run build
    npm start

Windows 生产模式也可使用：

    scripts\run-web.cmd
    scripts\stop-web.cmd

`npm run dev` 和 `npm start` 固定使用 3050。项目不会占用 3000 或 8010。

服务端 PDF 会自动寻找系统中的 Chrome、Edge 或 Chromium。自定义路径可设置 `CHROMIUM_EXECUTABLE_PATH`。

首次访问数据接口时会创建 `data/teacher-question-bank.sqlite3`、`data/files` 和本机加密密钥。生产环境建议复制 `.env.example` 并设置固定的 `MODEL_KEY_ENCRYPTION_SECRET`。整个 `data` 目录都应纳入备份，但不能提交 Git。

## 模型配置

进入“模型设置”：

- MiMo V2.5 Free 已预填 endpoint、model id 和公共凭据 `public`，开箱即用；自定义模型仍需填写自己的 API Key。
- 也可添加任何支持图片输入的 Chat Completions、OpenAI Responses 或 Anthropic Messages 模型；Base URL 可以填写版本根路径或完整协议 endpoint。
- Chat Completions 和 Responses 使用 Bearer Token；Anthropic Messages 使用 `x-api-key` 和 `anthropic-version: 2023-06-01`。
- 自定义 Base URL 必须为 HTTPS；仅 `localhost`/`127.0.0.1`/`::1` 允许 HTTP。
- 应用不会向浏览器回传 API Key 明文。
- 未配置 Key 时仍会保存原卷和分页图，并明确停在“等待模型配置”；配置完成后可从审核页重试，不需要重新上传。

## 数据与迁移

数据模型位于 `db/schema.ts`，运行时幂等初始化位于 `db/bootstrap.ts`，版本化迁移位于 `drizzle/`。核心实体包括 documents、pages、extraction_runs、questions、question_regions、question_assets、tags、tag_catalog、model_profiles、papers、paper_items、paper_templates 和 answer_imports。

## 健康检查

    npm run doctor

## 备份与恢复

创建包含 SQLite 一致性快照、原卷、页面图、裁剪图和本机密钥的备份；命令会立即做 SHA-256 与 SQLite 完整性校验：

    npm run backup

也可以指定目录，并在以后单独复验：

    npm run backup -- D:\\teacher-db-backups\\backup-2026-08-03
    npm run backup:verify -- D:\\teacher-db-backups\\backup-2026-08-03

恢复前必须停止应用。恢复会保留旧数据目录作为 `data.pre-restore-*` 安全副本：

    npm run restore -- D:\\teacher-db-backups\\backup-2026-08-03 --confirm

## 当前边界

- 只接收 PDF。DOC、DOCX、ODT 和图片会明确拒绝；请先在原编辑器中导出 PDF，以避免公式、字体和浮动对象因不同排版引擎而错位。
- 自动跨页合并只查看相邻的下一页；极少数连续跨越三页以上或题号模糊的内容会标记为低置信度，需在审核页人工修正。
- 服务端 PDF 依赖本机 Chromium 系浏览器；极简服务器镜像需要额外安装 Chromium 或设置其可执行文件路径。
- 本地模式是单教师 `local-demo` 空间。部署为多用户系统时，需要由可信反向代理提供 `oai-authenticated-user-id`，不能让公网客户端自行伪造该请求头。
