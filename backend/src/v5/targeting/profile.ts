import type { CanonicalSourceDocument, JobRequirementBundle, ValidationIssue, ValidationResult } from '@/v5/types'
import { validateJobExtractionCandidate } from '@/v5/evidence'
import { writingIssue, writingNumbers } from '@/v5/writing/facts'
import type { JobSuccessProfile, TargetedJobExtraction } from '@/v5/targeting/contracts'

export function profileNodes(profile: JobSuccessProfile) {
  return [...profile.context, ...profile.tasks, ...profile.outcomes, ...profile.successConditions, ...profile.attributes]
}

function summaryQualifications(text: string) {
  const qualifications: Array<{ category: 'education' | 'experience'; quote: string; start: number; end: number }> = []
  // Only independent metadata fields qualify; do not infer thresholds from job prose or titles.
  if (text.length > 120 || !/[/|｜·]/u.test(text)) return qualifications
  const patterns = [
    { category: 'education' as const, pattern: /^(?:学历\s*[:：]\s*)?((?:高中|中专|大专|专科|本科|学士|硕士|博士)(?:及以上|以上|及以下|以下)?(?:学历|学位)?)$/u },
    { category: 'experience' as const, pattern: /^(?:(?:工作经验|经验|工作年限|年限)\s*[:：]\s*)?(\d+(?:\.\d+)?(?:\s*[-–—~～至到]\s*\d+(?:\.\d+)?)?\s*年(?:及以上|以上|及以下|以下|以内|左右)?(?:工作经验|经验)?)$/u },
  ]
  for (const part of text.matchAll(/[^/|｜·]+/gu)) {
    const value = part[0].trim()
    for (const { category, pattern } of patterns) {
      const quote = value.match(pattern)?.[1]
      if (!quote) continue
      const start = part.index + part[0].indexOf(quote)
      qualifications.push({ category, quote, start, end: start + quote.length })
    }
  }
  return qualifications
}

function isPureSummaryMetadata(text: string, basicInfo: TargetedJobExtraction['basicInfo']) {
  const qualifications = summaryQualifications(text)
  if (!qualifications.length) return false
  const basicValues = new Set(Object.values(basicInfo).filter((value): value is string => Boolean(value)))
  const pay = /^(?:(?:薪资|薪酬|工资)\s*[:：]\s*)?(?:\d+(?:\.\d+)?(?:\s*[-–—~～至到]\s*\d+(?:\.\d+)?)?\s*(?:K|万|元)(?:\/月)?|\d{1,2}薪|薪资面议|面议)$/iu
  return text.split(/[/|｜·]/u).map(part => part.trim()).filter(Boolean).every(part => {
    const withoutLabel = part.replace(/^(?:工作地点|地点|城市|公司|职位|岗位|学历|工作经验|经验|年限)\s*[:：]\s*/u, '')
    return basicValues.has(withoutLabel) || pay.test(part) || qualifications.some(item => item.quote === withoutLabel)
  })
}

function qualitativeYearConflict(conflict: JobSuccessProfile['conflicts'][number], sourceTexts: string[]) {
  if (!/年限/u.test(conflict.description) || !/口径|范围|冲突|不一致|矛盾/u.test(conflict.description)
    || /学历|学位|薪资|语言|签证|业务要求|职责差异|职责冲突/u.test(conflict.description)
    || sourceTexts.length !== conflict.sourceBlockIds.length || sourceTexts.length < 2) return null
  const explicitYears: string[] = []
  const qualitativeQuotes: string[] = []
  for (const source of sourceTexts) {
    const summaryYears = summaryQualifications(source).filter(item => item.category === 'experience')
    if (summaryYears.length) {
      explicitYears.push(...summaryYears.map(item => item.quote))
      continue
    }
    const text = source.replace(/^\s*(?:[-*]\s+|\d+[、.．]\s*)/u, '')
    const qualitative = text.match(/(?:多年|一定|丰富)(?:的)?[^，。；;、：:\d\n]{0,24}经验/u)?.[0]
    // A second numeric condition, negation or another type of source needs its original conflict review.
    if (!qualitative || /\d|[零一二两三四五六七八九十百]+\s*年/u.test(text)
      || /不得|不接受|不能|不足|未满|不满|不具备|没有|无需|不要求|仅限|不超过|不低于|至少|至多/u.test(text)) return null
    qualitativeQuotes.push(qualitative)
  }
  if (explicitYears.length !== 1 || !qualitativeQuotes.length) return null
  return { yearQuote: explicitYears[0], qualitativeQuotes: [...new Set(qualitativeQuotes)] }
}

export function validateTargetedJobExtraction(document: CanonicalSourceDocument, value: TargetedJobExtraction): ValidationResult<TargetedJobExtraction> {
  const { jobSuccessProfile, ...legacy } = value
  const checked = validateJobExtractionCandidate(document, legacy)
  if (!checked.passed) return { passed: false, issues: checked.issues }
  const candidate = { ...(checked.value ?? legacy), jobSuccessProfile: structuredClone(jobSuccessProfile) }
  const profile = candidate.jobSuccessProfile
  const issues: ValidationIssue[] = [...checked.issues]
  const report = (code: string, path: string, message: string, severity: ValidationIssue['severity'] = 'error') => {
    issues.push(writingIssue(code, path, [], message, severity))
  }
  const blocks = new Map(document.blocks.map(block => [block.sourceBlockId, block]))
  const metadataCandidates = candidate.requirementCandidates.filter(item => {
    const block = blocks.get(item.sourceBlockId)
    if (!block || block.inputRiskFlags.length || !isPureSummaryMetadata(block.text, candidate.basicInfo)) return false
    // Quotes were validated above. In a wholly metadata block, only complete standalone qualifications are match targets.
    const independentQualification = summaryQualifications(block.text).some(qualification => {
      if (item.category !== qualification.category) return false
      if (item.verbatimText === qualification.quote) return true
      return [...block.text.matchAll(/[^/|｜·]+/gu)].some(part => part[0].trim() === item.verbatimText
        && part.index <= qualification.start && part.index + part[0].length >= qualification.end)
    })
    return !independentQualification
  })
  if (metadataCandidates.length) {
    const removedIds = new Set(metadataCandidates.map(item => item.requirementLocalId))
    const retain = (ids: string[]) => ids.filter(id => !removedIds.has(id))
    candidate.basicInfoSourceBlockIds = [...new Set([...candidate.basicInfoSourceBlockIds, ...metadataCandidates.map(item => item.sourceBlockId)])]
    candidate.requirementCandidates = candidate.requirementCandidates.filter(item => !removedIds.has(item.requirementLocalId))
    profile.requirements = profile.requirements.filter(item => !removedIds.has(item.requirementLocalId))
    for (const node of [...profile.tasks, ...profile.attributes]) {
      const originalIds = node.requirementLocalIds
      node.requirementLocalIds = retain(originalIds)
      if (originalIds.length && !node.requirementLocalIds.length && originalIds.some(id => removedIds.has(id))) {
        report('JOB_PROFILE_METADATA_NODE_INVALID', node.id, '该任务或能力仅关联招聘摘要元数据。请移除这类虚假能力目标；真正业务任务应引用其业务原文，不把地点薪资作为候选人能力缺口。')
      }
    }
    candidate.explicitCompanySignals = candidate.explicitCompanySignals.map(item => ({ ...item, requirementLocalIds: retain(item.requirementLocalIds) }))
    candidate.explicitLocationSignals = candidate.explicitLocationSignals.map(item => ({ ...item, requirementLocalIds: retain(item.requirementLocalIds) }))
    for (const item of metadataCandidates) report('JOB_PROFILE_SUMMARY_METADATA_REMOVED', item.requirementLocalId,
      '已移除招聘摘要中整行或片段形式的元数据能力要求；地点薪资保留为基本信息，明示学历和年限继续通过独立原文资格核验。', 'warning')
  }
  const requirements = new Map(candidate.requirementCandidates.map(item => [item.requirementLocalId, item]))
  for (const block of document.blocks) {
    if (block.inputRiskFlags.length) continue
    for (const qualification of summaryQualifications(block.text)) {
      const covered = candidate.requirementCandidates.some(item => item.sourceBlockId === block.sourceBlockId
        && item.category === qualification.category && item.verbatimText.includes(qualification.quote)
        && profile.requirements.some(condition => condition.requirementLocalId === item.requirementLocalId
          && condition.sourceQuote.includes(qualification.quote)))
      if (!covered) report('JOB_PROFILE_SUMMARY_QUALIFICATION_MISSING', block.sourceBlockId,
        `招聘摘要中的明示条件“${qualification.quote}”未独立保留。请添加 category=${qualification.category} 的 requirementCandidate，逐字引用该片段并使用 span {start:${qualification.start},end:${qualification.end}}，同步加入 jobSuccessProfile.requirements；该 block 可继续支撑 basicInfo。保留原意，不补单位、不推定年限硬上限。`)
    }
  }
  const nodes = profileNodes(profile), nodeIds = new Set(nodes.map(node => node.id))
  const tasks = new Set(profile.tasks.map(node => node.id)), conditions = new Set(profile.successConditions.map(node => node.id))
  if (nodeIds.size !== nodes.length) report('JOB_PROFILE_DUPLICATE_ID', 'jobSuccessProfile', '画像节点 ID 重复。')
  const checkIds = (ids: string[], legal: Set<string>, path: string) => {
    if (new Set(ids).size !== ids.length || ids.some(id => !legal.has(id))) report('JOB_PROFILE_UNKNOWN_REFERENCE', path, '画像存在未知或重复引用。')
  }
  for (const node of nodes) {
    checkIds(node.provenance.sourceBlockIds, new Set(blocks.keys()), node.id)
    if (node.provenance.sourceBlockIds.some(id => blocks.get(id)?.inputRiskFlags.length)) report('JOB_PROFILE_UNSAFE_SOURCE', node.id, '不允许用注入或隐藏控制片段支撑岗位画像。')
    if (node.provenance.basis !== 'unknown' && !node.provenance.sourceBlockIds.length) report('JOB_PROFILE_SOURCE_MISSING', node.id, '明示或推断判断需要 JD 来源。')
    if (node.provenance.basis === 'inferred' && !node.provenance.reason.trim()) report('JOB_PROFILE_INFERENCE_BASIS_MISSING', node.id, '推断判断缺少简短依据。')
    const sourceTexts = node.provenance.sourceBlockIds.flatMap(id => blocks.get(id)?.text ?? [])
    // A missing unit next to a role is ambiguous, not evidence for a new year threshold.
    const unitlessRanges = sourceTexts.flatMap(text => [...text.matchAll(/(\d+\s*[-~至]\s*\d+)\s*(?=产品经理|工程师|设计师|运营|会计|分析师|顾问)/gu)]
      .map(match => match[1].replace(/\s/g, '')))
    const supportedNumbers = new Set(sourceTexts.flatMap(writingNumbers))
    const ambiguousYears = writingNumbers(node.text).filter(number => number.endsWith('年')
      && !supportedNumbers.has(number) && unitlessRanges.includes(number.slice(0, -1)))
    if (ambiguousYears.length) {
      node.text = node.text.replace(/\d+\s*[-~至]\s*\d+\s*年/gu, value => ambiguousYears.includes(value.replace(/\s/g, ''))
        ? `${value.replace(/\s/g, '').slice(0, -1)}（单位未明）` : value)
      node.provenance.basis = 'inferred'
      node.provenance.confidence = 'low'
      node.provenance.reason = '源文角色前的区间缺少单位，不能认定为年限或必要门槛。'
      const uncertainty = '岗位原文存在未注明单位的经验区间，实际年限要求待确认。'
      if (!profile.unknowns.includes(uncertainty)) profile.unknowns.push(uncertainty)
      for (const condition of profile.requirements) {
        if (node.provenance.sourceBlockIds.includes(requirements.get(condition.requirementLocalId)?.sourceBlockId ?? '')
          && unitlessRanges.some(range => condition.sourceQuote.replace(/\s/g, '').includes(range))) condition.condition = 'unclear'
      }
      report('JOB_PROFILE_UNIT_AMBIGUITY_ALIGNED', node.id, '缺失单位按不确定性记录，不增加年限门槛，也不调用模型修复。', 'warning')
    }
    if (writingNumbers(node.text).some(number => !supportedNumbers.has(number))) report('JOB_PROFILE_NUMBER_UNSUPPORTED', node.id, '画像文字不能引入来源没有的数字或指标。')
  }
  for (const task of profile.tasks) checkIds(task.requirementLocalIds, new Set(requirements.keys()), task.id)
  for (const outcome of profile.outcomes) {
    checkIds(outcome.taskIds, tasks, outcome.id)
    if (!outcome.taskIds.length) report('JOB_PROFILE_TASK_LINK_MISSING', outcome.id, '结果应关联岗位任务。')
    if (outcome.metricQuote !== null && (outcome.provenance.basis !== 'explicit'
      || !outcome.provenance.sourceBlockIds.some(id => blocks.get(id)?.text.includes(outcome.metricQuote!)))) {
      report('JOB_PROFILE_METRIC_UNSUPPORTED', outcome.id, '指标必须逐字来自明示 JD，不能推断数值。')
    }
  }
  for (const condition of profile.successConditions) {
    checkIds(condition.taskIds, tasks, condition.id)
    if (!condition.taskIds.length) report('JOB_PROFILE_TASK_LINK_MISSING', condition.id, '成功条件应关联岗位任务。')
    if (profile.outcomes.some(outcome => outcome.text.replace(/[\s，。；、]/gu, '') === condition.text.replace(/[\s，。；、]/gu, ''))) {
      report('JOB_PROFILE_CONDITION_REPEATS_OUTCOME', condition.id, '成功条件重复了结果目标，仍需补充完成任务所需的过程条件。', 'warning')
    }
  }
  for (const attribute of profile.attributes) {
    checkIds(attribute.taskIds, tasks, attribute.id)
    checkIds(attribute.conditionIds, conditions, attribute.id)
    checkIds(attribute.requirementLocalIds, new Set(requirements.keys()), attribute.id)
    if (!attribute.taskIds.length && !attribute.conditionIds.length && !attribute.requirementLocalIds.length) report('JOB_PROFILE_ATTRIBUTE_UNANCHORED', attribute.id, '属性应关联任务、成功条件或明确岗位要求。')
  }
  for (const [index, condition] of profile.requirements.entries()) {
    const requirement = requirements.get(condition.requirementLocalId)
    if (!requirement || !requirement.verbatimText.includes(condition.sourceQuote)) {
      report('JOB_PROFILE_QUALIFICATION_QUOTE_INVALID', `jobSuccessProfile.requirements[${index}]`, '资格判断的原文摘录不存在。')
      continue
    }
    if (condition.condition === 'necessary'
      && (/优先|加分|最好|例如|preferred|nice.to.have/iu.test(condition.sourceQuote)
        || !/必须|要求|需|至少|以上|不得|required|must|mandatory|minimum/iu.test(condition.sourceQuote))) {
      condition.condition = 'unclear'
      report('JOB_PROFILE_QUALIFICATION_DOWNGRADED', `jobSuccessProfile.requirements[${index}]`, '无法明确认定为必要条件，保留为待判断，不影响生成。', 'warning')
    }
  }
  // The legacy score must not elevate a preference merely because the profile is richer.
  for (const requirement of candidate.requirementCandidates) {
    if (requirement.importance === 'must_have' && !profile.requirements.some(condition => condition.requirementLocalId === requirement.requirementLocalId && condition.condition === 'necessary')) {
      requirement.importance = 'differentiator'
      report('JOB_PROFILE_LEGACY_GATE_DOWNGRADED', requirement.requirementLocalId, '未证实必要条件，不投影为硬门槛。', 'warning')
    }
  }
  profile.conflicts = profile.conflicts.filter((conflict, index) => {
    checkIds(conflict.sourceBlockIds, new Set(blocks.keys()), `jobSuccessProfile.conflicts[${index}]`)
    const sources = conflict.sourceBlockIds.flatMap(id => blocks.get(id)?.text ?? [])
    const qualitative = qualitativeYearConflict(conflict, sources)
    if (!qualitative || conflict.sourceBlockIds.some(id => blocks.get(id)?.inputRiskFlags.length)) return true
    const statement = `经验口径待确认：明示“${qualitative.yearQuote}”与“${qualitative.qualitativeQuotes.join('、')}”未构成不相容的年限条件；可核对所指经验类型，不能据此认定年限冲突。`
    if (statement.length > 240) return true
    if (!profile.unknowns.includes(statement)) profile.unknowns.push(statement)
    if (!candidate.uncertainties.some(item => item.statement === statement)) {
      candidate.uncertainties = [...candidate.uncertainties, { statement, sourceBlockIds: [...conflict.sourceBlockIds] }]
    }
    report('JOB_PROFILE_QUALITATIVE_YEARS_ALIGNED', `jobSuccessProfile.conflicts[${index}]`,
      `已将缺少不相容数值依据的年限冲突改为待确认口径，并保留原来源。原判断：${conflict.description}`, 'warning')
    return false
  })
  return { passed: !issues.some(issue => issue.severity === 'error'), value: candidate, issues }
}

export interface JobTarget {
  id: string
  kind: 'task' | 'condition' | 'attribute' | 'requirement'
  text: string
  basis: 'explicit' | 'inferred' | 'unknown'
  priority: 'core' | 'supporting' | 'optional' | 'unclear'
  taskIds: string[]
  requirementIds: string[]
  dimension?: JobSuccessProfile['attributes'][number]['dimension']
}

export function buildJobTargets(candidate: TargetedJobExtraction, job: JobRequirementBundle): JobTarget[] {
  const profile = candidate.jobSuccessProfile
  const localIds = new Map(candidate.requirementCandidates.map(item => [item.requirementLocalId,
    job.requirementAtoms.find(atom => atom.sourceBlockId === item.sourceBlockId && atom.verbatimText === item.verbatimText)?.requirementId]))
  const canonical = (ids: string[]) => [...new Set(ids.flatMap(id => localIds.get(id) ? [localIds.get(id)!] : []))]
  const taskById = new Map(profile.tasks.map(task => [task.id, task]))
  const taskRequirements = (ids: string[]) => canonical(ids.flatMap(id => taskById.get(id)?.requirementLocalIds ?? []))
  const priorityOrder: JobTarget['priority'][] = ['core', 'supporting', 'optional', 'unclear']
  const taskPriority = (ids: string[]): JobTarget['priority'] => priorityOrder.find(priority => ids.some(id => taskById.get(id)?.priority === priority)) ?? 'unclear'
  return [
    ...profile.tasks.map(task => ({ id: task.id, kind: 'task' as const, text: task.text, basis: task.provenance.basis,
      priority: task.priority, taskIds: [task.id], requirementIds: canonical(task.requirementLocalIds) })),
    ...profile.successConditions.map(condition => ({ id: condition.id, kind: 'condition' as const, text: condition.text,
      basis: condition.provenance.basis, priority: taskPriority(condition.taskIds), taskIds: condition.taskIds, requirementIds: taskRequirements(condition.taskIds) })),
    ...profile.attributes.map(attribute => {
      const taskIds = [...new Set([...attribute.taskIds, ...profile.successConditions.filter(item => attribute.conditionIds.includes(item.id)).flatMap(item => item.taskIds)])]
      return { id: attribute.id, kind: 'attribute' as const, text: attribute.text, basis: attribute.provenance.basis,
        priority: taskPriority(taskIds), taskIds, requirementIds: [...new Set([...canonical(attribute.requirementLocalIds), ...taskRequirements(taskIds)])], dimension: attribute.dimension }
    }),
    ...job.requirementAtoms.map(requirement => ({ id: requirement.requirementId, kind: 'requirement' as const,
      text: requirement.normalizedRequirement, basis: requirement.explicitness === 'explicit' ? 'explicit' as const : 'inferred' as const,
      priority: requirement.importance === 'core_outcome' ? 'core' as const : 'supporting' as const,
      taskIds: profile.tasks.filter(task => canonical(task.requirementLocalIds).includes(requirement.requirementId)).map(task => task.id), requirementIds: [requirement.requirementId] })),
  ]
}
