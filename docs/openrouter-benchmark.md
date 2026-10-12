# OpenRouter 整卷识别对比

`scripts/benchmark-openrouter.mjs` 用真实应用的整卷识别、流式解析、题目落库和收尾校验来测试模型；HTTP 200 本身不算通过。它不修改模型提示词、解析器或题目处理逻辑。

## 使用

先取得用户对模型、试卷和付费调用的授权。把配置放在 Git 忽略的 `tmp` 目录，使用本机已有的 OpenRouter Chat Completions 配置 ID，不在配置中填写明文密钥：

```json
{
  "sourceData": "C:/absolute/path/to/project/data",
  "outputData": "C:/absolute/path/to/project/tmp/benchmark-new-run",
  "localApi": "http://127.0.0.1:3050",
  "ownerId": "local-demo",
  "keyProfileId": "existing-openrouter-profile-id",
  "concurrency": 2,
  "models": ["provider/model-a", "provider/model-b"],
  "documents": [{ "id": "existing-document-id", "label": "试卷 A" }]
}
```

在项目根目录运行：

```powershell
node --import ./server/register.mjs --import tsx scripts/benchmark-openrouter.mjs prepare tmp/benchmark-config.json
node --import ./server/register.mjs --import tsx scripts/benchmark-openrouter.mjs run tmp/benchmark-config.json
node --import ./server/register.mjs --import tsx scripts/benchmark-openrouter.mjs billing tmp/benchmark-config.json
```

`prepare` 查询 OpenRouter 当前模型目录并检查图片输入能力，复用现有密钥，通过本机 API 添加缺少的配置，保留原来选中的模型。随后用 SQLite backup 创建独立数据库快照，复制指定原卷和页面图片并记录 SHA-256。快照保留原应用标签、教学 Skill 和设置，使测试输入与软件一致。它包含原数据库和加密密钥，必须留在本机忽略目录，不能提交 Git。

`run` 只使用隔离目录，在其中为每个模型/试卷组合创建新文档。原库不新增测试题目、不变更审核状态、不重新启动原队列。每组只执行一次完整流程，同时最多两组；不调用队列自动重试，但保留应用原有 HTTP 参数兼容回退。三张卷子、六个模型意味着 18 次流程，兼容回退可能增加 HTTP 请求数。输出目录或结果文件已存在时拒绝覆盖/重复调用，避免意外重复计费；中断后请先查看证据再决定是否另建测试。

## 结果解释

`billing` 只能在测试完成后运行。它读取本轮 generation ID，使用 [OpenRouter generation 元数据接口](https://openrouter.ai/docs/api/api-reference/generations/get-generation) 查询账单，补充因为中途格式错误取消流而缺少的 usage 费用，不再生成题目。查不到费用时仍保留未知；可重复查询未成功的记录。

- `results.json`：实时汇总通过/失败、题数、耗时、错误、模型调用 trace ID、OpenRouter 返回的 usage 和费用。
- `benchmark.json`：测试配置、模型目录和当时价格、原卷与页面哈希。
- `model-traces/`：请求（图片内容用哈希替代）、原始流、输出、传输结果、结构校验结果。保留在本机，不能将题目、原卷或原始响应发布到 GitHub。
- `inputHash`：去掉模型 ID 后的请求内容哈希。同一卷不同模型应一致；如不一致，先分析差异再声称输入完全相同。
- `passed`：现有识别和收尾校验全部成功；`failed`：应用处理失败；`harness_error`：测试工具异常，应单独排查，不归因于模型。
- 费用使用 OpenRouter usage 的美元金额，不使用软件中可能未配置的人民币估价。响应未给出费用时为 `null`，不能按免费处理。拒绝请求的零费用仅表示未观测到生成用量，最终账单以 OpenRouter 为准。

一次三卷全通过只是当前路由、负载和输入下的样本结果，不代表永不出错。结构通过也不等于题干、数学公式、答案和配图全部正确；采用前仍应抽查题目质量。

## 后续方向（本次不改解析器）

1. 扩大到不同页数、扫描质量、学科和复杂公式的固定样本集，重复采样比较稳定性。
2. 用人工核验数据量化漏题、题干/答案准确率、公式和配图质量，避免只以接口可用判断优劣。
3. 单独评估上游限流、共享池过载、输出格式错误的比例；模型质量与服务商稳定性分开记录。
4. 需要重试、备用路由或输出修复时另做实验，不将修复后的结果混入本轮原始成功率。
5. 自动汇总 OpenRouter 实际费用、缓存命中和分档价格，按成功完成的整卷比较成本。
