import { z } from 'zod'
import type { CompositionBlueprintSlot, CompositionSectionKey } from '@/v5/composition/contract'
import type { GenerationPolicy, ResumeEvidenceBundle, V5ResumePlan } from '@/v5/types'
import type { WritingPlan } from '@/v5/writing/plan'
import { writingPayload } from '@/v5/writing/plan'
import { buildWritingFact, writingIssue, writingNumbers, TEAM_CONTRIBUTION_PATTERN, type WritingFact } from '@/v5/writing/facts'
import { compileWritingArtifact, SupportedWritingError } from '@/v5/writing/compiler'
import { hasIncompleteMetricValue } from '@/v5/composition/source-display'
import { hasCanonicalSourceLineSeparator } from '@/v5/composition/source-continuation'
import { targetingEvidenceScores } from '@/v5/targeting/fit'
import { workScopeBrief } from '@/v5/writing/work-coverage'
import { canCompactEntryParagraphs, entryLayoutItemLimit, ENTRY_LAYOUT_VERSION } from '@/v5/writing/entry-layout'

export const ENTRY_WRITING_POLICY = 'entry-writing-v1' as const
export const entryParagraphSchema = z.object({
  role: z.enum(['positioning', 'scope', 'problem', 'approach', 'contribution', 'outcome', 'method', 'education', 'credential', 'detail']),
  text: z.string().trim().min(1).max(6000),
  evidenceIds: z.array(z.string().min(1)).min(1).max(80),
}).strict()
export const writtenEntrySchema = z.object({
  entryId: z.string().min(1), paragraphs: z.array(entryParagraphSchema).min(1).max(12),
}).strict()
export const entryWritingOutputSchema = z.object({
  contractVersion: z.literal(ENTRY_WRITING_POLICY), entries: z.array(writtenEntrySchema).min(1).max(100),
}).strict()
export type WrittenEntry = z.infer<typeof writtenEntrySchema>

export const SECTION_WRITING_ROLES: Partial<Record<CompositionSectionKey, string>> = {
  summary: '职业定位—有依据的能力主张—目标岗位价值；正文负责具体证明。',
  experience: '责任范围—核心工作方法—本人代表贡献—持续交付价值。',
  project: '业务对象与问题/需求—方案逻辑与边界—本人动作和产物—结果或真实交付状态。',
  research: '研究问题—研究方法—本人工作—发现、产出或当前阶段。',
  skills: '能力领域—方法工具—应用对象—可完成的产物，不复述事件。',
  education: '学历事实由标题呈现；正文选择相关训练和实际学习证据，不重复标题。',
  certifications: '证书准确名称—级别—取得状态—必要有效范围，部分通过不等于持证。',
  awards: '奖项名称—级别—时间与必要背景，不升级获奖范围。',
}

export interface EntryBrief {
  entryId: string
  section: CompositionSectionKey
  scopeId: string | null
  order: number
  slot: CompositionBlueprintSlot
  facts: WritingFact[]
  coreEvidenceIds: string[]
  taskIds: string[]
  lengthHint: { unit: 'words' | 'cjk_characters'; target: number }
}
export interface EntryWritingPlan {
  version: typeof ENTRY_WRITING_POLICY
  base: WritingPlan
  entries: EntryBrief[]
  renderingPlan: V5ResumePlan
  listItemBudget: number
  listItemHardLimit: number
}

/** Omit a dangling quantity when its unit lives on the following source line.
 * Never promote or concatenate that following (possibly qualified) source.
 */
export function omitSplitQuantityTail(fact: WritingFact, resume: ResumeEvidenceBundle): WritingFact {
  const atom = resume.evidenceAtoms.find(a => a.evidenceId === fact.evidenceId)
  if (!atom || !/\d\s*$/u.test(fact.text)) return fact
  const next = resume.evidenceAtoms.find(a => a.sourceScopeId === atom.sourceScopeId
    && a.sourceDocumentHash === atom.sourceDocumentHash
    && /^B\d+$/u.test(a.sourceBlockId) && /^B\d+$/u.test(atom.sourceBlockId)
    && Number(a.sourceBlockId.slice(1)) === Number(atom.sourceBlockId.slice(1)) + 1
    // Omission needs only a potential adjacent unit, not permission to join it.
    // Qualified/editorial next blocks often deliberately carry no join proof.
    && (hasCanonicalSourceLineSeparator(atom, a)
      || (a.sourceSpan.start > atom.sourceSpan.end && a.sourceSpan.start - atom.sourceSpan.end <= 4)))
  if (!next || !/^(?:万|亿|千|百|次|人|份|项|家|条|篇)(?:\+|[。；;，,\s]|$)/u.test(next.verbatimText.trim())) return fact
  const tail = /[；;。][^；;。]*(?:累计|日均|月均|年均|查看|覆盖|访问)[^；;。]*\d\s*$/u.exec(fact.text)
  if (!tail) return fact
  const text = fact.text.slice(0, tail.index).trim()
  if (!text || hasIncompleteMetricValue(text)) return fact
  const numbers = writingNumbers(text)
  return { ...fact, text, focusText: text, protectedNumbers: numbers,
    requiredNumbers: fact.requiredNumbers?.filter(n => numbers.includes(n)) }
}

/** Version selection reads only the server envelope, never nested source text. */
export function isEntryWritingEnvelope(envelope: unknown): boolean {
  if (!envelope || typeof envelope !== 'object' || !('payload' in envelope)) return false
  const payload = envelope.payload
  return !!payload && typeof payload === 'object' && 'entryWritingPolicy' in payload
    && payload.entryWritingPolicy === ENTRY_WRITING_POLICY
    && 'writingPolicy' in payload && payload.writingPolicy === 'supported-writing-v1'
}

export function buildEntryWritingPlan(input: {
  base: WritingPlan; resume: ResumeEvidenceBundle; plan: V5ResumePlan; policy: GenerationPolicy
}): EntryWritingPlan {
  if (!input.base.targeting) throw new Error('ENTRY_WRITER_REQUIRES_TARGETING')
  const base = structuredClone(input.base), renderingPlan = structuredClone(input.plan)
  // Timeline-only jobs can retain a verbatim scope list without asking the
  // model to manufacture contributions. These fixed blocks share the budget.
  for (const scope of renderingPlan.scopePlans.filter(item => item.treatment === 'timeline_line')) {
    const brief = workScopeBrief(input.resume, scope.scopeId)
    const minimumEntries = new Set(base.blueprint.slots.filter(slot => slot.kind !== 'summary'
      && !base.fixedBlocks?.some(block => block.slotId === slot.slotId))
      .map(slot => slot.kind === 'business_bullet' ? `${slot.sectionKey}:${slot.scopeId}` : slot.slotId)).size
    if (!brief || (base.fixedBlocks?.length ?? 0) + minimumEntries >= input.policy.hardTotalListItemMax) continue
    const slotId = `work-scope:${scope.scopeId}`
    base.blueprint.slots.push({ slotId, kind: 'business_bullet', sectionKey: 'experience', scopeId: scope.scopeId,
      outputPath: `experience.${scope.scopeId}.bullets[0]`, order: base.blueprint.slots.length,
      required: true, allowedEvidenceIds: [brief.evidenceId] })
    ;(base.fixedBlocks ??= []).push({ slotId, evidenceIds: [brief.evidenceId], text: brief.text })
    scope.treatment = 'compress'
    scope.selectedEvidenceIds = [brief.evidenceId]
    scope.bulletBudget = 1
  }
  const fixed = new Set(base.fixedBlocks?.map(block => block.slotId))
  const entries: EntryBrief[] = []
  const atoms = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const factMap = new Map(base.facts.map(fact => [fact.evidenceId, fact]))
  const business = (slot: CompositionBlueprintSlot) => slot.kind === 'business_bullet'
  for (const slot of [...base.blueprint.slots].sort((a, b) => a.order - b.order)) {
    if (fixed.has(slot.slotId)) continue
    let entry = business(slot) ? entries.find(item => item.scopeId === slot.scopeId && item.section === slot.sectionKey) : undefined
    if (!entry) {
      entry = { entryId: `entry:${entries.length}`, section: slot.sectionKey, scopeId: slot.scopeId,
        order: slot.order, slot: structuredClone(slot), facts: [], coreEvidenceIds: [], taskIds: [],
        lengthHint: { unit: base.outputLength.unit, target: 0 } }
      entries.push(entry)
    }
    for (const id of slot.allowedEvidenceIds) {
      const fact = factMap.get(id)
      if (fact && !entry.facts.some(item => item.evidenceId === id)) entry.facts.push(fact)
    }
    entry.coreEvidenceIds.push(...(base.coreEvidenceIdsBySlot[slot.slotId] ?? []))
    entry.taskIds.push(...(base.editorial?.slots[slot.slotId]?.targetTaskIds ?? []))
  }
  for (const entry of entries) {
    if (business(entry.slot) && entry.scopeId) {
      const scopePlan = renderingPlan.scopePlans.find(item => item.scopeId === entry.scopeId)!
      // Restore selected facts lost by per-slot grouping. Context stays within the
      // validated semantic scope; a scope is not shared across unrelated projects.
      const candidates = input.resume.evidenceAtoms.filter(atom => atom.sourceScopeId === entry.scopeId
        && (scopePlan.selectedEvidenceIds.includes(atom.evidenceId)
          || (atom.claimType === 'other' && atom.status === 'source_supported' && !atom.riskFlags.length
            && atom.verbatimText.trim().length >= 12 && !hasIncompleteMetricValue(atom.verbatimText))))
      for (const atom of candidates) {
        if (entry.facts.some(fact => fact.evidenceId === atom.evidenceId)) continue
        const fact = factMap.get(atom.evidenceId) ?? buildWritingFact(atom)
        if (!fact || ['identity', 'timeline', 'skill'].includes(fact.claimType)) continue
        entry.facts.push(fact)
        factMap.set(fact.evidenceId, fact)
        base.expandedEvidenceIds[fact.evidenceId] ??= [fact.evidenceId]
      }
      // Context is optional material, never a new required achievement.
      scopePlan.selectedEvidenceIds = [...new Set([...scopePlan.selectedEvidenceIds, ...entry.facts.map(f => f.evidenceId)])]
    }
    entry.facts.sort((a, b) => (atoms.get(a.evidenceId)?.sourceSpan.start ?? 0) - (atoms.get(b.evidenceId)?.sourceSpan.start ?? 0))
    entry.coreEvidenceIds = [...new Set(entry.coreEvidenceIds)]
    entry.taskIds = [...new Set(entry.taskIds)]
  }
  for (const entry of entries) entry.facts = entry.facts.map(fact => {
    let safe = omitSplitQuantityTail(fact, input.resume)
    // Surface a verified attribution constraint in the prose material as well
    // as metadata, so it is not lost when copying a contribution sentence.
    if (safe.boundaries.includes('团队或参与贡献') && !TEAM_CONTRIBUTION_PATTERN.test(safe.text)) {
      safe = { ...safe, text: `团队协作中，${safe.text}` }
    }
    factMap.set(safe.evidenceId, safe)
    return safe
  })
  // A summary can only cite its own pool; retain representative practices from
  // additional relevant scopes rather than having it borrow facts from the JD.
  const scores = targetingEvidenceScores(input.base.targeting.fit, input.base.targeting.targets, input.resume)
  const summary = entries.find(entry => entry.section === 'summary')
  if (summary) {
    const represented = new Set(summary.facts.map(f => f.scopeId))
    const candidates = entries.filter(entry => business(entry.slot)).flatMap(entry =>
      entry.facts.filter(f => entry.coreEvidenceIds.includes(f.evidenceId)))
      .sort((a, b) => (scores.get(b.evidenceId) ?? 0) - (scores.get(a.evidenceId) ?? 0))
    for (const fact of candidates) {
      if (summary.facts.length >= 5) break
      if (represented.has(fact.scopeId) || (scores.get(fact.evidenceId) ?? 0) <= 0) continue
      summary.facts.push(fact)
      represented.add(fact.scopeId)
    }
  }
  base.facts = [...factMap.values()]
  // Budget after scope/role assembly. It is a soft document allocation, not an
  // instruction to compress an action because its former slot was an overview.
  const weights = entries.map(entry => {
    const words = new Intl.Segmenter('zh', { granularity: 'word' })
    const size = entry.facts.reduce((sum, fact) => sum + [...words.segment(fact.text)].filter(p => p.isWordLike).length, 0)
    return Math.max(1, Math.sqrt(size)) * (business(entry.slot) ? 2 : 1) * (entry.taskIds.length ? 1.25 : 1)
  })
  const total = weights.reduce((sum, n) => sum + n, 0)
  entries.forEach((entry, index) => { entry.lengthHint.target = Math.floor(base.outputLength.softMax * 0.8 * weights[index] / Math.max(1, total)) })
  return { version: ENTRY_WRITING_POLICY, base, entries, renderingPlan,
    listItemBudget: Math.max(0, input.policy.hardTotalListItemMax - (base.fixedBlocks?.length ?? 0)),
    listItemHardLimit: Math.max(0, entryLayoutItemLimit(input.policy) - (base.fixedBlocks?.length ?? 0)) }
}

export function entryWritingPayload(plan: EntryWritingPlan) {
  const old = writingPayload(plan.base)
  return {
    writingPolicy: plan.base.version, entryWritingPolicy: plan.version,
    guidance: plan.base.guidance, outputLength: plan.base.outputLength,
    listItemBudget: plan.listItemBudget,
    layoutPolicy: ENTRY_LAYOUT_VERSION, listItemHardLimit: plan.listItemHardLimit,
    jobTargeting: old.jobTargeting, candidateIdentity: old.candidateIdentity,
    // Body first, abstraction last; presentation order remains server-owned.
    entries: [...plan.entries].sort((a, b) => Number(['summary', 'skills'].includes(a.section)) - Number(['summary', 'skills'].includes(b.section)) || a.order - b.order)
      .map(entry => ({ entryId: entry.entryId, section: entry.section,
        paragraphLimit: entry.slot.kind === 'business_bullet'
          ? plan.renderingPlan.scopePlans.find(scope => scope.scopeId === entry.scopeId)?.treatment === 'compress' ? 2 : 4 : 1,
        purpose: SECTION_WRITING_ROLES[entry.section] ?? '准确呈现与岗位相关的源材料。',
        facts: entry.facts, coreEvidenceIds: entry.coreEvidenceIds, targetTaskIds: entry.taskIds,
        lengthHint: entry.lengthHint })),
  }
}

/** Locally validate a complete entry; no partial JSON or raw reasoning is public. */
export function compileEntryWriting(input: {
  output: unknown; entryPlan: EntryWritingPlan; resume: ResumeEvidenceBundle; policy: GenerationPolicy
  previewEntryId?: string
}) {
  const output = entryWritingOutputSchema.parse(input.output)
  const entries = input.previewEntryId ? input.entryPlan.entries.filter(e => e.entryId === input.previewEntryId) : input.entryPlan.entries
  const byId = new Map(output.entries.map(entry => [entry.entryId, entry]))
  const fail = (code: string) => { throw new SupportedWritingError([writingIssue(code, 'entries', [], '经历结构与服务端计划不一致。')]) }
  if (byId.size !== output.entries.length || byId.size !== entries.length || entries.some(entry => !byId.has(entry.entryId))) fail('ENTRY_SET_INVALID')
  const writingPlan = structuredClone(input.entryPlan.base)
  const plan = structuredClone(input.entryPlan.renderingPlan)
  const fixedSlots = writingPlan.blueprint.slots.filter(slot => writingPlan.fixedBlocks?.some(block => block.slotId === slot.slotId))
  writingPlan.blueprint.slots = input.previewEntryId ? [] : fixedSlots
  if (input.previewEntryId) writingPlan.fixedBlocks = []
  writingPlan.entryParagraphGroups = {}
  writingPlan.coreEvidenceIdsBySlot = {}
  writingPlan.editorial = undefined
  const blocks: Array<{ slotId: string; evidenceIds: string[]; text: string }> = []
  const warnings = []
  const paragraphsById = new Map(entries.map(entry => [entry.entryId, byId.get(entry.entryId)!.paragraphs.map(paragraph => {
    if (entry.slot.kind !== 'business_bullet' || /(?:未|不|没有|非).{0,3}主导/u.test(paragraph.text)) return paragraph
    const sources = paragraph.evidenceIds.flatMap(id => input.entryPlan.base.expandedEvidenceIds[id] ?? [id])
      .flatMap(id => input.resume.evidenceAtoms.filter(atom => atom.evidenceId === id))
    if (sources.some(atom => /主导/u.test(atom.verbatimText))) return paragraph
    const text = paragraph.text.replace(/主导(形成|设计|梳理|分析|开发|制定|搭建|完成)/gu, (original, action: string) =>
      sources.some(atom => ['action', 'responsibility', 'deliverable'].includes(atom.claimType)
        && atom.verbatimText.includes(action)) ? action : original)
    if (text === paragraph.text) return paragraph
    warnings.push(writingIssue('WRITER_UNSUPPORTED_LEADERSHIP_REMOVED', entry.entryId, paragraph.evidenceIds,
      '删除无来源依据的“主导”修饰，保留同条源材料明确记录的实际动作；未改写源事实。', 'warning'))
    return { ...paragraph, text }
  })]))
  const countItems = () => entries.reduce((sum, entry) => sum + (entry.slot.kind === 'summary' ? 0
    : entry.slot.kind === 'business_bullet' ? paragraphsById.get(entry.entryId)!.length : 1), 0)
  let merges = 0
  while (countItems() > input.entryPlan.listItemHardLimit) {
    const available = entries.filter(entry => entry.slot.kind === 'business_bullet')
    const pairs = available.flatMap(entry => {
      const paragraphs = paragraphsById.get(entry.entryId)!
      return paragraphs.slice(0, -1).flatMap((p, index) =>
        canCompactEntryParagraphs(p, paragraphs[index + 1], input.policy.outputLength.unit) ? [{entryId:entry.entryId, index,
        size:p.text.length + paragraphs[index + 1].text.length}]
        : [])
    }).sort((a, b) => a.size - b.size)
    const pair = pairs[0]
    if (!pair) break
    const paragraphs = paragraphsById.get(pair.entryId)!
    const [left, right] = paragraphs.slice(pair.index, pair.index + 2)
    paragraphs.splice(pair.index, 2, {role:left.role, text:`${left.text} ${right.text}`,
      evidenceIds:[...new Set([...left.evidenceIds, ...right.evidenceIds])]})
    merges++
  }
  if (merges) warnings.push(writingIssue('WRITER_LAYOUT_COMPACTED', 'entries', [],
    `同经历相邻段落合并 ${merges} 次以满足列表布局，保留全部句子与引用。`, 'warning'))
  if (countItems() > input.entryPlan.listItemBudget) warnings.push(writingIssue('ENTRY_LAYOUT_TARGET_EXCEEDED', 'entries', [],
    '为保留独立信息段落使用有限排版余量；总字数上限和证据校验不变。', 'warning'))
  let order = fixedSlots.length
  for (const entry of entries) {
    const written = byId.get(entry.entryId)!
    // Ancillary layout is server-owned. Preserve every sentence and reference
    // when a model splits a single summary/skill/education slot into paragraphs.
    let paragraphs = entry.slot.kind !== 'business_bullet' && written.paragraphs.length > 1
      ? [{ role: written.paragraphs[0].role, text: written.paragraphs.map(p => p.text).join(' '),
        evidenceIds: [...new Set(written.paragraphs.flatMap(p => p.evidenceIds))] }]
      : paragraphsById.get(entry.entryId)!
    if (entry.slot.kind !== 'business_bullet' && written.paragraphs.length > 1) warnings.push(writingIssue('WRITER_ANCILLARY_PARAGRAPHS_JOINED', entry.entryId,
      paragraphs[0].evidenceIds, '辅助板块多段已按单槽布局合并，未删正文或引用。', 'warning'))
    if (entry.section === 'summary') paragraphs = paragraphs.map(paragraph => {
      const sources = paragraph.evidenceIds.flatMap(id => input.entryPlan.base.expandedEvidenceIds[id] ?? [id])
        .flatMap(id => input.resume.evidenceAtoms.filter(atom => atom.evidenceId === id))
      if (!/主导过/u.test(paragraph.text) || /(?:未|不|没有|非).{0,3}主导/u.test(paragraph.text)
        || sources.some(atom => /主导/u.test(`${atom.verbatimText} ${atom.sourceActionVerb ?? ''}`))
        || !sources.some(atom => ['action', 'responsibility', 'deliverable'].includes(atom.claimType))) return paragraph
      warnings.push(writingIssue('WRITER_SUMMARY_OWNERSHIP_DOWNGRADED', entry.entryId, paragraph.evidenceIds,
        '摘要无依据的“主导”已降为“参与”；不新增经历，不修改来源。', 'warning'))
      return {...paragraph, text:paragraph.text.replace(/主导过/gu, '参与过')}
    })
    const allowed = entry.facts.map(fact => fact.evidenceId)
    const used = new Set(written.paragraphs.flatMap(p => p.evidenceIds))
    const joined = written.paragraphs.map(p => p.text).join('；')
    if (entry.coreEvidenceIds.some(id => !used.has(id))) warnings.push(writingIssue('WRITER_PRIORITY_PRACTICE_OMITTED', entry.entryId, entry.coreEvidenceIds, '经历核心材料未充分呈现，保留离线质量提示。', 'warning'))
    const requiredNumbers = entry.facts.filter(f => entry.coreEvidenceIds.includes(f.evidenceId)).flatMap(f => f.requiredNumbers ?? [])
    if (requiredNumbers.some(n => !writingNumbers(joined).includes(n))) warnings.push(writingIssue('WRITER_PRIORITY_OUTCOME_OMITTED', entry.entryId, entry.coreEvidenceIds, '核心结果数值未呈现，保留离线质量提示。', 'warning'))
    for (const [index, paragraph] of paragraphs.entries()) {
      const slotId = `${entry.entryId}:p${index}`
      const path = entry.slot.kind === 'business_bullet' ? `${entry.section}.${entry.scopeId}.bullets[${index}]` : entry.slot.outputPath
      writingPlan.blueprint.slots.push({ ...entry.slot, slotId, outputPath: path, order: order++, allowedEvidenceIds: allowed })
      writingPlan.coreEvidenceIdsBySlot[slotId] = []
      writingPlan.entryParagraphGroups[slotId] = entry.entryId
      blocks.push({ slotId, evidenceIds: paragraph.evidenceIds, text: paragraph.text })
    }
    const scope = plan.scopePlans.find(scope => scope.scopeId === entry.scopeId)
    if (scope && entry.slot.kind === 'business_bullet') {
      scope.bulletBudget = paragraphs.length
      if (['experience', 'internship'].includes(scope.scopeType)) scope.treatment = paragraphs.length > 1 ? 'expand' : 'compress'
    }
  }
  const result = compileWritingArtifact({ composition: { contractVersion: 'p06-composition-v1', blocks }, writingPlan,
    resume: input.resume, plan, policy: input.policy })
  const entryParagraphPaths = new Set(writingPlan.blueprint.slots.filter(s => s.kind === 'business_bullet').map(s => s.outputPath))
  return { ...result, writingIssues: [...result.writingIssues, ...warnings], renderingPlan: plan, entryParagraphPaths }
}
