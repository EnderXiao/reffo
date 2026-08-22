# Reffo 功能与传播证据表

> 更新日期：2026-08-15  
> 使用方法：任何海报、视频、社媒文案、落地页或销售材料中的功能卖点，都应先在本表找到对应证据和安全口径。未列出或标为“不可宣传”的能力，默认不能写成已上线。

## 状态定义

- **A｜运行确认**：当前本地 H5 已看到真实页面/操作入口，且调用链存在。
- **B｜源码确认**：实现存在，本次未触发可能产生模型费用、上传或数据写入的操作。
- **C｜条件能力**：依赖 API Key、登录、环境、性能或平台，需要带条件描述。
- **D｜未完成/不可宣传**：实现缺失、状态不一致、仅规划，或当前证据不足。

## 可传播功能

| ID | 功能/候选卖点 | 状态 | 页面或实际功能依据 | 源码/API 依据 | 建议对外口径 | 必须保留的限制 |
|---|---|---|---|---|---|---|
| F-01 | 一个岗位，一份独立简历 | A | 首页实际展示多个岗位版本卡片；主标题为“一个岗位，一份简历” | `frontend/Taro/reffo-taro/src/pages/index/constants/content.ts:5-21`；`frontend/Taro/reffo-taro/src/pages/index/model/usePageModel.ts:130-148` | “针对每个目标岗位，准备一份独立的简历版本。” | 不说“保证录用”“每份都最佳” |
| F-02 | 一份源简历可复用 | A | 首页显示源简历入口；创建页可编辑/保存源简历 | `frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts:1201-1221`；`frontend/Taro/reffo-taro/src/store/sourceResumeStore.ts:19-119` | “先建立源简历，后续申请可直接复用。” | 源简历会本地保存并可能同步服务端，需要隐私说明 |
| F-03 | 粘贴文字导入简历 | A | 源简历页有“输入文字描述”文本区 | `frontend/Taro/reffo-taro/src/pages/create/PageView.h5.tsx:305-339` | “支持直接粘贴已有简历内容。” | 用户仍需核对结构和敏感信息 |
| F-04 | 上传 PDF 简历并 OCR | C | 创建页有上传文件入口 | `frontend/Taro/reffo-taro/src/utils/resume-file-upload.ts:138-148`；`frontend/Taro/reffo-taro/src/services/parse.ts:197-205`；`POST /api/v1/parse/resume-file` | “支持 PDF 简历文字识别。” | 依赖 GLM-OCR；OCR 可能出错；不包含 DOC/DOCX |
| F-05 | 导入 MD/TXT 简历 | B | 上传入口共用文件选择 | `frontend/Taro/reffo-taro/src/utils/resume-file-upload.ts:9-13`、`138-169` | “支持 MD、TXT 文本简历导入。” | 仅指内容读取，不代表保留原排版 |
| F-06 | 粘贴目标岗位 JD | A | 岗位页有公司、Base、岗位名和岗位描述输入框 | `frontend/Taro/reffo-taro/src/pages/create/PageView.h5.tsx:416-474` | “粘贴目标岗位描述，即可开始针对性分析。” | JD 内容质量会影响分析结果 |
| F-07 | 上传 JD 截图并 OCR | C | 岗位页有“上传岗位描述截图”入口 | `frontend/Taro/reffo-taro/src/services/parse.ts:203-206`；`POST /api/v1/parse/jd-image` | “支持从岗位截图提取 JD 文本和基础信息。” | 仅 PNG/JPEG；依赖 GLM-OCR；需人工核对 |
| F-08 | 简历质量分析 | A | 结果页实际展示字母评级和差距分析 | `frontend/Taro/reffo-taro/src/services/resume.ts:285-361`；`frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:358-403` | “从完整性、证据和表达等维度分析当前简历。” | 评分是产品内 AI/规则评分，不是招聘方评分 |
| F-09 | JD 结构化解析 | B | 岗位信息能进入匹配和结果流程 | `backend/src/agents/jd-parser.ts`；`frontend/Taro/reffo-taro/src/services/resume.ts:363-385` | “提取岗位职责、硬性要求和技能重点。” | 不宣称覆盖所有招聘网站格式 |
| F-10 | 人岗匹配与差距分析 | A | 结果页“岗位分析”显示差距与策略 | `frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:76-90`、`358-400`；`POST /api/v1/mvp/match` | “查看当前材料与目标岗位的匹配点、差距和优化思路。” | “材料未证明”不等于用户不具备；不解释成录用概率 |
| F-11 | 区分不同证据缺口 | B | 当前用户页主要显示差距；证据类型尚未完整可视化 | `backend/src/prompts/prompts.ts:209-219`；`backend/src/harness/evaluators/business-evaluators.ts:161-188` | “系统区分直接缺失、隐含证据和措辞未对齐。” | 若用于 UI 截图，应标注“机制示意”；不要伪造成现有页面 |
| F-12 | 基于已有事实重排简历重点 | B | 最佳简历页展示针对岗位生成的内容 | `backend/src/prompts/prompts.ts:269-293`；`frontend/Taro/reffo-taro/src/services/resume.ts:387-417` | “围绕目标岗位，重排和改写源简历中已有的真实证据。” | 不能说“绝不新增/绝不幻觉”；提交前必须人工核验 |
| F-13 | 生成 Markdown 简历 | A | “最佳简历”页实际展示结构化 Markdown 内容 | `frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:405-490`；`POST /api/v1/mvp/generate` | “生成一份可继续编辑的 Markdown 简历。” | 当前不是 DOCX/PDF 精排模板输出 |
| F-14 | 结果页逐行编辑 | A | 最佳简历内容支持点选行、编辑、保存/取消 | `frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:412-459`、`490-525` | “AI 初稿可逐行修改，最终版本由你确认。” | 修改后仍需人工校对全文一致性 |
| F-15 | 下载 Markdown 文件 | A | 最佳简历页实际有“下载”入口 | `frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:461-488` | “一键下载 Markdown 版本。” | 不写“支持 Word/PDF 下载” |
| F-16 | 面试问题建议 | A | 面试建议页实际展示“可能的问题” | `frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:574-597`；`POST /api/v1/mvp/interview` | “根据简历和岗位生成可能的面试问题。” | 题目为 AI 建议，不代表真实面试题 |
| F-17 | 面试故事准备 | A | 面试建议页实际展示“明星故事推荐”和源简历/JD 引用 | `frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:599-629`；`frontend/Taro/reffo-taro/src/pages/result/model/interviewReferences.ts:78-120` | “用源简历和 JD 的相关片段辅助准备案例故事。” | 引用匹配为启发式；缺项时有通用兜底，不承诺逐句精准溯源 |
| F-18 | 面试反问清单 | A | 面试建议页实际展示“聪明的反问” | `frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:583-589`、`631-632` | “提供可参考的面试反问方向。” | 不代表企业真实情况；用户应按现场调整 |
| F-19 | 生成历史卡片 | A | 首页实际显示多份岗位卡片和当前序号 | `frontend/Taro/reffo-taro/src/pages/index/model/homeCardData.ts:138-197`；`frontend/Taro/reffo-taro/src/store/historyStore.ts:172-318` | “把每次岗位申请保存成可回看的卡片。” | 最多展示最近 10 项；本地/服务端数据策略需说明 |
| F-20 | 保存结果并回到首页 | A | 结果页“下一步”进入完成页，完成页回首页 | `frontend/Taro/reffo-taro/src/pages/result/usePageModel.ts:384-451`；`frontend/Taro/reffo-taro/src/pages/complete/usePageModel.ts:53-79` | “完成后自动保存本次申请版本并回到卡片首页。” | 远端失败时可能只保留本地缓存 |
| F-21 | 修改历史岗位信息 | B | 结果页有“编辑简历”入口 | `frontend/Taro/reffo-taro/src/pages/result/usePageModel.ts:472-483`；`frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts:1153-1194` | “已保存的申请可返回修改岗位信息。” | 修改岗位信息不等同于自动重新生成全部内容 |
| F-22 | 删除历史和源简历 | B | 创建页包含删除交互与动画 | `frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts:1320-1338`；`frontend/Taro/reffo-taro/src/store/sourceResumeStore.ts:108-130`；后端历史/source DELETE 路由 | “支持删除本地/服务端记录。” | 尚无账号注销或一键删除全部个人数据的完整用户流程 |
| F-23 | 多步骤 Agent 工作流 | B | UI 依次显示分析、简历、面试阶段 | `backend/src/workflows/resume-optimization-workflow.ts:92-228`、`435-512`；`frontend/Taro/reffo-taro/src/pages/result/usePageModel.ts:271-363` | “用分步骤 Agent 完成分析、匹配、生成和面试准备。” | 不使用“全自动 Agent 保证效果”；Taro 分步路径与 `/process` 有差异 |
| F-24 | Markdown 质量门禁与最多两次修订 | B | 本次未重新生成付费模型结果 | `backend/src/workflows/resume-optimization-workflow.ts:224-399`；`backend/src/harness/evaluators/markdown-resume-evaluator.ts:18-91` | “后端会检查结构、完整性和占位符，并在完整流程中尝试修订。” | 门禁不是逐句事实证明；宣传“每份都经历两次修订”不准确 |
| F-25 | 结果可部分成功 | B | 工作流可返回 `partial` 与 recoverable errors | `backend/src/workflows/resume-optimization-workflow.ts:289-421`、`480-512` | 不建议作为消费者卖点；可在技术说明中写“部分阶段失败时保留已完成结果”。 | 需要 UI 清晰提示，不能把部分结果当完整交付 |
| F-26 | 邮箱登录和同步基础 | C | 登录页实际可见“同步源简历和生成历史” | `frontend/Taro/reffo-taro/src/pages/auth/index.tsx:45-83`；`frontend/Taro/reffo-taro/src/services/auth.ts:62-118` | 内测可写“支持登录后同步”，正式宣传前需上线验收。 | README 仍将生产用户体系列为待补齐；不得写“多端无缝同步已上线” |
| F-27 | 高性能 Three.js 卡片效果 | C | 首页实际看到 3D 卡片堆和材质层级 | `frontend/Taro/reffo-taro/src/utils/visual-tier.ts:89-160`、`263-273`；`frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/PremiumCardEffect.h5.tsx:35-156` | “高性能设备可呈现更丰富的卡片材质与动效。” | 会因设备性能、WebGL 和减少动态效果设置而降级 |
| F-28 | CSS 视觉降级与减少动态效果 | B | 页面当前能正常显示基础/增强视觉 | `frontend/Taro/reffo-taro/src/utils/visual-tier.ts:126-160`、`191-226` | “根据设备能力自动调整视觉强度。” | 不承诺所有设备画面完全一致 |
| F-29 | 完成庆祝动效 | A | 完成页实际看到彩屑、卡片和祝贺文案 | `frontend/Taro/reffo-taro/src/pages/complete/PageView.h5.tsx:8-88` | 适合作为短视频结尾，不需要单独功能承诺。 | 纯体验效果，不代表求职结果成功 |
| F-30 | AI 内容人工复核提示 | A | 首页和结果页均实际显示“内容由人工智能生成，请仔细检查” | `frontend/Taro/reffo-taro/src/pages/index/constants/content.ts:17-21`；`frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:1425` | 所有展示生成结果的营销素材建议保留同类提示。 | 不能把提示缩到不可读或在效果承诺后完全省略 |

## 内部能力：可用于技术背书，不宜直接当消费者卖点

| ID | 能力 | 状态 | 证据 | 可用范围 | 风险说明 |
|---|---|---|---|---|---|
| I-01 | Agent Harness run/step/attempt/event/evaluation | B | `README.md:21-28`；`backend/README.md:88-95`；`backend/src/harness/` | 技术博客、工程招聘、内部质量说明 | 不是用户行为埋点，不可转化成运营增长数据 |
| I-02 | 失败样本与回归数据集摘要 | B | `GET /api/v1/mvp/regression-dataset`、`POST /runs/:run_id/failure-samples`；`backend/src/routes/mvp.ts:133-249` | 内部评测流程 | 可能涉及简历数据；公开前必须脱敏和确认授权 |
| I-03 | LLM Judge | C | `backend/src/workflows/resume-optimization-workflow.ts:424-432`、`556-594` | 内部质量研究 | 只有显式启用才运行，且是异步；不能说每份结果都有 AI 复审 |
| I-04 | 外部模型供应商可替换 | B | `backend/src/providers/deepseek-provider.ts:7-47`；`backend/src/config/env.ts:92-109` | 技术架构说明 | 对外列供应商前确认合同、品牌和隐私口径 |
| I-05 | SQLite / Supabase 双存储路径 | C | `backend/src/repositories/resume-history-repository.ts`；`backend/src/config/env.ts:73-90` | 部署说明 | 本地开发与生产数据隔离方式不同，不能笼统说“数据只在本地” |

## 不可按已上线宣传的能力

| ID | 不可宣传项 | 当前事实 | 直接证据 | 允许的替代说法 |
|---|---|---|---|---|
| N-01 | 分享简历/一键分享 | 调用失败时提示“分享功能暂不可用” | `frontend/Taro/reffo-taro/src/pages/result/usePageModel.ts:454-460` | 暂不提；实现并验收后再上表 |
| N-02 | 支持 Word/DOC/DOCX 解析 | 文件选择可选，但解析明确拒绝 | `frontend/Taro/reffo-taro/src/utils/resume-file-upload.ts:9-14`、`138-148` | “支持 PDF、MD、TXT；Word 请先转换格式” |
| N-03 | 生成 Word/PDF 精排简历 | 当前下载实现只生成 Markdown Blob | `frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:461-474` | “下载 Markdown，便于继续编辑” |
| N-04 | 自动投递/一键求职 | 仓库没有招聘平台投递或职位申请接口 | 全量路由只有 mvp、parse、source-resume、resume-history、system | 不提；定位为求职材料准备工具 |
| N-05 | 职位搜索或智能推荐 | 示例岗位是本地常量，不是真实岗位库 | `frontend/Taro/reffo-taro/src/pages/landing/constants/job-descriptions.ts:13-104` | “可输入自定义目标岗位” |
| N-06 | ATS 通过率保证 | 没有 ATS 平台连接或真实通过率数据 | 后端路由与前端服务全量检查无 ATS 接口 | “帮助对齐 JD 关键词与证据”，且不可保证通过 |
| N-07 | 面试/录用/薪资结果保证 | 没有求职结果追踪或因果评测 | 无相关路由、store、埋点；页面只有 AI 提示 | “辅助准备，不替代个人判断和真实面试表现” |
| N-08 | 分数等于竞争力或录用概率 | 分数来自模型与规则，`improvement_score` 还有前端差值计算 | `frontend/Taro/reffo-taro/src/services/resume.ts:412-416`、`533-545` | “产品内参考评分” |
| N-09 | 100% 不编造/零幻觉 | Prompt 有约束，但门禁不是逐句事实校验 | `backend/src/prompts/prompts.ts:269-293`；`backend/src/harness/evaluators/markdown-resume-evaluator.ts:18-91` | “设置事实边界，仍需人工核验” |
| N-10 | 每条面试建议均可精准溯源 | 前端缺项时会生成通用兜底，并用启发式找引用 | `frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:574-597`；`frontend/Taro/reffo-taro/src/pages/result/model/interviewReferences.ts:51-120` | “结合简历与 JD 提供准备方向” |
| N-11 | 全平台已经稳定上线 | README 明确 RN/小程序仍需真机回归 | `README.md:84-91` | 目前只按已验证的 H5 口径传播 |
| N-12 | 生产级账号与跨端同步已完备 | 有登录代码，但 README 仍列为待补齐 | `README.md:89-91`；`frontend/Taro/reffo-taro/src/pages/auth/index.tsx` | “正在建设/内测登录同步”或暂不提 |
| N-13 | 数据只存本地或不会发送第三方 | 简历/JD 会发往大模型和 OCR，且有服务端持久化 | `backend/src/providers/deepseek-provider.ts:40-47`；`backend/src/services/ocr/glm-ocr-provider.ts:266-279`；历史仓储 | 必须如实披露本地、服务端和第三方处理路径 |
| N-14 | 已有完善隐私合规体系 | 未发现用户可见隐私政策、同意流程、业务数据保留和账号注销实现 | 全量文案/路由检索；仅 Harness 有保留天数 | 发布前补齐后再表述 |
| N-15 | 数据驱动的个性化/大量用户验证 | 没有产品 Analytics 事件 SDK 或效果数据 | 前端全量检索；`ErrorBoundary` 仅留监控 TODO | 不使用用户规模、提升率、留存率等数字 |
| N-16 | 当前仓库可直接干净启动生产服务 | Prompt 模块引用的 `backend/src/prompts/v42-prompts.ts` 当前缺失 | `backend/src/prompts/prompts.ts:3-7`；文件不存在 | 只说明本次本地已运行，修复后再做可重复启动声明 |

## 高风险现有文案替换建议

| 现有文案 | 位置 | 风险 | 建议替换 |
|---|---|---|---|
| “开始生成最佳简历” | `frontend/Taro/reffo-taro/src/pages/create/types.ts:100-107` | “最佳”是绝对效果承诺 | “开始生成岗位定制简历” |
| “确保简历与目标岗位高度匹配” | `frontend/Taro/reffo-taro/src/pages/result/PageView.h5.tsx:86-90` | 无法保证，且分数非招聘方判断 | “围绕目标岗位重组简历重点” |
| “提高在就业市场的竞争力” | `frontend/Taro/reffo-taro/src/pages/index/constants/content.ts:12-15` | 求职结果型承诺 | “帮助看清简历与岗位之间的差距” |
| “充分理解你的技能模型和工作经验” | `frontend/Taro/reffo-taro/src/pages/create/types.ts:79-98` | 暗示完全理解，忽略 OCR/模型误差 | “根据你提供的技能和经历建立分析基础” |
| “您提供的信息越详细……越能……高度契合” | 创建页 H5 实际文案 | 暗示线性、确定的效果关系 | “信息越完整，越有助于系统识别可用证据；生成后请核对” |
| “恭喜你！” | `frontend/Taro/reffo-taro/src/pages/complete/PageView.h5.tsx:82-85` | 若单独截取可能被误解为求职成功 | 可保留，但必须同屏出现“简历已经准备就绪”，不能剪成“已成功获得岗位” |

## 传播素材使用检查清单

发布任何素材前确认：

- [ ] 卖点能在本表找到 ID、证据和当前状态。
- [ ] 画面中的简历、JD、姓名、电话、邮箱、地址、公司内部信息均为授权且脱敏的样例。
- [ ] 没有把示例岗位、历史旧结果或机制示意伪装成真实用户结果。
- [ ] 没有把产品内分数写成 ATS 通过率、竞争力或录用概率。
- [ ] AI 生成结果画面保留清晰可读的人工核验提示。
- [ ] OCR、登录同步、Three.js 等条件能力已经说明环境或设备条件。
- [ ] 没有出现分享、Word 解析、PDF/Word 精排下载、自动投递等当前未完成能力。
- [ ] 所有提升率、用户数、案例结果和评价都有可追溯的数据与授权。
- [ ] 隐私政策、数据处理方、保留期限和删除机制已经过产品、技术与法务共同确认。
