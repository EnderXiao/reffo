import type { EvidenceAtom, ResumeEvidenceBundle, JobRequirementBundle, V5MatchAnalysis, ValidationIssue, ValidationResult } from '@/v5/types'
import type { JobFitMap } from '@/v5/targeting/contracts'
import type { JobTarget } from '@/v5/targeting/profile'
import { buildWritingFact, inspectSupportedWriting, writingIssue } from '@/v5/writing/facts'
import { validateV5MatchAnalysis } from '@/v5/validators'
import { buildRequirementJudgments, hasExplicitContraryEvidence } from './judgments'

// Bounded checks for concrete specialties; absence means unproven, not incapable.
// This deliberately does not attempt to certify generic semantic equivalence.
const SPECIALTY_SIGNALS = [
  { label: '模型效果评估', pattern: /(?:模型|LLM)(?:效果|质量|性能)?(?:评估|评测|评价)|(?:评估|评测)(?:大语言)?模型/iu },
  { label: '模型训练或微调', pattern: /(?:模型|LLM)(?:训练|微调)|fine.tun/iu },
  { label: 'A/B 测试', pattern: /A\s*\/\s*B\s*(?:测试|实验|test)/iu },
  { label: 'SQL', pattern: /\bSQL\b/iu },
  { label: 'Python', pattern: /\bPython\b/iu },
  { label: 'Figma', pattern: /\bFigma\b/iu },
] as const

const MODEL_SPECIALTY_SIGNALS = [
  {label: '模型训练', pattern: /(?:模型|LLM)[^，,；;。！？!?]{0,8}训练|训练[^，,；;。！？!?]{0,8}(?:模型|LLM)/iu},
  {label: '模型微调', pattern: /(?:模型|LLM)[^，,；;。！？!?]{0,8}微调|微调[^，,；;。！？!?]{0,8}(?:模型|LLM)/iu},
  {label: '模型评估', pattern: /(?:模型|LLM)(?:(?:的)?(?:效果|质量|性能|输出|回答|生成|离线|在线|端到端)){0,3}(?:评估|评测)|(?:模型|LLM)(?:(?:训练|微调)[和与及或、]){1,2}(?:评估|评测)|(?:评估|评测)(?:大语言|语言|生成式|基础|AI|人工智能)?(?:模型|LLM)/iu},
] as const

// “交易” also describes retail orders and digital marketplaces. It authorizes
// checking transaction practice, but cannot authorize a financial-industry gate.
const FINANCIAL_DOMAIN_PATTERN = /金融|风控|信贷|借贷|授信|银行|保险|证券/u
const FINANCIAL_CONTEXT_PATTERN = /金融|风控|信贷|借贷|授信|交易|银行|保险|证券/u
const FINANCIAL_SPECIALTIES = [
  {label: '风控专项', pattern: /风控/u},
  {label: '信贷专项', pattern: /信贷|借贷|授信/u},
  {label: '交易专项', pattern: /交易/u},
  {label: '银行专项', pattern: /银行/u},
  {label: '保险专项', pattern: /保险/u},
  {label: '证券专项', pattern: /证券/u},
] as const
const INDEPENDENT_OWNERSHIP_PATTERN = /独立(?:主导|牵头|负责|完成|承担|开展|建设|交付|规划|进行|推进|推动|设计|解决|从)|全权/u

export function unprovenSpecialties(targetText: string, sourceTexts: string[]) {
  return SPECIALTY_SIGNALS.filter(signal => signal.pattern.test(targetText)
    && !sourceTexts.some(text => signal.pattern.test(text))).map(signal => signal.label)
}

function sourceBoundedFitPresentation(link: JobFitMap['links'][number], atoms: EvidenceAtom[]) {
  const unsupportedDenial = ['unknown', 'weak_signal', 'transferable'].includes(link.status)
    && link.difference.split(/[，,。；;！？!?]/u).some(clause => [...clause.matchAll(/不具备|不会|不擅长|无法胜任|不能胜任|不胜任|缺乏|欠缺/gu)].some(match => {
      const prefix = clause.slice(0, match.index), following = clause.slice(match.index! + match[0].length)
      if (/(?:不能|不应|不得|不可|不足以|不等于|并非|不是|无法|未能证明|未证明)[^，,；;。]{0,16}$/u.test(prefix)) return false
      if (/(?:材料|简历|文档|证据|记录)(?:中|里|目前|尚)?$/u.test(prefix)) return false
      return !/^.{0,18}(?:证据|材料|记录|证明|描述|说明)/u.test(following)
    }))
  // Inspect affirmative advice only: “不写成独立负责” preserves the boundary.
  const affirmativeAdvice = link.expressionAngle.split(/[，,。；;]|但|而是|不过|然而/u)
    .filter(clause => !/不要|不得|不应|不可|不宜|不能|不写|不称|不表述|不包装|避免|勿/u.test(clause)).join('；')
  const unsafeAngle = inspectSupportedWriting(affirmativeAdvice, atoms, 'matching.expressionAngle')
    .some(issue => issue.code === 'WRITER_OWNERSHIP_UPGRADE')
  return {
    difference: unsupportedDenial ? '当前材料尚未充分证明该项能力；证据有限不代表候选人不具备该能力。' : link.difference,
    expressionAngle: unsafeAngle ? '' : link.expressionAngle,
  }
}

/** A domain-specific unknown does not negate an already supported generic practice. */
function deniesGeneralReleaseFollowUp(text: string) {
  return text.split(/[，。；;]|以及|并且|及/u).some(clause => {
    const denial = /(?:尚未|没有|尚无|缺乏|未见|未提供|未说明)[^，。；;]{0,16}(?:上线后|发布后)[^，。；;]{0,12}(?:跟进|跟踪|监控|闭环|表现)/u.test(clause)
      || /(?:上线后|发布后)[^，。；;]{0,12}(?:跟进|跟踪|监控|闭环|表现)[^，。；;]{0,12}(?:尚无|缺乏|未提供|未说明)/u.test(clause)
    if (!denial) return false
    const narrowedDomain = /(?:金融|风控|信贷|借贷|授信|交易|银行|保险|证券)[^，。；;]{0,10}(?:上线后|发布后)/u.test(clause)
    const narrowedMetric = /(?:上线后|发布后)[^，。；;]{0,8}(?:业务指标|业务效果|转化率|留存率|收入指标|金融指标|风控指标)/u.test(clause)
    return !narrowedDomain && !narrowedMetric
  })
}

function scopeAssertions(text: string) {
  return text.split(/[，,；;。！？!?]|但(?:是)?|然而|不过|却/u).flatMap(clause => {
    const conjunctions = [...clause.matchAll(/以及|并且|而且|同时|另外|此外|且|和|及|也|而/gu)]
    const assertions: string[] = []
    let start = 0
    for (const [index, conjunction] of conjunctions.entries()) {
      const end = conjunction.index! + conjunction[0].length
      const before = clause.slice(start, conjunction.index)
      const after = clause.slice(end, conjunctions[index + 1]?.index ?? clause.length)
      // Separate complete coordinated judgments, not a shared noun list such
      // as “不要求模型训练和模型评估”. Each side needs its own predicate.
      const predicate = /未|不|无|缺|待|需|应|不足|补充/u
      if (predicate.test(before) && predicate.test(after)) {
        assertions.push(before)
        start = end
      }
    }
    assertions.push(clause.slice(start))
    return assertions
  })
}

function hasRoleBoundaryDeficit(clauses: string[], index: number, mention: string) {
  const deficit = /需(?:要)?补|待补|不足|缺口|差距/u
  if (deficit.test(clauses[index]!)) return true
  const specialtyTerms = mention.match(/训练|微调|评估|评测/gu) ?? []
  // A later request for “这一差距” still targets the specialty. A named
  // product responsibility is a separate assertion and cannot revoke its boundary.
  return clauses.slice(index + 1).some(clause => deficit.test(clause) && (
    specialtyTerms.some(term => clause.includes(term))
    || /(?:该|这|此|其|相关|相应|上述|前述)(?:一|项|类|个)?(?:差距|缺口|方面|能力|专项|职责|经历|经验|材料|证据|细节|内容)/u.test(clause)
    || /(?:需(?:要)?|应(?:当)?|须|待)(?:补充|补足|完善|提供|说明)(?:一些|更多|具体|相应|相关)?(?:材料|证据|经历|经验|能力|细节|说明|信息|记录|内容)?\s*$/u.test(clause)
    || /^(?:仍|尚|还)?(?:有|存在)?(?:不足|缺口|差距)\s*$/u.test(clause)
  ))
}

function isRenderedRoleBoundary(text: string, prefix: string, suffix: string, mention: string) {
  if (!/(?:模型|LLM)/iu.test(mention) || !/训练|微调|评估|评测/u.test(mention)) return false
  // “未写” is safe only as an account of the rendered role, not an absence of
  // proof (“材料未写模型训练经验”) or an unproven ability in another field.
  if (/(?:材料|简历|文档|证据|记录|履历)(?:中|里|上)?[^，,；;。]{0,6}(?:未写|没有写|未写明|未描述|未表述)$/u.test(prefix)) return false
  if (/(?:未|不)(?:写成|表述为|描述为|声称)[^，,；;。]{0,6}$/u.test(prefix)) return true
  if (/能力|经验|证明|证据|资质|水平/u.test(suffix)) return false
  const contextualRole = /(?:为|属于|仅|只|限于|参与|承担|负责|围绕|侧重|聚焦)[^，,；;。]{0,30}(?:产品|功能|应用|方案|交互|业务|职责|设计|范围)/u.test(text)
  return contextualRole && (
    /(?:未写|没有写|不写)[^，,；;。]{0,6}$/u.test(prefix)
    || /^[^，,；;。]{0,6}(?:未写|没有写|不写)(?:成|为)?\s*$/u.test(suffix)
  )
}

function unexcludedScopeMentions(text: string, pattern: RegExp, roleBoundary = false) {
  // A boundary disclaimer applies to its own assertion, never to the following
  // contrast or a different field. Joining all fields let unrelated words form
  // a specialty match and let one disclaimer conceal a real added requirement.
  const clauses = scopeAssertions(text)
  return clauses.flatMap((clause, index) => [...clause.matchAll(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`))].flatMap(match => {
    const prefix = clause.slice(0, match.index), suffix = clause.slice(match.index! + match[0].length)
    const explicitlyExcluded = /(?:无需|不必|不需要|不要求)[^，,；;。]{0,16}$/u.test(prefix)
      || /(?:非|不属[于]?|不作为|不纳入)(?:本项|此项|本条|该项)?(?:的)?(?:要求|门槛|条件|缺口|差距)[^，,；;。]{0,12}$/u.test(prefix)
      || /不(?:自动)?(?:升级|等于|代表|视为)[^，,；;。]{0,16}$/u.test(prefix)
      || /不(?:得|应|能|可)(?:将|把|写成|称为|视为|要求|增加|引入|作为)[^，,；;。]{0,20}$/u.test(prefix)
      || /避免[^，,；;。]{0,8}(?:升级|当作|视为)[^，,；;。]{0,16}$/u.test(prefix)
      || (/(?:不作为|不纳入|不设为|不构成)[^，,；;。]{0,8}$/u.test(prefix)
        && /^[^，,；;。]{0,10}(?:门槛|要求|条件|缺口|差距)/u.test(suffix))
      || (/不(?:将|把)[^，,；;。]{0,8}$/u.test(prefix)
        && /^[^，,；;。]{0,10}(?:作为|纳入|设为|视为)(?:本项|此项|该项)?(?:的)?(?:门槛|要求|条件|缺口|差距)/u.test(suffix))
      || /^[^，,；;。]{0,10}(?:并非|不是|非|不构成|不作为)(?:本项|此项|本条|该项)?(?:的)?(?:要求|门槛|条件|缺口|差距)/u.test(suffix)
      || /^[^，,；;。]{0,10}(?:不属于|不在)(?:本项|此项|本条|该项)(?:的)?(?:要求|范围)/u.test(suffix)
    if (explicitlyExcluded) return []
    if (/^(?:独立|全权)/u.test(match[0]) && /非$/u.test(prefix)) return []
    // “未涉及模型训练” can accurately limit the source role. “未说明模型
    // 训练能力” is an unsupported deficit and deliberately remains actionable.
    if (roleBoundary && !hasRoleBoundaryDeficit(clauses, index, match[0])
      && (/(?:未涉及|不涉及|未包含|不包含|不承担|未承担|非)[^，,；;。]{0,8}$/u.test(prefix)
        || /^[^，,；;。]{0,8}(?:未涉及|不涉及|未包含|不包含|不承担|未承担)/u.test(suffix)
        || isRenderedRoleBoundary(text, prefix, suffix, match[0]))) return []
    return [{clause: clause.trim(), mention: match[0]}]
  }))
}

function hasUnexcludedScopeMention(text: string, pattern: RegExp, roleBoundary = false) {
  return unexcludedScopeMentions(text, pattern, roleBoundary).length > 0
}

export interface FitRequirementScopeFinding {
  code: string
  field: string
  clause: string
  mention: string
  criterion: string
  sourceQuote: string
}

export function inspectFitRequirementScopeDetails(link: JobFitMap['links'][number], target: JobTarget): FitRequirementScopeFinding[] {
  if (target.kind !== 'requirement') return []
  const source = target.sourceQuote ?? target.text
  // Every field can surface in the v2 judgment or editing strategy. A rejected
  // threshold cannot survive in an aspect reason after difference is repaired.
  const negativeAssessment: Array<{field: string; text: string; roleBoundary?: boolean}> = [
    {field: 'difference', text: link.difference}, {field: 'roleBoundary', text: link.roleBoundary ?? '', roleBoundary: true},
    ...(link.unprovenAspects ?? []).flatMap((aspect, index) => [
      {field: `unprovenAspects[${index}].text`, text: aspect.text},
      {field: `unprovenAspects[${index}].reason`, text: aspect.reason},
    ]),
    ...[{field: 'similarity', text: link.similarity}, {field: 'expressionAngle', text: link.expressionAngle},
      ...(link.supportedAspects ?? []).map((aspect, index) => ({field: `supportedAspects[${index}].text`, text: aspect.text}))]
      .flatMap(field => scopeAssertions(field.text).filter(clause => /未|缺|不足|需|待|补充/u.test(clause))
        .map(text => ({...field, text}))),
  ]
  const findings: FitRequirementScopeFinding[] = []
  const report = (code: string, criterion: string, pattern: RegExp) => {
    for (const field of negativeAssessment) for (const match of unexcludedScopeMentions(field.text, pattern, field.roleBoundary)) {
      findings.push({code, field: field.field, ...match, criterion, sourceQuote: source})
    }
  }
  const introduced = (code: string, criterion: string, pattern: RegExp) => {
    if (!hasUnexcludedScopeMention(source, pattern)) report(code, criterion, pattern)
  }
  if (!hasUnexcludedScopeMention(source, FINANCIAL_DOMAIN_PATTERN)) {
    report('JOB_FIT_FOREIGN_DOMAIN_GATE', '行业专项', FINANCIAL_DOMAIN_PATTERN)
  }
  // A broad industry condition cannot silently become every specialty in
  // that industry. A named specialty may still use its broad industry label.
  for (const signal of FINANCIAL_SPECIALTIES) introduced('JOB_FIT_FOREIGN_DOMAIN_GATE', signal.label, signal.pattern)
  introduced('JOB_FIT_INVENTED_OWNERSHIP_GATE', '独立责任', INDEPENDENT_OWNERSHIP_PATTERN)
  for (const signal of MODEL_SPECIALTY_SIGNALS) introduced('JOB_FIT_INVENTED_SPECIALTY_GATE', signal.label, signal.pattern)
  if (/基础|基本|一定/u.test(source) && !/系统化|体系化|系统性|精通|专家级|高级/u.test(source)) {
    report('JOB_FIT_INVENTED_PROFICIENCY_GATE', '超出基础程度', /系统化|体系化|系统性|精通|专家级|高级/u)
  }
  if (/(?:0\s*(?:到|至|[-→])\s*1|零到一)/u.test(source) && !/全流程|全过程|规模化|立项/u.test(source)) {
    report('JOB_FIT_INVENTED_SCOPE_GATE', '全过程范围', /全流程|全过程|完整(?:的)?(?:产品)?建设过程|立项.{0,10}规模化/u)
  }
  return findings
}

export function inspectFitRequirementScope(link: JobFitMap['links'][number], target: JobTarget): string[] {
  return [...new Set(inspectFitRequirementScopeDetails(link, target).map(finding => finding.code))]
}

export function prepareJobFitScopeRepair(fit: JobFitMap, targets: JobTarget[], issues: ValidationIssue[]) {
  const affected = new Set(issues.filter(issue => issue.severity === 'error').map(issue => issue.outputPath))
  if (!affected.size || [...affected].some(id => !targets.some(target => target.id === id))) return null
  const targetIds = new Set([...affected] as string[])
  const isolatedRequirements = issues.filter(issue => issue.severity === 'error').every(issue => /JOB_FIT_(?:FOREIGN_DOMAIN|INVENTED_OWNERSHIP|INVENTED_SPECIALTY|INVENTED_PROFICIENCY|INVENTED_SCOPE)_GATE/u.test(issue.code))
    && targets.filter(target => targetIds.has(target.id)).every(target => target.kind === 'requirement')
  return {targetIds: [...targetIds], targets: targets.filter(target => targetIds.has(target.id)), isolatedRequirements,
    currentOutput: isolatedRequirements ? {previousJudgmentsRejected: true,
      sourceBoundaries: targets.filter(target => targetIds.has(target.id)).map(target => ({targetId: target.id,
        sourceQuote: target.sourceQuote ?? target.text,
        excludedCriteria: issues.filter(issue => issue.outputPath === target.id).flatMap(issue =>
          issue.code === 'JOB_FIT_INVENTED_OWNERSHIP_GATE' ? ['此原文未要求独立责任；“未证明独立主导/负责/承担”不构成该要求的差距。责任边界只如实写参与、实习或团队贡献。']
          : issue.code === 'JOB_FIT_INVENTED_SPECIALTY_GATE' ? [`此原文未要求${MODEL_SPECIALTY_SIGNALS.filter(signal => !hasUnexcludedScopeMention(target.sourceQuote ?? target.text, signal.pattern)).map(signal => signal.label).join('、')}；这些专项不能出现在本项的待证明方面、差距或补充要求中。原文实际要求的专项仍按真实证据判断；真实角色只写已证实的参与范围。`]
          : issue.code === 'JOB_FIT_FOREIGN_DOMAIN_GATE' ? [hasUnexcludedScopeMention(target.sourceQuote ?? target.text, FINANCIAL_CONTEXT_PATTERN)
            ? `此原文明示的行业条件应保留，但未要求${[...(!hasUnexcludedScopeMention(target.sourceQuote ?? target.text, FINANCIAL_DOMAIN_PATTERN) ? ['金融行业'] : []), ...FINANCIAL_SPECIALTIES.filter(signal => !hasUnexcludedScopeMention(target.sourceQuote ?? target.text, signal.pattern)).map(signal => signal.label)].join('、')}；不要把交易流程或广义行业经验升级成这些专项门槛。`
            : '此原文没有限定金融、风控或交易等专项场景；不要将公司行业或其他目标的行业条件迁入本项。只依据本项原文核对已有通用实践及实际未证明的维度。']
          : issue.code === 'JOB_FIT_INVENTED_PROFICIENCY_GATE' ? ['此原文只要求基础能力；未建系统化/体系化方法不是本项缺口，按实际基础分析实践判断。']
          : issue.code === 'JOB_FIT_INVENTED_SCOPE_GATE' ? ['此原文只要求有0到1建设经验，没有要求独立、全流程或立项到规模化。参与的MVP/PRD/灰度/上线可以证明已有相应建设经验，具体结论仍按证据核对；未证明全过程不是新增缺口。'] : [])})),
      admittedPriorPractice: fit.links.filter(link => targetIds.has(link.targetId)).map(link => ({targetId: link.targetId,
        evidenceIds: link.evidenceIds, similarity: link.similarity, supportedAspects: link.supportedAspects ?? []})),
      instruction: '此前差距依据越过本项原文，已丢弃该草稿的状态和差距文案；请按sourceQuote与真实证据重新判断，不沿用被拒绝的结论。'}
      : {...fit, links: fit.links.filter(link => targetIds.has(link.targetId)), narratives: []},
    merge(repaired: JobFitMap): JobFitMap {
      if (repaired.links.length !== targetIds.size || new Set(repaired.links.map(link => link.targetId)).size !== targetIds.size
        || repaired.links.some(link => !targetIds.has(link.targetId))) throw new Error('JOB_FIT_SCOPED_REPAIR_TARGET_MISMATCH')
      const replacements = new Map(repaired.links.map(link => [link.targetId, link]))
      return {...fit, links: fit.links.map(link => replacements.get(link.targetId) ?? link),
        narratives: [...fit.narratives.filter(narrative => narrative.targetIds.every(id => !targetIds.has(id))), ...repaired.narratives],
        questions: fit.questions}
    }}
}

export function validateJobFitMap(value: JobFitMap, targets: JobTarget[], resume: ResumeEvidenceBundle): ValidationResult<JobFitMap> {
  const fit = structuredClone(value)
  const targetById = new Map(targets.map(target => [target.id, target]))
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const originalReferences = new Map(value.links.map(link => [link.targetId, link.evidenceIds]))
  const seen = new Set<string>(), issues: ValidationIssue[] = []
  const report = (code: string, path: string, ids: string[], message: string, severity: ValidationIssue['severity'] = 'error') => issues.push(writingIssue(code, path, ids, message, severity))
  for (const link of fit.links) {
    const target = targetById.get(link.targetId)
    if (!target || seen.has(link.targetId)) { report('JOB_FIT_TARGET_INVALID', link.targetId, [], '目标未知或重复。'); continue }
    seen.add(link.targetId)
    const scopeFindings = inspectFitRequirementScopeDetails(link, target)
    for (const code of new Set(scopeFindings.map(finding => finding.code))) report(code, link.targetId, link.evidenceIds,
      `该原子要求的可见判断字段引入了其精确JD原文没有的门槛。本项原文：${target.sourceQuote ?? target.text}；触发位置：${scopeFindings.filter(finding => finding.code === code)
        .map(finding => `${finding.field}「${finding.clause}」（${finding.criterion}：${finding.mention}）`).join('；')}。请按sourceQuote重新评估所有理由字段，保留真实支持方面；不得只清理difference、直接改状态或编造证据。`)
    if (link.supportedAspects?.some(aspect => !aspect.evidenceIds.length || aspect.evidenceIds.some(id => !link.evidenceIds.includes(id)))) {
      report('JOB_FIT_ASPECT_EVIDENCE_INVALID', link.targetId, link.evidenceIds, '支持方面必须引用本目标已关联的真实证据，不能借用其他目标的事实。')
    }
    if (fit.contractVersion === 'job-fit-map-v2' && !['unknown', 'conflicted'].includes(link.status)
      && (!link.supportedAspects || !link.unprovenAspects || link.roleBoundary === undefined)) {
      report('JOB_FIT_ASSESSMENT_MISSING', link.targetId, link.evidenceIds, '新契约须分别评估已支持方面、未证实方面及角色边界；不能只提交旧单段理由。')
    }
    if (new Set(link.evidenceIds).size !== link.evidenceIds.length || link.evidenceIds.some(id => {
      const atom = evidence.get(id)
      return !atom || atom.riskFlags.includes('sensitive_pii') || atom.riskFlags.includes('prompt_injection_like_text')
        || (atom.status === 'excluded' && link.status !== 'conflicted')
    })) report('JOB_FIT_EVIDENCE_INVALID', link.targetId, [], '只能使用真实简历证据引用，不能把岗位要求或推断作为个人事实。')
    // An unknown verdict may still reference source practice without certifying
    // the whole target. Keep that reference set stable for repeated validation.
    if (target.basis === 'unknown') {
      link.status = 'unknown'; link.evidenceIds = []
      if (link.supportedAspects) link.supportedAspects = []
    }
    if (link.status === 'explicit_gap' && !hasExplicitContraryEvidence(target.text, link.evidenceIds.flatMap(id => evidence.get(id) ? [evidence.get(id)!] : []))) {
      link.status = 'unknown'
      link.similarity = ''; link.expressionAngle = ''
      link.difference = '当前材料未提供足够证据，不能据此判定候选人存在该项缺陷。'
      report('JOB_FIT_UNPROVEN_GAP_ALIGNED', link.targetId, [], '无证据的缺陷判断降为未知，不要求模型补造证据或重试。', 'warning')
    }
    if (link.status !== 'unknown' && !link.evidenceIds.length) report('JOB_FIT_PROOF_MISSING', link.targetId, [], '支持、差异或冲突判断需要具体简历证据。', 'warning')
    if (link.status === 'transferable' && (!link.similarity.trim() || !link.difference.trim())) report('JOB_FIT_TRANSFER_BASIS_MISSING', link.targetId, link.evidenceIds, '可迁移判断需说明相似点与差异。', 'warning')
    if (link.status === 'direct' && link.evidenceIds.length && link.evidenceIds.every(id => {
      const atom = evidence.get(id)
      return !atom || ['skill', 'education', 'other'].includes(atom.claimType) || atom.riskFlags.includes('self_assessment_only')
    }) && target.kind !== 'requirement') {
      link.status = 'weak_signal'
      report('JOB_FIT_WEAK_SIGNAL_ALIGNED', link.targetId, link.evidenceIds, '仅有知识或技能信号，不能据此证明已完成岗位任务。', 'warning')
    }
    const missing = unprovenSpecialties(target.text, link.evidenceIds.flatMap(id => evidence.get(id)?.verbatimText ?? []))
    if (link.status === 'direct' && missing.length) {
      link.status = 'weak_signal'
      link.difference = `所引材料未明确支持：${missing.join('、')}。局部相关不能认证整项任务。`
      report('JOB_FIT_PARTIAL_COVERAGE_ALIGNED', link.targetId, link.evidenceIds, '具体专项缺乏证据，整体直接匹配改为局部信号；细分任务可保留独立匹配。', 'warning')
    }
    const sourceTexts = link.evidenceIds.flatMap(id => evidence.get(id)?.verbatimText ?? [])
    const followUpPractice = sourceTexts.some(text => /监控/u.test(text) && /日志|复现|修复|发版/u.test(text))
    const followUpDenial = [link.difference, ...(link.unprovenAspects ?? []).map(item => item.text + item.reason)]
      .some(deniesGeneralReleaseFollowUp)
    if (followUpPractice && followUpDenial) report('JOB_FIT_SOURCE_NEGATION_CONFLICT', link.targetId, link.evidenceIds,
      '所引来源已有监控、排查与修复发版实践，不能同时判断没有发布后跟进；请保留已支持方面并只说明实际未证明的范围。')
    const presentation = sourceBoundedFitPresentation(link, link.evidenceIds.flatMap(id => evidence.get(id) ? [evidence.get(id)!] : []))
    if (presentation.difference !== link.difference || presentation.expressionAngle !== link.expressionAngle) {
      Object.assign(link, presentation)
      report('JOB_FIT_PRESENTATION_BOUNDARY_ALIGNED', link.targetId, link.evidenceIds, '已将无依据的能力否定限定为材料证据边界，并省略职责升级建议。', 'warning')
    }
  }
  // Omitted judgments become unknown, never an implicit pass or a reason for another API call.
  for (const target of targets.filter(target => !seen.has(target.id))) fit.links.push({
    targetId: target.id, status: 'unknown', evidenceIds: [], similarity: '', difference: '当前材料未形成该项判断。', expressionAngle: '',
  })
  const linkById = new Map(fit.links.map(link => [link.targetId, link]))
  // Related task IDs describe the job model, not an AND-qualification contract.
  // Diagnose mixed support without guessing semantics or rejecting useful practice.
  for (const link of fit.links.filter(item => item.status === 'direct')) {
    const target = targetById.get(link.targetId)
    if (!target || target.kind === 'task') continue
    const unprovenTasks = target.taskIds.filter(id => targetById.get(id)?.kind === 'task'
      && !['direct', 'transferable'].includes(linkById.get(id)?.status ?? 'unknown'))
    if (unprovenTasks.length) report('JOB_FIT_RELATED_TASK_UNPROVEN', link.targetId, link.evidenceIds,
      '该目标关联的部分任务尚无独立支持。目标本身的判断不等于这些任务已被证明；保留原判断与差异供离线审阅，不自动重试。', 'warning')
  }
  const originalNarratives = structuredClone(fit.narratives)
  const filteredNarratives: Array<{index: number; code: string}> = []
  const retainedNarratives: JobFitMap['narratives'] = []
  for (const [index, narrative] of fit.narratives.entries()) {
    const supported = new Set(narrative.targetIds.flatMap(id => {
      const link = linkById.get(id)
      return link && ['direct', 'transferable'].includes(link.status) ? link.evidenceIds : []
    }))
    const referenced = new Set(narrative.targetIds.flatMap(id => originalReferences.get(id) ?? []))
    const invalidReferences = !narrative.targetIds.length || narrative.targetIds.some(id => !targetById.has(id))
      || !narrative.evidenceIds.length || narrative.evidenceIds.some(id => !evidence.has(id) || !referenced.has(id))
    if (invalidReferences) {
      filteredNarratives.push({index, code: 'JOB_FIT_NARRATIVE_UNSUPPORTED'})
      report('JOB_FIT_NARRATIVE_UNSUPPORTED', `narratives[${index}]`, [], '可选主线引用无效，已局部省略；不影响经过验证的事实关联。', 'warning')
      continue
    }
    if (narrative.targetIds.some(id => !['direct', 'transferable'].includes(linkById.get(id)?.status ?? 'unknown'))
      || narrative.evidenceIds.some(id => !supported.has(id))) {
      filteredNarratives.push({index, code: 'JOB_FIT_NARRATIVE_DOWNGRADED'})
      report('JOB_FIT_NARRATIVE_DOWNGRADED', `narratives[${index}]`, [], '对应关系已降为弱信号或未知，省略该胜任主线，不要求模型重试。', 'warning')
      continue
    }
    if (inspectSupportedWriting(narrative.statement,
      narrative.evidenceIds.flatMap(id => evidence.get(id) ? [evidence.get(id)!] : []), `narratives[${index}]`).length) {
      filteredNarratives.push({index, code: 'JOB_FIT_NARRATIVE_FACT_RISK'})
      report('JOB_FIT_NARRATIVE_FACT_RISK', `narratives[${index}]`, narrative.evidenceIds,
        '主线出现已知数字、工具或职责边界风险；省略该主线，保留原事实供 Writer 独立组织。', 'warning')
      continue
    }
    retainedNarratives.push(narrative)
  }
  let recovery: NonNullable<JobFitMap['narrativeDiagnostics']>['recovery'] = 'not_needed'
  const recoverAllSupported = !retainedNarratives.length
  const rejectedNarrativeTargets = new Set(filteredNarratives.flatMap(item => originalNarratives[item.index]!.targetIds))
  if (recoverAllSupported || rejectedNarrativeTargets.size) {
    recovery = 'no_safe_candidate'
    for (const link of fit.links) {
      if (!['direct', 'transferable'].includes(link.status)) continue
      if (!recoverAllSupported && !rejectedNarrativeTargets.has(link.targetId)) continue
      for (const aspect of link.supportedAspects ?? []) {
        const atoms = aspect.evidenceIds.flatMap(id => evidence.get(id) ? [evidence.get(id)!] : [])
        if (!atoms.length || aspect.evidenceIds.some(id => !link.evidenceIds.includes(id))
          || inspectSupportedWriting(aspect.text, atoms, 'narrativeRecovery').length) continue
        if (retainedNarratives.some(item => item.statement === aspect.text)) continue
        retainedNarratives.push({statement: aspect.text, targetIds: [link.targetId], evidenceIds: aspect.evidenceIds})
        recovery = 'recovered_from_supported_aspects'
      }
    }
  }
  fit.narratives = retainedNarratives
  fit.narrativeDiagnostics = value.narrativeDiagnostics ?? {original: originalNarratives, filtered: filteredNarratives, recovery}
  if (fit.questions.some(question => !targetById.has(question.targetId))) report('JOB_FIT_QUESTION_TARGET_INVALID', 'questions', [], '补充问题必须关联当前岗位目标。', 'warning')
  return { passed: !issues.some(issue => issue.severity === 'error'), issues, value: fit }
}

/** Positive source practice is useful even when a whole qualification is partial.
 * Keep this projection separate from verdicts and fully supported narratives. */
export function sourcePracticeStrengths(fit: JobFitMap, targets: JobTarget[], resume: ResumeEvidenceBundle) {
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const targetById = new Map(targets.map(target => [target.id, target]))
  const coveredScopes = new Set(fit.narratives.flatMap(narrative => narrative.evidenceIds
    .flatMap(id => evidence.get(id)?.sourceScopeId ?? [])))
  const candidates = new Map<string, {text: string; evidenceIds: string[]; targetId: string; score: number}>()
  for (const link of fit.links) {
    const target = targetById.get(link.targetId)
    if (!target || target.basis === 'unknown' || !['direct', 'transferable', 'weak_signal'].includes(link.status)) continue
    for (const aspect of link.supportedAspects ?? []) {
      const atoms = aspect.evidenceIds.flatMap(id => evidence.get(id) ? [evidence.get(id)!] : [])
      if (!atoms.length || atoms.length !== aspect.evidenceIds.length || atoms.some(atom =>
        !link.evidenceIds.includes(atom.evidenceId) || !isConcretePractice(atom) || !buildWritingFact(atom)
        || atom.riskFlags.some(flag => ['uncertain', 'future_or_planned', 'conflicting', 'sensitive_pii', 'prompt_injection_like_text'].includes(flag)))
        || inspectSupportedWriting(aspect.text, atoms, 'partialPracticeStrength').length
        || /完全满足|全部满足|完全符合|胜任岗位/u.test(aspect.text)) continue
      const scopes = [...new Set(atoms.map(atom => atom.sourceScopeId))]
      if (scopes.length !== 1 || coveredScopes.has(scopes[0]!)) continue
      // One complete source-grounded aspect per experience avoids multiplying
      // the same practice across synonymous task/attribute/qualification labels.
      const score = aspect.text.length + (target.kind === 'task' ? 80 : 0)
      const prior = candidates.get(scopes[0]!)
      if (!prior || score > prior.score) candidates.set(scopes[0]!, {text: aspect.text,
        evidenceIds: aspect.evidenceIds, targetId: link.targetId, score})
    }
  }
  return [...candidates].map(([scopeId, item]) => ({strengthId: `source_practice_${scopeId}`,
    requirementIds: targetById.get(item.targetId)?.requirementIds ?? [], evidenceIds: item.evidenceIds,
    statement: `可迁移实践：${item.text}`}))
}

export function projectLegacyMatch(originalFit: JobFitMap, targets: JobTarget[], resume: ResumeEvidenceBundle, job: JobRequirementBundle): V5MatchAnalysis {
  const judgmentBundle = buildRequirementJudgments(originalFit, job, resume)
  const judgments = new Map(judgmentBundle.items.map(item => [item.requirementId, item]))
  const fit = structuredClone(originalFit)
  for (const link of fit.links) {
    const judgment = judgments.get(link.targetId)
    if (!judgment) continue
    link.status = judgment.conflict ? 'conflicted' : judgment.status === 'direct' ? 'direct'
      : judgment.status === 'transferable_or_partial' ? 'transferable' : judgment.status === 'not_met' ? 'explicit_gap' : 'unknown'
    link.evidenceIds = judgment.evidenceIds
    link.difference = judgment.unprovenAspects.map(item => item.text).join('；') || link.difference
  }
  const targetById = new Map(targets.map(target => [target.id, target]))
  const requirementById = new Map(job.requirementAtoms.map(requirement => [requirement.requirementId, requirement]))
  const links = new Map(fit.links.map(link => [link.targetId, link]))
  const requirementsFor = (ids: string[]) => [...new Set(ids.flatMap(id => targetById.get(id)?.requirementIds ?? []))]
  const states = { direct: 'direct_match', transferable: 'transferable_match', weak_signal: 'currently_unproven', unknown: 'currently_unproven', explicit_gap: 'currently_unproven', conflicted: 'conflicting_evidence' } as const
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const practiceStrengths = sourcePracticeStrengths(originalFit, targets, resume)
  const gaps: V5MatchAnalysis['gaps'] = []
  const priority = { core: 0, supporting: 1, optional: 2, unclear: 3 }
  // Questions are optional follow-ups, not the source of gap analysis or writing advice.
  // Prefer task-level differences and avoid repeating them for their qualification nodes.
  const gapTargets = targets.filter(target => ['task', 'requirement'].includes(target.kind) && target.basis !== 'unknown')
    .sort((a, b) => priority[a.priority] - priority[b.priority] || Number(a.kind !== 'task') - Number(b.kind !== 'task'))
  for (const target of gapTargets) {
    const link = links.get(target.id)
    if (link?.status === 'direct') continue
    const requirementIds = target.requirementIds
    if (!requirementIds.length) continue
    const evidenceIds = (link?.evidenceIds ?? []).filter(id => {
      const atom = evidence.get(id)
      return atom && (atom.status !== 'excluded' || link?.status === 'conflicted')
        && !atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text'].includes(flag))
    })
    const presentation = link && sourceBoundedFitPresentation(link, evidenceIds.flatMap(id => evidence.get(id) ? [evidence.get(id)!] : []))
    const requirement = target.kind === 'requirement' ? requirementById.get(target.id) : undefined
    const unprovenQualification = ['unknown', 'weak_signal', 'transferable'].includes(link?.status ?? 'unknown')
    const pureYears = requirement?.category === 'experience'
      && /^(?:(?:要求|需|至少|具备|拥有|具有)\s*)?(?:(?:相关)?(?:工作|从业|岗位|产品经理)?(?:经验|经历|年限)\s*)?(?:至少|不少于)?\d+(?:\.\d+)?(?:\s*[-~至到]\s*\d+(?:\.\d+)?)?\s*年(?:以上|及以上|以内|以下|左右)?(?:的)?(?:(?:相关|全职|累计)?(?:工作|从业|岗位|产品经理)?(?:经验|经历|年限))?(?:优先)?[。.]?$/u.test(target.text.trim())
    const pureEducation = requirement?.category === 'education'
      && /^(?:(?:要求|需|至少|具备|具有|拥有)\s*)?(?:大专|本科|学士|硕士|研究生|博士)(?:及以上|以上)?(?:学历|学位)?(?:及以上|以上)?(?:优先)?[。.]?$/u.test(target.text.trim())
    const qualification = !unprovenQualification ? undefined : pureYears ? {
      difference: resume.timeline.some(item => ['experience', 'internship'].includes(item.kind) && (item.start || item.end))
        ? '已有任职时间线，累计相关年限及实习是否计入仍需按招聘方口径核对。'
        : '当前材料尚缺少可核对的任职起止时间，暂不能判断累计相关年限。',
      safeHandling: '核对每段相关任职的起止时间、全职或实习性质及重叠周期，按招聘方口径计算累计年限。',
    } : requirement?.category === 'location' ? {
      difference: '工作地、到岗或出差安排与本人意向是否一致仍待确认。',
      safeHandling: '核对工作地点及岗位明确的到岗、出差安排，并确认本人意向与可接受条件。',
    } : pureEducation ? {
      difference: resume.timeline.some(item => item.kind === 'education')
        ? '已有教育经历材料，最高学历、学位与专业是否符合该要求仍需核对。'
        : '当前材料尚未提供足够的教育信息，暂不能判断学历与专业是否符合。',
      safeHandling: '核对最高学历、学位、专业及毕业状态，并补充对应的教育信息。',
    } : undefined
    const difference = qualification?.difference ?? (presentation?.difference.trim() || '当前材料未提供足够的相关证据，尚不能判断是否符合。')
    const angle = presentation?.expressionAngle.trim()
    const safeHandling = link?.status === 'conflicted'
      ? '先核对相关材料中的冲突，统一职责、时间与结果口径后再写入简历。'
      : link?.status === 'explicit_gap'
        ? `如实保留条件差异，不改写为已满足。${angle || '仅展示已有的相关经历与适用边界。'}`
        : qualification ? qualification.safeHandling : evidenceIds.length && angle
          ? angle
          : '补充相关经历中的本人职责、交付物和可核验结果；没有实际经历时保留为待补充，不写成已有能力。'
    gaps.push({ gapId: `target_gap_${target.id}`, requirementIds,
      evidenceType: evidenceIds.length ? 'implicit_evidence' : 'direct_missing',
      priority: target.priority === 'core' ? 'high' : target.priority === 'optional' ? 'low' : 'medium',
      evidenceIds, impact: difference, safeHandling })
  }
  const match: V5MatchAnalysis = {
    schemaVersion: '5.0.0',
    judgmentBundle,
    // A task link never certifies a whole compound qualification. Use its own judgment.
    requirementMatches: job.requirementAtoms.map(requirement => {
      const link = links.get(requirement.requirementId)
      return { requirementId: requirement.requirementId, status: link ? states[link.status] : 'currently_unproven',
        evidenceIds: link && ['direct', 'transferable'].includes(link.status) ? link.evidenceIds : [], confidence: 'medium',
        rationale: link ? [link.status, link.similarity, link.difference].filter(Boolean).join('；') : '当前材料未知，不等于没有能力。' }
    }),
    strengths: [...fit.narratives.map((narrative, index) => ({ strengthId: `target_strength_${index}`,
      requirementIds: requirementsFor(narrative.targetIds), evidenceIds: narrative.evidenceIds, statement: narrative.statement })), ...practiceStrengths],
    gaps,
    positioning: { statement: [...fit.narratives.map(item => item.statement), ...practiceStrengths.map(item => item.statement)].join('；'),
      primaryRequirementIds: requirementsFor(fit.narratives.flatMap(item => item.targetIds)).slice(0, 3),
      primaryEvidenceIds: [...new Set([...fit.narratives.flatMap(item => item.evidenceIds), ...practiceStrengths.flatMap(item => item.evidenceIds)])], forbiddenIdentityClaims: [] },
    scoreInputs: { mustHaveApplicable: 0, mustHaveDirect: 0, mustHaveTransferable: 0, coreOutcomeApplicable: 0, coreOutcomeDirect: 0, coreOutcomeTransferable: 0, evidenceClarityRatio: 0 },
    contextUsed: [],
  }
  const checked = validateV5MatchAnalysis({ resume, job, match, gateMode: 'relaxed_release' })
  if (!checked.passed) throw new Error('JOB_FIT_COMPATIBILITY_INVALID')
  const aligned = checked.value ?? match
  // Only retained task gaps cover their requirement projection. Collect them before
  // deduplication so a core requirement cannot preempt a supporting task by sort order.
  const taskGapIds = new Set(gapTargets.filter(target => target.kind === 'task').map(target => `target_gap_${target.id}`))
  const coveredRequirements = new Set(aligned.gaps.filter(gap => taskGapIds.has(gap.gapId)).flatMap(gap => gap.requirementIds))
  return { ...aligned, gaps: aligned.gaps.flatMap(gap => {
    if (taskGapIds.has(gap.gapId)) return [gap]
    const requirementIds = gap.requirementIds.filter(id => !coveredRequirements.has(id))
    return requirementIds.length ? [{ ...gap, requirementIds }] : []
  }) }
}

function isConcretePractice(atom: EvidenceAtom) {
  return ['action', 'responsibility', 'deliverable', 'result'].includes(atom.claimType)
    && !atom.riskFlags.includes('self_assessment_only')
}

/** Selection value is not a qualification verdict. Never upgrade a link's status. */
export function targetingSelectionBasis(link: JobFitMap['links'][number], atom: EvidenceAtom): 'supported' | 'partial_practice' | null {
  if (!buildWritingFact(atom)) return null
  if (['direct', 'transferable'].includes(link.status)) return 'supported'
  // The v1 contract uses weak_signal for both vague signals and partial compound-task proof.
  // Concrete practice with an explicit limitation remains usable; skills and self-praise do not.
  if (link.status === 'weak_signal' && isConcretePractice(atom) && link.similarity.trim() && link.difference.trim()
    && !/^(?:无[。.]?|无差异[。.]?|none|n\/a)$/iu.test(link.difference.trim())) return 'partial_practice'
  return null
}

export function targetingEvidenceScores(fit: JobFitMap, targets: JobTarget[], resume: ResumeEvidenceBundle) {
  const targetById = new Map(targets.map(target => [target.id, target]))
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const scores = new Map<string, number>()
  const priority = { core: 30, supporting: 12, optional: 4, unclear: 0 }
  for (const link of fit.links) {
    const target = targetById.get(link.targetId)
    if (!target || target.basis === 'unknown') continue
    for (const id of link.evidenceIds) {
      const atom = evidence.get(id)
      const basis = atom && targetingSelectionBasis(link, atom)
      if (!atom || !basis) continue
      const score = priority[target.priority] * (basis === 'partial_practice' ? 0.75 : 1) + (target.kind === 'task' ? 8 : 0)
        + (link.status === 'direct' ? 4 : link.status === 'transferable' ? 2 : 0) + (['result', 'deliverable'].includes(atom.claimType) ? 6 : 0)
        + (atom.attributionLevel === 'owned' || atom.attributionLevel === 'drove' ? 2 : 0)
      // Max, not sum: six attribute labels do not manufacture six independent proofs.
      scores.set(id, Math.max(scores.get(id) ?? 0, score))
    }
  }
  return scores
}

/** Reservations for task-related writing, NOT a count of fully supported tasks. */
export function coreTaskEvidence(fit: JobFitMap, targets: JobTarget[], resume: ResumeEvidenceBundle) {
  const links = new Map(fit.links.map(link => [link.targetId, link]))
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  return new Map(targets.filter(target => target.kind === 'task' && target.priority === 'core' && target.basis !== 'unknown')
    .flatMap(target => {
      const link = links.get(target.id)
      const ids = link?.evidenceIds.filter(id => {
        const atom = evidence.get(id)
        return atom && isConcretePractice(atom) && targetingSelectionBasis(link, atom)
      }) ?? []
      return ids.length ? [[target.id, ids] as const] : []
    }))
}

export function compactTargetingResume(resume: ResumeEvidenceBundle) {
  const atoms = resume.evidenceAtoms.filter(atom => !atom.riskFlags.includes('sensitive_pii') && !atom.riskFlags.includes('prompt_injection_like_text') && atom.claimType !== 'identity')
  return { timeline: resume.timeline.map(({ scopeId, kind, title, start, end }) => ({ scopeId, kind, title, start, end })),
    facts: atoms.map(({ evidenceId, sourceScopeId, verbatimText, claimType, status, attributionLevel, riskFlags }) => ({ evidenceId, sourceScopeId, text: verbatimText, claimType, status, attributionLevel, riskFlags })),
    conflicts: resume.conflicts,
  }
}
