import type { MatchAnalysis, ResumeStructure } from '@/types'

export type ResumePlan = Record<string, unknown>

const numberPattern = /(?:约|近|超过|超|至少|最多|不足|逾|低于|高于)?\s*\d+(?:[.,，]\d+)*(?:\.\d+)?\s*(?:%|％|万\+?|亿\+?|[Kk]\+?|元|人|家|份|款|项|个|年|月|天|小时|分钟|次|篇|名|所|级|分|\/\d+)?/g
const selfReportedPattern = /个人(?:简历|材料)(?:自述|记录)|简历记录|经本人确认/
const excludedEvidencePattern = /需[^，。；）)]{0,10}(?:确认|说明|核验)|待确认|待核验|口径冲突|口径.*(?:不一致|冲突)|不足以证明|因果(?:不足|不明|无法)|PRD记录|受[^，。；）)]{0,20}(?:影响|推动)|不(?:能|可)[^，。；）)]{0,12}归因|不等同于/
const auditClausePattern = /个人(?:简历|材料)(?:自述|记录)|简历记录|经本人确认/
const actionVerbs = ['主导', '统筹', '独立', '负责', '推动', '组织', '设计', '搭建', '建设', '参与', '协同', '支持', '协助', '承担']
const canonicalBusinessEvidencePath = /^(?:experience\[\d+\]\.(?:responsibilities|achievements)\[\d+\]|projects\[\d+\]\.(?:description|achievements\[\d+\]))$/

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
  const retainedEvidencePaths = new Set<string>()
  const safeUsageByPath = new Map<string, string>()
  const declaredStablePaths = new Set<string>()
  const declaredCustomizedPaths = new Set<string>()
  const careerAnchorPaths = new Set<string>()
  const pillars = Array.isArray(plan.evidence_pillars) ? plan.evidence_pillars : []

  plan.evidence_pillars = pillars.flatMap(pillar => {
    if (!pillar || typeof pillar !== 'object') return []
    const row = pillar as ResumePlan
    const evidence = Array.isArray(row.selected_evidence) ? row.selected_evidence : []
    row.selected_evidence = evidence.filter(item => {
      if (!item || typeof item !== 'object') return false
      const evidenceRow = item as ResumePlan
      const sourcePath = typeof evidenceRow.source_path === 'string' ? evidenceRow.source_path : ''
      const sourceValue = valueAtSourcePath(sourceResume, sourcePath)
      const sourceQuote = typeof sourceValue === 'string' ? sourceValue.trim() : ''
      const safeUsage = sourceQuote ? safeEvidenceUsage(sourceQuote) : ''
      const keep = Boolean(
        sourcePath
        && canonicalBusinessEvidencePath.test(sourcePath)
        && sourceQuote
        && safeUsage
        && !retainedEvidencePaths.has(sourcePath)
      )

      if (!keep) {
        if (sourcePath && !retainedEvidencePaths.has(sourcePath)) removedPaths.add(sourcePath)
        return false
      }

      evidenceRow.source_quote = sourceQuote
      evidenceRow.safe_usage = safeUsage
      evidenceRow.verification_status = selfReportedPattern.test(sourceQuote) ? 'self_reported' : 'verified'
      evidenceRow.source_scope = sourcePath.match(/^(?:experience|projects)\[\d+\]/)?.[0]
        || sourcePath.split('.')[0]
      evidenceRow.source_action_verb = actionVerbs.find(verb => sourceQuote.includes(verb)) || ''
      evidenceRow.usage_layer = evidenceRow.usage_layer === 'stable_core' ? 'stable_core' : 'job_customized'
      evidenceRow.usage_role = ['career_anchor', 'jd_primary', 'jd_adjacent'].includes(String(evidenceRow.usage_role))
        ? evidenceRow.usage_role
        : 'jd_adjacent'
      if (evidenceRow.usage_layer === 'stable_core') declaredStablePaths.add(sourcePath)
      else declaredCustomizedPaths.add(sourcePath)
      if (evidenceRow.usage_role === 'career_anchor') careerAnchorPaths.add(sourcePath)
      retainedEvidencePaths.add(sourcePath)
      safeUsageByPath.set(sourcePath, safeUsage)
      return true
    })
    return (row.selected_evidence as unknown[]).length ? [row] : []
  })

  const uniqueRetainedPaths = (value: unknown, scope?: string) => [...new Set(
    (Array.isArray(value) ? value : []).filter((path): path is string => (
      typeof path === 'string'
      && retainedEvidencePaths.has(path)
      && (!scope || path.startsWith(`${scope}.`))
    ))
  )]

  const rawLayers = plan.resume_layers && typeof plan.resume_layers === 'object'
    ? plan.resume_layers as ResumePlan
    : {}
  const stableCorePaths = uniqueRetainedPaths([
    ...(Array.isArray(rawLayers.stable_core_evidence_paths) ? rawLayers.stable_core_evidence_paths : []),
    ...declaredStablePaths,
  ])
  if (!stableCorePaths.length) {
    const fallbackStablePath = [...careerAnchorPaths][0]
      || [...retainedEvidencePaths].find(path => path.startsWith('experience['))
    if (fallbackStablePath) stableCorePaths.push(fallbackStablePath)
  }
  const stableCorePathSet = new Set(stableCorePaths)
  plan.resume_layers = {
    stable_core_evidence_paths: stableCorePaths,
    job_customized_evidence_paths: uniqueRetainedPaths([
      ...(Array.isArray(rawLayers.job_customized_evidence_paths) ? rawLayers.job_customized_evidence_paths : []),
      ...declaredCustomizedPaths,
    ])
      .filter(path => !stableCorePathSet.has(path)),
    customization_rationale: typeof rawLayers.customization_rationale === 'string'
      ? rawLayers.customization_rationale
      : '',
  }

  const rawBudget = plan.content_budget && typeof plan.content_budget === 'object'
    ? plan.content_budget as ResumePlan
    : {}
  const requestedMode = rawBudget.mode
  const mode = requestedMode === 'minimal_transfer' || requestedMode === 'reconstruct_targeted'
    ? requestedMode
    : 'preserve_compact'
  const modeDefaults = mode === 'minimal_transfer'
    ? { minimum: 3, target: 6, maxBullets: 10, maxProjects: 1, softMinChars: 600, maxChars: 1200 }
    : mode === 'reconstruct_targeted'
      ? { minimum: 7, target: 12, maxBullets: 18, maxProjects: 3, softMinChars: 1100, maxChars: 2300 }
      : { minimum: 4, target: 7, maxBullets: 12, maxProjects: 2, softMinChars: 800, maxChars: 1400 }
  const clampInteger = (value: unknown, minimum: number, maximum: number, fallback: number) => {
    const normalized = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
    return Math.min(maximum, Math.max(minimum, normalized))
  }
  const maxProjectCount = clampInteger(
    rawBudget.max_project_count,
    0,
    modeDefaults.maxProjects,
    modeDefaults.maxProjects
  )

  const rawExperienceRows = Array.isArray(plan.experience_plan) ? plan.experience_plan : []
  const experienceRowsByPath = new Map<string, ResumePlan>()
  for (const item of rawExperienceRows) {
    if (!item || typeof item !== 'object') continue
    const row = item as ResumePlan
    const sourcePath = typeof row.source_path === 'string' ? row.source_path : ''
    if (/^experience\[\d+\]$/.test(sourcePath) && !experienceRowsByPath.has(sourcePath)) {
      experienceRowsByPath.set(sourcePath, row)
    }
  }
  plan.experience_plan = sourceResume.experience.map((experience, index) => {
    const sourcePath = `experience[${index}]`
    const row = experienceRowsByPath.get(sourcePath) || {}
    const requestedPaths = uniqueRetainedPaths(row.selected_evidence_paths, sourcePath)
    const scopedStablePaths = stableCorePaths.filter(path => path.startsWith(`${sourcePath}.`))
    const selectedPaths = requestedPaths.length ? requestedPaths : scopedStablePaths
    const requestedTreatment = row.treatment

    if (
      !selectedPaths.length
      || ((requestedTreatment === 'timeline_line' || requestedTreatment === 'continuity_only') && !scopedStablePaths.length)
    ) {
      return {
        source_path: sourcePath,
        company: experience.company,
        position: experience.position,
        time_range: experience.time_range,
        treatment: 'timeline_line',
        bullet_budget: 0,
        selected_evidence_paths: [],
        rewrite_angle: '',
      }
    }

    const treatment = requestedTreatment === 'expand' && selectedPaths.length >= 2 ? 'expand' : 'compress'
    const minBudget = treatment === 'expand' ? 2 : 1
    const maxBudget = Math.min(treatment === 'expand' ? 4 : 2, selectedPaths.length)
    return {
      source_path: sourcePath,
      company: experience.company,
      position: experience.position,
      time_range: experience.time_range,
      treatment,
      bullet_budget: clampInteger(row.bullet_budget, minBudget, maxBudget, maxBudget),
      selected_evidence_paths: selectedPaths,
      rewrite_angle: typeof row.rewrite_angle === 'string' ? row.rewrite_angle : '',
    }
  })

  const rawProjectRows = Array.isArray(plan.project_plan) ? plan.project_plan : []
  const projectRowsByPath = new Map<string, ResumePlan>()
  const orderedProjectPaths: string[] = []
  const sourceProjects = sourceResume.projects || []
  for (const item of rawProjectRows) {
    if (!item || typeof item !== 'object') continue
    const row = item as ResumePlan
    const sourcePath = typeof row.source_path === 'string' ? row.source_path : ''
    const projectIndex = Number(sourcePath.match(/^projects\[(\d+)\]$/)?.[1])
    if (Number.isInteger(projectIndex) && sourceProjects[projectIndex] && !projectRowsByPath.has(sourcePath)) {
      projectRowsByPath.set(sourcePath, row)
      orderedProjectPaths.push(sourcePath)
    }
  }
  for (let index = 0; index < sourceProjects.length; index += 1) {
    const sourcePath = `projects[${index}]`
    if (!projectRowsByPath.has(sourcePath)) orderedProjectPaths.push(sourcePath)
  }
  const selectedProjectEvidencePaths = (sourcePath: string) => {
    const row = projectRowsByPath.get(sourcePath) || {}
    const requestedPaths = uniqueRetainedPaths(row.selected_evidence_paths, sourcePath)
    return requestedPaths.length
      ? requestedPaths
      : row.treatment === 'include'
        ? [...retainedEvidencePaths].filter(path => path.startsWith(`${sourcePath}.`))
        : []
  }
  const candidateProjectPaths = orderedProjectPaths.filter(sourcePath => (
    projectRowsByPath.get(sourcePath)?.treatment === 'include'
    && selectedProjectEvidencePaths(sourcePath).length > 0
  ))
  const stableProjectScopes = new Set(stableCorePaths
    .map(path => path.match(/^projects\[\d+\]/)?.[0])
    .filter((path): path is string => Boolean(path)))
  const prioritizedProjectPaths = [
    ...candidateProjectPaths.filter(path => stableProjectScopes.has(path)),
    ...candidateProjectPaths.filter(path => !stableProjectScopes.has(path)),
  ]
  const includedProjectPaths = new Set(prioritizedProjectPaths.slice(0, maxProjectCount))
  const generatedOmitReasons: ResumePlan[] = []
  plan.project_plan = orderedProjectPaths.map(sourcePath => {
    const projectIndex = Number(sourcePath.match(/^projects\[(\d+)\]$/)?.[1])
    const project = sourceProjects[projectIndex]
    const row = projectRowsByPath.get(sourcePath) || {}
    const selectedPaths = selectedProjectEvidencePaths(sourcePath)
    const canInclude = includedProjectPaths.has(sourcePath)

    if (!canInclude) {
      if (row.treatment === 'include') {
        generatedOmitReasons.push({
          source_path: sourcePath,
          reason: selectedPaths.length
            ? '超过当前内容预算允许的项目数量'
            : '清洗后没有可用的白名单项目证据',
        })
      }
      return {
        source_path: sourcePath,
        name: project.name,
        role: project.role,
        treatment: 'omit',
        bullet_budget: 0,
        selected_evidence_paths: [],
        rewrite_angle: '',
      }
    }

    const maxBudget = Math.min(3, selectedPaths.length)
    return {
      source_path: sourcePath,
      name: project.name,
      role: project.role,
      treatment: 'include',
      bullet_budget: clampInteger(row.bullet_budget, 1, maxBudget, maxBudget),
      selected_evidence_paths: selectedPaths,
      rewrite_angle: typeof row.rewrite_angle === 'string' ? row.rewrite_angle : '',
    }
  })

  const selectedBusinessEvidencePaths = new Set<string>()
  let businessBulletCapacity = 0
  for (const planKey of ['experience_plan', 'project_plan']) {
    const rows = plan[planKey] as ResumePlan[]
    for (const row of rows) {
      for (const path of uniqueRetainedPaths(row.selected_evidence_paths, String(row.source_path || ''))) {
        selectedBusinessEvidencePaths.add(path)
      }
      if (typeof row.bullet_budget === 'number' && row.bullet_budget > 0) {
        businessBulletCapacity += Math.trunc(row.bullet_budget)
      }
    }
  }
  const sanitizedLayers = plan.resume_layers as ResumePlan
  const activeStablePaths = uniqueRetainedPaths(sanitizedLayers.stable_core_evidence_paths)
    .filter(path => selectedBusinessEvidencePaths.has(path))
  if (!activeStablePaths.length) {
    const fallbackStablePath = [...selectedBusinessEvidencePaths]
      .find(path => path.startsWith('experience['))
      || [...selectedBusinessEvidencePaths][0]
    if (fallbackStablePath) activeStablePaths.push(fallbackStablePath)
  }
  const activeStablePathSet = new Set(activeStablePaths)
  plan.resume_layers = {
    stable_core_evidence_paths: activeStablePaths,
    job_customized_evidence_paths: uniqueRetainedPaths(sanitizedLayers.job_customized_evidence_paths)
      .filter(path => selectedBusinessEvidencePaths.has(path) && !activeStablePathSet.has(path)),
    customization_rationale: sanitizedLayers.customization_rationale,
  }
  plan.evidence_pillars = (plan.evidence_pillars as ResumePlan[]).flatMap(pillar => {
    const evidence = Array.isArray(pillar.selected_evidence)
      ? pillar.selected_evidence.flatMap(item => {
        if (!item || typeof item !== 'object') return []
        const evidenceRow = item as ResumePlan
        const sourcePath = evidenceRow.source_path
        if (typeof sourcePath !== 'string' || !selectedBusinessEvidencePaths.has(sourcePath)) return []
        evidenceRow.usage_layer = activeStablePathSet.has(sourcePath) ? 'stable_core' : 'job_customized'
        return [evidenceRow]
      })
      : []
    if (!evidence.length) return []
    pillar.selected_evidence = evidence
    return [pillar]
  })
  const eligibleEvidenceCount = selectedBusinessEvidencePaths.size
  const minimumBusinessBullets = Math.min(
    modeDefaults.minimum,
    eligibleEvidenceCount,
    businessBulletCapacity
  )
  const targetBusinessBullets = Math.max(
    minimumBusinessBullets,
    Math.min(modeDefaults.target, eligibleEvidenceCount, businessBulletCapacity)
  )
  const minTotalBulletCapacity = Math.min(
    modeDefaults.maxBullets,
    targetBusinessBullets + (sourceResume.skills.hard_skills.length ? 1 : 0)
  )
  plan.content_budget = {
    mode,
    eligible_business_evidence_count: eligibleEvidenceCount,
    min_visible_experience_count: sourceResume.experience.length,
    min_business_bullets: minimumBusinessBullets,
    target_business_bullets: targetBusinessBullets,
    max_total_bullets: clampInteger(
      rawBudget.max_total_bullets,
      minTotalBulletCapacity,
      modeDefaults.maxBullets,
      modeDefaults.maxBullets
    ),
    max_project_count: maxProjectCount,
    soft_min_markdown_chars: modeDefaults.softMinChars,
    max_markdown_chars: clampInteger(
      rawBudget.max_markdown_chars,
      modeDefaults.softMinChars,
      modeDefaults.maxChars,
      modeDefaults.maxChars
    ),
    lower_bound_exception_reason: eligibleEvidenceCount < modeDefaults.minimum
      || businessBulletCapacity < modeDefaults.minimum
      ? `清洗后有 ${eligibleEvidenceCount} 条合格业务证据，当前行预算最多输出 ${businessBulletCapacity} 条业务正文，不得用重复、扩写或套话补足。`
      : typeof rawBudget.lower_bound_exception_reason === 'string'
        ? rawBudget.lower_bound_exception_reason
        : '',
  }

  const skills = Array.isArray(plan.skills_to_feature) ? plan.skills_to_feature : []
  const seenSkills = new Set<string>()
  plan.skills_to_feature = skills.filter(item => {
    if (!item || typeof item !== 'object') return false
    const row = item as ResumePlan
    const sourcePath = typeof row.source_path === 'string' ? row.source_path : ''
    const sourceValue = valueAtSourcePath(sourceResume, sourcePath)
    if (typeof sourceValue !== 'string' || seenSkills.has(sourceValue)) return false
    row.skill = sourceValue
    seenSkills.add(sourceValue)
    return true
  }).slice(0, 8)

  const keywordMap = Array.isArray(plan.safe_keyword_map) ? plan.safe_keyword_map : []
  plan.safe_keyword_map = keywordMap.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const row = item as ResumePlan
    const sourcePath = typeof row.source_path === 'string' ? row.source_path : ''
    const safeUsage = safeUsageByPath.get(sourcePath)
    if (!safeUsage || !selectedBusinessEvidencePaths.has(sourcePath)) return []
    return [{
      jd_term: typeof row.jd_term === 'string' ? row.jd_term : '',
      source_path: sourcePath,
      safe_phrase: safeUsage,
    }]
  })

  const omitReasons = Array.isArray(plan.omit_reasons) ? plan.omit_reasons : []
  plan.omit_reasons = [
    ...omitReasons.filter(item => {
      if (!item || typeof item !== 'object') return false
      const sourcePath = (item as ResumePlan).source_path
      return typeof sourcePath !== 'string'
        || !sourcePath.startsWith('projects[')
        || !includedProjectPaths.has(sourcePath)
    }),
    ...generatedOmitReasons,
  ]

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
    resume_layers: plan.resume_layers,
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
    const sectionHeading = line.match(/^##\s+(.+)/)
    if (sectionHeading && projectSectionPattern.test(sectionHeading[1].trim())) {
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
  const keptByScope = new Map<string, string[]>()
  const output: string[] = []
  let section = ''
  let entry = ''
  for (const line of markdown.split(/\r?\n/)) {
    const h2 = line.match(/^##\s+(.+)/)
    const h3 = line.match(/^###\s+(.+)/)
    if (h2) {
      section = h2[1].trim()
      entry = ''
      output.push(line)
      continue
    }
    if (h3) {
      entry = h3[1].trim()
      output.push(line)
      continue
    }
    if (!/^\s*[-*]\s+/.test(line)) {
      output.push(line)
      continue
    }

    const content = line.replace(/^\s*[-*]\s+/, '').trim()
    const scope = `${section}\u0000${entry}`
    const kept = keptByScope.get(scope) || []
    const currentNumbers = [...content.matchAll(numberPattern)].map(match => normalize(match[0])).filter(Boolean)
    const duplicate = kept.some(previous => {
      const previousNumbers = [...previous.matchAll(numberPattern)].map(match => normalize(match[0])).filter(Boolean)
      const sharesNumber = currentNumbers.some(number => previousNumbers.includes(number))
      return similarity(content, previous) >= 0.78 || (sharesNumber && similarity(content, previous) >= 0.35)
    })
    if (!duplicate) {
      kept.push(content)
      keptByScope.set(scope, kept)
      output.push(line)
    }
  }
  return output.join('\n')
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
    const unsupportedNumbers = (value: string) => [...value.matchAll(numberPattern)]
      .map(match => match[0].trim())
      .filter(atom => atom && !sourceNormalized.includes(normalize(atom)))
    const unsupported = unsupportedNumbers(line)
    if (!unsupported.length) return [line]
    const bullet = line.match(/^(\s*[-*]\s+)(.+)$/)
    if (bullet) {
      const safeSegments = bullet[2]
        .split(/[；;]/)
        .map(segment => segment.trim())
        .filter(segment => segment && !unsupportedNumbers(segment).length)
      return safeSegments.length ? [`${bullet[1]}${safeSegments.join('；')}`] : []
    }
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

const workSectionPattern = /^(?:(?:核心|主要)?(?:工作|职业|任职|实习|实践)(?:经历|经验|履历))(?:[（(].*[）)])?$/
const projectSectionPattern = /^(?:(?:核心|代表|精选)?项目(?:经历|经验|成果|案例)?)(?:[（(].*[）)])?$/

function removeEmptyBusinessSections(markdown: string) {
  const lines = markdown.split(/\r?\n/)
  const output: string[] = []
  for (let index = 0; index < lines.length;) {
    const heading = lines[index].match(/^##\s+(.+)/)
    if (!heading) {
      output.push(lines[index])
      index += 1
      continue
    }

    let end = index + 1
    while (end < lines.length && !/^##\s+/.test(lines[end])) end += 1
    const title = heading[1].trim()
    const isBusinessSection = workSectionPattern.test(title) || projectSectionPattern.test(title)
    const hasContent = lines.slice(index + 1, end).some(line => {
      const content = line.trim()
      return content && !/^[-*_]{3,}$/.test(content)
    })
    if (!isBusinessSection || hasContent) output.push(...lines.slice(index, end))
    index = end
  }
  return output.join('\n')
}

function removeOrphanBusinessHeadings(markdown: string, sourceResume: ResumeStructure) {
  const lines = markdown.split(/\r?\n/)
  const output: string[] = []
  const timelineEntries = new Map<string, string>()
  let section: 'work' | 'project' | 'other' = 'other'

  for (let index = 0; index < lines.length;) {
    const sectionHeading = lines[index].match(/^##\s+(.+)/)
    if (sectionHeading) {
      const title = sectionHeading[1].trim()
      section = workSectionPattern.test(title)
        ? 'work'
        : projectSectionPattern.test(title)
          ? 'project'
          : 'other'
      output.push(lines[index])
      index += 1
      continue
    }

    const entryHeading = lines[index].match(/^###\s+(.+)/)
    if (!entryHeading || section === 'other') {
      output.push(lines[index])
      index += 1
      continue
    }

    let end = index + 1
    while (end < lines.length && !/^#{2,3}\s+/.test(lines[end])) end += 1
    const bodyLines = lines.slice(index + 1, end)
    const hasBody = bodyLines.some(line => {
      const content = line.trim()
      return content && !/^[-*_]{3,}$/.test(content)
    })
    if (hasBody) {
      output.push(...lines.slice(index, end))
    } else if (section === 'work') {
      const title = entryHeading[1]
      const sourceExperience = sourceResume.experience.find(item => (
        title.includes(item.company) && (!item.position || title.includes(item.position))
      )) || sourceResume.experience.find(item => title.includes(item.company))
      if (sourceExperience) {
        timelineEntries.set(
          `${sourceExperience.company}|${sourceExperience.position}|${sourceExperience.time_range}`,
          `${sourceExperience.company}｜${sourceExperience.position}｜${sourceExperience.time_range}`
        )
      }
    }
    index = end
  }

  let cleaned = removeEmptyBusinessSections(output.join('\n'))
  const timelineLines = [...timelineEntries.values()].filter(line => !cleaned.includes(line))
  if (!timelineLines.length) return cleaned

  const insertion = `## 其他经历\n\n${timelineLines.join('\n\n')}`
  const supportingSection = cleaned.search(/^##\s+(?:教育背景|教育经历|专业技能|技能清单|技能)\s*$/m)
  if (supportingSection >= 0) {
    cleaned = `${cleaned.slice(0, supportingSection).trimEnd()}\n\n${insertion}\n\n${cleaned.slice(supportingSection)}`
  } else {
    cleaned = `${cleaned.trimEnd()}\n\n${insertion}`
  }
  return cleaned
}

export function postProcessV44Resume(markdown: string, sourceResume: ResumeStructure) {
  const cleaned = stripInternalAuditPhrases(removeUnsupportedNumericClaims(
    compactSupportingLists(dedupeResumeBullets(stripMarkdownFence(markdown))),
    sourceResume
  ))
  return removeOrphanBusinessHeadings(cleaned, sourceResume)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
