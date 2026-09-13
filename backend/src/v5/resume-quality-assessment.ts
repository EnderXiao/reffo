import type { ResumeExtractionCandidate } from '@/v5/types'

type Fact = ResumeExtractionCandidate['factCandidates'][number]
type Assessment = ResumeExtractionCandidate['qualityAssessment']
type Finding = Assessment['weaknesses'][number]

const BUSINESS_TYPES = new Set(['responsibility', 'action', 'deliverable', 'result'])
const CAREER_KINDS = new Set(['experience', 'internship'])

function unique<T>(values: T[]) {
  return [...new Set(values)]
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function finding(statement: string, facts: Fact[], sourceBlockIds: string[] = []): Finding {
  return {
    statement,
    factLocalIds: unique(facts.map(fact => fact.factLocalId)).sort(compareText),
    sourceBlockIds: unique([...sourceBlockIds, ...facts.map(fact => fact.sourceBlockId)]).sort(compareText),
  }
}

function compactLabels(values: string[], limit: number) {
  const counts = new Map<string, number>()
  for (const value of values) {
    const label = value.replace(/^[-*#\s]+/u, '').trim().replace(/[。；;.!！?？]+$/u, '')
    if (!label || label.length > 40) continue
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts].sort((left, right) => right[1] - left[1]
    || left[0].length - right[0].length || compareText(left[0], right[0]))
    .slice(0, limit).map(([label]) => label)
}

/**
 * P01 only evaluates its own transport shard. Absence and completeness claims
 * from that prose cannot describe a whole resume, even when they cite blocks.
 * Build document findings from the merged facts instead; references retain the
 * actual local problems without promoting a shard's missing context to a gap.
 */
export function assessResumeDocumentQuality(candidate: ResumeExtractionCandidate): Assessment {
  const facts = candidate.factCandidates
  const usable = facts.filter(fact => fact.proposedStatus !== 'excluded'
    && !fact.riskFlags.some(flag => ['prompt_injection_like_text', 'future_or_planned', 'conflicting'].includes(flag)))
  const factsForIds = (ids: string[]) => {
    const selected = new Set(ids)
    return facts.filter(fact => selected.has(fact.factLocalId))
  }
  const business = usable.filter(fact => BUSINESS_TYPES.has(fact.claimType))
  const results = business.filter(fact => fact.claimType === 'result')
  const actions = business.filter(fact => ['action', 'responsibility', 'deliverable'].includes(fact.claimType))
  const skills = usable.filter(fact => fact.claimType === 'skill')
  const education = usable.filter(fact => fact.claimType === 'education')
  const career = candidate.timelineCandidates.filter(item => CAREER_KINDS.has(item.kind))
  const identity = candidate.identityCandidates.filter(item => item.value.trim()
    && factsForIds(item.factLocalIds).some(fact => fact.proposedStatus !== 'excluded'))
  const hasName = identity.some(item => item.field === 'name')
  const hasContact = identity.some(item => item.field === 'phone' || item.field === 'email')
  const hasEducation = education.length > 0 || candidate.timelineCandidates.some(item => item.kind === 'education')
  const strengths: Finding[] = []
  const issues: Array<{ priority: number; key: string; finding: Finding; suggestion: string }> = []
  const issue = (priority: number, key: string, statement: string, suggestion: string, evidence: Fact[], blocks: string[] = []) => {
    issues.push({ priority, key, finding: finding(statement, evidence, blocks), suggestion })
  }

  if (actions.length > 0) strengths.push(finding('包含具体职责、执行行动或交付物，可据此展开经历描述。', actions))
  if (results.length > 0) strengths.push(finding('包含结果材料，可结合原文中的统计口径和归因边界呈现成果。', results))
  if (skills.length > 0) strengths.push(finding('列有技能或方法材料，可与相关经历中的行动证据关联。', skills))
  if (hasEducation) strengths.push(finding('提供教育背景材料，可用于核对专业与学历信息。', education.length > 0 ? education
    : factsForIds(candidate.timelineCandidates.filter(item => item.kind === 'education').flatMap(item => item.factLocalIds))))
  const completeCareer = career.filter(item => item.organization && item.title && item.start && item.end)
  if (completeCareer.length > 0) strengths.push(finding('提供任职机构、岗位及起止时间，支持梳理职业经历。',
    factsForIds(completeCareer.flatMap(item => item.factLocalIds))))

  if (candidate.conflicts.length > 0) issue(100, 'conflicts', '部分材料存在表述或指标口径冲突，需要确认后再用于投递。',
    '逐项核对冲突的原文、指标定义与归因，确认前保留限定或不采用争议表述。',
    factsForIds(candidate.conflicts.flatMap(item => item.factLocalIds)))
  const importantUnmapped = candidate.unmappedFragments.filter(item => item.importance === 'high')
  if (importantUnmapped.length > 0) issue(95, 'unmapped', '仍有重要原文片段未进入事实库，当前分析可能未覆盖这些材料。',
    '核对未映射的重要原文，补充清晰的经历归属或事实描述后重新分析。', [], importantUnmapped.map(item => item.sourceBlockId))
  const uncertain = business.filter(fact => fact.riskFlags.includes('uncertain')
    || /待确认|待核实|待核验|待补充|待复核/u.test(fact.verbatimText))
  if (uncertain.length > 0) issue(90, 'uncertain', '部分职责或成果材料带有待确认限定，不能直接写成已核实结论。',
    '核对这些材料的指标口径、个人贡献和完成状态；确认前保留原有限定。', uncertain)
  if (!hasName || !hasContact) {
    const missing = [!hasName ? '姓名' : '', !hasContact ? '电话或邮箱' : ''].filter(Boolean).join('、')
    issue(85, 'identity', `整份材料未提取到${missing}。`, `补充可用于投递的${missing}。`, [])
  }
  if (actions.length === 0) issue(80, 'actions', '整份材料尚缺少具体职责、执行行动或交付物证据。',
    '按实际经历补充问题背景、个人职责、执行行动及交付物。', business)
  const planned = facts.filter(fact => fact.riskFlags.includes('future_or_planned')
    && !fact.riskFlags.includes('prompt_injection_like_text'))
  if (planned.length > 0) issue(75, 'planned', '部分内容仍属于计划或未来状态，不能当作已经完成的经历或成果。',
    '明确区分已完成事项与规划；投递正文仅使用符合原文状态的表述。', planned)
  if (results.length === 0 && business.length > 0) issue(70, 'results', '已有职责或行动描述，但尚未提取到明确结果证据。',
    '补充实际产出、业务变化或可观察结果，无法量化时使用真实定性结果。', business)
  const metricFragments = usable.filter(fact => !['identity', 'timeline'].includes(fact.claimType)
    && /^\s*[-+]?\d[\d\s.,~～—–\-/%％+×x倍万亿个年月天人元]*\s*$/u.test(fact.verbatimText))
  if (metricFragments.length > 0) issue(65, 'metric_fragments', '存在独立成行的数值，展示时需要与对应指标及统计口径一起呈现。',
    '将这些数值与原文中的指标名称、对象、周期及归因说明配对，避免脱离上下文展示。', metricFragments)
  if (!hasEducation) issue(60, 'education', '整份材料尚未提取到教育背景。',
    '如岗位需要核对学历或专业，补充学校、专业、学历及就读时间。', [])
  if (career.length > 0 && completeCareer.length === 0) issue(55, 'timeline', '已提取的任职时间线尚缺少完整的机构、岗位或起止时间信息。',
    '核对各段任职的机构、岗位及起止时间，避免经历归属含糊。', factsForIds(career.flatMap(item => item.factLocalIds)))
  const team = business.filter(fact => fact.riskFlags.includes('team_attribution')
    || ['contributed', 'supported'].includes(fact.attributionLevel))
  if (team.length > 0) issue(50, 'attribution', '部分成果属于团队级或参与贡献，最终表达需要保留个人职责边界。',
    '区分个人负责、协作参与和团队结果，不把参与贡献改写成独立主导。', team)

  const selected = issues.sort((left, right) => right.priority - left.priority || compareText(left.key, right.key)).slice(0, 5)
  const roles = compactLabels(career.map(item => (item.title ?? '').split(/[；;|｜]/u)[0] ?? ''), 3)
  const skillLabels = compactLabels(skills.map(fact => fact.verbatimText), 3)
  const summary = [
    roles.length > 0 ? `经历涉及${roles.join('、')}等角色。` : '',
    skillLabels.length > 0 ? `技能与方法材料包括${skillLabels.join('、')}。` : '',
    business.length > 0 ? `材料包含${[actions.length > 0 ? '职责与行动' : '', results.length > 0 ? '成果' : '', hasEducation ? '教育背景' : ''].filter(Boolean).join('、')}证据。`
      : hasEducation ? '材料提供教育背景，具体业务经历与成果仍需补充。' : '当前材料中的具体业务经历与成果证据有限。',
  ].filter(Boolean).join('')
  return {
    scoreInputs: candidate.qualityAssessment.scoreInputs,
    strengths: strengths.slice(0, 5),
    weaknesses: selected.map(item => item.finding),
    suggestions: selected.map(item => ({ statement: item.suggestion, sourceBlockIds: item.finding.sourceBlockIds })),
    capabilitySummary: summary,
  }
}
