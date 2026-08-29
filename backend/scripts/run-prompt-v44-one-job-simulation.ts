import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import OpenAI from 'openai'
import {
  V44_ONE_JOB_PROMPT_VERSION,
  buildV44AggressiveGenerationMessages,
  buildV44BlindJudgeMessages,
  buildV44FinalAuditMessages,
  buildV44ResumePlanMessages,
} from '@/prompts/v44-one-job-one-resume-prompts'
import type { ChatMessage } from '@/providers/llm-provider'

type JsonObject = Record<string, unknown>

interface HistoryRecord {
  company: string
  position: string
  resume_content: string
  jd_content: string
  optimized_content: string
  process_result?: {
    analysis?: { structured_resume?: JsonObject }
    matching?: JsonObject
  }
}

interface UsageRow {
  stage: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

interface TextMetrics {
  chars: number
  bullets: number
  headings: number
  projectHeadings: number
  unsupportedNumbers: string[]
  addedAttributionTerms: string[]
  internalAuditMarkers: string[]
}

interface CaseResult {
  caseNumber: number
  target: string
  baselineResume: string
  candidateResume: string
  plan: JsonObject
  judge: JsonObject
  baselineMetrics: TextMetrics
  candidateMetrics: TextMetrics
  baselineScore: number | null
  candidateScore: number | null
  winner: 'baseline' | 'candidate' | 'tie' | 'unknown'
}

const historyPath = resolve(
  process.cwd(),
  process.argv[2] || '../.artifacts/supabase/nonprod-20260829-162532/database/resume_histories.json'
)
const outputRoot = resolve(
  process.cwd(),
  process.argv[3] || `../.artifacts/prompt-v44-one-job-${new Date().toISOString().replace(/[:.]/g, '-')}`
)
const generationModel = process.env.PROMPT_V44_GENERATION_MODEL || process.env.AI_MODEL || 'deepseek-chat'
const judgeModel = process.env.PROMPT_V44_JUDGE_MODEL || generationModel
const apiKey = process.env.OPENAI_API_KEY?.trim()

if (!apiKey) throw new Error('OPENAI_API_KEY 未配置')

const client = new OpenAI({
  apiKey,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com',
  timeout: 180000,
  maxRetries: 1,
})
const usageRows: UsageRow[] = []

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 80)
}

function stripFence(content: string) {
  const trimmed = content.trim()
  const match = trimmed.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i)
  return (match?.[1] || trimmed).trim()
}

function parseJson(content: string) {
  const stripped = stripFence(content)
  try {
    return JSON.parse(stripped) as JsonObject
  } catch {
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('模型未返回可解析 JSON')
    return JSON.parse(stripped.slice(start, end + 1)) as JsonObject
  }
}

async function complete(
  stage: string,
  model: string,
  messages: ChatMessage[],
  options: { json?: boolean; temperature?: number; maxTokens?: number } = {}
) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = Date.now()
    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? 6000,
        response_format: options.json ? { type: 'json_object' } : undefined,
      })
      const content = response.choices[0]?.message?.content?.trim()
      if (!content) throw new Error('模型返回空内容')
      const usage = {
        stage,
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        latencyMs: Date.now() - startedAt,
      }
      usageRows.push(usage)
      console.log(JSON.stringify({ event: 'call_completed', ...usage }))
      return content
    } catch (error) {
      lastError = error
      console.log(JSON.stringify({
        event: 'call_failed',
        stage,
        attempt,
        message: error instanceof Error ? error.message : String(error),
      }))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${stage} 调用失败`)
}

async function completeJson(stage: string, messages: ChatMessage[], model = generationModel) {
  const first = await complete(stage, model, messages, {
    json: true,
    temperature: 0.05,
    maxTokens: 7000,
  })
  try {
    return parseJson(first)
  } catch (error) {
    const repaired = await complete(
      `${stage}:json-repair`,
      model,
      [
        ...messages,
        { role: 'assistant', content: first },
        {
          role: 'user',
          content: `上次输出无法解析：${error instanceof Error ? error.message : String(error)}。只返回符合既定结构的 JSON。`,
        },
      ],
      { json: true, temperature: 0, maxTokens: 7000 }
    )
    return parseJson(repaired)
  }
}

function identityTimeline(structuredResume: JsonObject) {
  const experience = Array.isArray(structuredResume.experience) ? structuredResume.experience : []
  return {
    personal_info: structuredResume.personal_info || {},
    education: structuredResume.education || [],
    experience_timeline: experience.map(item => {
      const row = item && typeof item === 'object' ? item as JsonObject : {}
      return {
        company: row.company || '',
        position: row.position || '',
        time_range: row.time_range || '',
      }
    }),
  }
}

function factListLength(value: unknown) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).length : 0
}

function countStructuredEvidence(experience: unknown[], projects: unknown[]) {
  const experienceFacts = experience.reduce((sum, item) => {
    const row = item && typeof item === 'object' ? item as JsonObject : {}
    return sum + factListLength(row.responsibilities) + factListLength(row.achievements)
  }, 0)
  const projectFacts = projects.reduce((sum, item) => {
    const row = item && typeof item === 'object' ? item as JsonObject : {}
    return sum + (typeof row.description === 'string' && row.description.trim() ? 1 : 0)
      + factListLength(row.achievements)
  }, 0)
  return experienceFacts + projectFacts
}

function sourceProfile(structuredResume: JsonObject, rawResume: string, matching: JsonObject) {
  const experience = Array.isArray(structuredResume.experience) ? structuredResume.experience : []
  const projects = Array.isArray(structuredResume.projects) ? structuredResume.projects : []
  const evidenceCount = countStructuredEvidence(experience, projects)
  return {
    source_markdown_chars: rawResume.length,
    structured_evidence_count: evidenceCount,
    experience_count: experience.length,
    project_count: projects.length,
    source_is_compact: evidenceCount <= 18 && projects.length <= 2,
    match_score: typeof matching.match_score === 'number' ? matching.match_score : null,
  }
}

const selfReportedPattern = /个人(?:简历|材料)(?:自述|记录)|简历记录|经本人确认/
const excludedEvidencePattern = /需[^，。；）)]{0,10}(?:确认|说明|核验)|待确认|待核验|口径冲突|口径.*(?:不一致|冲突)|不足以证明|因果(?:不足|不明|无法)|PRD记录|受[^，。；）)]{0,20}(?:影响|推动)|不(?:能|可)[^，。；）)]{0,12}归因|不等同于/
const auditClausePattern = /个人(?:简历|材料)(?:自述|记录)|简历记录|经本人确认/
const actionVerbs = ['主导', '统筹', '独立', '负责', '推动', '组织', '设计', '搭建', '建设', '参与', '协同', '支持', '协助', '承担']

function valueAtSourcePath(source: unknown, sourcePath: string) {
  const parts = sourcePath.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let current: unknown = source
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function cleanAuditClauses(value: string) {
  return value.replace(/（([^）]*)）|\(([^)]*)\)/g, (full, chinese: string | undefined, ascii: string | undefined) => {
    const content = chinese || ascii || ''
    const kept = content
      .split(/[，,；;]/)
      .map(item => item.trim())
      .filter(item => item && !auditClausePattern.test(item))
    return kept.length ? `（${kept.join('，')}）` : ''
  }).replace(/\s+/g, ' ').trim()
}

function safeEvidenceUsage(value: string) {
  return value
    .split(/[；;]/)
    .map(segment => segment.trim())
    .filter(segment => segment && !excludedEvidencePattern.test(segment))
    .map(cleanAuditClauses)
    .filter(Boolean)
    .join('；')
}

function compactPlanForAudit(plan: JsonObject) {
  const compactRows = (value: unknown) => (Array.isArray(value) ? value : []).map(item => {
    const row = item && typeof item === 'object' ? item as JsonObject : {}
    return {
      source_path: row.source_path,
      company: row.company,
      position: row.position,
      time_range: row.time_range,
      name: row.name,
      role: row.role,
      treatment: row.treatment,
      bullet_budget: row.bullet_budget,
      selected_evidence_paths: row.selected_evidence_paths,
    }
  })
  return {
    target_value_proposition: plan.target_value_proposition,
    jd_core_priorities: plan.jd_core_priorities,
    evidence_pillars: plan.evidence_pillars,
    experience_plan: compactRows(plan.experience_plan),
    project_plan: compactRows(plan.project_plan),
    skills_to_feature: plan.skills_to_feature,
    forbidden_claims: plan.forbidden_claims,
    content_budget: plan.content_budget,
  }
}

function sanitizePlanEvidence(plan: JsonObject, structuredResume: JsonObject) {
  const removedPaths = new Set<string>()
  const pillars = Array.isArray(plan.evidence_pillars) ? plan.evidence_pillars : []
  for (const pillar of pillars) {
    if (!pillar || typeof pillar !== 'object') continue
    const row = pillar as JsonObject
    const evidence = Array.isArray(row.selected_evidence) ? row.selected_evidence : []
    row.selected_evidence = evidence.filter(item => {
      if (!item || typeof item !== 'object') return false
      const evidenceRow = item as JsonObject
      const sourcePath = typeof evidenceRow.source_path === 'string' ? evidenceRow.source_path : ''
      const sourceValue = valueAtSourcePath(structuredResume, sourcePath)
      const sourceQuote = typeof sourceValue === 'string' ? sourceValue.trim() : ''
      const safeUsage = sourceQuote ? safeEvidenceUsage(sourceQuote) : ''
      const keep = Boolean(sourceQuote) && Boolean(safeUsage)
      if (!keep && typeof evidenceRow.source_path === 'string') removedPaths.add(evidenceRow.source_path)
      if (keep) {
        evidenceRow.source_quote = sourceQuote
        evidenceRow.safe_usage = safeUsage
        evidenceRow.verification_status = selfReportedPattern.test(sourceQuote) ? 'self_reported' : 'verified'
        evidenceRow.source_scope = sourcePath.match(/^(?:experience|projects)\[\d+\]/)?.[0] || sourcePath.split('.')[0]
        evidenceRow.source_action_verb = actionVerbs.find(verb => sourceQuote.includes(verb)) || ''
      }
      return keep
    })
  }

  for (const planKey of ['experience_plan', 'project_plan']) {
    const rows = Array.isArray(plan[planKey]) ? plan[planKey] as unknown[] : []
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue
      const row = item as JsonObject
      if (Array.isArray(row.selected_evidence_paths)) {
        row.selected_evidence_paths = row.selected_evidence_paths.filter(path => (
          typeof path === 'string' && !removedPaths.has(path)
        ))
      }
    }
  }

  const forbiddenClaims = Array.isArray(plan.forbidden_claims) ? plan.forbidden_claims : []
  plan.forbidden_claims = [
    ...forbiddenClaims,
    ...[...removedPaths].map(path => `不确定证据已由规则门禁删除：${path}`),
  ]
  const skills = Array.isArray(plan.skills_to_feature) ? plan.skills_to_feature : []
  plan.skills_to_feature = skills.filter(item => {
    if (!item || typeof item !== 'object') return false
    const row = item as JsonObject
    const path = typeof row.source_path === 'string' ? row.source_path : ''
    const sourceValue = valueAtSourcePath(structuredResume, path)
    if (typeof sourceValue !== 'string') return false
    row.skill = sourceValue
    return true
  })
  return { plan, removedUncertainEvidence: removedPaths.size }
}

function planBudget(plan: JsonObject) {
  const budget = plan.content_budget && typeof plan.content_budget === 'object'
    ? plan.content_budget as JsonObject
    : {}
  return {
    bullets: typeof budget.max_total_bullets === 'number' ? budget.max_total_bullets : 16,
    projects: typeof budget.max_project_count === 'number' ? budget.max_project_count : 3,
    chars: typeof budget.max_markdown_chars === 'number' ? budget.max_markdown_chars : 1700,
  }
}

function exceedsPlanBudget(markdown: string, plan: JsonObject) {
  const budget = planBudget(plan)
  return bullets(markdown).length > budget.bullets
    || extractProjectHeadings(markdown).length > budget.projects
    || markdown.length > budget.chars
}

function compactSupportingLists(markdown: string) {
  let section = ''
  return markdown.split(/\r?\n/).map(line => {
    const heading = line.match(/^##\s+(.+)/)
    if (heading) section = heading[1].trim()
    if (/^(技能|专业技能|教育背景)/.test(section) && /^\s*[-*]\s+/.test(line)) {
      return line.replace(/^\s*[-*]\s+/, '')
    }
    return line
  }).join('\n')
}

function dedupeResumeBullets(markdown: string) {
  const kept: string[] = []
  return markdown.split(/\r?\n/).filter(line => {
    if (!/^\s*[-*]\s+/.test(line)) return true
    const content = line.replace(/^\s*[-*]\s+/, '').trim()
    const numericSignature = [...content.matchAll(numberPattern)].map(match => normalize(match[0])).join('|')
    const duplicate = kept.some(previous => {
      const currentNumbers = numericSignature.split('|').filter(Boolean)
      const previousNumbers = [...previous.matchAll(numberPattern)].map(match => normalize(match[0])).filter(Boolean)
      const previousSignature = previousNumbers.join('|')
      const sharesNumber = currentNumbers.some(number => previousNumbers.includes(number))
      return similarity(content, previous) >= 0.78
        || Boolean(numericSignature && previousSignature && numericSignature === previousSignature)
        || (sharesNumber && similarity(content, previous) >= 0.35)
    })
    if (!duplicate) kept.push(content)
    return !duplicate
  }).join('\n')
}

function removeUnsupportedNumericClaims(markdown: string, sourceResume: string) {
  const sourceNormalized = normalize(sourceResume)
  return markdown.split(/\r?\n/).flatMap(line => {
    const unsupported = [...line.matchAll(numberPattern)]
      .map(match => match[0].trim())
      .filter(atom => atom && !sourceNormalized.includes(normalize(atom)))
    if (!unsupported.length) return [line]
    if (/^\s*[-*]\s+/.test(line)) return []
    let repaired = line
    for (const atom of unsupported) repaired = repaired.replace(atom, '')
    repaired = repaired.replace(/\s{2,}/g, ' ').replace(/，\s*[，。]/g, '。').trim()
    return repaired ? [repaired] : []
  }).join('\n')
}

function stripInternalAuditPhrases(markdown: string) {
  return markdown
    .replace(/个人(?:简历|材料)(?:自述|记录)[：:]?\s*/g, '')
    .replace(/简历记录[：:]?\s*/g, '')
    .replace(/经本人确认\s*/g, '')
    .replace(/（\s*）|\(\s*\)/g, '')
}

const normalize = (value: string) => value.replace(/[\s,，]/g, '').toLowerCase()
const numberPattern = /(?:约|近|超过|超|至少|最多|不足|逾|低于|高于)?\s*\d+(?:[.,，]\d+)*(?:\.\d+)?\s*(?:%|％|万\+?|亿\+?|[Kk]\+?|元|人|家|份|款|项|个|年|月|天|小时|分钟|次|篇|名|所|级|分|\/\d+)?/g
const attributionTerms = ['主导', '独立', '统筹', '精通', '熟练', '全流程', '驱动', '赋能', '保障', '确保']
const auditPattern = /个人(?:简历|材料)(?:自述|记录)|PRD记录|需(?:确认|说明|核验)|待确认|待核验|证据等级|当前为(?:研究|规划|方案)阶段/g

function analyzeText(markdown: string, sourceResume: string): TextMetrics {
  const sourceNormalized = normalize(sourceResume)
  const numericAtoms = [...markdown.matchAll(numberPattern)].map(match => match[0].trim()).filter(Boolean)
  const unsupportedNumbers = [...new Set(
    numericAtoms.filter(atom => !sourceNormalized.includes(normalize(atom)))
  )]
  return {
    chars: markdown.length,
    bullets: markdown.split(/\r?\n/).filter(line => /^\s*[-*]\s+/.test(line)).length,
    headings: markdown.split(/\r?\n/).filter(line => /^#{1,3}\s+/.test(line)).length,
    projectHeadings: extractProjectHeadings(markdown).length,
    unsupportedNumbers,
    addedAttributionTerms: attributionTerms.filter(
      term => markdown.includes(term) && !sourceResume.includes(term)
    ),
    internalAuditMarkers: [...new Set([...markdown.matchAll(auditPattern)].map(match => match[0]))],
  }
}

function extractProjectHeadings(markdown: string) {
  const headings: string[] = []
  let inProjects = false
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s+项目经历/.test(line)) {
      inProjects = true
      continue
    }
    if (inProjects && /^##\s+/.test(line)) break
    if (inProjects && /^###\s+/.test(line)) headings.push(line.replace(/^###\s+/, '').trim())
  }
  return headings
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeJudge(judge: JsonObject) {
  const evaluations = Array.isArray(judge.evaluations) ? judge.evaluations : []
  const objects = evaluations.filter(item => item && typeof item === 'object') as JsonObject[]
  const baseline = objects.find(item => item.candidate_id === 'X') || {}
  const candidate = objects.find(item => item.candidate_id === 'Y') || {}
  const winnerValue = judge.winner
  return {
    baselineScore: numberValue(baseline.total_score),
    candidateScore: numberValue(candidate.total_score),
    winner: winnerValue === 'X'
      ? 'baseline' as const
      : winnerValue === 'Y'
        ? 'candidate' as const
        : winnerValue === 'tie'
          ? 'tie' as const
          : 'unknown' as const,
  }
}

function ngrams(value: string, size = 4) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
  const counts = new Map<string, number>()
  for (let index = 0; index <= normalized.length - size; index += 1) {
    const gram = normalized.slice(index, index + size)
    counts.set(gram, (counts.get(gram) || 0) + 1)
  }
  return counts
}

function cosine(left: Map<string, number>, right: Map<string, number>) {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (const value of left.values()) leftNorm += value * value
  for (const value of right.values()) rightNorm += value * value
  for (const [key, value] of left.entries()) dot += value * (right.get(key) || 0)
  return dot / Math.sqrt(leftNorm * rightNorm || 1)
}

function similarity(left: string, right: string) {
  return cosine(ngrams(left), ngrams(right))
}

function bullets(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^[-*]\s+/.test(line))
    .map(line => line.replace(/^[-*]\s+/, ''))
}

function bulletReuseRatio(current: string, others: string[]) {
  const currentBullets = bullets(current)
  const otherBullets = others.flatMap(bullets)
  const reused = currentBullets.filter(bullet => {
    const best = Math.max(0, ...otherBullets.map(other => similarity(bullet, other)))
    return best >= 0.72
  })
  return currentBullets.length ? reused.length / currentBullets.length : 0
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] || 0
}

function differentiation(results: CaseResult[], side: 'baseline' | 'candidate') {
  const targetResults = results.filter(result => result.caseNumber >= 3 && result.caseNumber <= 8)
  const resumes = targetResults.map(result => side === 'baseline' ? result.baselineResume : result.candidateResume)
  const similarities: number[] = []
  for (let left = 0; left < resumes.length; left += 1) {
    for (let right = left + 1; right < resumes.length; right += 1) {
      similarities.push(similarity(resumes[left], resumes[right]))
    }
  }
  const reuseRatios = resumes.map((resume, index) => bulletReuseRatio(
    resume,
    resumes.filter((_, otherIndex) => index !== otherIndex)
  ))
  return {
    medianBodySimilarity: Number(median(similarities).toFixed(3)),
    minBodySimilarity: Number(Math.min(...similarities).toFixed(3)),
    maxBodySimilarity: Number(Math.max(...similarities).toFixed(3)),
    averageBulletReuseRatio: Number((reuseRatios.reduce((sum, value) => sum + value, 0) / reuseRatios.length).toFixed(3)),
  }
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null)
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
}

function fixed(value: number | null, digits = 2) {
  return value === null ? null : Number(value.toFixed(digits))
}

function renderReport(results: CaseResult[], metadata: JsonObject) {
  const baselineJudge = average(results.map(result => result.baselineScore))
  const candidateJudge = average(results.map(result => result.candidateScore))
  const baselineDifferentiation = differentiation(results, 'baseline')
  const candidateDifferentiation = differentiation(results, 'candidate')
  const candidateWins = results.filter(result => result.winner === 'candidate').length
  const baselineWins = results.filter(result => result.winner === 'baseline').length
  const ties = results.filter(result => result.winner === 'tie').length
  const averageMetric = (side: 'baselineMetrics' | 'candidateMetrics', key: 'chars' | 'bullets' | 'projectHeadings') =>
    results.reduce((sum, result) => sum + result[side][key], 0) / results.length
  const riskCount = (side: 'baselineMetrics' | 'candidateMetrics', key: 'unsupportedNumbers' | 'addedAttributionTerms' | 'internalAuditMarkers') =>
    results.reduce((sum, result) => sum + result[side][key].length, 0)
  const rows = results.map(result => {
    const candidatePath = `cases/case-${String(result.caseNumber).padStart(2, '0')}-${safeFilename(result.target)}-candidate.md`
    return `| ${result.caseNumber} | ${result.target} | ${result.baselineScore ?? '-'} | ${result.candidateScore ?? '-'} | ${result.baselineMetrics.bullets} → ${result.candidateMetrics.bullets} | ${result.baselineMetrics.chars} → ${result.candidateMetrics.chars} | ${result.winner} | [候选简历](${candidatePath}) |`
  }).join('\n')

  return `# Reffo v4.4 “一岗一简历”激进候选版模拟与质量评估

运行时间：${metadata.completedAt}

候选提示词：${V44_ONE_JOB_PROMPT_VERSION}

生成模型：${generationModel}

评审模型：${judgeModel}
样本：Supabase nonprod 9 次历史处理；编号 3-8 为同一份源简历对应 6 个不同 JD

## 总体结果

- 旧版盲评均分：${fixed(baselineJudge)}
- 候选版盲评均分：${fixed(candidateJudge)}
- 绝对变化：${fixed(baselineJudge === null || candidateJudge === null ? null : candidateJudge - baselineJudge)}
- 胜负：候选版 ${candidateWins} 胜，旧版 ${baselineWins} 胜，平局 ${ties}，不可用 ${results.length - candidateWins - baselineWins - ties}
- 平均 bullet：${fixed(averageMetric('baselineMetrics', 'bullets'), 1)} → ${fixed(averageMetric('candidateMetrics', 'bullets'), 1)}
- 平均字符数：${fixed(averageMetric('baselineMetrics', 'chars'), 0)} → ${fixed(averageMetric('candidateMetrics', 'chars'), 0)}
- 平均项目数：${fixed(averageMetric('baselineMetrics', 'projectHeadings'), 1)} → ${fixed(averageMetric('candidateMetrics', 'projectHeadings'), 1)}
- 同源六岗位正文相似度中位数：${baselineDifferentiation.medianBodySimilarity} → ${candidateDifferentiation.medianBodySimilarity}
- 同源六岗位平均 bullet 复用率：${baselineDifferentiation.averageBulletReuseRatio} → ${candidateDifferentiation.averageBulletReuseRatio}
- 本地规则发现的新增数字风险：${riskCount('baselineMetrics', 'unsupportedNumbers')} → ${riskCount('candidateMetrics', 'unsupportedNumbers')}
- 本地规则发现的归因升级词：${riskCount('baselineMetrics', 'addedAttributionTerms')} → ${riskCount('candidateMetrics', 'addedAttributionTerms')}
- 内部审计标记：${riskCount('baselineMetrics', 'internalAuditMarkers')} → ${riskCount('candidateMetrics', 'internalAuditMarkers')}

## 逐案对比

| 编号 | 目标岗位 | 旧版分 | 候选分 | bullet | 字符数 | 胜者 | 产物 |
|---:|---|---:|---:|---:|---:|---|---|
${rows}

## 差异度

旧版：${JSON.stringify(baselineDifferentiation)}

候选版：${JSON.stringify(candidateDifferentiation)}

衡量目标不是让稳定事实变动，而是让项目选择、bullet 集合、证据优先级和篇幅分配随 JD 变化。候选版只有在正文相似度和 bullet 复用率下降，同时盲评、事实风险和可投递性不恶化时才应晋级。

## 解释边界

- 本次隔离测试“岗位证据规划 + 最终简历生成”，复用历史结构化简历、JD 和匹配分析，没有重新运行 OCR、简历分析或 JD 解析。
- 本地新增数字检查是字符串级启发式，日期格式变化可能产生误报；最终以逐案 Judge 和人工复核为准。
- 完整源材料、计划、两版简历和 Judge 输出均保存在本地忽略目录，不应提交或外发。
`
}

await mkdir(outputRoot, { recursive: true, mode: 0o700 })
await mkdir(resolve(outputRoot, 'cases'), { recursive: true, mode: 0o700 })

const histories = JSON.parse(await readFile(historyPath, 'utf8')) as HistoryRecord[]
const results: CaseResult[] = []

for (let index = 0; index < histories.length; index += 1) {
  const history = histories[index]
  const caseNumber = index + 1
  const structuredResume = history.process_result?.analysis?.structured_resume
  const matching = history.process_result?.matching
  const jdStructure = matching && typeof matching.jd_structure === 'object'
    ? matching.jd_structure
    : {}
  if (!structuredResume || !matching) {
    throw new Error(`案例 ${caseNumber} 缺少结构化简历或匹配分析`)
  }
  const target = `${history.company} / ${history.position}`
  const prefix = `case-${String(caseNumber).padStart(2, '0')}-${safeFilename(target)}`
  const caseResultPath = resolve(outputRoot, 'cases', `${prefix}-result.json`)
  try {
    const existing = JSON.parse(await readFile(caseResultPath, 'utf8')) as CaseResult
    results.push(existing)
    console.log(JSON.stringify({ event: 'case_resumed', caseNumber, target }))
    continue
  } catch {
    // No completed checkpoint for this case.
  }
  console.log(JSON.stringify({ event: 'case_started', caseNumber, target }))

  const rawPlan = await completeJson(
    `${prefix}:plan`,
    buildV44ResumePlanMessages({
      sourceResume: structuredResume,
      jobDescription: jdStructure,
      matchAnalysis: matching,
      sourceProfile: sourceProfile(structuredResume, history.resume_content, matching),
    })
  )
  const { plan } = sanitizePlanEvidence(rawPlan, structuredResume)
  const timeline = identityTimeline(structuredResume)
  const draftResume = stripFence(await complete(
    `${prefix}:generate`,
    generationModel,
    buildV44AggressiveGenerationMessages({
      identityTimeline: timeline,
      resumePlan: plan,
    }),
    { temperature: 0.25, maxTokens: 6000 }
  ))
  let candidateResume = stripFence(await complete(
    `${prefix}:final-audit`,
    generationModel,
    buildV44FinalAuditMessages({
      identityTimeline: timeline,
      resumePlan: compactPlanForAudit(plan),
      draftResume,
    }),
    { temperature: 0.05, maxTokens: 5000 }
  ))
  if (exceedsPlanBudget(candidateResume, plan)) {
    const budget = planBudget(plan)
    const currentBullets = bullets(candidateResume).length
    const currentProjects = extractProjectHeadings(candidateResume).length
    const repairMessages = buildV44FinalAuditMessages({
      identityTimeline: timeline,
      resumePlan: compactPlanForAudit(plan),
      draftResume: candidateResume,
    })
    repairMessages.push({
      role: 'user',
      content: `当前草稿实测为 ${currentBullets} 条列表项、${currentProjects} 个项目、${candidateResume.length} 个字符；硬上限为 ${budget.bullets} 条、${budget.projects} 个、${budget.chars} 字符。必须实际删除到三项都达标，只能返回压缩后的 Markdown。`,
    })
    candidateResume = stripFence(await complete(
      `${prefix}:budget-repair`,
      generationModel,
      repairMessages,
      { temperature: 0, maxTokens: 4500 }
    ))
  }
  candidateResume = stripInternalAuditPhrases(removeUnsupportedNumericClaims(
    compactSupportingLists(dedupeResumeBullets(candidateResume)),
    history.resume_content
  ))
  const judge = await completeJson(
    `${prefix}:judge`,
    buildV44BlindJudgeMessages({
      sourceResume: history.resume_content,
      jobDescription: history.jd_content,
      baselineResume: history.optimized_content,
      candidateResume,
    }),
    judgeModel
  )
  const normalizedJudge = normalizeJudge(judge)
  const result: CaseResult = {
    caseNumber,
    target,
    baselineResume: history.optimized_content,
    candidateResume,
    plan,
    judge,
    baselineMetrics: analyzeText(history.optimized_content, history.resume_content),
    candidateMetrics: analyzeText(candidateResume, history.resume_content),
    ...normalizedJudge,
  }
  results.push(result)

  await writeFile(resolve(outputRoot, 'cases', `${prefix}-baseline.md`), `${history.optimized_content.trim()}\n`, { mode: 0o600 })
  await writeFile(resolve(outputRoot, 'cases', `${prefix}-candidate.md`), `${candidateResume.trim()}\n`, { mode: 0o600 })
  await writeFile(resolve(outputRoot, 'cases', `${prefix}-plan.json`), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 })
  await writeFile(resolve(outputRoot, 'cases', `${prefix}-judge.json`), `${JSON.stringify(judge, null, 2)}\n`, { mode: 0o600 })
  await writeFile(caseResultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({
    event: 'case_completed',
    caseNumber,
    target,
    baselineScore: result.baselineScore,
    candidateScore: result.candidateScore,
    winner: result.winner,
    baselineBullets: result.baselineMetrics.bullets,
    candidateBullets: result.candidateMetrics.bullets,
  }))
}

const completedAt = new Date().toISOString()
const metadata = {
  completedAt,
  promptVersion: V44_ONE_JOB_PROMPT_VERSION,
  generationModel,
  judgeModel,
  historyFile: basename(historyPath),
  historyDigest: createHash('sha256').update(await readFile(historyPath)).digest('hex'),
  cases: results.length,
  usage: {
    calls: usageRows.length,
    inputTokens: usageRows.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: usageRows.reduce((sum, row) => sum + row.outputTokens, 0),
    latencyMs: usageRows.reduce((sum, row) => sum + row.latencyMs, 0),
  },
}
await writeFile(resolve(outputRoot, 'results.json'), `${JSON.stringify({ metadata, results }, null, 2)}\n`, { mode: 0o600 })
await writeFile(resolve(outputRoot, 'REPORT.md'), renderReport(results, metadata), { mode: 0o600 })
console.log(JSON.stringify({ event: 'simulation_completed', outputRoot, metadata }, null, 2))
