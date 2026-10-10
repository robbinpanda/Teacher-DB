# 运行架构与部署边界

## 当前进程

```text
浏览器 → Next.js Web (3050) → NestJS API (3051) → 业务服务 → SQLite + 文件目录
                                    ↑                   ↑
                               SSR 页面数据          独立 Worker
                                                        ↓
                                         FastAPI PDF (3052，可选)
```

- Next.js 负责 React 页面、SSR 和同源 API 转发。页面通过 `/api/view` 取得数据，不打开 SQLite、不启动队列。
- NestJS 管理 HTTP 入口、身份验证、请求上下文和统一错误响应。`server/http/handlers` 是迁移后的 transport 层，路由登记在 `server/http/routes.ts`；上传、分页、整卷识别、最终校验、审核保存位于 `server/services`，Worker 直接调用这些服务。
- Worker 单独运行整卷模型任务和 PDF 分页。模型任务继续使用 `document_jobs`、`extraction_runs`；分页使用 `document_preparations`。租约、心跳、退避和结果写入校验均保存在 SQLite 中。
- FastAPI 仅提供 PDF 字节到分页 JPEG 的流式协议，不接受文件路径、不访问数据库、不决定租户。Worker 校验每条事件与页面序号，逐页写入，租约失效后不能继续提交页面。客户端断开会释放 PDF 处理槽位。
- 原有班级、组卷、Skills、变式等 handler 已迁出 Next.js，但部分仍包含业务编排，可继续按域提取服务。按需发起的部分模型操作仍在 API 请求期间运行；整卷识别和后台分页已独立。

## 本地启动

`npm run local` 自动构建（源码和配置未变时复用），按 API → Worker → Web 顺序启动并等待就绪。Windows 的 `启动题库.cmd` 使用同一入口；关闭窗口/Ctrl+C 会停止本实例创建的进程树，`关闭题库.cmd` 会核对实例 ID 再停止。后台进程意外退出有有限次数退避重启，连续失败会让启动器报错退出。

默认仅需 Node.js 22，分页在浏览器完成。模型任务入队后不依赖网页；浏览器分页尚未保存完时关网页，需要重传同一 PDF 补齐。

`npm run local:python` 启用后台分页：首次准备项目 `.runtime/python` 虚拟环境并安装固定依赖，需要 Python 3.11+ 和网络；之后复用。也可设置 `JIANTI_WITH_PYTHON=1` 使用 Windows 一键启动。原卷上传后由后台渲染，关网页不影响处理。尚未配置模型时状态为 `awaiting_model`，页面证据保留。

开发模式用 `npm run dev`；已有生产构建用 `npm start`。可传 `--web-port=... --api-port=... --processor-port=...`。开发和生产实例应使用不同端口及数据目录。

## 数据迁移与就绪

`db/bootstrap.ts` 登记顺序迁移，`db/migrations.ts` 在同一个立即事务中完成数据库修改和 `schema_migrations` 记录。已有数据库先登记并应用基线修复，再升级；后续启动不会反复执行历史修复。当前版本 3：基线、进程心跳、PDF 分页任务。新版本需添加迁移，不能修改已经发布的迁移内容或校验值。

遇到未知高版本或校验值不同，启动失败；迁移失败整体回滚。API/Worker 同时首次启动时由数据库写锁串行执行迁移。升级前使用 `npm run backup` 备份完整数据与密钥。

`GET /api/ready` 检查 API 已完成数据库初始化，返回版本、实例 ID 与 Worker 心跳；`?dependencies=1` 在 Worker 尚未就绪时返回 503。`/api/health` 保留原有业务健康检查。FastAPI 的 `/ready` 返回协议版本。启动器在依赖就绪后才打开网页。

## 请求、状态和恢复

错误 JSON 使用 `{ error, code, retryable, requestId }`，响应头有 `x-request-id`。JSON 请求拒绝空值、数组和无效格式；业务边界继续检查内容、长度、归属、页面完整性和审核规则。上传结果、审核进度、识别输入以及 FastAPI 流使用共享运行时契约，不能仅凭 TypeScript 类型假定响应正确。

`lib/document-state.ts` 集中定义文档转换规则。公开文档修改不能从上传或失败直接跳到完成；完成还须通过页面和题目审核完整性检查。审核轮询按请求完成后延迟调度，取消页面卸载后的请求，暂时网络错误保留当前编辑数据。

模型租约默认 90 秒。分页租约默认 90 秒，Worker 心跳续租；进程退出后新 Worker 等租约过期再领取，旧 Worker 的写入被拒绝。分页恢复只补缺页，已有题图和审核证据保留。分页完成到模型任务入队在同一数据库事务提交。FastAPI 单次仅处理一份 PDF，超过容量返回可重试响应。

整卷题数校验优先使用可核验的原卷证据：仅当原始 PDF 每页均有正文文本、可明确分开试题与参考答案、两部分带分值的顶层题号分别从 1 连续且一一对应时，采用双方相互印证的实际题数，同时记录模型声明的题数。页脚页数和章节宣称题数不能作依据。扫描页、题号格式不确定或两部分不一致时不自动覆盖模型计数，继续严格检查其声明范围，不能仅因为返回了连续 1～20 就自动忽略可能遗漏的第 21 题。

## 远端部署准备

同一服务器可以分别运行 `npm run api`、`npm run worker`、Next Web 和 `python -m uvicorn processor.main:app`。API 与 Worker 共享同一本地磁盘上的 `JIANTI_DATA_DIR`；SQLite 阶段不适合多台主机通过网络文件系统同时写入。

设置 `JIANTI_DEPLOYMENT_MODE=remote`，同时设置 `JIANTI_AUTH_SECRET`（至少 32 字符）、`JIANTI_AUTH_ISSUER`、`JIANTI_AUTH_AUDIENCE`。外部登录服务签发 HS256 JWT，包含 `sub`、`exp`、`iss`、`aud`，可选 `nbf`。API 验证 Bearer 或 `jianti-session` Cookie，再将 `sub` 放入每次请求独立的租户上下文。来自浏览器的 `oai-authenticated-user-id` 无法覆盖身份。此阶段未提供用户注册/登录 UI；Cookie 由登录服务设置 HttpOnly、Secure 和合适的 SameSite。

Web 与 API 都需设置 remote 模式。外部只发布 Web/反向代理 HTTPS，API 和 FastAPI 留在私有网络；`APP_BASE_URL` 必须设置为 Web 可达的地址。API/Worker 共享固定 `MODEL_KEY_ENCRYPTION_SECRET`，Worker/FastAPI 共享 `JIANTI_PROCESSOR_TOKEN`。服务器需有 Chromium 才能导出成卷 PDF。

PDF 打印采用短时签名授权，仅允许指定 `paperId` 的打印 read model；题图嵌入返回数据。打印令牌不能用于一般 API、文件读取或其他试卷。

## PostgreSQL 下一步

当前 **仍是 SQLite**，`db/provider.ts` 对 `JIANTI_DATABASE_PROVIDER=postgres` 或 PostgreSQL `DATABASE_URL` 明确报错，防止看似切换成功却继续写本地数据。此轮完成了 HTTP/业务/执行进程的分离；业务中的部分存储逻辑仍使用 SQLite SQL，需要后续适配，不能只换连接串。

建议逐域增加仓储接口及 PostgreSQL 实现，复用当前服务和契约测试，先迁文档、审核、任务，再迁学校工作流：

1. 用 `pg`/Drizzle PostgreSQL 替换 SQLite driver、schema 和同步事务 API；全链路事务明确传递连接，禁止在异步事务中混用其他连接。
2. 将 `BEGIN IMMEDIATE` 领取任务改为事务中的 `FOR UPDATE SKIP LOCKED`；保留租约归属及过期校验。SQLite 的 rowid 排序、INSERT OR IGNORE、PRAGMA、FTS5 搜索需分别改写。
3. 根资源包含 owner/tenant；派生资源通过父资源约束归属。增加组合外键与 PostgreSQL RLS，并测试文件、导出、嵌套资源以及后台任务的跨租户拒绝。
4. 将文件存储接口替换为对象存储，保持对象键、数据库归属校验和带权限下载；Web 无需修改同源访问方式。
5. 迁移时停写、备份、导入、比对主键/行数/外键/校验和，再启用 PostgreSQL；禁止两个数据库同时写同一份题库。

## 回归验证

模型调用日志保存在 `JIANTI_DATA_DIR/model-traces/YYYY-MM-DD/<traceId>/`。每次调用使用独立目录，不随 `extraction_runs` 重试、重建或试卷删除覆盖。`manifest.json` 关联教师、模型、用途、试卷和识别尝试；`request-N.json` 保存实际提示词与模型参数，省略请求认证头及图片数据（保留图片长度与 SHA-256）；`response-N.raw` 保存模型 HTTP 响应体原始字节，400 兼容回退也单独保存。收到每块数据后先写盘并同步，再进行解析；`output.txt`、`thinking.txt` 分别记录正文和思考，`events.ndjson` 记录已解析的识别事件。`result.json` 是模型调用终态，`validation.json` 是整卷校验终态，模型传输成功但题数错误会留下失败的校验结果。进程被强制结束时可能没有终态文件，已有原始回复仍可检查；过去未记录的回复无法补回。日志默认保留，并纳入完整备份，未通过通用文件 API 暴露。

每份试卷的 `/review/<documentId>/logs` 提供调用历史、失败筛选、实际系统/用户提示词、模型原始正文、HTTP原始流、思考内容及解析事件。工作台、审核页和失败恢复页均有入口。`GET /api/documents/<documentId>/model-traces` 分页列出历史（每页50条），详情及内容接口再次校验日志清单的 owner/document 归属；内容按64 KiB分页并保持UTF-8边界，文件名只接受日志文件白名单。接口禁止缓存，不接受任意文件路径。日志缺少结束记录时展示“未结束 / 中断”，不把模型传输完成直接等同于整卷识别成功。

图片复核会把已有图片及其原始框加入模型请求：绿色 E 编号对应已有图片，紫色编号对应像素候选。模型可以明确删除误图、重复图、邻题图或不完整框，但必须在 `removedAssets` 中逐张给出已有图片 ID 和理由；保留时选择 `existing:<id>`，沿用原 ID 和边界。所有已有图片都必须作出保留或删除决定，未知 ID、矛盾决定及遗漏决定会被拒绝；复核期间原图发生变化也拒绝过时结果。界面显示删除理由和最终图片预览，采用后替换草稿并重排解析引用；可以合法删除全部图片。普通不等式组、方程组和分段函数转为 LaTeX，不能当成图片；真正的图表和茎叶图仍须保留。

置信度是模型自评，不是统计正确率。识别及复核提示不预置 95% 示例。后端独立执行规则：人工核查或图片修正最高 65%，缺图最高 50%，只降低已有评分；发现删除误图时，即使模型返回 `needsHumanReview=false`、95%，也强制待核查和降分。复核立即保存缺图、核查状态及降分，图片替换经界面采用后保存；旧页面普通保存不能撤销已记录的低分和核查状态。显式审核通过可清除核查标记，但不会提高 AI 分数。原模型评分及删除理由保留在原始回复，实际执行评分写入校验日志。仅 `unlocatedImages=[]` 这一确实为空的错误类型可兼容恢复，同时记录格式警告、降分并要求核查；其他非布尔值拒绝。

- `npm test`：纯业务、迁移回滚、租约、身份、契约、上传恢复等。
- `npm run backend:verify`：真实 NestJS + Worker、并发迁移、上传、错误和用户归属。
- `npm run processor:verify`：真实 FastAPI 80 页 PDF、停止 Worker、过期租约恢复、缺页续存。
- `npm run remote:verify`：真实 API 的 JWT、伪造身份头、并发租户、外部文件拒绝、打印能力范围。
- `npm run local:verify`：生产构建复用、四个进程就绪、重复启动、实例核对和完整关闭。
- `npm run test:browser`：首次缺页、非 JSON 响应、慢请求、断网恢复、API 崩溃后自动恢复。
- `npm run review:verify`、`npm run review:verify-startup`：现有审核集成流程与首次访问。

以上集成测试创建独立临时数据库，不使用已有 `data/`。
