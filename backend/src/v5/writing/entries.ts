import { z } from 'zod'
import {buildDetailSeeds, inspectDetailLedger, stableDetailIds, type DetailSeed} from './detail-ledger'
import type {ActionReceipt, OptimizationAction} from '@/shared/resume-actions'
import type { CompositionBlueprintSlot, CompositionSectionKey } from '@/v5/composition/contract'
import type { EvidenceAtom, GenerationPolicy, ResumeEvidenceBundle, V5ResumePlan, ValidationIssue } from '@/v5/types'
import type { WritingPlan } from '@/v5/writing/plan'
import { writingPayload } from '@/v5/writing/plan'
import {
  buildWritingFact,
  inspectSupportedWriting,
  findUnsupportedCollaboratorTerms,
  TEAM_CONTRIBUTION_PATTERN,
  writingDisplayText,
  writingIssue,
  writingNumbers,
  type WritingFact,
} from '@/v5/writing/facts'
import { compileWritingArtifact, SupportedWritingError } from '@/v5/writing/compiler'
import { hasIncompleteMetricValue } from '@/v5/composition/source-display'
import { hasCanonicalSourceLineSeparator } from '@/v5/composition/source-continuation'
import { targetingEvidenceScores } from '@/v5/targeting/fit'
import { EntrySetValidationError, inspectEntrySet } from './entry-set'
import { workScopeBrief } from '@/v5/writing/work-coverage'
import { canCompactEntryParagraphs, entryLayoutItemLimit, entryParagraphLimit, planEntryLayoutCorrections, ENTRY_LAYOUT_VERSION } from '@/v5/writing/entry-layout'
import { explicitEducationDegree } from '@/v5/writing/education'
import { hasRepeatedSkillDimensions } from '@/v5/writing/skills'
import type { EntryStrategyAction } from './intents'
import type { EntryParagraphReference } from './strategy-outcomes'
import { selectCompletionGaps, type GapSelectionCandidate } from './gap-selection'
import { buildCompletionDocument } from './completion-document'
import { sourceUncertainties, sourceClaimTemplateV6, type SourceUncertainty } from './source-uncertainties'
import { serializeDraft } from '@/shared/resume-completion'
import {routeSourceInformation, type RoutedAssertion, type InterviewPreparationTopic} from './information-routing'
import { detailAssessmentSchema, uncertaintyResolutionSchema, entryCoverageSchema, entrySegmentSchema, entrySegmentV4Schema, entrySegmentV6Schema, gapDecisionsSchema, GAP_GUIDANCE, GAP_TEMPLATES, inspectEntrySkeleton, normalizeDetailTemplateElements, normalizeOptionalGapPunctuation, projectFactSegments, segmentEvidenceIds, validateDeliveryBudget, type EntrySegment } from './entry-skeleton'

export const ENTRY_WRITING_POLICY = 'entry-writing-v6' as const
export const SKELETON_POLICY_VERSION = 'five-element-cloze-v4' as const

/** A delivery snapshot is compiled from this exact fact text before final validation. */
export function assertEntryDeliveryProjection(
  compiled: { markdown: string }, validated: { markdown: string } | undefined,
): void {
  if (validated && validated.markdown !== compiled.markdown) throw new SupportedWritingError([
    writingIssue('WRITER_PROJECTION_MISMATCH', 'artifact.markdown', [],
      '最终事实正文与留白展示稿的编译基准不一致，不能交付过期展示稿。'),
  ])
}

const paragraphRoleSchema = z.enum(['positioning', 'scope', 'problem', 'approach', 'contribution', 'outcome', 'method', 'education', 'credential', 'detail'])
export const entryParagraphSchema = z.object({
  role: paragraphRoleSchema,
  unitId: z.string().min(1).optional(),
  text: z.string().trim().max(6000),
  evidenceIds: z.array(z.string().min(1)).max(80),
  segments: z.array(entrySegmentSchema).min(1).optional(),
}).strict().superRefine((paragraph, context) => {
  // Keep a dependent-only draft parseable so the scoped writer correction can
  // require its safe practice anchor. It never passes skeleton validation.
  if ((!paragraph.text || !paragraph.evidenceIds.length) && !paragraph.segments?.some(segment => segment.kind === 'dependent_claim')) {
    context.addIssue({code: z.ZodIssueCode.custom, message: '普通正文须有非空文本和事实引用。'})
  }
})
export const writtenEntrySchema = z.object({
  entryId: z.string().min(1), coverage: entryCoverageSchema.optional(), gapDecisions: gapDecisionsSchema.optional(),
  detailAssessments: z.array(detailAssessmentSchema).optional(), uncertaintyResolutions: z.array(uncertaintyResolutionSchema).optional(),
  actionReceipts: z.array(z.object({actionId: z.string().min(1), unitIds: z.array(z.string().min(1)), evidenceIds: z.array(z.string().min(1)), detailIds: z.array(z.string().min(1)), coveredAspectIds: z.array(z.string().min(1)), explanation: z.string().trim().min(1).max(600)}).strict()).optional(),
  paragraphs: z.array(entryParagraphSchema).min(1).max(12),
}).strict()
export const writtenEntryV2Schema = z.object({
  entryId: z.string().min(1), coverage: entryCoverageSchema,
  paragraphs: z.array(z.object({role: paragraphRoleSchema,
    segments: z.array(entrySegmentSchema).min(1)}).strict()).min(1).max(12),
}).strict()
export const entryWritingV2OutputSchema = z.object({
  contractVersion: z.literal('entry-writing-v2'), entries: z.array(writtenEntryV2Schema).max(100),
}).strict()
export const writtenEntryV3Schema = writtenEntryV2Schema.extend({gapDecisions: gapDecisionsSchema})
export const entryWritingV3OutputSchema = z.object({
  contractVersion: z.literal('entry-writing-v3'), entries: z.array(writtenEntryV3Schema).max(100),
}).strict()
export const writtenEntryV4Schema = writtenEntryV2Schema.extend({
  paragraphs: z.array(z.object({role: paragraphRoleSchema, segments: z.array(entrySegmentV4Schema).min(1)}).strict()).min(1).max(12),
  detailAssessments: z.array(detailAssessmentSchema), uncertaintyResolutions: z.array(uncertaintyResolutionSchema),
})
export const entryWritingV4OutputSchema = z.object({
  contractVersion: z.literal('entry-writing-v4'), entries: z.array(writtenEntryV4Schema).max(100),
}).strict()
export const writtenEntryV5Schema = writtenEntryV4Schema.extend({
  coverage: z.array(z.object({element: z.enum(['responsibility', 'project', 'problem', 'solution', 'result']), status: z.enum(['known', 'missing', 'ambiguous', 'not_applicable']), evidenceIds: z.array(z.string().min(1)), answer: z.string().trim().min(1).max(600), resultKind: z.enum(['deliverable', 'adoption', 'business_outcome', 'unknown', 'not_applicable'])}).strict()).length(5),
  paragraphs: z.array(z.object({unitId: z.string().min(1), role: paragraphRoleSchema, segments: z.array(entrySegmentV4Schema).min(1)}).strict()).min(1).max(12),
  actionReceipts: writtenEntrySchema.shape.actionReceipts.unwrap(),
})
export const entryWritingV5OutputSchema = z.object({contractVersion: z.literal('entry-writing-v5'), entries: z.array(writtenEntryV5Schema).max(100)}).strict()
export const writtenEntryV6Schema = writtenEntryV5Schema.extend({paragraphs: z.array(z.object({unitId: z.string().min(1), role: paragraphRoleSchema, segments: z.array(entrySegmentV6Schema).min(1)}).strict()).min(1).max(12)})
export const entryWritingV6OutputSchema = z.object({contractVersion: z.literal(ENTRY_WRITING_POLICY), entries: z.array(writtenEntryV6Schema).max(100)}).strict()
const compatibleEntryOutputSchema = z.object({
  contractVersion: z.enum(['entry-writing-v1', 'entry-writing-v2', 'entry-writing-v3', 'entry-writing-v4', 'entry-writing-v5', ENTRY_WRITING_POLICY]), entries: z.array(writtenEntrySchema).max(100),
}).strict()
export function materializeWrittenEntry(entry: z.infer<typeof writtenEntryV2Schema> & {
  gapDecisions?: z.infer<typeof gapDecisionsSchema>
  detailAssessments?: z.infer<typeof detailAssessmentSchema>[]
  uncertaintyResolutions?: z.infer<typeof uncertaintyResolutionSchema>[]
  actionReceipts?: z.infer<typeof writtenEntrySchema>['actionReceipts']
}): z.infer<typeof writtenEntrySchema> {
  return {...entry, paragraphs: entry.paragraphs.map(paragraph => {
    const segments = normalizeOptionalGapPunctuation(paragraph.segments)
    return {...paragraph, segments, text: projectFactSegments(segments), evidenceIds: segmentEvidenceIds(segments)}
  })}
}
// This parser is for compilation/replay only. Structured-stage acceptance uses
// entryWritingV4OutputSchema so a new provider cannot return legacy free text.
export const entryWritingOutputSchema = z.union([entryWritingV6OutputSchema, entryWritingV5OutputSchema, entryWritingV4OutputSchema, entryWritingV3OutputSchema, entryWritingV2OutputSchema, compatibleEntryOutputSchema])
  .transform(output => ({...output, entries: output.entries.map(entry =>
    'text' in entry.paragraphs[0] ? writtenEntrySchema.parse(entry) : materializeWrittenEntry(entry as z.infer<typeof writtenEntryV2Schema>))}))
export type WrittenEntry = z.infer<typeof writtenEntrySchema>

function rewriteFactParagraph<T extends {text: string; evidenceIds: string[]; segments?: EntrySegment[]}>(paragraph: T, rewrite: (text: string) => string): T {
  if (!paragraph.segments) return {...paragraph, text: rewrite(paragraph.text)}
  const segments = paragraph.segments.map(segment => segment.kind === 'fact' ? {...segment, text: rewrite(segment.text)} : segment)
  return {...paragraph, segments, text: projectFactSegments(segments), evidenceIds: segmentEvidenceIds(segments)}
}
function joinFactParagraphs<T extends {role: WrittenEntry['paragraphs'][number]['role']; text: string; evidenceIds: string[]; segments?: EntrySegment[]; sourceParagraphIndices: number[]}>(left: T, right: T): T {
  const segments = left.segments || right.segments ? [
    ...(left.segments ?? [{kind: 'fact' as const, text: left.text, evidenceIds: left.evidenceIds}]),
    {kind: 'fact' as const, text: ' ', evidenceIds: left.evidenceIds},
    ...(right.segments ?? [{kind: 'fact' as const, text: right.text, evidenceIds: right.evidenceIds}]),
  ] : undefined
  return {...left, text: `${left.text} ${right.text}`, evidenceIds: [...new Set([...left.evidenceIds, ...right.evidenceIds])],
    ...(segments ? {segments} : {}), sourceParagraphIndices: [...left.sourceParagraphIndices, ...right.sourceParagraphIndices]}
}

/** 兼容模型附加的空注释，不接受有内容的额外字段或改动正文。 */
export function normalizeWrittenEntry(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  const removable = [
    ...(record.entryIdNote === '' ? ['entryIdNote'] : []),
    ...(Object.hasOwn(record, 'actionReceiptsNote') && (record.actionReceiptsNote === null || record.actionReceiptsNote === '') ? ['actionReceiptsNote'] : []),
  ]
  if (!removable.length) return value
  const entry = {...record}
  for (const key of removable) delete entry[key]
  return entry
}

export function normalizeEntryWritingOutput(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { value, removedNotes: 0, rejectedReceiptCount: 0 }
  const record = value as Record<string, unknown>
  if (!['entry-writing-v1', 'entry-writing-v2', 'entry-writing-v3', 'entry-writing-v4', 'entry-writing-v5', ENTRY_WRITING_POLICY].includes(String(record.contractVersion)) || !Array.isArray(record.entries)) return { value, removedNotes: 0, rejectedReceiptCount: 0 }
  let removedNotes = 0
  let rejectedReceiptCount = 0
  const receiptSchema = writtenEntrySchema.shape.actionReceipts.unwrap().element
  const entries = record.entries.map(entry => {
    const normalized = normalizeWrittenEntry(entry)
    if (normalized !== entry) removedNotes += 1
    if (typeof normalized === 'object' && normalized !== null && !Array.isArray(normalized)) {
      const written = normalized as Record<string, unknown>
      if (Array.isArray(written.actionReceipts)) {
        // Receipts are untrusted adoption metadata. Quarantine the whole bad
        // receipt; stripping unknown fields would falsely endorse its claim.
        const receipts = written.actionReceipts.filter(receipt => receiptSchema.safeParse(receipt).success)
        const rejected = written.actionReceipts.length - receipts.length
        rejectedReceiptCount += rejected
        if (rejected) return {...written, actionReceipts: receipts}
      }
    }
    return normalized
  })
  return { value: removedNotes || rejectedReceiptCount ? { ...record, entries } : value, removedNotes, rejectedReceiptCount }
}

/** 约束本次请求的 ID 和数量；重复、缺失仍由最终集合校验明确诊断。 */
export function entryWritingTransportSchema(envelope: unknown) {
  const {payload} = z.object({payload: z.object({entries: z.array(z.object({entryId: z.string()})).min(1).max(100)})}).parse(envelope)
  const ids = payload.entries.map(entry => entry.entryId)
  const diagnostics = inspectEntrySet(ids, ids)
  if (!diagnostics.passed) throw new EntrySetValidationError(diagnostics, 'ENTRY_PLAN_INVALID')
  return entryWritingV6OutputSchema.extend({
    entries: z.array(writtenEntryV6Schema.extend({entryId: z.enum(ids as [string, ...string[]])})).length(ids.length),
  })
}

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
  gapContextFacts: Array<{evidenceId: string; scopeId: string; text: string}>
  gapContextComplete: boolean
  sourceUncertainties?: SourceUncertainty[]
  informationRouting?: RoutedAssertion[]
  preparationTopics?: InterviewPreparationTopic[]
  coreEvidenceIds: string[]
  taskIds: string[]
  projectIdentity?: {text: string; evidenceIds: string[]}
  strategyActions?: EntryStrategyAction[]
  detailSeeds?: DetailSeed[]
  editorialActions?: OptimizationAction[]
  /** Newly admitted action material whose explicit boundary must survive in this entry. */
  strategyBoundaryEvidenceIds?: string[]
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** 删除校验器已确认无来源的协作部门，不补写新的协作对象或个人成果。 */
export function removeUnsupportedCollaboratorMentions(
  value: string,
  atoms: EvidenceAtom[],
) {
  const teams = findUnsupportedCollaboratorTerms(value, atoms)
  if (!teams.length) return value

  const sourceSupportsTeamBoundary = atoms.some(atom => (
    atom.riskFlags.includes('team_attribution')
    || TEAM_CONTRIBUTION_PATTERN.test(writingDisplayText(atom.verbatimText))
  ))
  const safeBoundary = sourceSupportsTeamBoundary ? '团队协作' : ''
  const unsupported = new Set(teams)
  let normalized = value.replace(/(协同|协调|联合|对接|联动|和|与)\s*((?:(?:研发|开发|设计|市场|运营|测试|销售|业务|商务|宣发|工艺)(?!洞察|数据|指标|增长|收入)(?:团队|部门)?[、，,与和及\s]*){1,8})/gu,
    (phrase, verb: string, list: string) => {
      const members = list.match(/(?:研发|开发|设计|市场|运营|测试|销售|业务|商务|宣发|工艺)(?:团队|部门)?/gu) ?? []
      const retained = members.filter(member => !unsupported.has(member.replace(/团队|部门/gu, '').replace(/^开发$/u, '研发')))
      if (retained.length === members.length) return phrase
      const trailingConjunction = list.match(/[与和及]\s*$/u)?.[0] ?? ''
      return retained.length ? `${verb}${retained.join('、')}${trailingConjunction}`
        : `${sourceSupportsTeamBoundary ? '通过团队协作' : ''}${trailingConjunction}`
    })
  for (const team of teams) {
    const teamPattern = team === '研发' ? '(?:研发|开发)' : escapeRegExp(team)
    const pattern = `${teamPattern}(?:团队|部门)?`
    normalized = normalized
      .replace(new RegExp(
        `(?:推动|促成|支持|协助|配合|与|和|协同|协调|联合|对接|联动)\\s*${pattern}(?=$|[\\u4e00-\\u9fff，、。；;：:！？!?])`,
        'gu',
      ), safeBoundary)
      .replace(new RegExp(`${pattern}(?=\\s*(?:协同|协作|沟通|联动|对接))`, 'gu'), safeBoundary)
      .replace(new RegExp(
        `[、，,]\\s*${pattern}(?=$|[\\u4e00-\\u9fff，、。；;：:！？!?]|\\s*(?:协同|协作|沟通|联动|对接))`,
        'gu',
      ), '')
  }

  return normalized
    .replace(/^[、，,]\s*/u, '')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/\s*([，。；;])/gu, '$1')
    .trim()
}

/** Move an exactly repeated source-backed research deliverable to its outcome paragraph. */
export function removeRepeatedResearchDeliverable<T extends {text: string; evidenceIds: string[]; segments?: EntrySegment[]}>(paragraphs: T[], atoms: EvidenceAtom[]) {
  let removed = 0
  const result = [...paragraphs]
  for (const [index, later] of result.entries()) {
    const repeated = later.text.match(/^(?:上述研究|该研究|本次研究)(形成[^，,；;。]{8,80})[，,；;。]/u)?.[1]
    if (!repeated || writingNumbers(repeated).length || /未|不|尚|仅|待|计划|预计/u.test(repeated)) continue
    const supportedIds = new Set(atoms.filter(atom => later.evidenceIds.includes(atom.evidenceId)
      && atom.status === 'source_supported' && !atom.riskFlags.length && atom.verbatimText.includes(repeated)).map(atom => atom.evidenceId))
    if (!supportedIds.size) continue
    for (let earlierIndex = 0; earlierIndex < index; earlierIndex++) {
      const earlier = result[earlierIndex]
      const trim = (text: string, evidenceIds: string[]) => evidenceIds.some(id => supportedIds.has(id))
        && text.endsWith(`，${repeated}`) && text.length > repeated.length + 8 ? text.slice(0, -repeated.length - 1) : text
      if (earlier.segments) {
        const segments = earlier.segments.map(segment => segment.kind === 'fact'
          ? {...segment, text: trim(segment.text, segment.evidenceIds)} : segment)
        const text = projectFactSegments(segments)
        if (text !== earlier.text) {result[earlierIndex] = {...earlier, segments, text}; removed++}
      } else {
        const text = trim(earlier.text, earlier.evidenceIds)
        if (text !== earlier.text) {result[earlierIndex] = {...earlier, text}; removed++}
      }
    }
  }
  return {paragraphs: result, removed}
}

/** A near-copy is sent for scoped rewriting, never automatically paraphrased into a new ability. */
export function hasRepeatedSkillCase(skill: {text: string; evidenceIds: string[]}, business: Array<{text: string; evidenceIds: string[]}>, expanded: Record<string, string[]> = {}) {
  const compact = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
  const text = compact(skill.text)
  if (text.length < 32) return false
  const sourceIds = new Set(skill.evidenceIds.flatMap(id => expanded[id] ?? [id]))
  const candidates = business.filter(paragraph => paragraph.evidenceIds.flatMap(id => expanded[id] ?? [id]).some(id => sourceIds.has(id)))
    .map(paragraph => compact(paragraph.text))
  const repeated = new Set<number>()
  // Long literal overlap plus the same source identifies copied case narration;
  // short shared skill names alone cannot meet this conservative review trigger.
  for (let index = 0; index <= text.length - 8; index++) if (candidates.some(value => value.includes(text.slice(index, index + 8)))) {
    for (let position = index; position < index + 8; position++) repeated.add(position)
  }
  return repeated.size / text.length >= 0.72
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

export function normalizeEntryFact(fact: WritingFact, resume: ResumeEvidenceBundle): WritingFact {
  let safe = omitSplitQuantityTail(fact, resume)
  if (safe.boundaries.includes('团队或参与贡献') && !TEAM_CONTRIBUTION_PATTERN.test(safe.text)) {
    safe = { ...safe, text: `团队协作中，${safe.text}` }
  }
  return safe
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
  const allUncertainties = [...new Set(input.resume.evidenceAtoms.map(atom => atom.sourceScopeId))]
    .flatMap(scopeId => sourceUncertainties(input.resume.evidenceAtoms, scopeId))
  const routing = routeSourceInformation({atoms: input.resume.evidenceAtoms})
  const unresolvedIds = new Set(allUncertainties.filter(signal => !routing.admittedTextByEvidence.has(signal.evidenceId)).map(signal => signal.evidenceId))
  const routedFact = (atom: EvidenceAtom) => {
    const text = routing.admittedTextByEvidence.get(atom.evidenceId)
    if (!text) return null
    const fact = buildWritingFact({...atom, verbatimText: text, riskFlags: atom.riskFlags.filter(flag => flag !== 'conflicting')})
    if (fact && routing.uncertainEvidenceIds.includes(atom.evidenceId)) fact.sourceExcerpts = routing.assertions
      .filter(assertion => assertion.evidenceId === atom.evidenceId && assertion.resumeText)
      .map(assertion => ({evidenceId: atom.evidenceId, sourceSpan: {start: assertion.sourceSpan.start, end: assertion.sourceSpan.end}}))
    return fact
  }
  const factMap = new Map(base.facts.filter(fact => !unresolvedIds.has(fact.evidenceId)).flatMap(fact => {
    const atom = atoms.get(fact.evidenceId)
    const routed = atom && routing.uncertainEvidenceIds.includes(atom.evidenceId) ? routedFact(atom) : fact
    return routed ? [[routed.evidenceId, routed] as const] : []
  }))
  const business = (slot: CompositionBlueprintSlot) => slot.kind === 'business_bullet'
  for (const slot of [...base.blueprint.slots].sort((a, b) => a.order - b.order)) {
    if (fixed.has(slot.slotId)) continue
    let entry = business(slot) ? entries.find(item => item.scopeId === slot.scopeId && item.section === slot.sectionKey) : undefined
    if (!entry) {
      entry = { entryId: `entry:${entries.length}`, section: slot.sectionKey, scopeId: slot.scopeId,
        order: slot.order, slot: structuredClone(slot), facts: [], gapContextFacts: [], gapContextComplete: true, coreEvidenceIds: [], taskIds: [],
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
        const fact = factMap.get(atom.evidenceId) ?? routedFact(atom)
        if (!fact || ['identity', 'timeline', 'skill'].includes(fact.claimType)) continue
        entry.facts.push(fact)
        factMap.set(fact.evidenceId, fact)
        base.expandedEvidenceIds[fact.evidenceId] ??= [fact.evidenceId]
      }
      // Context is optional material, never a new required achievement.
      scopePlan.selectedEvidenceIds = [...new Set([...scopePlan.selectedEvidenceIds, ...entry.facts.map(f => f.evidenceId)])]
    }
    if (business(entry.slot) && entry.scopeId) {
      const context = input.resume.evidenceAtoms.filter(atom => atom.sourceScopeId === entry.scopeId
        && atom.status !== 'excluded' && !atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text'].includes(flag)))
        .sort((a, b) => a.sourceSpan.start - b.sourceSpan.start)
      const facts = context.flatMap(atom => {
        const fact = routedFact(atom)
        return fact ? [{evidenceId: fact.evidenceId, scopeId: fact.scopeId, text: fact.text}] : []
      })
      let characters = 0
      for (const fact of facts) {
        if (characters + fact.text.length > 20000 || entry.gapContextFacts.length >= 100) break
        characters += fact.text.length
        entry.gapContextFacts.push(fact)
      }
      entry.gapContextComplete = entry.gapContextFacts.length === facts.length
    }
    if (business(entry.slot) && entry.scopeId) {
      entry.sourceUncertainties = allUncertainties.filter(signal => signal.scopeId === entry.scopeId)
      entry.informationRouting = routing.assertions.filter(assertion => assertion.scopeId === entry.scopeId)
      entry.preparationTopics = routing.preparationTopics.filter(topic => topic.scopeId === entry.scopeId)
      const uncertain = new Set(entry.sourceUncertainties.filter(signal => !routing.admittedTextByEvidence.has(signal.evidenceId)).map(signal => signal.evidenceId))
      // Answers already in the same scope are eligible body facts after the
      // existing fact gate; they must not be handed back as user blanks.
      for (const context of entry.gapContextFacts) {
        const atom = atoms.get(context.evidenceId)
        if (!atom || uncertain.has(atom.evidenceId) || !['action', 'responsibility', 'deliverable', 'result'].includes(atom.claimType)
          || entry.facts.some(fact => fact.evidenceId === atom.evidenceId)) continue
        const fact = routedFact(atom)
        if (fact) { entry.facts.push(fact); factMap.set(fact.evidenceId, fact); base.expandedEvidenceIds[fact.evidenceId] ??= [fact.evidenceId] }
      }
      entry.facts = entry.facts.filter(fact => !uncertain.has(fact.evidenceId))
      entry.gapContextFacts = [...entry.gapContextFacts.filter(fact => !uncertain.has(fact.evidenceId)),
        ...entry.sourceUncertainties.map(signal => ({evidenceId: signal.evidenceId, scopeId: signal.scopeId, text: signal.text}))]
      entry.coreEvidenceIds = entry.coreEvidenceIds.filter(id => !uncertain.has(id))
      const scopePlan = renderingPlan.scopePlans.find(scope => scope.scopeId === entry.scopeId)
      if (scopePlan) scopePlan.selectedEvidenceIds = [...new Set([...scopePlan.selectedEvidenceIds, ...entry.facts.map(fact => fact.evidenceId)])]
        .filter(id => !uncertain.has(id))
    }
    entry.facts.sort((a, b) => (atoms.get(a.evidenceId)?.sourceSpan.start ?? 0) - (atoms.get(b.evidenceId)?.sourceSpan.start ?? 0))
    entry.coreEvidenceIds = [...new Set(entry.coreEvidenceIds)]
    entry.taskIds = [...new Set(entry.taskIds)]
    const identity = input.resume.timeline.find(item => item.scopeId === entry.scopeId)
    if (identity) entry.projectIdentity = {text: [identity.organization, identity.title].filter(Boolean).join('｜'), evidenceIds: identity.evidenceIds}
  }
  // Summary and skills cannot make unresolved outcomes safe by changing scope.
  for (const entry of entries) {
    entry.facts = entry.facts.filter(fact => !unresolvedIds.has(fact.evidenceId))
    entry.coreEvidenceIds = entry.coreEvidenceIds.filter(id => !unresolvedIds.has(id))
  }
  for (let index = entries.length - 1; index >= 0; index--) if (!entries[index].facts.length) entries.splice(index, 1)
  for (const entry of entries) entry.facts = entry.facts.map(fact => {
    // Surface a verified attribution constraint in the prose material as well
    // as metadata, so it is not lost when copying a contribution sentence.
    const safe = normalizeEntryFact(fact, input.resume)
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
  const ids = plan.entries.map(entry => entry.entryId)
  const diagnostics = inspectEntrySet(ids, ids)
  if (!diagnostics.passed || !ids.length || ids.length > 100
    || plan.entries.some(entry => plan.base.fixedBlocks?.some(block => block.slotId === entry.slot.slotId))) {
    throw new EntrySetValidationError(diagnostics, 'ENTRY_PLAN_INVALID')
  }
  const old = writingPayload(plan.base)
  return {
    writingPolicy: plan.base.version, entryWritingPolicy: plan.version,
    guidance: plan.base.guidance, outputLength: plan.base.outputLength,
    skeletonPolicy: {version: SKELETON_POLICY_VERSION, templates: GAP_GUIDANCE, selection: 'value_based_without_count_quota'},
    listItemBudget: plan.listItemBudget,
    layoutPolicy: ENTRY_LAYOUT_VERSION, listItemHardLimit: plan.listItemHardLimit,
    requiredEntryIds: ids, requiredEntryCount: ids.length,
    jobTargeting: old.jobTargeting, candidateIdentity: old.candidateIdentity,
    sourceRenderedSkills: (plan.base.fixedBlocks ?? []).filter(block => plan.base.blueprint.slots.some(slot => slot.kind === 'skill' && slot.slotId === block.slotId)),
    // Body first, abstraction last; presentation order remains server-owned.
    entries: [...plan.entries].sort((a, b) => Number(['summary', 'skills'].includes(a.section)) - Number(['summary', 'skills'].includes(b.section)) || a.order - b.order)
      .map(entry => ({ entryId: entry.entryId, section: entry.section,
        paragraphLimit: entryParagraphLimit(entry.slot.kind === 'business_bullet',
          plan.renderingPlan.scopePlans.find(scope => scope.scopeId === entry.scopeId)?.treatment === 'compress'),
        purpose: SECTION_WRITING_ROLES[entry.section] ?? '准确呈现与岗位相关的源材料。',
        facts: entry.facts, gapContextFacts: entry.gapContextFacts, gapContextComplete: entry.gapContextComplete, sourceUncertainties: entry.sourceUncertainties ?? [], coreEvidenceIds: entry.coreEvidenceIds, targetTaskIds: entry.taskIds,
        informationRouting: entry.informationRouting ?? [], preparationTopics: entry.preparationTopics ?? [],
        sourceClaimTemplates: (entry.sourceUncertainties ?? []).flatMap(signal => {const template = sourceClaimTemplateV6(signal); return template ? [template] : []}),
        projectIdentity: entry.projectIdentity ?? null,
        detailSeeds: entry.detailSeeds ?? [], editorialActions: entry.editorialActions ?? [],
        ...(entry.strategyActions?.length ? { strategyActions: entry.strategyActions } : {}),
        lengthHint: entry.lengthHint })),
  }
}

/** Locally validate a complete entry; no partial JSON or raw reasoning is public. */
export function compileEntryWriting(input: {
  output: unknown; entryPlan: EntryWritingPlan; resume: ResumeEvidenceBundle; policy: GenerationPolicy
  previewEntryId?: string
  documentId?: string
}) {
  const output = entryWritingOutputSchema.parse(input.output)
  for (const written of output.entries) if (written.detailAssessments) {
    written.detailAssessments = normalizeDetailTemplateElements(written.detailAssessments, written.paragraphs)
  }
  if (output.contractVersion === ENTRY_WRITING_POLICY) for (const written of output.entries) {
    const brief = input.entryPlan.entries.find(entry => entry.entryId === written.entryId)
    if (!brief) continue
    const detailMap = stableDetailIds(brief, written.detailAssessments ?? [])
    for (const detail of written.detailAssessments ?? []) detail.detailId = detailMap.get(detail.detailId)!
    const unitMap = new Map(written.paragraphs.map((paragraph, i) => [paragraph.unitId ?? `local:${i}`, `${written.entryId}:unit:${i}`]))
    for (const [index, paragraph] of written.paragraphs.entries()) {
      paragraph.unitId = `${written.entryId}:unit:${index}`
      for (const segment of paragraph.segments ?? []) {
        if (segment.kind === 'optional_gap_clause' && segment.detailId) segment.detailId = detailMap.get(segment.detailId) ?? segment.detailId
        if (segment.kind === 'dependent_claim') {
          segment.requiredDetailIds = segment.requiredDetailIds.map(id => detailMap.get(id) ?? id)
          for (const part of segment.parts) if (part.kind === 'required_detail_gap') part.detailId = detailMap.get(part.detailId) ?? part.detailId
        }
      }
    }
    for (const receipt of written.actionReceipts ?? []) {
      receipt.unitIds = receipt.unitIds.map(id => unitMap.get(id) ?? id)
      receipt.detailIds = receipt.detailIds.map(id => detailMap.get(id) ?? id)
    }
  }
  const selectedEntries = input.previewEntryId ? input.entryPlan.entries.filter(e => e.entryId === input.previewEntryId) : input.entryPlan.entries
  const entries = ['entry-writing-v1', 'entry-writing-v2', 'entry-writing-v3', 'entry-writing-v4'].includes(output.contractVersion)
    ? selectedEntries.map(entry => ({...entry, facts: entry.facts.filter(fact => !entry.sourceUncertainties?.some(signal => signal.evidenceId === fact.evidenceId))})) : selectedEntries
  const byId = new Map(output.entries.map(entry => [entry.entryId, entry]))
  // The server slot, not model self-assessment, decides whether the project
  // five-element ledger applies. Ancillary body facts retain their own gates.
  for (const entry of entries.filter(entry => entry.slot.kind !== 'business_bullet')) {
    const written = byId.get(entry.entryId)
    if (!written?.coverage) continue
    written.coverage = ['responsibility', 'project', 'problem', 'solution', 'result'].map(element => ({
      element: element as NonNullable<WrittenEntry['coverage']>[number]['element'], status: 'not_applicable' as const,
      evidenceIds: [], answer: '本条为技能、教育或其他辅助信息，不适用项目经历五要素；正文仍须逐项通过来源校验。', resultKind: 'not_applicable' as const,
    }))
  }
  const fail = (code: string) => { throw new SupportedWritingError([writingIssue(code, 'entries', [], '经历结构与服务端计划不一致。')]) }
  const diagnostics = inspectEntrySet(entries.map(entry => entry.entryId), output.entries.map(entry => entry.entryId))
  if (!diagnostics.passed) throw new EntrySetValidationError(diagnostics)
  const skeletonIssues: ValidationIssue[] = []
  const rejectedReceipts = new Map<string, Array<{actionId: string; reasonCodes: string[]}>>()
  const receiptWarnings: ValidationIssue[] = []
  for (const entry of entries) {
    const written = byId.get(entry.entryId)!
    const issues = inspectEntrySkeleton({coverage: written.coverage, paragraphs: written.paragraphs,
      gapDecisions: written.gapDecisions, requireGapDecisions: output.contractVersion === 'entry-writing-v3',
      requireInformationRouting: output.contractVersion === ENTRY_WRITING_POLICY,
      requireDetails: ['entry-writing-v4', 'entry-writing-v5', ENTRY_WRITING_POLICY].includes(output.contractVersion), detailAssessments: written.detailAssessments,
      uncertaintyResolutions: written.uncertaintyResolutions, sourceUncertainties: entry.sourceUncertainties,
      gapContextFacts: entry.gapContextFacts, gapContextComplete: entry.gapContextComplete, targetTaskIds: entry.taskIds,
      facts: entry.facts, identityEvidenceIds: entry.projectIdentity?.evidenceIds, hasProjectIdentity: ['project', 'research'].includes(entry.section) && Boolean(entry.projectIdentity?.text),
      atoms: input.resume.evidenceAtoms, scopeId: entry.scopeId, business: entry.slot.kind === 'business_bullet', outputPath: entry.slot.outputPath, entryId: entry.entryId})
    if (output.contractVersion === ENTRY_WRITING_POLICY) {
      for (const paragraph of written.paragraphs.filter(paragraph => paragraph.evidenceIds.some(id => entry.informationRouting?.some(assertion => assertion.evidenceId === id)))) {
        const routedAtoms = paragraph.evidenceIds.flatMap(evidenceId => {
          const fact = entry.facts.find(fact => fact.evidenceId === evidenceId)
          const atom = input.resume.evidenceAtoms.find(atom => atom.evidenceId === evidenceId)
          return atom && fact ? [{...atom, verbatimText: fact.text}] : []
        })
        issues.push(...inspectSupportedWriting(paragraph.text, routedAtoms, entry.slot.outputPath, true))
      }
      issues.push(...inspectDetailLedger({entry, written}))
      written.actionReceipts = (written.actionReceipts ?? []).filter(receipt => {
        const action = entry.editorialActions?.find(action => action.actionId === receipt.actionId)
        const reasonCodes = [
          ...(!action ? ['unknown_action'] : []),
          ...(action && receipt.coveredAspectIds.some(id => !action.successConditions.some(condition => condition.aspectId === id)) ? ['unknown_aspect'] : []),
          ...(!receipt.unitIds.length || receipt.unitIds.some(id => !written.paragraphs.some(paragraph => paragraph.unitId === id)) ? ['unlinked_unit'] : []),
          ...(receipt.evidenceIds.some(id => !entry.facts.some(fact => fact.evidenceId === id)) ? ['unadmitted_evidence'] : []),
        ]
        if (!reasonCodes.length) return true
        rejectedReceipts.set(entry.entryId, [...(rejectedReceipts.get(entry.entryId) ?? []), {actionId: receipt.actionId, reasonCodes}])
        receiptWarnings.push(writingIssue('WRITER_ACTION_RECEIPT_REJECTED', entry.slot.outputPath, [],
          '未通过关联核对的行动回执已隔离；对应策略保留待核对或未采用，正文仍独立执行事实校验。', 'warning'))
        return false
      })
    }
    skeletonIssues.push(...issues)
  }
  // The schema and entry set are trusted at this point. Collect independent
  // paragraph/skill failures together before invoking the fact compiler, so an
  // early cloze error cannot hide another entry's deterministic duplicate.
  const entryIssues = [...skeletonIssues]
  const writingPlan = structuredClone(input.entryPlan.base)
  const plan = structuredClone(input.entryPlan.renderingPlan)
  const fixedSlots = writingPlan.blueprint.slots.filter(slot => writingPlan.fixedBlocks?.some(block => block.slotId === slot.slotId))
  const fixedListItemCount = fixedSlots.filter(slot => slot.kind !== 'summary').length
  writingPlan.blueprint.slots = input.previewEntryId ? [] : fixedSlots
  if (input.previewEntryId) writingPlan.fixedBlocks = []
  writingPlan.entryParagraphGroups = {}
  writingPlan.coreEvidenceIdsBySlot = {}
  writingPlan.editorial = undefined
  const blocks: Array<{ slotId: string; evidenceIds: string[]; text: string }> = []
  const sourceParagraphIndicesByPath = new Map<string, readonly number[]>()
  const entryParagraphReferences: EntryParagraphReference[] = []
  const finalParagraphs = new Map<string, WrittenEntry['paragraphs'][number] & {sourceParagraphIndices: number[]}>()
  const entryIdsByPath = new Map<string, string>()
  const warnings = []
  const paragraphsById = new Map(entries.map(entry => [entry.entryId, byId.get(entry.entryId)!.paragraphs
    .map((paragraph, index) => ({ ...paragraph, sourceParagraphIndices: [index] }))
    .map(paragraph => {
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
    return rewriteFactParagraph(paragraph, value => value.replace(/主导(形成|设计|梳理|分析|开发|制定|搭建|完成)/gu, (original, action: string) =>
      sources.some(atom => ['action', 'responsibility', 'deliverable'].includes(atom.claimType) && atom.verbatimText.includes(action)) ? action : original))
  })]))
  for (const entry of entries.filter(entry => entry.slot.kind === 'business_bullet')) {
    const normalized = removeRepeatedResearchDeliverable(paragraphsById.get(entry.entryId)!, input.resume.evidenceAtoms)
    if (!normalized.removed) continue
    paragraphsById.set(entry.entryId, normalized.paragraphs)
    warnings.push(writingIssue('WRITER_REPEATED_RESEARCH_DELIVERABLE_REMOVED', entry.entryId, [],
      '同一来源逐字重复的研究交付物仅在结果段保留，前文保留研究方法、数值与待填处；未作语义改写。', 'warning'))
  }
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
    paragraphs.splice(pair.index, 2, joinFactParagraphs(left, right))
    merges++
  }
  if (merges) warnings.push(writingIssue('WRITER_LAYOUT_COMPACTED', 'entries', [],
    `同经历相邻段落合并 ${merges} 次以满足列表布局，保留全部句子与引用。`, 'warning'))
  if (countItems() > input.entryPlan.listItemBudget) warnings.push(writingIssue('ENTRY_LAYOUT_TARGET_EXCEEDED', 'entries', [],
    '为保留独立信息段落使用有限排版余量；总字数上限和证据校验不变。', 'warning'))
  let order = fixedSlots.length
  const fixedSkillSlotIds = new Set(fixedSlots.filter(slot => slot.kind === 'skill').map(slot => slot.slotId))
  const usedSkillClauses = new Set((writingPlan.fixedBlocks ?? []).filter(block => fixedSkillSlotIds.has(block.slotId))
    .flatMap(block => (block.text.match(/[^；;。]+[；;。]?/gu) ?? []).map(clause => clause.replace(/[；;。]\s*$/u, '').trim())))
  for (const entry of entries) {
    const written = byId.get(entry.entryId)!
    // Ancillary layout is server-owned. Preserve every sentence and reference
    // when a model splits a single summary/skill/education slot into paragraphs.
    let paragraphs = entry.slot.kind !== 'business_bullet' && written.paragraphs.length > 1
      ? [paragraphsById.get(entry.entryId)!.reduce((left, right) => joinFactParagraphs(left, right))]
      : paragraphsById.get(entry.entryId)!
    if (entry.slot.kind !== 'business_bullet' && written.paragraphs.length > 1) warnings.push(writingIssue('WRITER_ANCILLARY_PARAGRAPHS_JOINED', entry.entryId,
      paragraphs[0].evidenceIds, '辅助板块多段已按单槽布局合并，未删正文或引用。', 'warning'))
    if (entry.section === 'skills') {
      const priorSkillClauses = [...usedSkillClauses]
      paragraphs = paragraphs.map(paragraph => rewriteFactParagraph(paragraph, text => (text.match(/[^；;。]+[；;。]?/gu) ?? []).filter(clause => {
        const key = clause.replace(/[；;。]\s*$/u, '').trim()
        if (!key) return false
        if (usedSkillClauses.has(key)) {
          warnings.push(writingIssue('WRITER_DUPLICATE_SKILL_CLAUSE_REMOVED', entry.entryId, paragraph.evidenceIds,
            '仅删除技能板块前文已逐字呈现的完整分句，保留其他独立能力与来源。', 'warning'))
          return false
        }
        usedSkillClauses.add(key)
        return true
      }).join('').trim())).filter(paragraph => paragraph.text.trim())
      if (!paragraphs.length) continue
      const repeatedDimensions = paragraphs.find(paragraph => hasRepeatedSkillDimensions(paragraph.text, priorSkillClauses))
      if (repeatedDimensions) entryIssues.push(writingIssue('WRITER_SKILL_DIMENSIONS_REPEATED', entry.slot.outputPath, repeatedDimensions.evidenceIds,
        '本技能条重述了sourceRenderedSkills已完整呈现的能力维度。仅重写此条，保留facts中未覆盖的真实竞品、交付或验证方法，以简短能力维度说明方法与产物；不复述固定技能清单，不叙述公司、时间、团队名单或项目过程。'))
      const business = entries.filter(item => item.slot.kind === 'business_bullet').flatMap(item => paragraphsById.get(item.entryId)!)
      const repeatedCase = paragraphs.find(paragraph => hasRepeatedSkillCase(paragraph, business, input.entryPlan.base.expandedEvidenceIds))
      if (repeatedCase) entryIssues.push(writingIssue('WRITER_SKILL_CASE_REPEATED', entry.slot.outputPath, repeatedCase.evidenceIds,
        '技能段落大部分逐字复述同一来源的经历正文；请只改本技能条目，将已有方法组织为有来源的能力维度，不重讲项目过程、不新增工具、成果或角色。'))
    }
    if (entry.section === 'summary') paragraphs = paragraphs.map(paragraph => {
      const sources = paragraph.evidenceIds.flatMap(id => input.entryPlan.base.expandedEvidenceIds[id] ?? [id])
        .flatMap(id => input.resume.evidenceAtoms.filter(atom => atom.evidenceId === id))
      if (!/主导过/u.test(paragraph.text) || /(?:未|不|没有|非).{0,3}主导/u.test(paragraph.text)
        || sources.some(atom => /主导/u.test(`${atom.verbatimText} ${atom.sourceActionVerb ?? ''}`))
        || !sources.some(atom => ['action', 'responsibility', 'deliverable'].includes(atom.claimType))) return paragraph
      warnings.push(writingIssue('WRITER_SUMMARY_OWNERSHIP_DOWNGRADED', entry.entryId, paragraph.evidenceIds,
        '摘要无依据的“主导”已降为“参与”；不新增经历，不修改来源。', 'warning'))
      return rewriteFactParagraph(paragraph, text => text.replace(/主导过/gu, '参与过'))
    })
    if (entry.section === 'education') {
      const degrees = entry.facts.flatMap(fact => {
        const atom = input.resume.evidenceAtoms.find(item => item.evidenceId === fact.evidenceId && item.sourceScopeId === entry.scopeId)
        const label = atom && explicitEducationDegree(atom)
        return label ? [{ label, evidenceId: fact.evidenceId }] : []
      })
      const labels = [...new Set(degrees.map(item => item.label))]
      const scope = input.resume.timeline.find(item => item.scopeId === entry.scopeId)
      const displayed = [scope?.organization, scope?.title, ...paragraphs.map(item => item.text)].filter(Boolean).join(' ')
      if (labels.length === 1 && !displayed.includes(labels[0])) {
        const first = paragraphs[0]
        const degreeIds = degrees.map(item => item.evidenceId)
        const segments = first.segments ? [{kind: 'fact' as const, text: `${labels[0]}；`, evidenceIds: degreeIds}, ...first.segments] : undefined
        paragraphs = [{ ...first, text: `${labels[0]}；${first.text}`, ...(segments ? {segments} : {}),
          evidenceIds: [...new Set([...degreeIds, ...first.evidenceIds])] }, ...paragraphs.slice(1)]
        warnings.push(writingIssue('WRITER_EDUCATION_DEGREE_RETAINED', entry.entryId, degrees.map(item => item.evidenceId),
          '教育正文保留了同一经历中明确给出的学历原文，未推断毕业状态或新增学历。', 'warning'))
      }
    }
    const allowed = entry.facts.map(fact => fact.evidenceId)
    const used = new Set(paragraphs.flatMap(p => p.evidenceIds))
    const joined = paragraphs.map(p => p.text).join('；')
    const actionEvidence = new Set(entry.strategyActions?.filter(action => action.evidenceIds.some(id => {
      const atom = input.resume.evidenceAtoms.find(item => item.evidenceId === id)
      return used.has(id) && atom && ['action', 'responsibility', 'deliverable', 'result'].includes(atom.claimType)
    })).flatMap(action => action.evidenceIds))
    const boundaryAtoms = input.resume.evidenceAtoms.filter(atom =>
      entry.strategyBoundaryEvidenceIds?.includes(atom.evidenceId) && actionEvidence.has(atom.evidenceId)
      && atom.sourceScopeId === entry.scopeId)
    const boundaryIssues = inspectSupportedWriting(joined, boundaryAtoms, entry.slot.outputPath, false, {strategyBoundaries: true})
      .filter(issue => ['WRITER_BOUNDARY_LOST', 'WRITER_NEGATION_LOST'].includes(issue.code))
    entryIssues.push(...boundaryIssues)
    if (entry.coreEvidenceIds.some(id => !used.has(id))) warnings.push(writingIssue('WRITER_PRIORITY_PRACTICE_OMITTED', entry.entryId, entry.coreEvidenceIds, '经历核心材料未充分呈现，保留离线质量提示。', 'warning'))
    const requiredNumbers = entry.facts.filter(f => entry.coreEvidenceIds.includes(f.evidenceId)).flatMap(f => f.requiredNumbers ?? [])
    if (requiredNumbers.some(n => !writingNumbers(joined).includes(n))) warnings.push(writingIssue('WRITER_PRIORITY_OUTCOME_OMITTED', entry.entryId, entry.coreEvidenceIds, '核心结果数值未呈现，保留离线质量提示。', 'warning'))
    for (const [index, paragraph] of paragraphs.entries()) {
      const slotId = `${entry.entryId}:p${index}`
      const path = entry.slot.kind === 'business_bullet' ? `${entry.section}.${entry.scopeId}.bullets[${index}]` : entry.slot.outputPath
      sourceParagraphIndicesByPath.set(path, paragraph.sourceParagraphIndices)
      sourceParagraphIndicesByPath.set(slotId, paragraph.sourceParagraphIndices)
      writingPlan.blueprint.slots.push({ ...entry.slot, slotId, outputPath: path, order: order++, allowedEvidenceIds: allowed })
      writingPlan.coreEvidenceIdsBySlot[slotId] = []
      writingPlan.entryParagraphGroups[slotId] = entry.entryId
      blocks.push({ slotId, evidenceIds: paragraph.evidenceIds, text: paragraph.text })
      finalParagraphs.set(path, paragraph)
      entryIdsByPath.set(path, entry.entryId)
      if (entry.slot.kind === 'business_bullet') {
        const scope = input.resume.timeline.find(item => item.scopeId === entry.scopeId)
        const section = entry.section === 'project' ? '项目经历' : entry.section === 'research' ? '研究经历' : '工作经历'
        entryParagraphReferences.push({ entryId: entry.entryId, outputPath: path,
          location: [section, scope?.organization || scope?.title, `第${index + 1}段`].filter(Boolean).join(' · ') })
      }
    }
    const scope = plan.scopePlans.find(scope => scope.scopeId === entry.scopeId)
    if (scope && entry.slot.kind === 'business_bullet') {
      scope.bulletBudget = paragraphs.length
      if (['experience', 'internship'].includes(scope.scopeType)) scope.treatment = paragraphs.length > 1 ? 'expand' : 'compress'
    }
  }
  if (!input.previewEntryId) {
    const totalListItems = fixedListItemCount + blocks.filter(block =>
      writingPlan.blueprint.slots.find(slot => slot.slotId === block.slotId)?.kind !== 'summary').length
    const layoutEntries = entries.filter(entry => entry.slot.kind === 'business_bullet').map(entry => ({
      entryId: entry.entryId,
      currentParagraphCount: [...entryIdsByPath.values()].filter(id => id === entry.entryId).length,
      paragraphLimit: entryParagraphLimit(true, input.entryPlan.renderingPlan.scopePlans
        .find(scope => scope.scopeId === entry.scopeId)?.treatment === 'compress'),
    }))
    const layoutIssues = planEntryLayoutCorrections(layoutEntries, totalListItems, entryLayoutItemLimit(input.policy)).map(target => {
      const entry = entries.find(entry => entry.entryId === target.entryId)!
      const originalParagraphCount = byId.get(entry.entryId)!.paragraphs.length
      return {...writingIssue('WRITER_ENTRY_LAYOUT_EXCEEDED', entry.entryId,
        [...new Set(byId.get(entry.entryId)!.paragraphs.flatMap(paragraph => paragraph.evidenceIds))],
        `本条原稿${originalParagraphCount}段，安全合并后${target.currentParagraphCount}段，须在保留全部有效事实、数字、责任边界、引用及有价值填写格和细节决策的前提下重新组织为${target.targetParagraphCount}段；全文当前${totalListItems}条列表、硬限${entryLayoutItemLimit(input.policy)}条。本次允许重排本条全部段落，不拼接超过原长度约束的长段，不删除事实或填写格。`),
        subcode: 'ENTRY_PARAGRAPH_ALLOCATION_EXCEEDED',
        expectedConstraint: JSON.stringify({currentParagraphCount: originalParagraphCount, compiledParagraphCount: target.currentParagraphCount,
          targetParagraphCount: target.targetParagraphCount, totalListItemCount: totalListItems,
          totalListItemLimit: entryLayoutItemLimit(input.policy)})}
    })
    // Whole-entry layout repair must not inherit a single rendered paragraph's
    // source indices or lock every unchanged index in the correction protocol.
    if (layoutIssues.length) throw new SupportedWritingError([...entryIssues, ...layoutIssues], sourceParagraphIndicesByPath)
  }
  // A dependent-only paragraph has no admitted fact projection yet. Keep its
  // precise skeleton failure instead of adding a broad composition-schema error.
  if (entryIssues.length && blocks.some(block => !block.text.trim() || !block.evidenceIds.length)) {
    throw new SupportedWritingError(entryIssues, sourceParagraphIndicesByPath)
  }
  const compileBlocks = (compositionBlocks: typeof blocks) => {
    try {
      return compileWritingArtifact({
        composition: {contractVersion: 'p06-composition-v1', blocks: compositionBlocks},
        writingPlan,
        resume: input.resume,
        plan,
        policy: input.policy,
      })
    } catch (error) {
      if (!(error instanceof SupportedWritingError)) throw error
      // 渲染段落可由多段草稿合并；纠正始终定位 rejectedEntries 中的原始段落。
      throw new SupportedWritingError([...entryIssues, ...error.issues], sourceParagraphIndicesByPath)
    }
  }
  let result
  const collaboratorNormalizations: typeof warnings = []
  try {
    result = compileBlocks(blocks)
  } catch (error) {
    if (!(error instanceof SupportedWritingError)
      || !error.issues.some(issue => issue.severity === 'error' && issue.code === 'WRITER_COLLABORATOR_ADDED')) {
      throw error
    }
    const slotByOutputPath = new Map(writingPlan.blueprint.slots.map(slot => [slot.outputPath, slot.slotId]))
    const normalizedBlocks = blocks.map(block => {
      const issues = error.issues.filter(issue => issue.severity === 'error'
        && issue.code === 'WRITER_COLLABORATOR_ADDED'
        && slotByOutputPath.get(issue.outputPath ?? '') === block.slotId)
      if (!issues.length) return block
      const atoms = [...new Set(block.evidenceIds.flatMap(id => input.entryPlan.base.expandedEvidenceIds[id] ?? [id]))]
        .flatMap(id => input.resume.evidenceAtoms.filter(atom => atom.evidenceId === id))
      const path = writingPlan.blueprint.slots.find(slot => slot.slotId === block.slotId)!.outputPath
      const paragraph = finalParagraphs.get(path)!
      const normalized = rewriteFactParagraph(paragraph, text => removeUnsupportedCollaboratorMentions(text, atoms))
      const text = normalized.text
      if (text === block.text) return block
      collaboratorNormalizations.push(writingIssue(
        'WRITER_COLLABORATOR_REMOVED',
        block.slotId,
        block.evidenceIds,
        '已删除生成稿中无来源支持的具体协作部门，保留同一引用能够证明的实际动作。',
        'warning',
      ))
      finalParagraphs.set(path, normalized)
      return {...block, text}
    })
    if (!collaboratorNormalizations.length) throw error
    result = compileBlocks(normalizedBlocks)
  }
  if (entryIssues.length) throw new SupportedWritingError(entryIssues, sourceParagraphIndicesByPath)
  const entryParagraphPaths = new Set(writingPlan.blueprint.slots.filter(s => s.kind === 'business_bullet').map(s => s.outputPath))
  // Normative rewrites above change fact segments first. Check optional clause
  // boundaries again before building either public text or its preview.
  const normalizedSkeletonIssues: ValidationIssue[] = []
  for (const entry of entries) {
    const selectedParagraphs = [...finalParagraphs].filter(([path]) => entryIdsByPath.get(path) === entry.entryId)
    const paragraphs = selectedParagraphs.map(([, paragraph]) => paragraph)
    const issues = inspectEntrySkeleton({coverage: byId.get(entry.entryId)!.coverage, paragraphs,
      gapDecisions: byId.get(entry.entryId)!.gapDecisions, requireGapDecisions: output.contractVersion === 'entry-writing-v3',
      requireInformationRouting: output.contractVersion === ENTRY_WRITING_POLICY,
      requireDetails: ['entry-writing-v4', 'entry-writing-v5', ENTRY_WRITING_POLICY].includes(output.contractVersion), detailAssessments: byId.get(entry.entryId)!.detailAssessments,
      uncertaintyResolutions: byId.get(entry.entryId)!.uncertaintyResolutions, sourceUncertainties: entry.sourceUncertainties,
      gapContextFacts: entry.gapContextFacts, gapContextComplete: entry.gapContextComplete, targetTaskIds: entry.taskIds,
      facts: entry.facts, identityEvidenceIds: entry.projectIdentity?.evidenceIds,
      hasProjectIdentity: ['project', 'research'].includes(entry.section) && Boolean(entry.projectIdentity?.text),
      atoms: input.resume.evidenceAtoms, scopeId: entry.scopeId, business: entry.slot.kind === 'business_bullet', outputPath: entry.slot.outputPath, entryId: entry.entryId})
    normalizedSkeletonIssues.push(...issues.map(issue => {
      if (issue.paragraphIndex === undefined) return issue
      const selected = selectedParagraphs[issue.paragraphIndex]
      if (!selected) return issue
      const [outputPath, paragraph] = selected
      // Explicit indices always refer to provider paragraphs. A compacted unit
      // with several sources instead uses the renderer path's complete mapping.
      return {...issue, outputPath, paragraphIndex: paragraph.sourceParagraphIndices.length === 1
        ? paragraph.sourceParagraphIndices[0] : undefined}
    }))
  }
  if (normalizedSkeletonIssues.length) throw new SupportedWritingError(normalizedSkeletonIssues, sourceParagraphIndicesByPath)
  const enabledGaps = new Map<string, Set<number>>()
  const priority = {core: 0, supporting: 1, optional: 2, unclear: 3}
  const candidates = [...finalParagraphs].flatMap(([path, paragraph]) => (paragraph.segments ?? []).flatMap((segment, index): GapSelectionCandidate[] => {
    if (segment.kind !== 'optional_gap_clause') return []
    const entry = entries.find(item => item.entryId === entryIdsByPath.get(path))!
    const element = GAP_TEMPLATES[segment.template].element
    const detail = byId.get(entry.entryId)?.detailAssessments?.find(item => item.detailId === segment.detailId)
    const decision = byId.get(entry.entryId)?.gapDecisions?.find(item => item.element === element && item.action === 'supplement')
    const targetTasks = detail?.targetTaskIds ?? (decision?.action === 'supplement' ? decision.targetTaskIds : entry.taskIds)
    const tasks = input.entryPlan.base.targeting?.profile.tasks.filter(task => targetTasks.includes(task.id)
      && task.provenance.basis !== 'unknown') ?? []
    const purpose = decision?.action === 'supplement' ? decision.purpose
      : element === 'problem' || element === 'solution' ? 'explain_key_action'
      : element === 'responsibility' ? 'clarify_contribution' : element === 'result' ? 'identify_deliverable' : 'identify_object'
    return [{path, index, entryId: entry.entryId, scopeId: entry.scopeId, element, purpose,
      ...(input.resume.sourceStructure?.nodes.find(node => node.scopeId === entry.scopeId && node.kind === 'project')?.parentScopeId
        ? {parentScopeId: input.resume.sourceStructure.nodes.find(node => node.scopeId === entry.scopeId)!.parentScopeId!} : {}),
      ...(detail ? {detailId: detail.detailId, detailKind: detail.detailKind, subject: detail.subject, anchorEvidenceIds: detail.anchorEvidenceIds} : {}),
      taskPriority: Math.min(3, ...tasks.map(task => priority[task.priority])), order: entry.order}]
  }))
  const gapSelections = selectCompletionGaps(candidates)
  const gaps = gapSelections.filter(item => item.disposition === 'selected')
  for (const gap of gaps) {
    const indices = enabledGaps.get(gap.path) ?? new Set<number>()
    indices.add(gap.index); enabledGaps.set(gap.path, indices)
  }
  // Editing guidance is not résumé body copy. The shared document serializer
  // owns both preview and download projections, including dependent claims.
  validateDeliveryBudget(result.artifact.markdown, input.policy)
  const completionDocument = buildCompletionDocument({documentId: input.documentId,
    renderedBlocks: result.renderedBlocks, finalParagraphs, enabledGaps, artifactMarkdown: result.artifact.markdown,
    unitsByPath: new Map([...entryIdsByPath].map(([path, entryId]) => [path, {unitId: finalParagraphs.get(path)?.unitId ?? `${entryId}:unit:${finalParagraphs.get(path)?.sourceParagraphIndices[0] ?? 0}`, entryId}])),
    detailAssessmentsByPath: new Map([...entryIdsByPath].map(([path, entryId]) => [path, byId.get(entryId)?.detailAssessments ?? []])),
    schemaVersion: output.contractVersion === ENTRY_WRITING_POLICY ? 'resume-completion-v4' : output.contractVersion === 'entry-writing-v5' ? 'resume-completion-v3' : output.contractVersion === 'entry-writing-v4' ? 'resume-completion-v2' : 'resume-completion-v1'})
  const deliveryMarkdown = serializeDraft(completionDocument)
  const deliveryLines = deliveryMarkdown.split('\n')
  const deliveryParagraphs = new Map<string, string[]>()
  const gapOutputPaths = new Set<string>()
  for (const [index, block] of result.renderedBlocks.entries()) {
    if (!block.outputPath) continue
    const entryId = entryIdsByPath.get(block.outputPath)
    if (!entryId) continue
    const prefix = completionDocument.blocks[index].prefix
    const text = deliveryLines[index].slice(prefix.length)
    deliveryParagraphs.set(entryId, [...(deliveryParagraphs.get(entryId) ?? []), text])
    if (completionDocument.blocks[index].segments.some(segment => segment.kind !== 'text')) gapOutputPaths.add(block.outputPath)
  }
  return {
    ...result, deliveryMarkdown, completionDocument, preparationTopics: routeSourceInformation({atoms: input.resume.evidenceAtoms, actions: entries.flatMap(entry => entry.editorialActions ?? [])}).preparationTopics,
    actionReceipts: entries.flatMap(entry => {
      const unitAliases = new Map<string, string>([...finalParagraphs].filter(([path]) => entryIdsByPath.get(path) === entry.entryId)
        .flatMap(([, paragraph]) => paragraph.sourceParagraphIndices.map(index => [`${entry.entryId}:unit:${index}`,
          paragraph.unitId ?? `${entry.entryId}:unit:${paragraph.sourceParagraphIndices[0]}`] as const)))
      return (byId.get(entry.entryId)?.actionReceipts ?? []).map(receipt => ({...receipt, entryId: entry.entryId,
        unitIds: [...new Set(receipt.unitIds.map(unitId => unitAliases.get(unitId) ?? unitId))]}))
    }) as ActionReceipt[], deliveryParagraphs, gapOutputPaths, gapSelections,
    entryAudits: entries.map(entry => ({entryId: entry.entryId, coverage: byId.get(entry.entryId)?.coverage ?? [],
      detailAssessments: byId.get(entry.entryId)?.detailAssessments ?? [],
      sourceUncertainties: (entry.sourceUncertainties ?? []).map(({text: _sourceText, ...signal}) => signal),
      uncertaintyResolutions: byId.get(entry.entryId)?.uncertaintyResolutions ?? [],
      rejectedActionReceipts: rejectedReceipts.get(entry.entryId) ?? [],
      zeroGapReason: byId.get(entry.entryId)?.detailAssessments?.some(detail => detail.decision === 'supplement')
        ? null : 'no_selected_detail_after_assessment'})),
    gapDecisionsByEntry: entries.map(entry => ({entryId: entry.entryId, decisions: byId.get(entry.entryId)?.gapDecisions ?? []})),
    writingIssues: [...result.writingIssues, ...warnings, ...collaboratorNormalizations, ...receiptWarnings],
    renderingPlan: plan,
    entryParagraphPaths,
    entryParagraphReferences,
  }
}
