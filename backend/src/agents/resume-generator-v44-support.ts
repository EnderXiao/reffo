import type { MatchAnalysis, ResumeStructure } from '@/types'

export type ResumePlan = Record<string, unknown>

const numberPattern = /(?:约|近|超过|超|至少|最多|不足|逾|低于|高于)?\s*\d+(?:[.,，]\d+)*(?:\.\d+)?\s*(?:%|％|万\+?|亿\+?|[Kk]\+?|元|人|家|份|款|项|个|年|月|天|小时|分钟|次|篇|名|所|级|分|\/\d+)?/g
const selfReportedPattern = /个人(?:简历|材料)(?:自述|记录)|简历记录|经本人确认/
const excludedEvidencePattern = /需[^，。；）)]{0,10}(?:确认|说明|核验)|待确认|待核验|口径冲突|口径.*(?:不一致|冲突)|不足以证明|因果(?:不足|不明|无法)|PRD记录|受[^，。；）)]{0,20}(?:影响|推动)|不(?:能|可)[^，。；）)]{0,12}归因|不等同于/
const auditClausePattern = /个人(?:简历|材料)(?:自述|记录)|简历记录|经本人确认/
const actionVerbs = ['主导', '统筹', '独立', '负责', '推动', '组织', '设计', '搭建', '建设', '参与', '协同', '支持', '协助', '承担']

const normalize = (value: string) => value.replace(/[\s,，]/g, '').toLowerCase()

export function stripMarkdownFence(content: string) {
  const trimmed = content.trim()
  const match = trimmed.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i)
  return (match?.[1] || trimmed).trim()
}

export function parseJsonObject(content: string): ResumePlan {
  const stripped = stripMarkdownFence(content)
  try {
    return JSON.parse(stripped) as ResumePlan
  } catch {
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('模型未返回可解析的简历选材计划')
    return JSON.parse(stripped.slice(start, end + 1)) as ResumePlan
  }
}

export function buildIdentityTimeline(sourceResume: ResumeStructure) {
  return {
    personal_info: sourceResume.personal_info,
    education: sourceResume.education,
    experience_timeline: sourceResume.experience.map(item => ({
      company: item.company,
      position: item.position,
      time_range: item.time_range,
    })),
  }
}

const factListLength = (value: unknown) => (
  Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).length : 0
)

export function buildSourceProfile(sourceResume: ResumeStructure, matchAnalysis: MatchAnalysis) {
  const projects = sourceResume.projects || []
  const experienceFacts = sourceResume.experience.reduce(
    (sum, item) => sum + factListLength(item.responsibilities) + factListLength(item.achievements),
    0
  )
  const projectFacts = projects.reduce(
    (sum, item) => sum + (item.description.trim() ? 1 : 0) + factListLength(item.achievements),
    0
  )
  const evidenceCount = experienceFacts + projectFacts

  return {
    source_markdown_chars: JSON.stringify(sourceResume).length,
    structured_evidence_count: evidenceCount,
    experience_count: sourceResume.experience.length,
    project_count: projects.length,
    source_is_compact: evidenceCount <= 18 && projects.length <= 2,
    match_score: matchAnalysis.match_score,
  }
}

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
  return value.replace(/（([^）]*)）|\(([^)]*)\)/g, (_full, chinese: string | undefined, ascii: string | undefined) => {
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

export function sanitizeResumePlan(rawPlan: ResumePlan, sourceResume: ResumeStructure) {
  const plan = structuredClone(rawPlan)
  const removedPaths = new Set<string>()
  const pillars = Array.isArray(plan.evidence_pillars) ? plan.evidence_pillars : []

  for (const pillar of pillars) {
    if (!pillar || typeof pillar !== 'object') continue
    const row = pillar as ResumePlan
    const evidence = Array.isArray(row.selected_evidence) ? row.selected_evidence : []
    row.selected_evidence = evidence.filter(item => {
      if (!item || typeof item !== 'object') return false
      const evidenceRow = item as ResumePlan
      const sourcePath = typeof evidenceRow.source_path === 'string' ? evidenceRow.source_path : ''
      const sourceValue = valueAtSourcePath(sourceResume, sourcePath)
      const sourceQuote = typeof sourceValue === 'string' ? sourceValue.trim() : ''
      const safeUsage = sourceQuote ? safeEvidenceUsage(sourceQuote) : ''
      const keep = Boolean(sourceQuote && safeUsage)

      if (!keep) {
        if (sourcePath) removedPaths.add(sourcePath)
        return false
      }

      evidenceRow.source_quote = sourceQuote
      evidenceRow.safe_usage = safeUsage
      evidenceRow.verification_status = selfReportedPattern.test(sourceQuote) ? 'self_reported' : 'verified'
      evidenceRow.source_scope = sourcePath.match(/^(?:experience|projects)\[\d+\]/)?.[0]
        || sourcePath.split('.')[0]
      evidenceRow.source_action_verb = actionVerbs.find(verb => sourceQuote.includes(verb)) || ''
      return true
    })
  }

  for (const planKey of ['experience_plan', 'project_plan']) {
    const rows = Array.isArray(plan[planKey]) ? plan[planKey] as unknown[] : []
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue
      const row = item as ResumePlan
      if (Array.isArray(row.selected_evidence_paths)) {
        row.selected_evidence_paths = row.selected_evidence_paths.filter(
          path => typeof path === 'string' && !removedPaths.has(path)
        )
      }
    }
  }

  const skills = Array.isArray(plan.skills_to_feature) ? plan.skills_to_feature : []
  plan.skills_to_feature = skills.filter(item => {
    if (!item || typeof item !== 'object') return false
    const row = item as ResumePlan
    const sourcePath = typeof row.source_path === 'string' ? row.source_path : ''
    const sourceValue = valueAtSourcePath(sourceResume, sourcePath)
    if (typeof sourceValue !== 'string') return false
    row.skill = sourceValue
    return true
  })

  const forbiddenClaims = Array.isArray(plan.forbidden_claims) ? plan.forbidden_claims : []
  plan.forbidden_claims = [
    ...forbiddenClaims,
    ...[...removedPaths].map(path => `证据门禁已删除：${path}`),
  ]

  return plan
}

function compactRows(value: unknown) {
  return (Array.isArray(value) ? value : []).map(item => {
    const row = item && typeof item === 'object' ? item as ResumePlan : {}
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
}

export function compactResumePlanForAudit(plan: ResumePlan) {
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

export function getResumePlanBudget(plan: ResumePlan) {
  const budget = plan.content_budget && typeof plan.content_budget === 'object'
    ? plan.content_budget as ResumePlan
    : {}
  return {
    bullets: typeof budget.max_total_bullets === 'number' ? budget.max_total_bullets : 16,
    projects: typeof budget.max_project_count === 'number' ? budget.max_project_count : 3,
    chars: typeof budget.max_markdown_chars === 'number' ? budget.max_markdown_chars : 1700,
  }
}

const extractBullets = (markdown: string) => markdown
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => /^[-*]\s+/.test(line))
  .map(line => line.replace(/^[-*]\s+/, ''))

function extractProjectHeadings(markdown: string) {
  const headings: string[] = []
  let inProjects = false
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s+项目经历/.test(line)) {
      inProjects = true
      continue
    }
    if (inProjects && /^##\s+/.test(line)) break
    if (inProjects && /^###\s+/.test(line)) headings.push(line)
  }
  return headings
}

export function getResumeBudgetStats(markdown: string) {
  return {
    bullets: extractBullets(markdown).length,
    projects: extractProjectHeadings(markdown).length,
    chars: markdown.length,
  }
}

export function exceedsResumePlanBudget(markdown: string, plan: ResumePlan) {
  const budget = getResumePlanBudget(plan)
  const stats = getResumeBudgetStats(markdown)
  return stats.bullets > budget.bullets || stats.projects > budget.projects || stats.chars > budget.chars
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

function similarity(left: string, right: string) {
  const leftCounts = ngrams(left)
  const rightCounts = ngrams(right)
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (const value of leftCounts.values()) leftNorm += value * value
  for (const value of rightCounts.values()) rightNorm += value * value
  for (const [key, value] of leftCounts.entries()) dot += value * (rightCounts.get(key) || 0)
  return dot / Math.sqrt(leftNorm * rightNorm || 1)
}

function dedupeResumeBullets(markdown: string) {
  const kept: string[] = []
  return markdown.split(/\r?\n/).filter(line => {
    if (!/^\s*[-*]\s+/.test(line)) return true
    const content = line.replace(/^\s*[-*]\s+/, '').trim()
    const currentNumbers = [...content.matchAll(numberPattern)].map(match => normalize(match[0])).filter(Boolean)
    const duplicate = kept.some(previous => {
      const previousNumbers = [...previous.matchAll(numberPattern)].map(match => normalize(match[0])).filter(Boolean)
      const sharesNumber = currentNumbers.some(number => previousNumbers.includes(number))
      return similarity(content, previous) >= 0.78 || (sharesNumber && similarity(content, previous) >= 0.35)
    })
    if (!duplicate) kept.push(content)
    return !duplicate
  }).join('\n')
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

function removeUnsupportedNumericClaims(markdown: string, sourceResume: ResumeStructure) {
  const sourceNormalized = normalize(JSON.stringify(sourceResume))
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

export function postProcessV44Resume(markdown: string, sourceResume: ResumeStructure) {
  return stripInternalAuditPhrases(removeUnsupportedNumericClaims(
    compactSupportingLists(dedupeResumeBullets(stripMarkdownFence(markdown))),
    sourceResume
  )).trim()
}
