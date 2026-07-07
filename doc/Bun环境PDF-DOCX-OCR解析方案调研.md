# Bun 环境 PDF / DOCX / OCR 解析方案调研

## 背景

当前创建流程里，上传简历页已经允许用户选择 `.pdf`、`.doc`、`.docx`、`.md`、`.txt` 文件，但实际只有 `.md` 和 `.txt` 会在前端读取文本；PDF / DOC / DOCX 目前会生成一个占位 Markdown。岗位描述页支持上传 `.png`、`.jpg`、`.jpeg`、`.webp` 图片，但目前只记录附件名称和大小，不会做 OCR，也不会把图片中的 JD 文本回填到表单。

这份文档调研在 Bun 后端环境下可用的 PDF、DOCX、OCR 解析库或工具，并给出推荐落地方案。

## 当前代码现状

| 模块 | 现状 | 代码位置 |
|---|---|---|
| 简历上传支持类型 | UI 允许 `.pdf`、`.doc`、`.docx`、`.md`、`.txt` | `frontend/Taro/reffo-taro/src/pages/create/types.ts:106` |
| 简历文本读取 | 只有 `.md` 和 `.txt` 会读取文本 | `frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts:64` |
| 非文本简历处理 | PDF / DOC / DOCX 走占位 Markdown | `frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts:679` |
| 占位 Markdown | 使用文件名生成“上传了文件”的简历占位内容 | `frontend/Taro/reffo-taro/src/pages/create/utils/resumeMarkdown.ts:67` |
| JD 图片支持类型 | 支持 `.png`、`.jpg`、`.jpeg`、`.webp` | `frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts:65` |
| JD 图片解析 | 只保存附件元信息，不做 OCR | `frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts:794` |
| JD 请求内容 | 上传模式只拼接“岗位描述附件：xxx”和兜底说明 | `frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts:319` |

## 结论摘要

> ✅ 推荐优先在后端新增解析能力，不建议把 PDF / DOCX / OCR 解析直接放到 Taro 前端。前端负责上传和回填，后端负责文件解析、大小限制、超时、错误码和隐私日志控制。

推荐组合：

| 场景 | 首选方案 | 备选方案 | 不推荐点 |
|---|---|---|---|
| PDF 文本解析 | `unpdf` | `pdf-parse` v2、Poppler `pdftotext` | 不建议前端用 PDF.js 直接解析真实简历，包体和兼容成本较高 |
| DOCX 文本解析 | `mammoth` | Apache Tika Server、LibreOffice 转换 | `.doc` 老格式不建议用纯 JS 硬解析 |
| DOC 老格式 | 暂时明确不支持或转人工提示 | LibreOffice / Tika Server | 纯 JS 生态支持弱，稳定性和安全边界较差 |
| JD 图片 OCR | MVP 可用 `tesseract.js` | PaddleOCR 服务、系统 Tesseract CLI | 纯前端 OCR 包体大，中文截图准确率不稳定 |
| 高准确中文 OCR | PaddleOCR 独立服务 | 云 OCR / 模型服务 | 引入 Python/服务部署成本 |
| 全格式文档抽取 | Apache Tika Server | 自建解析服务 | 服务较重，需要沙箱和资源限制 |

## PDF 解析方案

### 方案 A：`unpdf`（推荐）

`unpdf` 是基于 PDF.js 的工具库，定位是跨运行时 PDF 解析，覆盖 Node、Bun、Deno 和浏览器。它适合在 Bun 后端中作为首选 PDF 文本抽取库。

优点：

- 明确支持 Bun 运行时，和当前后端技术栈匹配。
- API 面向文本抽取，接入成本低。
- 基于 PDF.js，常规文本型 PDF 支持较好。
- 不依赖系统二进制，部署相对简单。

风险：

- 扫描版 PDF 本身没有文本层，需要 OCR 才能解析。
- 复杂 PDF 排版还原能力有限，抽取结果可能乱序。
- 简历中表格、双栏、图标和页眉页脚需要后续清洗。

适合用法：

```ts
import {extractText, getDocumentProxy} from 'unpdf'

const pdf = await getDocumentProxy(new Uint8Array(buffer))
const {text, totalPages} = await extractText(pdf, {mergePages: true})
```

### 方案 B：`pdf-parse` v2（可验证后作为备选）

`pdf-parse` 是 Node 生态里常见的 PDF 文本解析库，新版本提供 `PDFParse` 类，适合 Node 风格后端。它在 Bun 下大概率可以运行，但建议在本仓库实际安装并跑样例 PDF 验证后再定。

优点：

- 使用者多，资料较多。
- API 简单，适合快速抽取文本。

风险：

- Bun 兼容需要实测确认。
- 不同版本 API 差异较大，依赖锁定要谨慎。
- 同样不能处理扫描版 PDF。

### 方案 C：Poppler `pdftotext`（生产备选）

Poppler 的 `pdftotext` 是成熟命令行工具，适合对抽取质量和性能有更高要求的服务端环境。

优点：

- 工具成熟稳定。
- 大文件和复杂 PDF 处理能力通常不错。
- 可以通过进程超时和资源隔离控制风险。

风险：

- 依赖系统安装 Poppler，部署复杂度高。
- 需要处理不同系统路径和容器镜像依赖。
- 通过子进程调用要特别注意超时、临时文件清理和错误码。

## DOCX / DOC 解析方案

### 方案 A：`mammoth`（推荐 DOCX）

`mammoth` 专注把 `.docx` 转为 HTML 或提取原始文本。对简历场景而言，首期可以使用 `extractRawText` 直接拿纯文本。

优点：

- 纯 JS，适合 Bun 后端尝试接入。
- 对 `.docx` 支持成熟。
- 可提取原始文本，也可转 HTML 后再做结构化处理。

风险：

- 不支持老 `.doc` 二进制格式。
- 不会严格保留复杂视觉排版。
- 从不可信文档生成 HTML 时要注意消毒；本项目首期建议只取 raw text。

适合用法：

```ts
import mammoth from 'mammoth'

const result = await mammoth.extractRawText({buffer})
const text = result.value
const warnings = result.messages
```

### 方案 B：Apache Tika Server（全格式备选）

Apache Tika 能识别并抽取 PDF、DOC、DOCX、PPT、图片等多种文件的文本和元数据，适合作为独立解析服务。

优点：

- 格式覆盖全面，包括 `.doc` 老格式。
- 可作为独立服务，不污染 Bun 进程。
- 后续如果文档类型变多，扩展成本低。

风险：

- 服务较重，引入 Java 运行时。
- 需要容器化部署、资源限制和安全隔离。
- 调试和运维成本高于单个 JS 包。

### 方案 C：LibreOffice headless（DOC 兜底）

可通过 LibreOffice 无头模式把 `.doc` 转 `.docx` 或文本，再交给 `mammoth` 或直接读取。

优点：

- 对老 Office 格式兼容性强。
- 可作为离线批处理或后端服务兜底。

风险：

- 依赖重，启动慢。
- 子进程和临时文件管理复杂。
- 不适合直接放在轻量 Bun API 进程内。

## OCR 解析方案

### 方案 A：`tesseract.js`（MVP 可用）

`tesseract.js` 是 Tesseract OCR 的 JS/WASM 版本，可在 Node 和浏览器中运行。用于 MVP 验证“JD 图片 OCR 后回填”比较合适。

优点：

- JS 生态，接入门槛低。
- 可运行在后端，也可在浏览器端运行。
- 不依赖额外 Python 服务。

风险：

- 中文 JD 截图准确率受图片质量影响较大。
- 首次加载语言包和 WASM 资源较重。
- 在前端使用会增加包体和设备负担，因此更建议放后端。

适合策略：

- 首期后端 OCR，只返回纯文本。
- 语言优先使用 `chi_sim+eng`。
- 对图片做基础预处理：限制尺寸、压缩、灰度化或增强对比度。
- OCR 失败时允许用户继续手动编辑 JD。

### 方案 B：系统 Tesseract CLI / `node-tesseract-ocr`

如果部署环境能安装 Tesseract 二进制，可以用 CLI 或 Node wrapper 调用。

优点：

- 相比 WASM，服务端性能和资源占用可能更可控。
- 语言包管理清晰。

风险：

- 需要部署系统依赖和语言包。
- 在不同环境安装路径可能不同。
- 仍然需要图片预处理提升中文准确率。

### 方案 C：PaddleOCR（推荐高准确中文 OCR）

PaddleOCR 对中文 OCR 更友好，适合后续提高 JD 截图解析质量。建议作为独立 Python 服务或 sidecar，而不是直接塞进 Bun 进程。

优点：

- 中文识别准确率通常优于通用 Tesseract。
- 支持文本检测、方向分类和识别完整链路。
- 对移动端截图、网页截图这类场景更有优势。

风险：

- Python / 模型 / 推理环境更重。
- 服务部署、模型缓存和资源隔离成本更高。
- 需要额外接口或队列承载异步 OCR。

## 前后端落地建议

### 推荐新增后端接口

```text
POST /api/v1/parse/resume-file
Content-Type: multipart/form-data
file: PDF / DOCX / TXT / MD

返回：
{
  "success": true,
  "data": {
    "fileName": "resume.pdf",
    "fileType": "pdf",
    "text": "抽取后的纯文本...",
    "markdown": "转换后的 Markdown...",
    "warnings": []
  }
}
```

```text
POST /api/v1/parse/jd-image
Content-Type: multipart/form-data
file: PNG / JPG / JPEG / WEBP

返回：
{
  "success": true,
  "data": {
    "fileName": "jd.png",
    "text": "OCR 识别出的岗位描述...",
    "structured": {
      "companyName": "可选",
      "positionName": "可选",
      "jdText": "可选"
    },
    "warnings": []
  }
}
```

接口职责建议：

- 路由层只处理上传、校验、错误码和响应格式。
- 解析逻辑放到 `backend/src/services/` 或 `backend/src/agents/parse-*`，不要堆在路由里。
- 文件大小沿用前端 10MB 限制，后端也必须重复校验。
- 所有解析都设置超时，避免 PDF / OCR 卡死请求。
- 日志不要输出完整简历或完整 JD 文本，只记录文件名、类型、大小、耗时和错误摘要。

### 推荐前端改造

简历上传：

1. `.md` / `.txt` 可以继续前端读取，也可以统一交给后端解析。
2. `.pdf` / `.docx` 上传到 `/api/v1/parse/resume-file`。
3. 成功后把后端返回的 `markdown` 写入 `resumeUploadState.markdown`。
4. 失败时展示“解析失败，可上传文本版或手动粘贴”，不要再静默生成占位简历。
5. `.doc` 建议先从可选类型中移除，或明确提示“暂不支持老版 Word，请另存为 DOCX”。

JD 图片上传：

1. 图片上传到 `/api/v1/parse/jd-image`。
2. 成功后把 OCR 文本回填到 `jobDescriptionState.content`。
3. 如果后端能结构化出公司名和岗位名，则同步回填 `companyName` 和 `positionName`。
4. 保留图片预览和附件信息，方便用户核对。
5. OCR 结果必须允许用户编辑，不能直接不可见地进入生成流程。

## 推荐实施路线

### 第 1 阶段：纯文本能力闭环

- 后端新增 `parse` 路由。
- PDF 使用 `unpdf`。
- DOCX 使用 `mammoth.extractRawText`。
- TXT / MD 使用普通文本读取。
- `.doc` 暂时返回明确错误。
- 前端接入简历解析接口并回填 Markdown。

验收标准：

- 上传 PDF 简历后，生成流程实际使用抽取文本。
- 上传 DOCX 简历后，生成流程实际使用抽取文本。
- 上传 `.doc` 时给出清晰提示，不进入假成功状态。

### 第 2 阶段：JD 图片 OCR MVP

- 后端新增 JD 图片 OCR 接口。
- 先用 `tesseract.js` 验证端到端体验。
- OCR 文本回填到 JD 文本框。
- 用户可编辑 OCR 结果再点击生成。

验收标准：

- 上传 JD 截图后能看到识别文本。
- 识别失败时能回到手动输入，不阻断流程。
- 生成请求中的 `jdContent` 包含 OCR 后文本，而不是只有附件名称。

### 第 3 阶段：中文 OCR 质量增强

- 对比 `tesseract.js` 与 PaddleOCR 的中文 JD 截图准确率。
- 如果 Tesseract 准确率不足，把 OCR 独立成 PaddleOCR sidecar。
- 增加图片预处理和识别置信度提示。
- 可选：用 LLM 对 OCR 文本结构化公司、岗位、职责、要求。

## 安全和稳定性注意事项

- 文件上传必须限制大小、扩展名和 MIME 类型。
- 不要信任前端传来的文件类型，后端要二次判断。
- 解析临时文件要放在安全临时目录，完成后清理。
- PDF、Office 文档和图片解析都要设置超时。
- 不要在日志中输出完整简历、完整 JD、手机号、邮箱等隐私内容。
- 对生成 HTML 的库要谨慎；首期只返回纯文本或 Markdown，避免 XSS。
- OCR 和文档解析失败要返回可恢复错误，让用户能手动粘贴文本继续。

## 依赖建议

首期建议新增：

```bash
cd backend
bun add unpdf mammoth
```

如果选择 OCR MVP：

```bash
cd backend
bun add tesseract.js
```

如果选择系统 OCR 或生产高准确方案，不建议直接新增 JS 依赖，而是新增独立服务或部署依赖：

- Tesseract CLI：系统安装 `tesseract` 和中文语言包。
- PaddleOCR：独立 Python 服务或容器。
- Tika Server：独立 Java 服务或容器。

## 资料来源

- `unpdf`：GitHub 项目说明，支持 Node、Bun、Deno、浏览器，并提供 PDF 文本抽取能力。https://github.com/unjs/unpdf
- `mammoth`：GitHub / npm 项目说明，支持 `.docx` 转 HTML 和 `extractRawText`。https://github.com/mwilliamson/mammoth.js
- `tesseract.js`：GitHub 项目说明，提供浏览器和 Node.js OCR。https://github.com/naptha/tesseract.js
- `pdf-parse`：npm / GitHub 项目说明，提供 PDF 文本抽取能力，新版本使用 `PDFParse`。https://github.com/mehmet-kozan/pdf-parse
- PaddleOCR：PaddlePaddle 官方 OCR 项目，覆盖多语言文本检测与识别。https://github.com/PaddlePaddle/PaddleOCR
- Apache Tika：官方项目说明，用于文档内容和元数据抽取。https://tika.apache.org/
- Poppler `pdftotext`：Poppler 工具集中的 PDF 文本抽取命令。https://poppler.freedesktop.org/
