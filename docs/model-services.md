# 模型服务配置与 OpenCode 适配

核对日期：2026-10-13。

## 设置方式

模型配置页提供四个互斥选项：OpenCode 普通付费、OpenCode Go 套餐、OpenRouter、自定义。同一配置只属于一种服务，可保存多个配置；普通付费与 Go 分别保存密钥和地址，切换服务需重新填写密钥。

| 服务 | 必填 | 自动处理 |
| --- | --- | --- |
| OpenCode 普通付费 | 选择模型、Console 服务账号 API Key | 普通 inference 地址、模型协议、默认显示名称、会话标识 |
| OpenCode Go 套餐 | 选择模型、套餐 API Key | 独立的 `https://opencode.ai/inference/go/v1`、Go 模型协议表、会话标识 |
| OpenRouter | 模型 ID、API Key | `https://openrouter.ai/api/v1`、Chat Completions、默认显示名称 |
| 自定义 | 显示名称、模型 ID、API Key、Base URL、协议 | 保留用户提供的地址和协议 |

超时时间有默认值；四项 Token 价格均选填。编辑同一服务时 Key 留空保留原密钥；切换服务需填对应 Key。服务预设在后端再次解析，不信任前端提交的预设地址。密钥继续加密保存，不回传明文。

两种 OpenCode 入口均只提供以下四个下拉选项，后端同样校验范围：

| 模型 | 普通接口 ID | Go 接口 ID | 协议 |
| --- | --- | --- | --- |
| GPT 6 Luna | `gpt-6-luna` | `gpt-6-luna` | Responses |
| Claude Haiku 5.5 | `claude-haiku-5-5` | `claude-haiku-5-5` | Messages |
| MiMo 2.6 Flash | `mimo-v2.6-flash-free` | `mimo-v2.6-flash` | Chat Completions |
| DeepSeek 4.1 Flash | `deepseek-v4.1-flash` | `deepseek-v4.1-flash` | Chat Completions |

普通模型表仅列出 MiMo 的 Free ID，因此选项明确标注 Free，并提示免费层限制；不能将其当作已验证可用的普通付费模型。切换服务时保留双方共有的模型 ID；MiMo 因 ID 不同需要重新选择。已有配置不删除，OpenRouter 和自定义仍可填写模型 ID。

## 官方文档核对

- [Console API](https://opencode.ai/v2/docs/console/api/)：服务账号 Key 为 Bearer 凭据，已绑定工作区，无须另填工作区 ID。这里不实现个人 OAuth/device flow，也不把个人 user token 当服务账号 Key。
- [Inference API](https://opencode.ai/v2/docs/console/api/inference/)：不同模型使用 Chat Completions、Responses、Anthropic Messages 或 Gemini；Claude/Qwen 的 Messages 请求必须包含 `max_tokens`。
- [模型端点表](https://opencode.ai/v2/docs/console/models/)：按明确模型 ID 匹配上表中的三个协议，MiMo 普通接口和 Go 的 ID 分别核对。
- [Go 文档](https://opencode.ai/v2/docs/console/go/)：要求应用自己的 User-Agent 与每会话稳定的 `x-opencode-session`。此要求列在 Go 页面，Console Inference 文档并未将 session 列为必填。应用对 OpenCode 请求统一携带这两项，不需要先创建远端 session。

普通付费选项连接 Console 按量计费接口，Go 选项连接 Go / Go Plus 套餐接口。Go 文档将其定位为编程代理用途；界面说明题库调用是否获准由服务商决定，程序发送自身的真实应用标识。两类服务不根据 Key 格式猜测、不自动切换，也不自动从 Go 回退到普通付费。

## 请求行为

- 普通付费继续使用 API 文档列出的协议专属地址；Go 使用其独立端点表，Chat、Responses、Messages 的完整地址依次为 `https://opencode.ai/inference/go/v1/chat/completions`、`https://opencode.ai/inference/go/v1/responses`、`https://opencode.ai/inference/go/v1/messages`。
- 两类服务分别匹配模型目录，Go 的 MiMo-V2.6-Flash ID 没有 `-free` 后缀。不允许把某服务的模型目录直接套到另一服务。
- 设置页按所选服务提供四项模型下拉选择，并显示最终协议和完整请求地址。
- 数据库 v8 扩展服务约束以保存 `opencode-go`，保留 v7 迁移原文、已有配置 ID、地址、密钥和默认选择。显式的自定义配置继续保持自定义。

- Chat / Responses：`https://opencode.ai/inference/openai/v1`。
- Messages：`https://opencode.ai/inference/anthropic/v1`，Bearer 鉴权，并保留 Anthropic 版本头。
- 自定义协议仍支持 Gemini（不在 OpenCode 四项预设中）：`<baseUrl>/models/<model>:generateContent`；流式使用 `:streamGenerateContent?alt=sse`。图片转 `inlineData`，解析普通文本、思考片段和 Token 用量，日志只存图片指纹。
- 所有 OpenCode 请求使用 `Authorization: Bearer ...`、`User-Agent: Jianti-Teacher-Question-Bank/0.1.0`、`x-opencode-session`。整卷调用用 extraction run ID；没有该 ID 的独立调用创建 UUID。每道题独立审核产生自己的会话 ID，同一次 HTTP 兼容回退复用原头。会话 ID 是路由/缓存标识，不会向接口追加其他题目或历史消息。
- 文本、非流式视觉、流式视觉、连接测试均经过同一请求构造器。仅 OpenCode 去掉通用 OpenAI reasoning 参数，由模型默认行为处理；OpenRouter/自定义原有推理参数保持不变。不能保证 OpenCode 所有模型都禁用思考。
- 请求日志只额外记录 session 与应用名称，不记录认证头。其他服务不附带这两个 OpenCode 专用信息。

`lib/model-services.ts` 保存本次核对的模型/协议表，允许去掉用户粘贴的 `opencode/` 前缀。该表是版本化快照，不自动猜测未来模型协议；未知 ID 与 System One 模型明确拒绝，可使用自定义配置。官方公开 `/inference/v1/models` 本次仅返回 ID、object、created、owned_by，没有足够协议元数据，因此未拿它作为自动协议推断依据。模型能否识图仍以服务能力和连接测试结果为准。

数据库通过独立 **v7** 迁移新增可空 `model_profiles.service`，不修改历史迁移校验值。已有配置按精确官方 origin/path 推断服务，保留原地址、协议与密钥；显式自定义配置不自动变成 OpenCode。

## 验证

- `tests/model-services.test.mjs`：四项模型范围、普通/Go 三协议路由、认证/session隔离、范围外模型、Gemini图文/SSE/用量与回退预算。
- `scripts/verify-model-services.mjs`：隔离数据库下通过正式配置API、文本/视觉/流式调用和连接测试，模拟52次HTTP请求，验证重试session稳定、跨题独立、密钥不泄露、租户隔离、v6/v7到v8升级保留配置。无真实付费调用。
- `tests/browser/model-services.spec.mjs`：表单选项、不同必填字段、仅两项保存OpenCode/OpenRouter、编辑切换协议及自定义配置。

未提供可用的 OpenCode Key，本轮没有进行真实 OpenCode 推理或宣称账号鉴权已通过；公开模型目录已实际读取。

上轮完整回归：203项单元测试、3项浏览器测试、相关ESLint与生产构建通过。四模型收敛后的验证见下文。构建仍有模型日志动态路径匹配过多文件的既有警告。页面截图：`tmp/opencode-model-settings.png`、`tmp/opencode-go-model-settings.png`；所有测试使用隔离数据目录。

2026-10-13 补充验证覆盖普通付费/Go 的三类协议与隔离路由、跨服务地址拒绝、Go 配置创建/编辑/重载、v7→v8 与 v6→v8 升级保留数据。验证使用模拟接口，不代表已验证真实套餐额度或授权。

四模型收敛验证：6项相关单元测试、52次模拟请求、3项浏览器测试、TypeScript、相关ESLint和生产构建均通过；浏览器覆盖两种服务各四项选择、MiMo ID切换、保存和编辑。未调用真实模型。
