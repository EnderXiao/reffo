import type { EvidenceAtom, ResumeEvidenceBundle, JobRequirementBundle, V5MatchAnalysis, ValidationIssue, ValidationResult } from '@/v5/types'
import type { JobFitMap } from '@/v5/targeting/contracts'
import type { JobTarget } from '@/v5/targeting/profile'
import { buildWritingFact, inspectSupportedWriting, writingIssue } from '@/v5/writing/facts'
import { validateV5MatchAnalysis } from '@/v5/validators'

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

export function unprovenSpecialties(targetText: string, sourceTexts: string[]) {
  return SPECIALTY_SIGNALS.filter(signal => signal.pattern.test(targetText)
    && !sourceTexts.some(text => signal.pattern.test(text))).map(signal => signal.label)
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
    if (new Set(link.evidenceIds).size !== link.evidenceIds.length || link.evidenceIds.some(id => {
      const atom = evidence.get(id)
      return !atom || atom.riskFlags.includes('sensitive_pii') || atom.riskFlags.includes('prompt_injection_like_text')
        || (atom.status === 'excluded' && link.status !== 'conflicted')
    })) report('JOB_FIT_EVIDENCE_INVALID', link.targetId, [], '只能使用真实简历证据引用，不能把岗位要求或推断作为个人事实。')
    if (link.status === 'unknown' || target.basis === 'unknown') {
      link.status = 'unknown'; link.evidenceIds = []
    }
    if (link.status === 'explicit_gap' && !link.evidenceIds.length) {
      link.status = 'unknown'
      link.similarity = ''; link.expressionAngle = ''
      link.difference = '当前材料未提供足够证据，不能据此判定候选人存在该项缺陷。'
      report('JOB_FIT_UNPROVEN_GAP_ALIGNED', link.targetId, [], '无证据的缺陷判断降为未知，不要求模型补造证据或重试。', 'warning')
    }
    if (link.status !== 'unknown' && !link.evidenceIds.length) report('JOB_FIT_PROOF_MISSING', link.targetId, [], '支持、差异或冲突判断需要具体简历证据。')
    if (link.status === 'transferable' && (!link.similarity.trim() || !link.difference.trim())) report('JOB_FIT_TRANSFER_BASIS_MISSING', link.targetId, link.evidenceIds, '可迁移判断需说明相似点与差异。')
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
      report('JOB_FIT_NARRATIVE_UNSUPPORTED', `narratives[${index}]`, [], '可选主线引用无效，已局部省略；不影响经过验证的事实关联。', 'warning')
      continue
    }
    if (narrative.targetIds.some(id => !['direct', 'transferable'].includes(linkById.get(id)?.status ?? 'unknown'))
      || narrative.evidenceIds.some(id => !supported.has(id))) {
      report('JOB_FIT_NARRATIVE_DOWNGRADED', `narratives[${index}]`, [], '对应关系已降为弱信号或未知，省略该胜任主线，不要求模型重试。', 'warning')
      continue
    }
    if (inspectSupportedWriting(narrative.statement,
      narrative.evidenceIds.flatMap(id => evidence.get(id) ? [evidence.get(id)!] : []), `narratives[${index}]`).length) {
      report('JOB_FIT_NARRATIVE_FACT_RISK', `narratives[${index}]`, narrative.evidenceIds,
        '主线出现已知数字、工具或职责边界风险；省略该主线，保留原事实供 Writer 独立组织。', 'warning')
      continue
    }
    retainedNarratives.push(narrative)
  }
  fit.narratives = retainedNarratives
  if (fit.questions.some(question => !targetById.has(question.targetId))) report('JOB_FIT_QUESTION_TARGET_INVALID', 'questions', [], '补充问题必须关联当前岗位目标。')
  return { passed: !issues.some(issue => issue.severity === 'error'), issues, value: fit }
}

export function projectLegacyMatch(fit: JobFitMap, targets: JobTarget[], resume: ResumeEvidenceBundle, job: JobRequirementBundle): V5MatchAnalysis {
  const targetById = new Map(targets.map(target => [target.id, target]))
  const links = new Map(fit.links.map(link => [link.targetId, link]))
  const requirementsFor = (ids: string[]) => [...new Set(ids.flatMap(id => targetById.get(id)?.requirementIds ?? []))]
  const states = { direct: 'direct_match', transferable: 'transferable_match', weak_signal: 'currently_unproven', unknown: 'currently_unproven', explicit_gap: 'currently_unproven', conflicted: 'conflicting_evidence' } as const
  const match: V5MatchAnalysis = {
    schemaVersion: '5.0.0',
    // A task link never certifies a whole compound qualification. Use its own judgment.
    requirementMatches: job.requirementAtoms.map(requirement => {
      const link = links.get(requirement.requirementId)
      return { requirementId: requirement.requirementId, status: link ? states[link.status] : 'currently_unproven',
        evidenceIds: link && ['direct', 'transferable'].includes(link.status) ? link.evidenceIds : [], confidence: 'medium',
        rationale: link ? [link.status, link.similarity, link.difference].filter(Boolean).join('；') : '当前材料未知，不等于没有能力。' }
    }),
    strengths: fit.narratives.map((narrative, index) => ({ strengthId: `target_strength_${index}`,
      requirementIds: requirementsFor(narrative.targetIds), evidenceIds: narrative.evidenceIds, statement: narrative.statement })),
    gaps: fit.questions.flatMap((question, index) => {
      const requirementIds = requirementsFor([question.targetId])
      const link = links.get(question.targetId)
      return requirementIds.length ? [{ gapId: `target_gap_${index}`, requirementIds,
        evidenceType: 'direct_missing' as const, priority: 'medium' as const, evidenceIds: [],
        impact: link?.status === 'explicit_gap' ? '来源明确存在岗位条件差异。' : '当前证据不足，不能据此判定本人不具备能力。', safeHandling: question.question }] : []
    }),
    positioning: { statement: fit.narratives.map(item => item.statement).join('；'),
      primaryRequirementIds: requirementsFor(fit.narratives.flatMap(item => item.targetIds)).slice(0, 3),
      primaryEvidenceIds: [...new Set(fit.narratives.flatMap(item => item.evidenceIds))], forbiddenIdentityClaims: [] },
    scoreInputs: { mustHaveApplicable: 0, mustHaveDirect: 0, mustHaveTransferable: 0, coreOutcomeApplicable: 0, coreOutcomeDirect: 0, coreOutcomeTransferable: 0, evidenceClarityRatio: 0 },
    contextUsed: [],
  }
  const checked = validateV5MatchAnalysis({ resume, job, match })
  if (!checked.passed) throw new Error('JOB_FIT_COMPATIBILITY_INVALID')
  return checked.value ?? match
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
