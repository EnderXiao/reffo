# GLM-OCR 接入 TODO

## 决策结论

Reffo 的 OCR / 文档解析能力确定优先使用 **GLM-OCR**。

选择原因：

- 成本更低：官方价格为输入输出同价 ¥0.2 / 百万 tokens。
- HTTP 直连：不需要本机部署 PaddleOCR，也不需要额外接入其他平台包装层。
- 能力覆盖更完整：同时支持 PDF 和图片解析，适合统一覆盖“简历 PDF 解析”和“JD 图片 OCR”。
- 支持结构化输出：可以输出 Markdown / JSON，便于前端回填和后续生成流程使用。
- Benchmark 表现有优势：官方 benchmark 中优于 DeepSeekOCR2 和 GPT-5.2 等对比项。

## 设计原则

不要让前端或业务代码直接依赖 GLM-OCR 原始响应格式。后端需要增加 OCR Provider 适配层，把 GLM-OCR 响应归一化成 Reffo 自己的业务结构。

推荐结构：

```text
GLM-OCR HTTP 原始响应
  ↓
GlmOcrProvider 适配层
  ↓
统一内部结构 ParsedDocumentResult / ParsedJobDescriptionResult
  ↓
parse 路由返回 ApiResponse
  ↓
Taro 前端回填简历 Markdown 或 JD 表单
```

不建议把 GLM-OCR 强行包装成完整 OpenAI SDK 格式。OpenAI SDK 更适合聊天模型，OCR / PDF / layout parsing 更适合归一化到项目自己的领域模型。

## 后端 TODO

### 1. 新增 OCR 类型定义

建议文件：`backend/src/services/ocr/types.ts`

- [x] 定义 `OcrProvider` 接口。
- [x] 定义 `ParseDocumentInput`。
- [x] 定义 `ParsedDocumentResult`。
- [x] 定义 `ParsedJobDescriptionResult`。
- [x] 定义统一 `OcrUsage`，用于记录 tokens、耗时、成本估算。
- [x] 定义统一错误类型，例如 `OcrProviderError`。

建议类型草案：

```ts
export interface OcrProvider {
  parseDocument(input: ParseDocumentInput): Promise<ParsedDocumentResult>
}

export interface ParseDocumentInput {
  fileName: string
  mimeType: string
  fileType: 'pdf' | 'image'
  buffer: ArrayBuffer
  purpose: 'resume' | 'jobDescription'
}

export interface ParsedDocumentResult {
  provider: 'glm-ocr'
  fileName: string
  fileType: 'pdf' | 'image'
  rawText: string
  markdown?: string
  structured?: ParsedJobDescriptionResult
  usage?: OcrUsage
  warnings: string[]
}

export interface ParsedJobDescriptionResult {
  companyName: string
  positionName: string
  jdText: string
  responsibilities: string[]
  requirements: string[]
}

export interface OcrUsage {
  inputTokens?: number
  outputTokens?: number
  costCny?: number
  latencyMs?: number
}
```

### 2. 新增 GLM-OCR Provider

建议文件：`backend/src/services/ocr/glm-ocr-provider.ts`

- [x] 封装 GLM-OCR HTTP 调用。
- [x] 支持图片输入。
- [x] 支持 PDF 输入。
- [x] 支持设置输出格式：Markdown / JSON。
- [x] 将 GLM-OCR 原始响应转成 `ParsedDocumentResult`。
- [x] 统一处理超时、限流、鉴权失败、文件格式不支持等错误。
- [x] 记录 `provider`、耗时、tokens 和成本估算。
- [x] 日志中只记录文件名、类型、大小、耗时和错误摘要，不输出完整简历 / JD 内容。

### 3. 新增 OCR 配置

建议文件：`backend/src/config/env.ts`

- [x] 新增 `GLM_OCR_API_KEY`。
- [x] 新增 `GLM_OCR_BASE_URL`。
- [x] 新增 `GLM_OCR_MODEL`。
- [x] 新增 `OCR_TIMEOUT_MS`。
- [x] 新增 `OCR_MAX_FILE_SIZE_MB`，默认可先沿用 10MB。
- [x] 同步更新 `backend/.env.example`。

建议环境变量：

```bash
GLM_OCR_API_KEY=
GLM_OCR_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_OCR_MODEL=glm-ocr
OCR_TIMEOUT_MS=30000
OCR_MAX_FILE_SIZE_MB=10
```

实际 `baseUrl` 和请求路径以 GLM-OCR 官方接口文档为准，实现前需再次确认。

### 4. 新增解析路由

建议文件：`backend/src/routes/parse.ts`

- [x] 新增 `POST /api/v1/parse/resume-file`。
- [x] 新增 `POST /api/v1/parse/jd-image`。
- [x] 路由使用 `ApiResponse<T>` 统一响应格式。
- [x] 校验文件大小。
- [x] 校验扩展名和 MIME 类型。
- [x] 捕获 OCR 错误并返回可理解错误信息。
- [x] 在 `backend/src/index.ts` 注册 parse 路由。

推荐响应结构：

```json
{
  "success": true,
  "data": {
    "provider": "glm-ocr",
    "fileName": "jd.png",
    "fileType": "image",
    "rawText": "OCR 原始文本",
    "markdown": "可选 Markdown",
    "structured": {
      "companyName": "公司名",
      "positionName": "岗位名",
      "jdText": "完整 JD 文本",
      "responsibilities": [],
      "requirements": []
    },
    "warnings": []
  }
}
```

### 5. 简历 PDF 解析逻辑

- [x] PDF 简历上传后调用 `parse/resume-file`。
- [x] 后端用 GLM-OCR 提取 PDF 文本或 Markdown。
- [x] 返回给前端后写入 `resumeUploadState.markdown`。
- [x] 如果 PDF 是扫描版，也依赖 GLM-OCR 完成 OCR。
- [x] 解析失败时不要生成占位简历，应提示用户上传文本版或手动粘贴。

### 6. JD 图片解析逻辑

- [x] JD 图片上传后调用 `parse/jd-image`。
- [x] 后端用 GLM-OCR 解析图片。
- [x] 尽量输出 `companyName`、`positionName`、`jdText`、`responsibilities`、`requirements`。
- [x] 前端回填公司名、岗位名和 JD 文本。
- [x] OCR 结果必须允许用户编辑。
- [x] 生成请求中的 `jdContent` 应包含 OCR 文本，而不是只有“岗位描述附件：xxx”。

## 前端 TODO

### 1. 新增解析 API service

建议文件：`frontend/Taro/reffo-taro/src/services/parse.ts`

- [x] 新增 `parseResumeFile(file)`。
- [x] 新增 `parseJobDescriptionImage(file)`。
- [x] 统一处理 `RequestError`。
- [x] 复用现有 `ApiClient` 和 base URL 配置。

### 2. 改造简历上传

涉及文件：`frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts`

- [x] `.md` / `.txt` 可继续前端读取。
- [x] `.pdf` 调用后端 `parse/resume-file`。
- [x] `.docx` 如仍要支持，需要决定是否走 GLM-OCR 或另接 DOCX 文本解析。
- [x] `.doc` 建议先移除或提示“暂不支持老版 Word，请另存为 DOCX / PDF”。
- [x] 删除或减少 PDF / DOCX 成功时的占位 Markdown 逻辑。
- [x] 解析失败时展示明确错误，不进入假成功。

### 3. 改造 JD 图片上传

涉及文件：`frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts`

- [x] 图片选择成功后调用后端 `parse/jd-image`。
- [x] 上传 / 解析过程中显示 loading 状态。
- [x] 解析成功后设置 `jobDescriptionState.content`。
- [x] 如果返回公司名和岗位名，同步设置 `companyName` 和 `positionName`。
- [x] 保留附件预览和文件名，便于用户核对。
- [x] 允许用户修改 OCR 结果。

### 4. 更新测试

建议文件：`frontend/Taro/reffo-taro/src/pages/create/__tests__/index.test.tsx`

- [ ] 新增 PDF 简历解析成功用例。
- [ ] 新增 PDF 简历解析失败用例。
- [ ] 新增 JD 图片 OCR 成功并回填用例。
- [ ] 新增 JD 图片 OCR 失败后手动输入兜底用例。
- [ ] 调整现有“岗位描述附件：jd-shot.png”相关断言，确保生成请求使用 OCR 文本。

## 安全与隐私 TODO

- [x] 文件大小限制前后端都要做。
- [x] 后端不要信任前端传来的扩展名和 MIME 类型。
- [x] 上传文件只用于即时解析，不默认落盘持久化。
- [x] 如果使用临时文件，解析完成后必须清理。
- [x] 日志禁止输出完整简历、完整 JD、手机号、邮箱等敏感内容。
- [x] OCR 请求设置超时。
- [x] OCR 失败返回可恢复错误，允许用户手动粘贴继续流程。
- [ ] 如未来上线，需要在隐私说明中告知“上传文件会发送到 GLM-OCR 服务进行解析”。

## 验收 TODO

### 样本准备

- [ ] 准备 5 份文本型 PDF 简历。
- [ ] 准备 5 份扫描版 PDF 简历。
- [ ] 准备 10 张移动端 JD 截图。
- [ ] 准备 10 张网页 JD 截图。
- [ ] 准备 5 张长截图。
- [ ] 准备 5 张低清晰度或压缩截图。

### 验收指标

- [ ] PDF 简历能提取出姓名、工作经历、项目经历、技能关键词。
- [ ] JD 图片能提取出岗位名、公司名、职责、要求。
- [ ] OCR 文本不会明显乱序。
- [x] 前端回填后用户可以编辑。
- [x] 生成请求中包含真实 OCR 文本。
- [x] 解析失败时用户能继续手动输入。
- [ ] 单张图片解析耗时可接受。
- [x] 单次调用成本可记录或估算。

## 推荐实施顺序

```text
1. 后端增加 OcrProvider 类型和 GLM-OCR provider
2. 后端增加 parse 路由和环境变量
3. 前端增加 parse service
4. 改造 JD 图片上传并回填 OCR 文本
5. 改造 PDF 简历上传并回填 Markdown
6. 补充前后端测试
7. 用真实样本验收并记录准确率 / 耗时 / 成本
```

## 待确认问题

- [x] GLM-OCR 官方 HTTP 请求体、鉴权 header、文件上传方式和响应字段。
- [x] GLM-OCR 对 PDF 页数和文件大小的限制。
- [x] GLM-OCR 是否原生支持 `.docx`，如果不支持，DOCX 是否继续用 `mammoth`。
- [x] 是否移除 `.doc` 上传支持，避免用户误以为老版 Word 可解析。
- [x] 是否需要保存 OCR 原始 Markdown 作为调试字段。
- [ ] 是否需要增加 provider fallback，例如 GLM-OCR 失败后允许切 Qwen-OCR。
