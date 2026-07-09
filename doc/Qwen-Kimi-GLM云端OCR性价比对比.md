# Qwen / Kimi / GLM 云端 OCR 性价比对比

## 背景

Reffo 当前简历分析和生成主要使用 DeepSeek 文本模型，但岗位描述上传图片后需要 OCR / 图片理解能力。由于本地部署 PaddleOCR 需要较强的本机或服务器资源，因此需要评估云端 OCR / 视觉模型作为替代方案。

本次只对比更适合国内接入的三个方向：Qwen、Kimi、GLM。对比重点是 **JD 截图 OCR、中文识别、结构化回填、Bun 后端接入成本和调用成本**。

## 结论摘要

在确认 Reffo 更看重 **低成本、HTTP 直连、同时支持 PDF / 图片、结构化输出** 后，推荐排序调整为：

```text
首选：GLM-OCR
备选：Qwen-OCR
不优先：Kimi Vision
```

| 方案 | 适配度 | 官方价格 | 粗略单张 JD 截图成本 | 优点 | 风险 |
|---|---:|---:|---:|---|---|
| GLM-OCR | 最高 | 输入输出同价 ¥0.2 / 百万 tokens | 官方称约 ¥1 可处理 2000 张 A4 扫描图，即约 ¥0.0005 / 张 | 极便宜；HTTP 直连；专门 OCR；同时支持图片 / PDF；可输出 Markdown / JSON | 需要为 GLM-OCR 单独写 provider adapter，并用真实 JD 截图验证质量 |
| Qwen-VL-OCR latest | 最高 | 输入 ¥0.3 / 百万 tokens，输出 ¥0.5 / 百万 tokens | 约 ¥0.001–0.003 / 张 | 专门 OCR；支持结构化抽取；OpenAI 兼容；Node/Bun 接入顺 | 需要接入阿里云百炼 |
| Qwen3.5-OCR | 很高 | 输入 ¥0.5 / 百万 tokens，输出 ¥2 / 百万 tokens | 约 ¥0.003–0.008 / 张 | 新一代 OCR，官方描述更快更准 | 比 `qwen-vl-ocr-latest` 贵一点 |
| GLM-4V-Plus / GLM-4.1V | 中 | GLM-4V-Plus-0111 ¥4 / 百万 tokens；GLM-4.1V-Thinking-FlashX ¥2 / 百万 tokens | 约 ¥0.01–0.03 / 张 | 通用视觉理解强 | 不是专门 OCR，成本高于 GLM-OCR / Qwen-OCR |
| Kimi Vision | 中 | Moonshot V1 Vision 输入 ¥2–10 / 百万 tokens，输出 ¥10–30 / 百万 tokens；K2.6 国际版 $0.95 输入 / $4 输出 | 约 ¥0.02 起，K2.6 可能更高 | 通用理解强，能直接产 JSON | 不是专门 OCR；图片只支持 base64 或上传文件 ID；单价明显高 |

> 最新决策：Reffo 首选 `GLM-OCR`。它的成本最低，并且同时覆盖 JD 图片 OCR 与 PDF 文档解析；`Qwen-OCR` 保留为兼容 OpenAI 调用方式的备选，Kimi Vision 作为通用视觉理解兜底。

## 为什么最初推荐 Qwen-OCR

最初把 Qwen-OCR 放在首选，是基于“最快接入现有 Bun / OpenAI SDK 调用链”和“JD 图片结构化抽取”两个权重：

- 当前后端已经通过 OpenAI SDK 兼容 DeepSeek，Qwen-OCR 的 OpenAI 兼容接口接入路径更顺。
- 当时优先考虑的是 JD 截图回填，而不是同时覆盖 PDF / 图片。
- Qwen-OCR 明确提供 `key_information_extraction` 等面向结构化抽取的任务类型。
- GLM-OCR 虽然更便宜，但接口形态不是标准 chat completions，需要单独封装 provider，并且我倾向于先用真实 JD 截图实测后再设为默认。

在你明确选择 GLM-OCR 的原因后，排序应调整为 GLM-OCR 优先：它更便宜、HTTP 直连、不需要额外云平台包装，并且同时支持 PDF 和图片解析，更符合 Reffo 当前“一个解析入口覆盖简历 PDF 与 JD 图片”的目标。

## 方案一：Qwen-OCR

### 适配度

Qwen-OCR 是本次最贴近 Reffo JD 截图场景的方案。它不是普通视觉聊天模型，而是专门面向 OCR 和文档信息抽取的模型，支持图片输入并返回识别文本。

适合点：

- 中文 OCR 场景匹配度高。
- 支持 OpenAI 兼容接口，Bun 后端可复用当前 OpenAI SDK 调用方式。
- 支持 `text_recognition`、`advanced_recognition`、`key_information_extraction`、`table_parsing` 等内置任务。
- 可以让模型直接输出岗位名称、公司名称、岗位职责、任职要求等结构化字段。

### 价格

官方价格：

| 模型 | 输入价格 | 输出价格 |
|---|---:|---:|
| `qwen-vl-ocr-latest` | ¥0.3 / 百万 tokens | ¥0.5 / 百万 tokens |
| `qwen3.5-ocr` | ¥0.5 / 百万 tokens | ¥2 / 百万 tokens |

JD 截图通常不是长文档，粗略估算单张成本约：

- `qwen-vl-ocr-latest`：¥0.001–0.003 / 张。
- `qwen3.5-ocr`：¥0.003–0.008 / 张。

实际成本取决于图片分辨率、识别文本长度和输出 JSON 长度。

### 推荐用法

首期可以让后端调用 Qwen-OCR，并要求输出稳定 JSON：

```json
{
  "companyName": "公司名称，无法识别则为空字符串",
  "positionName": "岗位名称，无法识别则为空字符串",
  "jdText": "完整岗位描述正文",
  "responsibilities": ["岗位职责"],
  "requirements": ["任职要求"],
  "rawText": "OCR 原始文本"
}
```

### 风险

- 需要配置阿里云百炼 API Key。
- 需要实测真实招聘 App 截图、网页截图、长截图、低清截图的效果。
- 结构化输出仍需后端做 JSON 解析容错。

## 方案二：GLM-OCR

### 适配度

GLM-OCR 是智谱提供的专业 OCR 能力，定位也是文字识别和文档解析，而不是普通视觉聊天。它支持图片和 PDF，并可输出 Markdown / JSON。

适合点：

- 专门 OCR，适合 JD 截图文本识别。
- 价格非常低。
- 支持 PDF，未来可能顺带覆盖部分文档解析场景。
- 输出可以选择 Markdown 或 JSON，便于前端回填和后续结构化。

### 价格

官方价格：

```text
GLM-OCR：输入输出同价 ¥0.2 / 百万 tokens
```

官方说明中提到，约 ¥1 可以处理 2000 张 A4 扫描图，折算约：

```text
约 ¥0.0005 / 张
```

如果实际 JD 截图识别质量够好，GLM-OCR 可能是性价比最高的方案。

### 风险

- 接口形态更偏 layout parsing，不是标准 OpenAI chat completions，需要单独写 provider adapter。
- 对移动端 JD 截图的识别质量需要实测。
- 如果还需要强语义结构化，可能需要 OCR 后再调用文本 LLM 做二次整理。

### 推荐定位

适合作为 Qwen-OCR 之后的低成本候选：

1. 准备 20–50 张真实 JD 截图样本。
2. 对 Qwen-OCR 和 GLM-OCR 同时跑识别。
3. 对比字段完整率、错字率、段落顺序、职责/要求分段质量。
4. 如果 GLM-OCR 准确率接近 Qwen，则把 GLM-OCR 设为默认，Qwen 作为高质量兜底。

## 方案三：Kimi Vision

### 适配度

Kimi Vision 是通用视觉理解模型，能够识别图片中文字，也能理解截图内容并输出 JSON。但它不是专门 OCR 模型，因此用在“只提取 JD 文本”的场景时，成本和定位都不如 Qwen-OCR / GLM-OCR 精准。

适合点：

- 通用图片理解强。
- 可以直接让模型输出结构化 JSON。
- 如果团队后续已经大量使用 Kimi，接入统一性较好。

### 价格

Kimi Vision 价格跟所选模型推理价格走。参考公开价格：

| 模型 | 输入价格 | 输出价格 |
|---|---:|---:|
| `moonshot-v1-8k-vision-preview` | ¥2 / 百万 tokens | ¥10 / 百万 tokens |
| `moonshot-v1-32k-vision-preview` | ¥5 / 百万 tokens | ¥20 / 百万 tokens |
| `moonshot-v1-128k-vision-preview` | ¥10 / 百万 tokens | ¥30 / 百万 tokens |
| Kimi K2.6 国际版 | $0.95 / 百万输入 tokens | $4 / 百万输出 tokens |

粗略估算单张 JD 截图成本通常约 ¥0.02 起，明显高于 Qwen-OCR / GLM-OCR。

### 风险

- 不是专门 OCR，纯文字识别性价比不高。
- 图片输入形式需要按 Kimi 要求处理，例如 base64 或上传文件 ID。
- 如果 prompt 写得不稳定，可能出现概括、改写或遗漏原文的问题。

### 推荐定位

不建议作为 Reffo JD OCR 首选。更适合以下场景：

- OCR 后需要强语义理解、归纳和判断。
- Qwen / GLM 对复杂截图识别失败时兜底。
- 团队已经有 Kimi API 额度或统一供应商要求。

## 推荐架构

建议把 OCR 能力封装成 provider adapter，而不是在业务代码里绑定某一家供应商。

```text
Taro 前端
  上传 JD 图片
    ↓
Bun 后端 /api/v1/parse/jd-image
    ↓
OcrProvider
  ├─ QwenOcrProvider（首选）
  ├─ GlmOcrProvider（低成本备选）
  └─ KimiVisionProvider（兜底）
    ↓
统一返回 ParseJobDescriptionResult
    ↓
前端回填 companyName / positionName / jdText
```

统一返回结构建议：

```ts
interface ParseJobDescriptionResult {
  provider: 'qwen' | 'glm' | 'kimi'
  companyName: string
  positionName: string
  jdText: string
  rawText: string
  confidence?: number
  warnings: string[]
}
```

## 推荐接入顺序

### 第 1 步：接 GLM-OCR

原因：

- 成本最低。
- HTTP 直连，后端接入不需要额外平台包装。
- 同时支持图片和 PDF，能统一覆盖 JD 截图 OCR 与简历 PDF 解析。
- 支持 Markdown / JSON 输出，便于回填表单和保存原始解析结果。

### 第 2 步：保留 Qwen-OCR 作为备选

原因：

- OpenAI 兼容接口接入体验好。
- 如果 GLM-OCR 在某些截图上质量不稳定，可作为高质量兜底。
- 可用于对比结构化抽取质量。

### 第 3 步：Kimi Vision 作为兜底

原因：

- 通用理解能力好。
- 但 OCR 单价和定位不如专用 OCR 模型。
- 适合处理疑难截图或做二次语义整理。

## 验收指标

建议准备一组真实 JD 截图样本进行对比，至少覆盖：

- 招聘网站截图。
- 移动 App 截图。
- 长截图。
- 低清晰度截图。
- 白底 / 深色模式截图。
- 包含公司名、岗位名、职责、要求、薪资、地点的混合截图。

对比指标：

| 指标 | 说明 |
|---|---|
| 文字完整率 | 是否漏掉岗位职责、任职要求、公司介绍等关键段落 |
| 错字率 | 中文错字、英文技术词、数字和符号是否准确 |
| 段落顺序 | 职责和要求是否保持原始顺序 |
| 字段抽取率 | 公司名、岗位名、薪资、地点是否能稳定抽取 |
| JSON 稳定性 | 是否能稳定返回可解析 JSON |
| 单张耗时 | 上传到返回的端到端耗时 |
| 单张成本 | 基于 token 账单估算真实调用成本 |

## 最终建议

Reffo 当前最合理的方案是：

```text
默认：GLM-OCR
备选：Qwen-VL-OCR latest
兜底：Kimi Vision
```

原因：

- GLM-OCR 成本最低，并且同时支持 PDF 和图片，更适合作为统一解析能力入口。
- Qwen-OCR 在 OpenAI 兼容调用和结构化任务类型上仍有优势，适合作为备选。
- Kimi Vision 更偏通用视觉理解，不适合只做 OCR 的默认方案。

## 资料来源

- Qwen-OCR API 文档：支持 OpenAI 兼容接口、Node.js 示例、图片 OCR 与结构化抽取。https://help.aliyun.com/en/model-studio/qwen-vl-ocr-api-reference
- Qwen 模型价格：包含 `qwen-vl-ocr-latest` 和 `qwen3.5-ocr` 输入 / 输出价格。https://help.aliyun.com/en/model-studio/model-pricing
- GLM-OCR 文档：专业 OCR，支持图片 / PDF，支持 Markdown / JSON 输出，价格 ¥0.2 / 百万 tokens。https://docs.bigmodel.cn/cn/guide/models/vlm/glm-ocr
- GLM 模型价格：包含 GLM-4V-Plus、GLM-4.1V-Thinking-FlashX 等视觉模型价格。https://open.bigmodel.cn/pricing
- Kimi Vision 使用文档：支持图片中文字理解和视觉问答。https://platform.kimi.ai/docs/guide/use-kimi-vision-model
- Kimi 价格文档：包含 Moonshot V1 Vision 与 Kimi K 系列模型价格。https://platform.kimi.com/docs/pricing/chat-v1
