import { createDigest } from '@/harness/run-context'
import type { EvidenceAtom } from '@/v5/types'
import type { EntryBrief, WrittenEntry } from './entries'
import type { DetailAssessment, EntryCoverage } from './entry-skeleton'
import type { ValidationIssue } from '@/v5/types'
import { writingIssue } from './facts'
import {resumeDetailRequirements} from './information-routing'
import {recoverSkillParagraphs} from './skill-recovery'
import {SupportedWritingError} from './compiler'
import {normalizeOptionalGapPunctuation, projectFactSegments, segmentEvidenceIds} from './entry-skeleton'

export interface DetailSeed {
  detailId: string
  subjectKind: 'experience_detail' | 'claim_qualification'
  subject: string
  detailKind: DetailAssessment['detailKind']
  element: DetailAssessment['element']
  anchorEvidenceIds: string[]
  contextCompleteness: 'complete' | 'incomplete'
  rationale: string
  requiredDisposition: true
}
const digest = (value: unknown) => createDigest(JSON.stringify(value)).slice(0, 16)

/** An absent answer is the purpose of a blank, not evidence that a blank has no value. */
function unjustifiedResearchOmission(entry: EntryBrief, seed: DetailSeed, detail: DetailAssessment, details: DetailAssessment[]) {
  if (seed.detailKind !== 'research_finding' || seed.contextCompleteness !== 'complete' || !entry.gapContextComplete
    || detail.sourceState !== 'missing' || detail.decision !== 'omit' || detail.answerEvidenceIds.length
    || !detail.targetTaskIds.some(id => entry.taskIds.includes(id))) return false
  const practice = entry.facts.filter(fact => seed.anchorEvidenceIds.includes(fact.evidenceId))
  if (!practice.some(fact => /问卷|访谈|调研|用户研究|行为分析|共创/u.test(fact.text))) return false
  const reason = detail.reason
  const absenceOnly = /未(?:记录|说明|提供|明确)|没有.{0,8}(?:发现|观察|结论)|缺少.{0,8}(?:发现|观察|结论)|无法.{0,20}(?:推断|推测|补出|代写)|补写.{0,10}推断|不虚构|避免.{0,12}(?:虚构|推断|编造)/u.test(reason)
  if (!absenceOnly) return false
  // A duplicate can be checked against another actual finding disposition.
  if (/重复|已由|已经.{0,8}(?:呈现|覆盖)|前文/u.test(reason) && details.some(other => other.detailId !== detail.detailId
    && other.detailKind === 'research_finding' && ['keep', 'use_source', 'supplement'].includes(other.decision)
    && other.anchorEvidenceIds.some(id => seed.anchorEvidenceIds.includes(id)))) return false
  // These are editorial reasons independent of whether the answer exists. A
  // concrete explanation must name a real source practice or target task; a
  // bare "low_value / 不相关 / 需重新研究" cannot hide the original failure.
  const independentReason = /与.{1,40}(?:岗位|任务|目标).{0,20}(?:关联弱|关联较弱|无关|不相关)|(?:岗位|任务|目标).{1,40}(?:无关|不相关|不需要)|(?:必须|只能|需要|需).{0,12}(?:重新研究|重做调研|重新调研|重新访谈|重新采集)|没有.{0,8}(?:实际|真实)(?:开展|实施|完成)(?:研究|调研|访谈)/u.test(reason)
  const grounded = practice.some(fact => {
    const phrases = new Set((fact.text.match(/[\p{Script=Han}]{2,}/gu) ?? []).flatMap(run => Array.from({length: run.length - 1}, (_, i) => run.slice(i, i + 2)))
      .filter(phrase => !/^(?:参与|组织|形成|研究|调研|报告|完成|输出|提供|进行)$/u.test(phrase)))
    return [...phrases].filter(phrase => reason.includes(phrase)).length >= 2
  })
    || detail.targetTaskIds.some(id => reason.includes(id))
  const claimsNewStudy = /(?:必须|只能|需要|需).{0,12}(?:重新研究|重做调研|重新调研|重新访谈|重新采集)/u.test(reason)
  const sourceRequiresNewStudy = entry.gapContextFacts.some(fact => /尚未开展|尚未进行|未实施|待开展|计划访谈|记录.{0,5}(?:遗失|丢失|不可追溯)|无法访问.{0,8}(?:记录|材料)|需重新/u.test(fact.text))
  if (claimsNewStudy && !sourceRequiresNewStudy) return true
  return !(independentReason && grounded)
}

/** This only catches an answer explicitly declaring its own dimension undocumented. */
function explicitlyUndocumentedAnswer(item: EntryCoverage[number]) {
  const labels = item.element === 'responsibility' ? '本人(?:具体)?职责|个人职责|承担环节|责任范围'
    : item.element === 'project' ? '项目名称|项目背景|业务对象'
      : item.element === 'problem' ? '业务痛点|业务问题|具体问题|痛点'
        : item.element === 'solution' ? '解决方案|具体方案|实际行动|实施方式'
          : item.resultKind === 'deliverable' ? '交付物|研究产出|实际产出|交付成果'
            : item.resultKind === 'adoption' ? '采纳情况|实际采用情况|实际使用情况|落地情况'
              : '业务结果|业务成果|业务收益|业务增量|实际效果|结果|收益'
  return new RegExp(`(?:^|[，,；;。])\\s*(?:具体)?(?:${labels})(?:的)?(?:来源|材料|信息|证据|细节)?(?:尚|仍)?(?:未记录|未说明|未提供|未明确)(?=[，,；;。]|$)`, 'u').test(item.answer ?? '')
    || new RegExp(`(?:^|[，,；;。])\\s*(?:来源|源材料|当前材料|材料)(?:中)?(?:尚|仍)?(?:未记录|未说明|未提供|未明确)(?:具体的?)?(?:${labels})(?=[，,；;。]|$)`, 'u').test(item.answer ?? '')
}

/** Only deterministic source signals become seeds; missing background is not automatically a gap. */
export function buildDetailSeeds(entry: EntryBrief, atoms: readonly EvidenceAtom[]): DetailSeed[] {
  if (entry.slot.kind !== 'business_bullet' || !entry.scopeId) return []
  const seeds: DetailSeed[] = []
  for (const signal of entry.sourceUncertainties ?? []) for (const {detailKind: kind, subject} of resumeDetailRequirements(signal)) {
    seeds.push({detailId: `detail:${digest([entry.scopeId, signal.evidenceId, kind, subject])}`, subjectKind: 'claim_qualification',
      subject, detailKind: kind,
      element: 'result', anchorEvidenceIds: [signal.evidenceId],
      contextCompleteness: entry.gapContextComplete ? 'complete' : 'incomplete', rationale: '仅补充影响理解的实施状态，保留本人参与及实际交付边界。', requiredDisposition: true})
  }
  const practice = atoms.filter(atom => atom.sourceScopeId === entry.scopeId && entry.facts.some(fact => fact.evidenceId === atom.evidenceId)
    && ['action', 'deliverable', 'responsibility'].includes(atom.claimType))
  const researchPractice = practice.filter(atom => /用户研究|用户调研|门店调研|问卷|访谈|行为分析/u.test(atom.verbatimText))
  if ((entry.section === 'research' ? practice : researchPractice).length) seeds.push({detailId: `detail:${digest([entry.scopeId, 'research_finding'])}`,
    subjectKind: 'experience_detail', subject: entry.projectIdentity?.text ?? '本项研究', detailKind: 'research_finding', element: 'result',
    anchorEvidenceIds: (entry.section === 'research' ? practice : researchPractice).map(atom => atom.evidenceId), contextCompleteness: entry.gapContextComplete ? 'complete' : 'incomplete',
    rationale: '检查已有研究材料是否包含一项具体发现；有答案直接使用，无答案且有价值才留短空，不能推断采纳或收益。', requiredDisposition: true})
  return seeds
}

export function inspectDetailLedger(input: {entry: EntryBrief; written: WrittenEntry}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const report = (code: string, text: string) => issues.push(writingIssue(code, input.entry.slot.outputPath, [], text))
  const details = input.written.detailAssessments ?? []
  const seen = new Set<string>()
  for (const seed of input.entry.detailSeeds ?? []) {
    const matches = details.filter(item => item.detailId === seed.detailId)
    if (matches.length !== 1) report('WRITER_DETAIL_SEED_UNRESOLVED', `服务端候选 ${seed.detailId} 必须逐项且恰好处置一次，不能返回空清单。`)
    else if (matches[0].detailKind !== seed.detailKind || matches[0].element !== seed.element
      || !matches[0].anchorEvidenceIds.some(id => seed.anchorEvidenceIds.includes(id))
      || seed.subjectKind === 'claim_qualification' && matches[0].subject !== seed.subject) report('WRITER_DETAIL_SEED_UNRESOLVED', '候选处置必须保留缺失维度、独立指标对象和原实践锚点，不能合并多个指标口径。')
    else if (unjustifiedResearchOmission(input.entry, seed, matches[0], details)) report('WRITER_GAP_OMISSION_INVALID',
      `候选 ${seed.detailId} 有真实研究实践、完整上下文及相关目标任务，但仅以“未记录答案/无法代写会推断”为由省略。缺少答案正是留空适用情形：保留已知研究动作，用 research_finding 留一项具体发现的短空并给出单句岗位价值提示；不代填发现、不假设采纳或收益。确有重复、低相关性或须重新研究时，应给出独立、具体且有来源依据的原因。`)
  }
  for (const detail of details) {
    const key = JSON.stringify([detail.subject, detail.detailKind, [...detail.anchorEvidenceIds].sort()])
    if (seen.has(key)) report('WRITER_DETAIL_INVALID', '同一个事实和缺失维度不能重复建立填写项。')
    seen.add(key)
  }
  for (const item of input.written.coverage ?? []) {
    if (!item.answer?.trim() || !item.resultKind && item.element === 'result') report('WRITER_COVERAGE_ANSWER_MISSING', '五要素必须给出具体语义回答或明确为何未知；结果区分交付物、采纳与业务成果。')
    if (item.status === 'known' && (explicitlyUndocumentedAnswer(item)
      || item.element === 'result' && ['unknown', 'not_applicable'].includes(item.resultKind ?? ''))) {
      report('WRITER_COVERAGE_INVALID', `五要素${item.element}自报未记录这一维度或结果类型未知，不能同时标为known；请保留实际已有回答，并将未明方面标为missing或ambiguous，不强造填写格。`)
    }
  }
  return issues
}

export function stableDetailIds(entry: EntryBrief, details: DetailAssessment[]): Map<string, string> {
  const seeds = new Set(entry.detailSeeds?.map(seed => seed.detailId))
  return new Map(details.map(detail => [detail.detailId, seeds.has(detail.detailId) ? detail.detailId
    : `detail:${digest([entry.scopeId, detail.detailKind, detail.subject, [...detail.anchorEvidenceIds].sort()])}`]))
}

/** Last-resort, per-entry source projection after bounded correction. No unresolved result is promoted. */
export function safeRecoveredEntry(entry: EntryBrief, rejected?: {written: WrittenEntry; issues: ValidationIssue[]; otherEntries?: WrittenEntry[]; renderedSkills?: Array<{text: string; evidenceIds: string[]}>; sourceParagraphIndices?: readonly number[]}): WrittenEntry {
  if (rejected?.issues.length && rejected.issues.every(issue => issue.code === 'WRITER_GAP_OMISSION_INVALID')) {
    const invalidDetails = new Set((entry.detailSeeds ?? []).filter(seed => {
      const detail = rejected.written.detailAssessments?.find(detail => detail.detailId === seed.detailId)
      return detail && unjustifiedResearchOmission(entry, seed, detail, rejected.written.detailAssessments ?? [])
    }).map(seed => seed.detailId))
    const written = structuredClone(rejected.written)
    for (const detailId of invalidDetails) {
      const detail = written.detailAssessments!.find(item => item.detailId === detailId)!
      const paragraph = written.paragraphs.find(item => item.evidenceIds.some(id => detail.anchorEvidenceIds.includes(id)))
      if (!paragraph?.segments) throw new SupportedWritingError(rejected.issues)
      const segments = [...paragraph.segments]
      const gap = {kind: 'optional_gap_clause' as const, template: 'research_finding' as const, detailId,
        hint: '补一项影响方案判断的研究发现，体现目标岗位所需的用户研究与产品判断能力。', candidates: []}
      const last = segments.at(-1)
      if (last?.kind === 'fact' && /^[。；;！!？?]$/u.test(last.text.trim())) segments.splice(segments.length - 1, 0, gap)
      else segments.push(gap)
      const normalized = normalizeOptionalGapPunctuation(segments)
      if (projectFactSegments(normalized) !== paragraph.text) throw new SupportedWritingError(rejected.issues)
      Object.assign(paragraph, {segments: normalized, text: projectFactSegments(normalized), evidenceIds: segmentEvidenceIds(normalized)})
      Object.assign(detail, {decision: 'supplement', expressionState: 'underspecified',
        reason: '已有真实研究实践且对应目标任务，缺少答案不构成省略理由；以短空承接具体研究发现，不代填结果。'})
    }
    return written
  }
  const facts = entry.facts.filter(fact => !entry.sourceUncertainties?.some(signal => signal.evidenceId === fact.evidenceId)
    || entry.informationRouting?.some(assertion => assertion.evidenceId === fact.evidenceId && assertion.resumeText))
  const core = facts.filter(fact => entry.coreEvidenceIds.includes(fact.evidenceId))
  const duplicateSkill = entry.section === 'skills' && rejected?.issues.some(issue => ['WRITER_SKILL_CASE_REPEATED', 'WRITER_SKILL_DIMENSIONS_REPEATED'].includes(issue.code))
  const retained = core.length ? core : facts.slice(0, 1)
  if (!retained.length) throw new SupportedWritingError([writingIssue('WRITER_RECOVERY_NO_SAFE_FACT', entry.slot.outputPath, [],
    '局部恢复没有可准入的来源事实，不能通过清空条目交付。')])
  const coverage: EntryCoverage = ['responsibility', 'project', 'problem', 'solution', 'result'].map(value => {
    const element = value as import('@/shared/resume-completion').FiveElement
    if (entry.slot.kind !== 'business_bullet') return {element, status: 'not_applicable', evidenceIds: [],
      answer: '本条按来源保留技能或教育等事实，不强套项目经历五要素。', resultKind: 'not_applicable'}
    if (element === 'project' && entry.projectIdentity?.text && entry.projectIdentity.evidenceIds.length) return {
      element, status: 'known', evidenceIds: entry.projectIdentity.evidenceIds, answer: entry.projectIdentity.text, resultKind: 'not_applicable'}
    const support = retained.filter(fact => element === 'responsibility' ? fact.claimType === 'responsibility'
      : element === 'problem' ? fact.contextRole === 'problem'
      : element === 'solution' ? ['action', 'deliverable'].includes(fact.claimType)
      : element === 'result' ? ['result', 'deliverable'].includes(fact.claimType) : false)
    if (support.length) return {element, status: 'known', evidenceIds: support.map(fact => fact.evidenceId),
      answer: support.map(fact => fact.text).join('；').slice(0, 600),
      resultKind: element === 'result' ? support.some(fact => fact.claimType === 'result') ? 'business_outcome' : 'deliverable' : 'not_applicable'}
    return {element, status: 'ambiguous', evidenceIds: [], answer: '本条仅恢复已核对来源，其他方面尚未重新评估；不据此判断事实缺失或建立填写格。',
      resultKind: element === 'result' ? 'unknown' : 'not_applicable'}
  })
  const fallback: WrittenEntry = {entryId: entry.entryId, coverage,
    detailAssessments: (entry.detailSeeds ?? []).map(seed => ({detailId: seed.detailId, element: seed.element, detailKind: seed.detailKind,
      subject: seed.subject, anchorEvidenceIds: seed.anchorEvidenceIds, targetTaskIds: [], sourceState: 'context_incomplete', answerEvidenceIds: [],
      expressionState: 'not_used', decision: 'omit', reason: '本条局部修复耗尽，暂时保留安全来源表达；该候选未通过核对，未伪装为已完成。', benefit: seed.rationale.slice(0, 120)})),
    uncertaintyResolutions: (entry.sourceUncertainties ?? []).map(signal => ({uncertaintyId: signal.uncertaintyId,
      action: 'use_safe_facts', claimId: null, reason: 'safe_alternative', explanation: '本条恢复为安全行动，待补证结果未进入正文。'})),
    actionReceipts: [], paragraphs: duplicateSkill ? recoverSkillParagraphs(entry, facts, rejected!) : retained.map((fact, index) => ({unitId: `${entry.entryId}:recovery:${index}`, role: 'detail', text: fact.text, evidenceIds: [fact.evidenceId],
      segments: [{kind: 'fact', text: fact.text, evidenceIds: [fact.evidenceId]}]}))}
  // An error with a reliable paragraph location must not erase separately valid
  // sentences or their clozes. Any changed unit is still fully revalidated.
  const located = rejected?.sourceParagraphIndices ?? rejected?.issues.map(issue => issue.paragraphIndex).filter((index): index is number => index !== undefined)
  if (rejected && located?.length && (rejected.sourceParagraphIndices !== undefined || rejected.issues.every(issue => issue.paragraphIndex !== undefined))
    && entry.slot.kind === 'business_bullet') {
    const failed = new Set(located)
    const paragraphs = rejected.written.paragraphs.flatMap((paragraph, index) => {
      if (!failed.has(index)) return [paragraph]
      // A known valuable blank cannot disappear merely because its containing
      // sentence failed another gate. Leave it blocked for a semantic repair.
      if (paragraph.segments?.some(segment => segment.kind !== 'fact')) throw new SupportedWritingError(rejected.issues)
      const sources = facts.filter(fact => paragraph.evidenceIds.includes(fact.evidenceId))
      if (!sources.length) return []
      return sources.map((fact, factIndex) => ({unitId: `${entry.entryId}:recovery:${index}:${factIndex}`, role: paragraph.role,
        text: fact.text, evidenceIds: [fact.evidenceId], segments: [{kind: 'fact' as const, text: fact.text, evidenceIds: [fact.evidenceId]}]}))
    })
    if (paragraphs.length) {
      const retainedUnits = new Set(paragraphs.map(paragraph => paragraph.unitId))
      const details = rejected.written.detailAssessments ?? []
      return {...rejected.written, paragraphs,
        // Keep detail truth and valid blanks; unresolved affected decisions are
        // rejected again rather than silently reclassified as absent context.
        detailAssessments: details,
        actionReceipts: rejected.written.actionReceipts?.filter(receipt => receipt.unitIds.every(id => retainedUnits.has(id))),
      }
    }
  }
  if (rejected && entry.slot.kind === 'business_bullet'
    && rejected.written.paragraphs.some(paragraph => paragraph.segments?.some(segment => segment.kind !== 'fact'))
    && rejected.issues.some(issue => issue.code !== 'WRITER_EVIDENCE_INVALID')) throw new SupportedWritingError(rejected.issues)
  // A future/context-only paragraph must not erase a separately valid research
  // paragraph. Keep the latter only after bounded repairs, then revalidate the
  // entire entry and document through the unchanged fact and gap gates.
  if (!rejected?.issues.length || rejected.issues.some(issue => issue.code !== 'WRITER_EVIDENCE_INVALID')) return fallback
  const allowed = new Set(facts.map(fact => fact.evidenceId))
  const contextOnly = new Set(entry.gapContextFacts.filter(fact => fact.scopeId === entry.scopeId && !allowed.has(fact.evidenceId)).map(fact => fact.evidenceId))
  const invalid = rejected.written.paragraphs.flatMap(paragraph => paragraph.evidenceIds).filter(id => !allowed.has(id))
  if (!invalid.length || invalid.some(id => !contextOnly.has(id))) return fallback
  const paragraphs = rejected.written.paragraphs.filter(paragraph => paragraph.evidenceIds.length
    && paragraph.evidenceIds.every(id => allowed.has(id)))
  if (!paragraphs.length || paragraphs.length === rejected.written.paragraphs.length) return fallback
  const usedIds = new Set(paragraphs.flatMap(paragraph => paragraph.evidenceIds))
  const gapIds = new Set(paragraphs.flatMap(paragraph => paragraph.segments?.flatMap(segment => segment.kind === 'optional_gap_clause'
    ? segment.detailId ? [segment.detailId] : [] : segment.kind === 'dependent_claim' ? segment.requiredDetailIds : []) ?? []))
  const claims = new Set(paragraphs.flatMap(paragraph => paragraph.segments?.flatMap(segment => segment.kind === 'dependent_claim' ? [segment.claimId] : []) ?? []))
  const units = new Set(paragraphs.map(paragraph => paragraph.unitId))
  return {...fallback, paragraphs: [...paragraphs, ...fallback.paragraphs.filter(paragraph => paragraph.evidenceIds.some(id => !usedIds.has(id)))],
    detailAssessments: (rejected.written.detailAssessments ?? []).map(detail => gapIds.has(detail.detailId) ? detail
      : {...detail, decision: 'omit' as const, reason: '关联段落未通过来源准入，已省略；该细节不冒称已使用或已补齐。'}),
    uncertaintyResolutions: (rejected.written.uncertaintyResolutions ?? []).map(resolution => resolution.claimId && claims.has(resolution.claimId)
      ? resolution : {...resolution, action: 'use_safe_facts' as const, claimId: null, reason: 'safe_alternative' as const,
        explanation: '不安全上下文段落已省略，保留独立通过核对的实际行动。'}),
    actionReceipts: rejected.written.actionReceipts?.filter(receipt => receipt.unitIds.every(id => units.has(id))),
  }
}
