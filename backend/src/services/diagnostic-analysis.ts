import {z} from 'zod'
import {env} from '@/config/env'
import {DashboardAccessError} from '@/auth/dashboard-access'
import {deepSeekProvider} from '@/providers/deepseek-provider'
import type {ChatCompletionInput, LlmProvider} from '@/providers/llm-provider'
import {
  diagnosticDetail,
  type DiagnosisRunDetail,
  type DiagnosisProviderCallItem,
  type DiagnosisEventItem,
  type DiagnosisFailureSampleItem,
} from '@/repositories/dashboard-diagnostics'

// 与看板前端定稿的枚举保持一致；严格 schema，输出越界会在服务端被拒绝。
export const diagnosticAnalysisSchema = z.object({
  conclusion: z.string().min(1).max(600),
  confidence: z.enum(['high', 'medium', 'low']),
  rootCauseClass: z.enum(['provider_http', 'timeout', 'network', 'stream_incomplete', 'rate_limit', 'output_validation', 'unknown']),
  confirmedEvidence: z.array(z.string().min(1).max(300)).max(12),
  uncertainFactors: z.array(z.string().min(1).max(300)).max(12),
  recommendedActions: z.array(z.string().min(1).max(300)).max(12),
  followUpQuestions: z.array(z.string().min(1).max(300)).max(8),
}).strict()
export type DiagnosisAnalysis = z.infer<typeof diagnosticAnalysisSchema>

export interface DiagnosisJobEvidence {
  id: string
  status: string
  stage: string
  error: string | null
  failureCode: string | null
  failureAction: string | null
  retryable: boolean | null
  updatedAt: string
}

export interface DiagnosticEvidence {
  runId: string
  failureSample: DiagnosisFailureSampleItem | null
  job: DiagnosisJobEvidence | null
  timeline: Array<{type: string; count: number; firstAt: string; lastAt: string}>
  steps: Array<{stepName: string; errorCodes: string[]}>
  providerCalls: DiagnosisProviderCallItem[]
}

export interface DiagnosisAnalysisResult {
  analysis: DiagnosisAnalysis
  model: string
  analyzedAt: string
  events: DiagnosisEventItem[]
  providerCalls: DiagnosisProviderCallItem[]
}

const SYSTEM_PROMPT = [
  '你是 Reffo 简历生成系统的 LLM 异常诊断助手。',
  '规则：',
  '1. 只依据提供的证据推断，严禁编造任何事实；',
  '2. 引用证据时必须带上事件发生时间与错误码（如 errorCode、failure_class、HTTP 状态）；',
  '3. 证据不足时必须把 confidence 设为 low，并在 uncertainFactors 中显式列出所有未知项；',
  '4. 证据中不包含任何用户简历、职位描述或提示词内容，你也绝不输出或猜测此类内容；',
  '5. 只输出一个严格符合以下结构的纯 JSON 对象，不要输出任何解释文字、Markdown 代码块或额外字段：',
  '{"conclusion":"一句根因结论","confidence":"high|medium|low","rootCauseClass":"provider_http|timeout|network|stream_incomplete|rate_limit|output_validation|unknown","confirmedEvidence":["带时间与错误码的证据"],"uncertainFactors":["证据不足时列出的未知项"],"recommendedActions":["可执行建议"],"followUpQuestions":["需要追问的问题"]}',
].join('\n')

function evidenceMessage(evidence: DiagnosticEvidence, retryHint: string | null) {
  const parts = ['以下是单个失败 run 的诊断证据，请输出根因分析 JSON。', JSON.stringify(evidence)]
  parts.push(retryHint ?? '请直接输出严格符合 schema 的 JSON。')
  return parts.join('\n\n')
}

function validationHint(error: z.ZodError) {
  const issues = error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
  return `上一次输出未通过结果校验：${issues}。请重新输出，只输出严格符合 schema 的纯 JSON，不要输出任何解释文字。`
}

// 由详情行构建紧凑证据：timeline 按事件类型汇总计数与首末时间，step 收集 errorCode 列表。
// 所有行都来自 repository 的白名单投影，不含简历/JD/提示词内容。
export function buildEvidenceFromDetail(detail: DiagnosisRunDetail): DiagnosticEvidence {
  const typeMap = new Map<string, {count: number; firstAt: string; lastAt: string}>()
  const stepErrors = new Map<string, Set<string>>()
  for (const event of detail.events) {
    const entry = typeMap.get(event.type) ?? {count: 0, firstAt: event.occurredAt, lastAt: event.occurredAt}
    entry.count += 1
    if (event.occurredAt < entry.firstAt) entry.firstAt = event.occurredAt
    if (event.occurredAt > entry.lastAt) entry.lastAt = event.occurredAt
    typeMap.set(event.type, entry)
    const errorCode = typeof event.payload.errorCode === 'string' ? event.payload.errorCode : null
    if (errorCode) {
      const stepName = typeof event.payload.stepName === 'string' ? event.payload.stepName : event.stepRunId ?? 'unknown'
      const codes = stepErrors.get(stepName) ?? new Set<string>()
      codes.add(errorCode)
      stepErrors.set(stepName, codes)
    }
  }
  const timeline = [...typeMap.entries()].map(([type, entry]) => ({type, ...entry}))
    .sort((a, b) => a.firstAt.localeCompare(b.firstAt))
    .slice(0, 50)
  const steps = [...stepErrors.entries()].map(([stepName, codes]) => ({
    stepName: String(stepName).slice(0, 120),
    errorCodes: [...codes].sort().slice(0, 12),
  })).sort((a, b) => a.stepName.localeCompare(b.stepName))
  const failure = detail.job?.failure
  const job: DiagnosisJobEvidence | null = detail.job ? {
    id: detail.job.id,
    status: detail.job.status,
    stage: detail.job.stage,
    error: detail.job.error,
    failureCode: typeof failure?.code === 'string' ? failure.code : null,
    failureAction: typeof failure?.action === 'string' ? failure.action : null,
    retryable: typeof failure?.retryable === 'boolean' ? failure.retryable : null,
    updatedAt: detail.job.updatedAt,
  } : null
  return {runId: detail.runId, failureSample: detail.failureSample, job, timeline, steps, providerCalls: detail.providerCalls}
}

export async function buildEvidence(runId: string): Promise<DiagnosticEvidence> {
  return buildEvidenceFromDetail(await diagnosticDetail(runId))
}

function analysisInput(evidence: DiagnosticEvidence, retryHint: string | null): ChatCompletionInput {
  return {
    messages: [
      {role: 'system', content: SYSTEM_PROMPT},
      {role: 'user', content: evidenceMessage(evidence, retryHint)},
    ],
    model: env.AI_MODEL,
    temperature: 0,
    maxOutputTokens: 1000,
    // DeepSeek 端点仅接受 json_object 响应格式；结构化由服务端 zod 校验 + 一次提示重试兜底。
    responseFormat: 'json_object',
  }
}

const ANALYSIS_FAILED = () => new DashboardAccessError('DASHBOARD_ANALYSIS_FAILED', '诊断分析生成失败，请稍后重试', 502)

// v1 不存储分析结果；zod 校验失败重试一次（附带校验错误与纯 JSON 要求），再次失败返回 502。
export async function analyzeRun(runId: string, provider: Pick<LlmProvider, 'complete'> = deepSeekProvider): Promise<DiagnosisAnalysisResult> {
  const detail = await diagnosticDetail(runId)
  const evidence = buildEvidenceFromDetail(detail)
  const analyzedAt = new Date().toISOString()
  let retryHint: string | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let content: string
    try {
      content = (await provider.complete(analysisInput(evidence, retryHint))).content
    } catch {
      throw ANALYSIS_FAILED()
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      if (attempt === 0) {
        retryHint = '上一次输出不是有效 JSON。请重新输出，只输出严格符合 schema 的纯 JSON，不要输出任何解释文字。'
        continue
      }
      throw ANALYSIS_FAILED()
    }
    const result = diagnosticAnalysisSchema.safeParse(parsed)
    if (result.success) {
      return {analysis: result.data, model: env.AI_MODEL, analyzedAt, events: detail.events, providerCalls: detail.providerCalls}
    }
    if (attempt === 0) {
      retryHint = validationHint(result.error)
      continue
    }
    throw ANALYSIS_FAILED()
  }
  throw ANALYSIS_FAILED()
}
