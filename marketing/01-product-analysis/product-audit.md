# Reffo 产品与传播审计

> 审计日期：2026-08-15  
> 审计口径：以当前工作区源代码和本地实际运行结果为准；README、需求或示例数据只作为辅助证据。  
> 结论用途：为后续运营策略、品牌、内容、海报和视频制作建立事实底座，不代表法律意见或上线验收报告。

## 一、审计范围与证据规则

本次已扫描仓库全量文件，并重点逐段审阅了以下主链路：

- 根目录、后端、MVP Web 与 Taro 前端的 README、配置和启动脚本。
- 后端 72 个 TypeScript 文件中的路由、Agent、工作流、Prompt、质量评估、OCR、鉴权与持久化实现。
- Taro 前端 257 个源码文件中的 7 个页面路由、创建与结果页模型、首页卡片组件、服务层、Zustand store、跨端存储和视觉分级。
- 28 个现有品牌、首页、创建、结果和消息类视觉资源；重点查看了 Reffo Logo 和首页卡片纹理。
- 早期 MVP Web 的 4 个源文件，用于区分旧演示版与当前 Taro 主产品。
- 埋点/监控关键词与依赖：未发现面向用户行为的 Analytics SDK 或事件上报；后端 Harness 属于 Agent 技术运行观测，不是运营埋点。

证据分为四级：

1. **运行确认**：本地 H5 页面真实可见，或接口健康检查返回 200。
2. **源码确认**：存在完整调用链或具体实现，但本次没有触发可能产生数据或模型费用的操作。
3. **条件能力**：依赖外部 API、登录、浏览器能力或特定环境配置。
4. **文档/规划**：README 或配置中出现，但当前实现、验证或上线条件不完整，不可按“已上线”宣传。

### 本次实际运行结果

- Taro H5：`http://localhost:10086/` 返回 200。
- 后端：`GET http://127.0.0.1:3000/api/v1/mvp/health` 返回 200。
- 已只读查看：落地/教程页、首页卡片堆、源简历输入页、岗位描述页、结果页的“岗位分析 / 最佳简历 / 面试建议”三个内容区、完成页、登录页。
- 真实页面确认了卡片堆、分步输入、结果分栏、Markdown 下载入口、完成庆祝动效和 AI 内容提示。
- 页面运行期间只看到既有 `webpackExports` 编译警告，没有把它判定为启动失败。
- 当前工作区的 `backend/src/prompts/prompts.ts:3-7` 引用了缺失的 `backend/src/prompts/v42-prompts.ts`。本次健康检查来自已经运行的兼容服务；当前 checkout 尚不具备“从干净工作区可重复启动后端”的完整证据。因此只能证明本机当前服务可用，不能据此宣称生产已就绪。

## 二、产品定位

### 一句话定位

Reffo 是一款以“一个岗位，一份简历”为核心的 AI 求职材料工作台：用户提供源简历和目标岗位描述，系统完成简历分析、岗位匹配、针对性重写和面试准备，并把不同岗位的结果保存为可回看的卡片。

源码依据：

- 根 README 将产品描述为“从工作履历到一岗一简历”的 AI Agent 服务：`README.md:1-3`。
- 首页核心文案为“一个岗位，一份简历”：`frontend/Taro/reffo-taro/src/pages/index/constants/content.ts:5-15`。
- Taro 主链路已经串起源简历、JD、生成、保存和回首页：`README.md:21-28`。
- 后端完整工作流覆盖分析、JD 解析、匹配、生成、质量门禁、修订和面试建议：`backend/README.md:67-86`、`backend/src/workflows/resume-optimization-workflow.ts:92-228`、`435-512`。

### 产品边界

Reffo 当前是“求职材料生成与准备工具”，不是：

- 招聘网站、职位搜索引擎或职位推荐系统；
- 自动投递、代投或申请跟踪系统；
- 由人工顾问交付的一对一简历服务；
- 能保证 ATS 通过、面试机会、录用或薪资结果的服务；
- 完整的在线排版模板市场。目前主要交付物是可编辑、可下载的 Markdown 简历。

仓库中没有职位抓取、招聘平台连接、自动投递、ATS 实测、人工顾问派单或求职结果追踪代码，因此以上能力均不得暗示已经存在。

## 三、核心功能与完整用户流程

| 阶段 | 用户动作 | 系统实际行为 | 当前输出 | 主要依据 |
|---|---|---|---|---|
| 0. 初次进入 | 查看教程，选择预设简历/上传简历与示例/自定义岗位 | 落地页用卡片队列、文件夹和岗位卡片引导进入创建流程 | 创建页草稿 | `frontend/Taro/reffo-taro/src/pages/landing/index.tsx:731-795`、`971-1020`；运行确认 |
| 1. 建立源简历 | 粘贴文本，或上传文件 | MD/TXT 本地读取；PDF 发送 OCR；内容保存为最新源简历 | 源简历摘要 | `frontend/Taro/reffo-taro/src/utils/resume-file-upload.ts:84-169`；`frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts:1140-1143` |
| 2. 输入目标岗位 | 填写公司、地点、岗位名和 JD 文本，或上传 JD 截图 | 图片通过 GLM-OCR 提取文本和岗位元数据 | JD 草稿 | `frontend/Taro/reffo-taro/src/services/parse.ts:197-206`；岗位输入页运行确认 |
| 3. 简历分析 | 点击开始生成 | Taro 主链路先调用 `/mvp/analyze`，得到质量评分、优势、问题、建议和结构化简历 | 简历分析 | `frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts:1201-1229`；`frontend/Taro/reffo-taro/src/services/resume.ts:344-361` |
| 4. 岗位匹配 | 无需额外操作 | 调用 `/mvp/match`，解析 JD 并输出匹配分、要求覆盖、差距与策略 | 岗位分析 | `frontend/Taro/reffo-taro/src/services/resume.ts:363-385`；结果页运行确认 |
| 5. 定制简历 | 进入结果页等待后续步骤 | 结果页继续调用 `/mvp/generate`，按源简历证据和匹配结果生成 Markdown | 最佳简历 | `frontend/Taro/reffo-taro/src/pages/result/usePageModel.ts:271-337` |
| 6. 面试准备 | 切换“面试建议” | 调用 `/mvp/interview`，输出可能问题、故事建议和反问；前端在缺项时会生成通用兜底内容 | 面试建议 | `frontend/Taro/reffo-taro/src/pages/result/usePageModel.ts:339-363`；`frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:565-633` |
| 7. 人工复核 | 逐行编辑，下载 Markdown | 修改结果会更新最近会话；下载生成 `.md` 文件 | 用户复核后的简历文件 | `frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:405-474` |
| 8. 保存与复用 | 保存/完成并回首页 | 完整结果写入历史记录，本地缓存优先展示，并尝试同步后端 | 岗位卡片与历史详情 | `frontend/Taro/reffo-taro/src/pages/result/usePageModel.ts:384-451`；`frontend/Taro/reffo-taro/src/store/historyStore.ts:172-318` |
| 9. 可选登录 | 邮箱密码登录 | 使用 Supabase Auth；登录文案为“同步源简历和生成历史” | 会话与跨端数据基础 | `frontend/Taro/reffo-taro/src/pages/auth/index.tsx:8-85`；`frontend/Taro/reffo-taro/src/services/auth.ts:62-118` |

补充说明：后端也提供一体化 `POST /api/v1/mvp/process`，但当前 Taro 主界面实际使用分步接口，以便结果页逐阶段生成。不能把 `/process` 的完整自愈链路直接等同为所有前端生成场景都经过完全相同的路径。

## 四、目标用户与主要痛点

### 源码支持的用户范围

落地页内置软件工程师、产品经理、数据分析师、UX 设计师和用户运营经理示例，并出现应届生与社招生示例卡片：`frontend/Taro/reffo-taro/src/pages/landing/constants/job-descriptions.ts:13-104`，实际落地页也展示了不同专业和求职阶段。

据此可以形成以下**待验证用户假设**，但不能写成已完成用户研究的结论：

1. 同时申请多个岗位、每个岗位要求不同的应届生和职场求职者。
2. 已有经历但不知道如何针对 JD 组织重点、对齐用词和呈现证据的人。
3. 希望减少重复改写时间，同时保留每个岗位版本的人。
4. 在投递前还需要准备可能问题、案例故事和反问的人。
5. 愿意对 AI 结果进行事实核验和人工修改的人。

### 主要痛点与产品回应

| 痛点 | 产品回应 | 证据强度 |
|---|---|---|
| 一份通用简历难以覆盖不同 JD | 每个岗位生成独立简历和历史卡片 | 运行确认 + 源码确认 |
| 不清楚自己与岗位的差距 | 输出差距分析、匹配项与优化策略 | 运行确认 + 源码确认 |
| 重复改写耗时且容易失去事实边界 | 多 Agent 分步生成，并在 Prompt 中限制新增候选人事实 | 源码确认；效果仍需实测 |
| PDF/JD 截图不便复制 | PDF 简历 OCR、JD 图片 OCR | 条件能力，依赖 GLM-OCR |
| 生成后还要准备面试 | 可能问题、故事建议、反问清单 | 运行确认 + 源码确认 |
| 多份结果难管理 | 首页卡片堆、历史详情和回首页动画 | 运行确认 |

目前没有访谈、问卷、付费转化、留存、职业分布或求职结果数据，不能宣称这些用户假设已经被市场验证。

## 五、核心价值

### 1. 从“写一份简历”转为“管理每一次申请”

用户先建立源简历，再为每个 JD 生成独立版本；首页最多展示最近 10 个历史卡片：`frontend/Taro/reffo-taro/src/pages/index/model/homeCardData.ts:180-197`。这比单次聊天更接近持续求职工作流。

### 2. 把岗位匹配、材料重写和面试准备串成一个闭环

结果页以“岗位分析—最佳简历—面试建议”组织输出，且后续阶段只有在前置阶段完成后才开放：`frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:76-124`、`frontend/Taro/reffo-taro/src/pages/result/usePageModel.ts:271-363`。

### 3. 强调“证据优先”，而不只是让模型自由发挥

当前 Prompt 明确要求候选人事实只能来自源简历，缺少证据不等于缺少能力，禁止虚构项目、技能、数字和经历，并要求保留数字限定词：`backend/src/prompts/prompts.ts:79-88`、`209-219`、`269-293`。匹配结果还把差距区分为 `direct_missing`、`implicit_evidence`、`wording_gap`：`backend/src/harness/evaluators/business-evaluators.ts:129-213`。

这可以安全表述为“系统设置了事实边界与质量校验”，不能表述为“绝不幻觉”或“100% 真实”。

### 4. 将抽象 AI 过程变成可见、可编辑、可保存的结果

用户能看到评分、差距、策略、Markdown 简历和面试建议，并可逐行编辑、下载和保存。实际 H5 已确认这些页面和入口存在。

## 六、与三类替代方案的差异

以下是产品结构差异，不是经过第三方评测的优劣结论。

| 对比对象 | 对方通常解决的问题 | Reffo 当前差异 | 不应做的夸张 |
|---|---|---|---|
| 普通简历模板 | 版式、章节和基础填写 | 以源简历 + 具体 JD 做语义分析、差距识别、内容重排，并保存多个岗位版本 | 不可宣称“比所有模板通过率更高”；当前主要输出仍是 Markdown，不是丰富模板市场 |
| 人工简历服务 | 顾问诊断、深度访谈、人工改写 | 软件化分步流程、可反复处理不同 JD、即时生成和历史管理 | 不可宣称效果优于资深顾问，也不能暗示有人类顾问复核 |
| 通用 AI 对话工具 | 开放式问答和单轮/多轮生成 | 固定的分析—匹配—生成—面试工作流，带源简历/JD 状态、结构化结果、质量门禁、历史卡片和下载 | 不可宣称消除了大模型幻觉；底层仍调用外部大模型 |

## 七、最适合传播的功能与视觉效果

### 第一优先级：可直接建立产品认知

1. **“一个岗位，一份简历”卡片堆**  
   传播画面：同一份源简历对应多个公司/岗位卡片，切换时展示不同策略。  
   依据：`frontend/Taro/reffo-taro/src/pages/index/constants/content.ts:5-21`、首页运行确认。

2. **源简历 + 目标 JD → 三段结果**  
   传播画面：岗位差距、相契简历、面试建议三个页签依次完成。  
   依据：`frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:76-101`、结果页运行确认。

3. **事实边界可视化**  
   传播画面：把“直接缺失 / 隐含证据 / 只是措辞未对齐”画成三类证据标签，强调不把“材料没写”说成“你不会”。  
   依据：`backend/src/prompts/prompts.ts:209-219`、`backend/src/harness/evaluators/business-evaluators.ts:161-188`。  
   注意：当前结果页未完整展示这三个英文证据类型，做宣传画面时要标为“工作机制示意”，不要伪装成现有页面截图。

4. **可编辑、可下载的 Markdown 简历**  
   传播画面：在结果页逐行修改后下载。  
   依据：`frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:405-474`。

### 第二优先级：适合短视频和动效素材

- 落地页多张预设简历在空间中排队，滑动后进入岗位文件夹。
- 首页长卡片堆的前后层级、品牌色和毛玻璃信息区。
- 高性能设备使用 Three.js 卡片材质；性能不足时回退为增强/基础 CSS，并尊重减少动态效果设置：`frontend/Taro/reffo-taro/src/utils/visual-tier.ts:89-160`、`191-273`、`frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/PremiumCardEffect.h5.tsx:35-156`。
- 生成完成页的彩屑、卡片落位和“恭喜你”动效：`frontend/Taro/reffo-taro/src/pages/complete/PageView.h5.tsx:8-88`。

这些视觉效果可以宣传为“界面体验”或用于录屏，不应被包装成简历效果提升的证据。

## 八、当前不适合直接宣传或尚未实现的能力

### 明确未实现或不完整

1. **分享**：结果页调用分享菜单失败后直接提示“分享功能暂不可用”：`frontend/Taro/reffo-taro/src/pages/result/usePageModel.ts:454-460`。
2. **DOC/DOCX 解析**：文件选择器允许选 DOC/DOCX，但解析逻辑会提示“暂不支持”，应立即避免对外写“支持 Word 简历”：`frontend/Taro/reffo-taro/src/utils/resume-file-upload.ts:9-14`、`138-148`。
3. **RN / 小程序已稳定上线**：README 明确仍需真实设备回归：`README.md:84-91`。
4. **生产级用户体系与部署**：README 仍标记上线部署、用户体系、鉴权和生产数据库方案待补齐：`README.md:89-91`。虽已有登录页和 Supabase 代码，但不可直接宣称“全平台安全同步已上线”。
5. **可重复的当前后端构建**：当前 checkout 缺少被引用的 `backend/src/prompts/v42-prompts.ts`，需先修复再做正式演示或 CI 证明。
6. **运营埋点与效果闭环**：没有用户行为事件 SDK；后端 Harness 只记录 Agent run/step/evaluation。不可宣称“根据数百万用户数据持续优化”或展示无依据的漏斗数据。

### 已有能力但不宜使用当前高承诺文案

- “最佳简历”“确保简历与目标岗位高度匹配”“提高在就业市场的竞争力”“充分理解你的技能模型”等属于效果型或绝对化表达。对应位置：`frontend/Taro/reffo-taro/src/pages/create/types.ts:79-107`、`frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:86-98`、`frontend/Taro/reffo-taro/src/pages/index/constants/content.ts:12-21`。
- 分数是模型和规则给出的产品内评分，不是 ATS、招聘方或录用概率。前端甚至把 `match_score - quality_score` 计算为 `improvement_score`：`frontend/Taro/reffo-taro/src/services/resume.ts:412-416`、`505-545`。不得对外解释为“成功率提升 X%”。
- 历史记录可能由旧 Prompt 版本生成。实际运行查看的历史结果中仍出现“补充量化成果”等建议，与当前 Prompt 的严格事实边界不完全一致。历史结果不能作为最新模型效果的无筛选案例。
- 后端完整 `/process` 有最多两次修订，但 Taro 当前分步调用路径与 `/process` 不完全一致。宣传“每份简历都经过完整多轮自愈”前需要逐接口验证和统一口径。

## 九、宣传风险

### 1. 隐私与数据安全

高风险点：

- 简历、JD、优化简历和完整结果会保存到浏览器/Taro 本地存储，并尝试同步后端；后端 SQLite/Supabase 表保存原始简历和 JD：`frontend/Taro/reffo-taro/src/store/historyStore.ts:172-318`、`backend/src/repositories/resume-history-repository.sqlite.ts:23-24`。
- 大模型请求会把包含简历/JD 的消息发给 DeepSeek 兼容 API：`backend/src/providers/deepseek-provider.ts:7-47`。
- OCR 会把 PDF 或图片发送给 GLM-OCR：`backend/src/services/ocr/glm-ocr-provider.ts:227-279`。
- 开发模式 API 日志会打印完整 `config.data`，其中可能含简历或 JD：`frontend/Taro/reffo-taro/src/services/api.ts:131-158`。
- 登录会把 Supabase access/refresh token 保存到本地跨端存储：`frontend/Taro/reffo-taro/src/services/auth.ts:98-117`。
- 未发现用户可见的隐私政策、服务条款、AI 数据处理同意、简历/JD 保留期限、账号注销或一键导出/删除全部个人数据流程。Harness 有保留天数，但不等同于业务简历数据保留策略：`backend/src/config/env.ts:87-90`。
- 本地工作区存在标记为私有审阅材料的 Prompt A/B 测试产物。它们不属于产品功能，不能进入营销素材、截图或版本提交；是否具备数据主体授权、匿名化和保留机制需人工复核。

对外发布前至少需要：隐私政策、第三方处理方清单、数据用途与保存期限、删除机制、敏感字段脱敏策略、开发日志关闭验证、样例数据授权记录。

### 2. 求职结果与广告承诺

禁止或必须改写：

- “保证通过 ATS”“保证拿到面试”“录用率提升 X%”“薪资提升 X%”。
- “一键解决求职”“比人工顾问更专业”“全网最强/最佳”。
- 把产品内评分解释成招聘方评价、市场竞争力或录用概率。

推荐使用：

- “根据你提供的源简历和目标岗位，生成一份供你复核的针对性版本。”
- “帮助识别当前材料与岗位要求之间的匹配点和待补充证据。”
- “AI 结果仅供求职材料准备参考，提交前请核对事实、联系方式和岗位要求。”

### 3. AI 效果与事实准确性

当前 Prompt 和校验器设置了很强的事实约束，但仍存在以下边界：

- Prompt 约束不是技术上的事实证明，模型仍可能误解或生成不准确内容。
- Markdown 质量门禁只检查长度、章节、占位符、源公司和技能是否被引用，并不逐句证明事实正确：`backend/src/harness/evaluators/markdown-resume-evaluator.ts:18-91`。
- 面试页在模型数据缺失时会生成通用兜底问题、故事和反问：`frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:574-597`、`frontend/Taro/reffo-taro/src/pages/result/model/interviewReferences.ts:78-120`。不能承诺每一条面试建议都由 AI 严格逐句溯源。
- OCR 可能产生识别错误，用户需要核对姓名、日期、数字和联系方式。

## 十、需要人工补充或确认的信息

以下信息目前无法从源码可靠得出，已在 `marketing/00-input/` 预留模板：

1. 产品正式阶段、公开域名、计划上线平台与发布日期。
2. 经过验证的核心用户画像、地域、行业、职业阶段和高频场景。
3. 商业模式、免费额度、付费方案、退款和客服机制。
4. 真实竞品清单与希望比较的维度。
5. 用户访谈、转化、留存、生成完成率、下载率、复用率和求职结果数据。
6. 可公开的真实案例、前后对比、用户授权和脱敏证明。
7. 模型效果评测集、事实错误率、OCR 准确率、质量门禁通过率和不同 Prompt 版本口径。
8. 隐私政策、服务条款、第三方模型/OCR 数据处理协议、数据保存和删除规则。
9. 品牌标准 Logo、标准色、字体授权、图片/插画版权和禁用规范。
10. 是否允许公开 DeepSeek、GLM-OCR、Supabase、Three.js 等技术供应商名称。
11. H5、RN、iOS、Android、小程序的真实上线与验收状态。
12. 是否保留“最佳简历”“高度匹配”等高承诺词；如保留，需要法务和效果数据共同支持。

## 十一、审计结论

Reffo 当前最有辨识度、且有实际产品依据的传播主线是：

> 从一份源简历出发，为每一个目标岗位建立独立版本；先看岗位差距，再生成可编辑简历，最后准备面试问题，并用卡片保存每次申请。

短期传播应聚焦“工作流、证据边界、可编辑结果和卡片视觉”，避免聚焦“录用结果、绝对匹配、ATS 保证或全平台同步”。正式投放前，优先补齐隐私与数据说明、可重复运行的后端构建、DOC/DOCX 文案一致性、分享状态和可公开的效果评测。
