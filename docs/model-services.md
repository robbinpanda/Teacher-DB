# 模型服务配置与 OpenCode 适配

核对日期：2026-10-13。

## 设置方式

模型配置页提供三个互斥选项，同一配置只属于一种服务，可保存多个配置。

| 服务 | 必填 | 自动处理 |
| --- | --- | --- |
| OpenCode | 官方模型 ID、Console 服务账号 API Key | 官方 inference 地址、模型协议、默认显示名称、会话标识 |
| OpenRouter | 模型 ID、API Key | `https://openrouter.ai/api/v1`、Chat Completions、默认显示名称 |
| 自定义 | 显示名称、模型 ID、API Key、Base URL、协议 | 保留用户提供的地址和协议 |

超时时间有默认值；四项 Token 价格均选填。编辑同一服务时 Key 留空保留原密钥；切换服务需填对应 Key。服务预设在后端再次解析，不信任前端提交的预设地址。密钥继续加密保存，不回传明文。

## 官方文档核对

- [Console API](https://opencode.ai/v2/docs/console/api/)：服务账号 Key 为 Bearer 凭据，已绑定工作区，无须另填工作区 ID。这里不实现个人 OAuth/device flow，也不把个人 user token 当服务账号 Key。
- [Inference API](https://opencode.ai/v2/docs/console/api/inference/)：不同模型使用 Chat Completions、Responses、Anthropic Messages 或 Gemini；Claude/Qwen 的 Messages 请求必须包含 `max_tokens`。
- [模型端点表](https://opencode.ai/v2/docs/console/models/)：按明确模型 ID 匹配，不能笼统地认为所有 Qwen 都走 Messages。例如 `qwen3.8-max` 走 Chat Completions，`qwen3.8-flash` 走 Messages。
- [Go 文档](https://opencode.ai/v2/docs/console/go/)：要求应用自己的 User-Agent 与每会话稳定的 `x-opencode-session`。此要求列在 Go 页面，Console Inference 文档并未将 session 列为必填。应用对 OpenCode 请求统一携带这两项，不需要先创建远端 session。

本预设连接 Console 推理接口，不代表接入 Go 订阅。Go 文档将其定位为编程代理用途；本题库不伪装成其他客户端或编程流量。Console 服务和 Go 套餐不能仅凭 Key 格式或相似模型名混用。

## 请求行为

- Chat / Responses：`https://opencode.ai/inference/openai/v1`。
- Messages：`https://opencode.ai/inference/anthropic/v1`，Bearer 鉴权，并保留 Anthropic 版本头。
- Gemini：`https://opencode.ai/inference/google/v1beta/models/<model>:generateContent`；流式使用 `:streamGenerateContent?alt=sse`。图片转 `inlineData`，解析普通文本、思考片段和 Token 用量，日志只存图片指纹。
- 所有 OpenCode 请求使用 `Authorization: Bearer ...`、`User-Agent: Jianti-Teacher-Question-Bank/0.1.0`、`x-opencode-session`。整卷调用用 extraction run ID；没有该 ID 的独立调用创建 UUID。每道题独立审核产生自己的会话 ID，同一次 HTTP 兼容回退复用原头。会话 ID 是路由/缓存标识，不会向接口追加其他题目或历史消息。
- 文本、非流式视觉、流式视觉、连接测试均经过同一请求构造器。仅 OpenCode 去掉通用 OpenAI reasoning 参数，由模型默认行为处理；OpenRouter/自定义原有推理参数保持不变。不能保证 OpenCode 所有模型都禁用思考。
- 请求日志只额外记录 session 与应用名称，不记录认证头。其他服务不附带这两个 OpenCode 专用信息。

`lib/model-services.ts` 保存本次核对的模型/协议表，允许去掉用户粘贴的 `opencode/` 前缀。该表是版本化快照，不自动猜测未来模型协议；未知 ID 与 System One 模型明确拒绝，可使用自定义配置。官方公开 `/inference/v1/models` 本次仅返回 ID、object、created、owned_by，没有足够协议元数据，因此未拿它作为自动协议推断依据。模型能否识图仍以服务能力和连接测试结果为准。

数据库通过独立 **v7** 迁移新增可空 `model_profiles.service`，不修改历史迁移校验值。已有配置按精确官方 origin/path 推断服务，保留原地址、协议与密钥；显式自定义配置不自动变成 OpenCode。

## 验证

- `tests/model-services.test.mjs`：四协议路由、Qwen 例外、认证/session隔离、未知模型、Gemini图文/SSE/用量与回退预算。
- `scripts/verify-model-services.mjs`：隔离数据库下通过正式配置API、文本/视觉/流式调用和连接测试，模拟27次HTTP请求，验证重试session稳定、跨题独立、密钥不泄露、租户隔离、v6到v7升级保留配置。无真实付费调用。
- `tests/browser/model-services.spec.mjs`：表单选项、不同必填字段、仅两项保存OpenCode/OpenRouter、编辑切换协议及自定义配置。

未提供可用的 OpenCode Key，本轮没有进行真实 OpenCode 推理或宣称账号鉴权已通过；公开模型目录已实际读取。

本轮结果：201项单元测试通过（其中2项备份测试因沙箱目录权限限制，在正常本机权限下复核通过），27次模拟请求及v6升级验证通过，2项浏览器测试通过，相关ESLint与生产构建通过。构建仍有模型日志动态路径匹配过多文件的既有警告。页面截图：`tmp/opencode-model-settings.png`；所有测试使用隔离数据目录。
