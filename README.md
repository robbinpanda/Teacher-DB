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

## 当前已实现

- PDF 批量上传与浏览器端逐页高清渲染；单批最多 50 份，上传阶段并发 2 份并按“渲染一页、落盘一页、释放一页”控制内存
- 原卷在页面渲染前立即预登记，切换到其他最近试卷不会丢失新任务；模型未配置时原卷和分页图也会保留
- 原卷/页面本地落盘，SHA-256 去重和页面校验
- SQLite 自动建库与兼容升级
- 内置 OpenCode MiMo V2.5 Free，自动使用 OpenCode 公共凭据，无需账号或个人 API Key
- 自定义接口协议、API Base URL、Model Name、API Key 和超时配置
- AES-GCM 密钥加密、模型切换与真实图片连通性测试
- Chat Completions 固定 `reasoning_effort: "none"`，Responses 固定 `reasoning.effort: "none"`，Anthropic Messages 不启用 thinking
- 强制开启 Thinking、不能关闭推理的模型会在连接测试时明确判定为不兼容，不会偷偷启用推理
- 服务端持久识别队列全局最多同时处理 2 份试卷；任务领取使用租约和心跳，进程重启后会自动回收并续跑
- 每页抽题使用幂等键和独立事务，成功一页立即保存题目、坐标、原始响应和完成状态，之后只重试未完成页
- 同一试卷按顶层题号唯一保存；只出现在下一页的候选题和“（1）/小问讲解”不会被误建为新题，历史假框重复项会在升级时安全去重
- 超时、网络错误、429/5xx 和网关拥挤会遵循 `Retry-After` 或指数退避，最多尝试 8 次；Responses 结构化参数被兼容网关拒绝时会自动降级一次
- 题目 JSON、LaTeX、页面/题图坐标、置信度、标签和人工审核界面
- 每次识别同时查看当前页与下一页；跨页题只在起始页创建一次，并用多个 `question_regions` 保存各页独立范围
- 审核页可在跨页题的各来源页之间切换，直接拖动题目框或右下角缩放；含题图时可在“题目范围/题图裁剪”间切换
- 答案页通过 `answerUpdates` 按题号回填，不会伪造为新题
- 人工修改题号、题型、题干、选项、答案、解析、分值和标签，并可手动补题
- 题图框拖拽调整后使用 Sharp 生成真实 JPEG 裁剪文件
- 已审核题库的服务端分页、题干/答案/标签/来源全文检索、题型与来源筛选，以及 JSON / Markdown 下载
- 从题库选题、排序、智能补齐到 100 分、自动保存试卷、打印或保存 PDF
- 由服务端 Chrome / Edge / Chromium 直接生成可下载 A4 PDF，可选择是否包含答案
- 内置中考数学、高考数学、日常作业和课堂测试模板；试卷按选择、填空、解答等板块排版，并在板块标题旁显示分值规则
- 教师可修改板块、分值、注意事项和考生信息栏并保存为个人模板；题图可在整卷预览中缩放、水平/垂直平移并自动显示题号图注
- 全局小学/初中/高中与学科切换；模型只能从对应范围的预制或教师扩充标签目录中选标签
- 已审核题目支持后补答案：导入 PDF 或图片后按题号和题干自动匹配，列出未匹配、低置信度和仍缺答案的题目
- 上传前只选择全局学科/学段；年份、考试类型、地区、学校从卷头推测，并可在审核页“试卷详情”中随时修正
- 页面和文档任务持久化为 queued / processing / retry_wait / complete / failed，记录尝试次数、下次重试时间、租约和错误
- `/api/health`、`npm run doctor`、一致性备份、SHA-256 校验和可回滚恢复

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
