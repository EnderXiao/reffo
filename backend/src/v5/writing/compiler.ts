import { p06CompositionOutputSchema, type P06CompositionOutput } from '@/v5/composition/contract'
import { renderValidatedCompositionArtifact } from '@/v5/composition/compiler'
import type { GenerationPolicy, ResumeEvidenceBundle, ValidationIssue, V5ResumePlan } from '@/v5/types'
import { inspectSupportedWriting, writingIssue, writingNumbers } from '@/v5/writing/facts'
import type { WritingPlan } from '@/v5/writing/plan'
import { deriveWritingSourceExcerpts, sourceAtomsForWritingInspection } from '@/v5/writing/source-excerpts'
import { editorialTerms, termOverlap } from '@/v5/writing/editorial'
import { hasIncompleteMetricValue } from '@/v5/composition/source-display'
import { deriveWritingContexts } from '@/v5/writing/context'
import { isPracticeSkillEvidence, PRACTICE_SKILL_POLICY } from '@/v5/writing/skills'
import { deriveEducationIdentity, inspectEducationIdentity } from '@/v5/writing/identity'

export const WRITING_COMPILER_VERSION = 'supported-writing-compiler-v6' as const

export const WRITING_QUALITY_CODES = new Set(['WRITER_CORE_RESULT_OMITTED', 'WRITER_SUPPORTING_DETAIL_OMITTED', 'WRITER_PRIORITY_OUTCOME_OMITTED', 'WRITER_PRIORITY_PRACTICE_OMITTED', 'WRITER_OVERVIEW_DETAIL_REPEATED', 'WRITER_ABSTRACT_TOO_LONG'])

export class SupportedWritingError extends Error {
  readonly code = 'SUPPORTED_WRITING_VALIDATION_FAILED' as const
  constructor(readonly issues: ValidationIssue[]) {
    super('正文未通过受控写作校验；不发起模型互审或自动重写。')
    this.name = 'SupportedWritingError'
  }
}

export function compileWritingArtifact(input: {
  composition: unknown
  writingPlan: WritingPlan
  resume: ResumeEvidenceBundle
  plan: V5ResumePlan
  policy: GenerationPolicy
}) {
  const parsed = p06CompositionOutputSchema.safeParse(input.composition)
  if (!parsed.success) throw new SupportedWritingError([
    writingIssue('WRITER_SCHEMA_INVALID', 'blocks', [], '正文结构不符合受控写作契约。'),
  ])
  const { blueprint } = input.writingPlan
  const slots = new Map(blueprint.slots.map(slot => [slot.slotId, slot]))
  const atoms = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const excerpts = deriveWritingSourceExcerpts(input.resume, input.plan)
  const contexts = new Map(deriveWritingContexts(input.resume, input.plan, Boolean(input.writingPlan.entryParagraphGroups)).map(context => [context.evidenceId, context]))
  const seenSlots = new Set<string>()
  const usedBody = new Map<string, string>()
  const issues: ValidationIssue[] = []
  const educationIdentity = deriveEducationIdentity(input.resume.evidenceAtoms)
  const materialized: P06CompositionOutput = { contractVersion: parsed.data.contractVersion, blocks: [] }
  const blocks = [...(input.writingPlan.fixedBlocks ?? []), ...parsed.data.blocks]
  for (const block of blocks) {
    const slot = slots.get(block.slotId)
    const report = (code: string, message: string) => issues.push(writingIssue(code, block.slotId, block.evidenceIds, message))
    if (!slot || seenSlots.has(block.slotId)) {
      report('WRITER_SLOT_INVALID', '存在未知或重复的正文槽位。')
      continue
    }
    seenSlots.add(block.slotId)
    issues.push(...inspectEducationIdentity(block.text, educationIdentity, slot.outputPath))
    const budget = input.writingPlan.documentEditorial?.abstractBudgets
    if (budget && (slot.kind === 'summary' || slot.kind === 'skill')
      && !input.writingPlan.fixedBlocks?.some(fixed=>fixed.slotId === slot.slotId)) {
      const length = budget.unit === 'cjk_characters' ? (block.text.match(/[\u4e00-\u9fff]/gu) ?? []).length
        : block.text.trim().split(/\s+/u).length
      if (length > (slot.kind === 'summary' ? budget.summaryMax : budget.skillMax)) {
        issues.push(writingIssue('WRITER_ABSTRACT_TOO_LONG', slot.outputPath, block.evidenceIds,
          '概括板块超过软篇幅参考，记录阅读质量问题，不截断正文、不触发模型重写。', 'warning'))
      }
    }
    if (hasIncompleteMetricValue(block.text)) report('WRITER_INCOMPLETE_METRIC', '数值比较缺少终点，不能将残缺源句交付为完整成果。')
    if (new Set(block.evidenceIds).size !== block.evidenceIds.length
      || block.evidenceIds.some(id => !slot.allowedEvidenceIds.includes(id))) {
      report('WRITER_EVIDENCE_INVALID', '正文引用超出当前主题或存在重复。')
      continue
    }
    if (/[\r\n]|```|^\s*(?:#{1,6}|[-*+])\s|<\/?[a-z][^>]*>/iu.test(block.text)) {
      report('WRITER_TEXT_STRUCTURE_INVALID', '正文必须是一行纯文本，不能自行添加文档结构。')
    }
    const core = input.writingPlan.coreEvidenceIdsBySlot[slot.slotId] ?? []
    const skillAbstraction = slot.kind === 'skill' && input.writingPlan.skillPolicy === PRACTICE_SKILL_POLICY
    if (skillAbstraction && block.evidenceIds.some(id => !atoms.get(id) || !isPracticeSkillEvidence(atoms.get(id)!, input.plan))) {
      report('WRITER_SKILL_EVIDENCE_INVALID', '技能概括只能使用已选技能或真实业务实践。')
    }
    for (const id of block.evidenceIds) {
      const fact = input.writingPlan.facts.find(fact => fact.evidenceId === id)
      if (!fact?.contextForEvidenceId) continue
      const context = contexts.get(id)
      const group = input.writingPlan.entryParagraphGroups?.[block.slotId]
      const actionInEntry = context && group && blocks.some(other =>
        input.writingPlan.entryParagraphGroups?.[other.slotId] === group
        && slots.get(other.slotId)?.scopeId === slot.scopeId
        && other.evidenceIds.includes(context.anchorEvidenceId))
      if (slot.kind !== 'business_bullet' || !context || context.anchorEvidenceId !== fact.contextForEvidenceId
        || (!block.evidenceIds.includes(context.anchorEvidenceId) && !actionInEntry)) {
        report('WRITER_CONTEXT_WITHOUT_ACTION', '背景语境只能随来源关联的实际行动使用，不能成为独立贡献。')
      }
    }
    if (core.some(id => !block.evidenceIds.includes(id))) report('WRITER_CORE_EVIDENCE_MISSING', '遗漏当前主题的核心贡献引用。')
    if (slot.kind !== 'summary' && !skillAbstraction) {
      const group = input.writingPlan.entryParagraphGroups?.[block.slotId]
      if (block.evidenceIds.some(id => usedBody.has(id) && (!group || usedBody.get(id) !== group))) report('WRITER_DUPLICATE_BODY_FACT', '同一事实被重复写入多个正文主题。')
      block.evidenceIds.forEach(id => usedBody.set(id, group ?? block.slotId))
      const outputNumbers = new Set(writingNumbers(block.text))
      const coreFacts = input.writingPlan.facts.filter(fact => core.includes(fact.evidenceId))
      // Old frozen plans retain their original obligation; never reinterpret old requests silently.
      const coreResultNumbers = coreFacts.flatMap(fact => fact.requiredNumbers
        ?? (['result', 'deliverable'].includes(fact.claimType) ? fact.protectedNumbers : []))
      if (coreResultNumbers.some(value => !outputNumbers.has(value))) {
        report('WRITER_CORE_RESULT_OMITTED', '核心交付或成果中的数值信息被省略，不能仅保留引用冒充覆盖。')
      }
      const supportingNumbers = coreFacts.flatMap(fact => fact.protectedNumbers)
        .filter(value => !coreResultNumbers.includes(value))
      if (supportingNumbers.some(value => !outputNumbers.has(value))) {
        issues.push(writingIssue('WRITER_SUPPORTING_DETAIL_OMITTED', block.slotId, core,
          '附带数值未入正文；保留质量提示，不按事实篡改阻断或发起模型重写。', 'warning'))
      }
      const guide = input.writingPlan.editorial?.slots[slot.slotId]
      if (guide?.priorityEvidenceIds?.some(id => !block.evidenceIds.includes(id))) {
        issues.push(writingIssue('WRITER_PRIORITY_PRACTICE_OMITTED', block.slotId, guide.priorityEvidenceIds,
          '有编辑优先级的补充实践未被引用；仅记录待评审取舍，不自动重写或判定语义遗漏。', 'warning'))
      }
      if (guide?.emphasis.filter(item => item.kind === 'outcome').some(item => writingNumbers(item.text).some(number => !outputNumbers.has(number)))) {
        issues.push(writingIssue('WRITER_PRIORITY_OUTCOME_OMITTED', block.slotId, core,
          '代码提示的相关成果数值未呈现；仅记录表达质量问题，不认证事实缺失或启动重写。', 'warning'))
      }
    }
    const expandedIds = [...new Set(block.evidenceIds.flatMap(id => input.writingPlan.expandedEvidenceIds[id] ?? [id]))]
    const sourceAtoms = expandedIds.flatMap(id => atoms.get(id) ? [atoms.get(id)!] : [])
    if (sourceAtoms.length !== expandedIds.length || sourceAtoms.some(atom => atom.status === 'excluded'
      || atom.riskFlags.includes('sensitive_pii') || (slot.scopeId !== null && atom.sourceScopeId !== slot.scopeId))) {
      report('WRITER_SCOPE_MISMATCH', '正文证据缺失、不可使用或与经历归属不一致。')
      continue
    }
    issues.push(...inspectSupportedWriting(block.text, sourceAtomsForWritingInspection(sourceAtoms, excerpts), slot.outputPath,
      Boolean(input.writingPlan.entryParagraphGroups)))
    materialized.blocks.push({ ...block, evidenceIds: expandedIds })
  }
  for (const block of blocks) {
    const guide = input.writingPlan.editorial?.slots[block.slotId]
    for (const otherId of guide?.avoidRepeatingSlotIds ?? []) {
      const other = blocks.find(item => item.slotId === otherId)
      if (!other) continue
      const left = editorialTerms(block.text), right = editorialTerms(other.text), common = termOverlap(left, right)
      if (common >= 4 && common / Math.max(1, Math.min(left.size, right.size)) >= 0.65) {
        issues.push(writingIssue('WRITER_OVERVIEW_DETAIL_REPEATED', block.slotId, block.evidenceIds,
          '工作概览与项目详情仍存在高度重复的表达，需离线复核；不删正文、不新增模型调用。', 'warning'))
      }
    }
  }
  for (const slot of blueprint.slots.filter(slot => slot.required && !seenSlots.has(slot.slotId))) {
    issues.push(writingIssue('WRITER_REQUIRED_SLOT_MISSING', slot.slotId, [], '遗漏已计划的正文或摘要。'))
  }
  if (issues.some(issue => issue.severity === 'error')) throw new SupportedWritingError(issues)
  const result = renderValidatedCompositionArtifact({ ...input, composition: materialized, blueprint })
  return { ...result, writingIssues: issues, writingCompilerVersion: WRITING_COMPILER_VERSION }
}
