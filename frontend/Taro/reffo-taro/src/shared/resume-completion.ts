// 由 shared/sync-resume-completion.mjs 生成，请修改 shared/resume-completion.ts 后重新同步。
import { resumeTextFingerprint } from './resume-strategy'

export type FiveElement = 'responsibility' | 'project' | 'problem' | 'solution' | 'result'
export type GapTemplate = 'problem' | 'research_problem' | 'method' | 'role_detail' | 'project_name' | 'design_deliverable' | 'metric_detail'
  | 'implementation_stage' | 'metric_definition' | 'metric_period' | 'metric_population' | 'human_intervention' | 'identity_name' | 'research_finding'
export type GapFill = { state: 'empty' } | { state: 'filled'; value: string; origin: 'user' } | { state: 'omitted' }
export interface CompletionAssociation { unitId?: string; actionIds?: string[] }
export interface ResumeTextSegment extends CompletionAssociation { kind: 'text'; segmentId: string; markdown: string; origin: 'generated' | 'user'; replacedClaimIds?: string[] }
export interface GapField {
  gapId: string
  detailId?: string
  element: FiveElement | 'identity'
  template: GapTemplate
  prefix: string
  suffix: string
  label: string
  instruction: string
  benefit: string
  /** The complete, single-sentence inline prompt used by v4. */
  hint?: string
  candidates: Array<{ text: string; kind: 'source_reference' | 'category_example' }>
  fill: GapFill
  unitId?: string
  actionIds?: string[]
}
export interface ResumeGapSegment extends GapField {
  kind: 'optional_gap_clause'
  retainedFacts: Array<{ textSegmentId: string; exactText: string }>
}
export interface ResumeRequiredDetailGap extends GapField { kind: 'required_detail_gap' }
export interface ResumeIdentityGap extends GapField { kind: 'identity_gap'; template: 'identity_name'; element: 'identity' }
export type CompletionGap = ResumeGapSegment | ResumeRequiredDetailGap | ResumeIdentityGap
export interface ClaimResolution { state: 'confirmed' | 'rejected'; note: string; origin: 'user' }
export interface ResumeDependentClaim extends CompletionAssociation {
  kind: 'dependent_claim'
  claimId: string
  sourceEvidenceIds: string[]
  sourceSpans: Array<{ sourceBlockId?: string; start: number; end: number }>
  readiness: 'metadata_missing' | 'context_incomplete' | 'conflicted'
  qualifiers: string[]
  parts: Array<ResumeTextSegment | ResumeRequiredDetailGap>
  requiredGapIds: string[]
  fillPolicy: 'all_required'
  resolution?: ClaimResolution
}
export interface ResumeClaimLineage { claimId: string; originalClaim: ResumeDependentClaim; resolution?: ClaimResolution }
export type ResumeCompletionSegment = ResumeTextSegment | ResumeGapSegment | ResumeDependentClaim | ResumeIdentityGap
export interface ResumeCompletionBlock extends CompletionAssociation {
  blockId: string
  outputPath?: string
  entryId?: string
  kind: 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullet' | 'numbered' | 'divider' | 'blank'
  prefix: string
  segments: ResumeCompletionSegment[]
}
export interface ResumeCompletionDocument {
  schemaVersion: 'resume-completion-v1' | 'resume-completion-v2' | 'resume-completion-v3' | 'resume-completion-v4'
  templateVersion: 'resume-completion-template-v1' | 'resume-completion-template-v2' | 'resume-completion-template-v3' | 'resume-completion-template-v4'
  documentId: string
  revision: number
  markdownFingerprint: string
  blocks: ResumeCompletionBlock[]
  claimLineage?: ResumeClaimLineage[]
  recovery?: { rawDocument: unknown; markdown: string }
}
export interface CompletionIssue { code: string; message: string; blockId?: string; gapId?: string }
export type CompletionValidationResult = { ok: true; document: ResumeCompletionDocument } | { ok: false; issues: CompletionIssue[] }
export interface CompletionCommand {
  documentId: string
  baseRevision: number
  gapId: string
  type: 'fill' | 'clear' | 'omit' | 'undo'
  value?: string
  previousFill?: GapFill
}
export type CompletionForwardOperation = {kind: 'gap'; command: CompletionCommand}
  | {kind: 'row'; documentId: string; baseRevision: number; blockId: string; draft: string}
  | {kind: 'resolve_claim'; documentId: string; baseRevision: number; claimId: string; resolution: ClaimResolution}
export type CompletionOperation = CompletionForwardOperation
  | {kind: 'restore'; documentId: string; baseRevision: number; previousDocument: ResumeCompletionDocument; operation: CompletionForwardOperation}
export interface CompletionEditJournal { documentId: string; baseRevision: number; operations: CompletionOperation[] }
export type CompletionEditResult = { ok: true; document: ResumeCompletionDocument; changed: boolean; undo?: CompletionCommand; notice?: string; operation?: CompletionOperation }
  | { ok: false; issues: CompletionIssue[] }
export interface CompletionRowEditSession {
  documentId: string
  baseRevision: number
  blockId: string
  draft: string
  originalBlock: ResumeCompletionBlock
  tokens: Array<{ token: string; gapId: string }>
}
export interface CompletionLoadResult {
  status: 'ready' | 'repair_required'
  document: ResumeCompletionDocument
  issues: CompletionIssue[]
  migrated: boolean
  blocked?: boolean
  rawDocument?: unknown
}
export interface CompletionOptions { documentId?: string; idFactory?: () => string }
export type CompletionExportResult = { ok: true; markdown: string; omittedCount: number; omittedClaimCount?: number;
  omittedGapIds?: string[]; omittedClaimIds?: string[]; exportedUnitIds?: string[]; excludedBlockIds?: string[]; identityMissing?: boolean; plainTextDigest?: string } | { ok: false; issues: CompletionIssue[] }

export const COMPLETION_TEMPLATES = {
  problem: { element: 'problem', prefix: '，针对', suffix: '的问题', label: '实际业务问题', instruction: '填一项实际业务问题', benefit: '使方案对应的痛点明确' },
  research_problem: { element: 'problem', prefix: '，围绕', suffix: '这一研究问题', label: '实际研究问题', instruction: '填一项实际研究过的使用问题', benefit: '使研究对象更具体' },
  method: { element: 'solution', prefix: '，采用', suffix: '的方法', label: '实际方法或规则', instruction: '填一种实际采用的方法或规则', benefit: '说明实际解决路径' },
  role_detail: { element: 'responsibility', prefix: '，本人承担的具体工作为', suffix: '', label: '本人具体工作', instruction: '填一项本人实际承担的工作环节', benefit: '明确个人分工' },
  project_name: { element: 'project', prefix: '，具体项目为', suffix: '', label: '真实项目或模块', instruction: '填真实项目或模块名称', benefit: '明确实践对象' },
  design_deliverable: { element: 'result', prefix: '，交付设计产物', suffix: '', label: '实际交付名称', instruction: '填实际交付的设计产物名称', benefit: '补明具体产出' },
  metric_detail: { element: 'result', prefix: '，', suffix: '', label: '指标缺失项', instruction: '补一个已有对比记录中缺失的数值、单位或月份', benefit: '补全可核对的指标口径' },
  implementation_stage: { element: 'result', prefix: '，当前实施阶段为', suffix: '', label: '实施阶段', instruction: '填该能力当前实际实施阶段', benefit: '明确设计与落地的边界' },
  metric_definition: { element: 'result', prefix: '，指标判断标准为', suffix: '', label: '指标定义', instruction: '填该指标实际采用的判断标准', benefit: '说明结果如何被计算或评价' },
  metric_period: { element: 'result', prefix: '，统计周期为', suffix: '', label: '统计周期', instruction: '填该结果实际统计的起止时间', benefit: '明确结果对应的时间范围' },
  metric_population: { element: 'result', prefix: '，统计对象为', suffix: '', label: '统计对象', instruction: '填实际纳入统计的对象或样本范围', benefit: '明确结果适用范围' },
  human_intervention: { element: 'solution', prefix: '，人工介入环节为', suffix: '', label: '人工介入环节', instruction: '填实际仍需人工处理的环节', benefit: '明确自动化与个人工作的边界' },
  identity_name: { element: 'identity', prefix: '', suffix: '', label: '姓名', instruction: '填写希望出现在简历中的真实姓名', benefit: '便于招聘方识别与联系；未填写时下载将省略姓名' },
  research_finding: { element: 'result', prefix: '，提炼的实际发现为', suffix: '', label: '一项实际研究发现', instruction: '填一项从已有访谈、问卷或分析中得到的具体发现', benefit: '让招聘者理解研究如何支持判断；不等于已被采纳或产生收益' },
} as const

type CompletionVersionInput = Pick<ResumeCompletionDocument, 'schemaVersion'> | string | undefined
export function completionVersion(value: CompletionVersionInput): number {
  const version = typeof value === 'string' ? value : value?.schemaVersion
  return /^resume-completion-v[1-4]$/u.test(version ?? '') ? Number(version!.slice(-1)) : 0
}
export const hasStructuredCompletion = (document: ResumeCompletionDocument): boolean => completionVersion(document) >= 2
export const hasLinkedCompletion = (value: CompletionVersionInput): boolean => completionVersion(value) >= 3
export const isCompletionV4 = (value: CompletionVersionInput): boolean => completionVersion(value) === 4

const COMPLETION_HINTS: Record<GapTemplate, string> = {
  problem: '补上一项实际业务问题，让招聘者看清你的方案针对什么痛点。',
  research_problem: '补上一项实际研究问题，体现研究目标与业务问题的关联。',
  method: '补上一种实际采用的方法，突出你解决问题的具体能力。',
  role_detail: '补上你负责的关键环节，让招聘者看清你的个人贡献。',
  project_name: '补上真实项目或模块名称，让招聘者理解你的实践对象。',
  design_deliverable: '补上实际交付的设计产物，体现你的方案产出能力。',
  metric_detail: '补上这项对比缺失的数值或单位，让招聘者看清改进效果。',
  implementation_stage: '补上实际实施阶段，让招聘者理解方案推进到哪一步。',
  metric_definition: '补上指标判断标准，让招聘者准确理解该结果。',
  metric_period: '补上结果对应的时间范围，让招聘者准确理解改进效果。',
  metric_population: '补上结果适用的业务范围，让招聘者准确理解该结果。',
  human_intervention: '补上你实际负责的人工处理环节，让招聘者看清个人贡献。',
  identity_name: '填写姓名，便于招聘方识别。',
  research_finding: '补一项影响方案选择的实际发现，体现你的研究与产品判断能力。',
}
export function renderCompletionHint(gap: Pick<GapField, 'template' | 'hint'>): string {
  return gap.hint || COMPLETION_HINTS[gap.template]
}

export function gapAnswerState(document: ResumeCompletionDocument, gap: GapField) {
  const claim = document.blocks.flatMap(block => block.segments).find((segment): segment is ResumeDependentClaim =>
    segment.kind === 'dependent_claim' && segment.requiredGapIds.includes(gap.gapId))
  return {completionState: gap.fill.state, provenanceState: gap.fill.state === 'filled' ? 'user_supplied' as const : 'unknown' as const,
    resolutionState: claim && !isCompletionV4(document) ? claim.resolution?.state ?? (hasLinkedCompletion(document) ? 'unresolved' : 'legacy') : 'not_required'}
}

const MAX_TEXT = 512_000
const MAX_BLOCKS = 4096
const MAX_SEGMENTS = 16_384
const markerPattern = /【待完善[：:]|〔待补(?:\s*\d+)?[：:]|\[数值缺失\]|\[单位缺失\]|\[月份缺失\]/u
const reservedPattern = /【待完善|〔待补/u
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const shortString = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\r\n\u2028\u2029]/u.test(value)
const issue = (code: string, message: string, blockId?: string, gapId?: string): CompletionIssue => ({code, message, ...(blockId ? {blockId} : {}), ...(gapId ? {gapId} : {})})
const fail = (value: CompletionIssue): { ok: false; issues: CompletionIssue[] } => ({ok: false, issues: [value]})

export function normalizeGapValue(value: string): string {
  return value.replace(/\r\n?|[\n\u2028\u2029]/gu, ' ').replace(/[\u200b\ufeff]/gu, '').trim()
}

function hasCompletionFragment(text: string): boolean {
  return reservedPattern.test(text) || /待补\s*\d+[：:]/u.test(text)
    || Object.values(COMPLETION_TEMPLATES).some(template => text.includes(`待完善：${template.instruction}`) || text.includes(`待完善:${template.instruction}`))
    || /待完善[：:]填这一个实际(?:数值|单位|月份)/u.test(text)
}

export function escapeCompletionValue(value: string): string {
  return value.replace(/([\\`*_{}\[\]<>])/gu, '\\$1')
}

export function renderCompletionPlaceholder(gap: GapField, required = false): string {
  if (gap.hint) return `【待完善：${gap.hint}】`
  const references = gap.candidates.some(candidate => candidate.kind === 'category_example')
    ? `；类别示例“${gap.candidates.filter(candidate => candidate.kind === 'category_example').map(candidate => candidate.text).join('/')}”，可组合且须确实完成`
    : gap.candidates.length ? `；可参考“${gap.candidates.map(candidate => candidate.text).join('/')}”，须实际适用` : ''
  const omission = gap.template === 'identity_name' ? '未填写时下载省略姓名，文件使用中性名称'
    : required ? '必要信息未填齐时，下载省略整条关联结果' : `无法确认时删去“${gap.prefix}……${gap.suffix}”分句`
  return `【待完善：${gap.instruction}${references}；${gap.benefit}；${omission}】`
}

export function visitSegments(document: ResumeCompletionDocument, visit: (segment: ResumeCompletionSegment | ResumeRequiredDetailGap, block: ResumeCompletionBlock, claim?: ResumeDependentClaim) => void): void {
  for (const block of document.blocks) for (const segment of block.segments) {
    visit(segment, block)
    if (segment.kind === 'dependent_claim') for (const part of segment.parts) visit(part, block, segment)
  }
}

export function collectGaps(document: ResumeCompletionDocument): CompletionGap[] {
  const gaps: CompletionGap[] = []
  visitSegments(document, segment => { if (segment.kind === 'optional_gap_clause' || segment.kind === 'required_detail_gap' || segment.kind === 'identity_gap') gaps.push(segment) })
  return gaps
}

export function findGap(document: ResumeCompletionDocument, gapId: string): CompletionGap | undefined {
  return collectGaps(document).find(gap => gap.gapId === gapId)
}

export function findClaim(document: ResumeCompletionDocument, claimId: string): ResumeDependentClaim | undefined {
  return document.blocks.flatMap(block => block.segments).find((segment): segment is ResumeDependentClaim => segment.kind === 'dependent_claim' && segment.claimId === claimId)
}

export function dependentClaimExportable(claim: ResumeDependentClaim, policy: boolean | ResumeCompletionDocument['schemaVersion'] = false): boolean {
  const requireResolution = typeof policy === 'boolean' ? policy : policy === 'resume-completion-v3'
  if (isCompletionV4(typeof policy === 'string' ? policy : undefined)) {
    // Meaning or factual conflicts cannot be resolved by filling a methodological field.
    return claim.readiness === 'metadata_missing' && claim.resolution?.state !== 'rejected' && claim.requiredGapIds.length > 0
      && claim.requiredGapIds.every(id => claim.parts.some(part => part.kind === 'required_detail_gap' && part.gapId === id && part.fill.state === 'filled'))
  }
  return (claim.readiness === 'metadata_missing' || claim.resolution?.state === 'confirmed')
    && (!requireResolution || claim.resolution?.state === 'confirmed') && claim.resolution?.state !== 'rejected' && claim.requiredGapIds.length > 0
    && claim.requiredGapIds.every(id => claim.parts.some(part => part.kind === 'required_detail_gap' && part.gapId === id && part.fill.state === 'filled'))
}

export function renderCompletionSegment(segment: ResumeCompletionSegment | ResumeRequiredDetailGap, mode: 'draft' | 'export' | 'facts' = 'draft'): string {
  if (segment.kind === 'dependent_claim') {
    if (mode === 'facts' || (mode === 'export' && !dependentClaimExportable(segment))) return ''
    return segment.parts.map(part => renderCompletionSegment(part, mode)).join('')
  }
  if (segment.kind === 'text') return segment.markdown
  if (segment.kind === 'required_detail_gap' || segment.kind === 'identity_gap') {
    if (mode === 'facts') return ''
    if (segment.fill.state === 'filled') return segment.prefix + escapeCompletionValue(segment.fill.value) + segment.suffix
    if (segment.kind === 'identity_gap' && segment.fill.state === 'omitted') return ''
    return mode === 'export' ? '' : segment.prefix + renderCompletionPlaceholder(segment, segment.kind === 'required_detail_gap') + segment.suffix
  }
  if (mode === 'facts' || segment.fill.state === 'omitted') return ''
  if (segment.fill.state === 'filled') return segment.prefix + escapeCompletionValue(segment.fill.value) + segment.suffix
  return mode === 'export' ? '' : segment.prefix + renderCompletionPlaceholder(segment) + segment.suffix
}

export function serializeDraft(document: ResumeCompletionDocument): string {
  if (document.recovery) return document.recovery.markdown
  return document.blocks.map(block => block.prefix + block.segments.map(segment => renderCompletionSegment(segment)).join('')).join('\n')
}

export function serializeWithoutAllGapClauses(document: ResumeCompletionDocument): string {
  return document.blocks.flatMap(block => {
    const text = block.segments.map(segment => hasStructuredCompletion(document) && segment.kind === 'text' && segment.origin === 'user'
      ? '' : renderCompletionSegment(segment, 'facts')).join('')
    if (hasStructuredCompletion(document) && !text.trim() && ['bullet', 'numbered'].includes(block.kind)
      && block.segments.some(segment => segment.kind === 'dependent_claim' || (segment.kind === 'text' && segment.origin === 'user'))) return []
    return [block.prefix + text]
  }).join('\n')
}

export function createCompletionDocument(input: { documentId: string; blocks: ResumeCompletionBlock[]; revision?: number; schemaVersion?: ResumeCompletionDocument['schemaVersion'] }): ResumeCompletionDocument {
  const schemaVersion = input.schemaVersion ?? 'resume-completion-v1'
  const document: ResumeCompletionDocument = {schemaVersion, templateVersion: schemaVersion === 'resume-completion-v4' ? 'resume-completion-template-v4' : schemaVersion === 'resume-completion-v3' ? 'resume-completion-template-v3'
    : schemaVersion === 'resume-completion-v2' ? 'resume-completion-template-v2' : 'resume-completion-template-v1',
    documentId: input.documentId, revision: input.revision ?? 0, markdownFingerprint: '',
    blocks: isCompletionV4(schemaVersion) ? JSON.parse(JSON.stringify(input.blocks)) as ResumeCompletionBlock[] : input.blocks}
  if (isCompletionV4(document)) visitSegments(document, segment => {
    if (segment.kind === 'optional_gap_clause' || segment.kind === 'required_detail_gap' || segment.kind === 'identity_gap') segment.hint ??= renderCompletionHint(segment)
  })
  document.markdownFingerprint = resumeTextFingerprint(serializeDraft(document))
  return document
}

function validFill(value: unknown): value is GapFill {
  if (!record(value)) return false
  if (value.state === 'empty' || value.state === 'omitted') return value.value === undefined && value.origin === undefined
  return value.state === 'filled' && value.origin === 'user' && shortString(value.value, 6000)
    && normalizeGapValue(value.value) === value.value && value.value.length > 0 && !hasCompletionFragment(value.value)
}

function validGapField(value: Record<string, unknown>, version: ResumeCompletionDocument['schemaVersion']): boolean {
  if (!shortString(value.gapId) || typeof value.template !== 'string' || !Object.prototype.hasOwnProperty.call(COMPLETION_TEMPLATES, value.template)) return false
  if (version !== 'resume-completion-v1' && !shortString(value.detailId)) return false
  if (isCompletionV4(version) && (!shortString(value.hint, 240) || /[【】<>；;\r\n]/u.test(value.hint)
    || /[。！？!?].+\S/u.test(value.hint))) return false
  const template = COMPLETION_TEMPLATES[value.template as GapTemplate]
  if (value.element !== template.element || typeof value.prefix !== 'string' || value.prefix.length > 1024 || (value.template !== 'identity_name' && !value.prefix) || typeof value.suffix !== 'string'
    || value.suffix.length > 1024 || /[\r\n【】<>]/u.test(value.prefix + value.suffix)
    || !shortString(value.label) || !shortString(value.instruction, 1024) || !shortString(value.benefit, 1024)
    || /[【】]/u.test(`${value.label}${value.instruction}${value.benefit}`) || !validFill(value.fill)
    || !Array.isArray(value.candidates) || value.candidates.length > 3) return false
  if (value.template !== 'metric_detail' && (value.prefix !== template.prefix || value.suffix !== template.suffix)) return false
  if (value.template === 'metric_detail' && !value.prefix.startsWith('，')) return false
  if (!value.candidates.every(candidate => record(candidate) && ['source_reference', 'category_example'].includes(String(candidate.kind))
    && shortString(candidate.text, 96) && !/[【】“”]/u.test(candidate.text))) return false
  return true
}

function validGap(value: Record<string, unknown>, version: ResumeCompletionDocument['schemaVersion']): value is Record<string, unknown> & ResumeGapSegment {
  return validGapField(value, version) && Array.isArray(value.retainedFacts) && value.retainedFacts.length <= 64
    && (value.template !== 'metric_detail' || value.retainedFacts.length > 0)
    && value.retainedFacts.every(anchor => record(anchor) && shortString(anchor.textSegmentId) && shortString(anchor.exactText, 6000))
}

function validText(value: Record<string, unknown>): value is Record<string, unknown> & ResumeTextSegment {
  return value.kind === 'text' && shortString(value.segmentId) && typeof value.markdown === 'string'
    && !/\n/u.test(value.markdown) && ['generated', 'user'].includes(String(value.origin))
    && (value.replacedClaimIds === undefined || (value.origin === 'user' && Array.isArray(value.replacedClaimIds)
      && value.replacedClaimIds.every(id => shortString(id)) && new Set(value.replacedClaimIds).size === value.replacedClaimIds.length))
}

function validAssociation(value: Record<string, unknown>): boolean {
  return (value.unitId === undefined || shortString(value.unitId)) && (value.actionIds === undefined || (Array.isArray(value.actionIds)
    && value.actionIds.length <= 1024 && value.actionIds.every(id => shortString(id)) && new Set(value.actionIds).size === value.actionIds.length))
}

function validResolution(value: unknown): value is ClaimResolution {
  return record(value) && ['confirmed', 'rejected'].includes(String(value.state)) && value.origin === 'user' && shortString(value.note, 2000)
    && normalizeGapValue(value.note) === value.note && !hasCompletionFragment(value.note)
}

export function completionIdentityName(document: ResumeCompletionDocument): string | undefined {
  const identity = collectGaps(document).find(gap => gap.kind === 'identity_gap' && gap.template === 'identity_name')
  return identity?.fill.state === 'filled' ? identity.fill.value : undefined
}

export function attachIdentityCompletion(document: ResumeCompletionDocument, input: {name?: string | null; actionIds?: string[]} = {}): ResumeCompletionDocument {
  if (!hasLinkedCompletion(document)) throw new Error('身份填写仅支持关联填写文档')
  const next = cloneDocument(document)
  if (collectGaps(next).some(gap => gap.kind === 'identity_gap')) return next
  const name = normalizeGapValue(input.name ?? '')
  const gap: ResumeIdentityGap = {kind: 'identity_gap', gapId: `${document.documentId}:identity:name`, detailId: 'identity:name',
    template: 'identity_name', ...COMPLETION_TEMPLATES.identity_name, candidates: [], fill: name ? {state: 'filled', value: name, origin: 'user'} : {state: 'empty'},
    ...(isCompletionV4(document) ? {hint: COMPLETION_HINTS.identity_name} : {}),
    ...(input.actionIds ? {actionIds: [...input.actionIds]} : {})}
  // A known name belongs to the source header; only absent identity becomes a user gap.
  if (name) return next
  const first = next.blocks[0]
  if (first?.kind === 'heading1' && first.segments.every(segment => segment.kind === 'text')) {
    first.segments = [gap]
  } else next.blocks.unshift({blockId: `${document.documentId}:identity:heading`, kind: 'heading1', prefix: '# ', segments: [gap]})
  return seal(next, document.revision)
}

export function validateCompletionDocument(value: unknown, expectedMarkdown?: string): CompletionValidationResult {
  if (!record(value) || !['resume-completion-v1', 'resume-completion-v2', 'resume-completion-v3', 'resume-completion-v4'].includes(String(value.schemaVersion))
    || value.templateVersion !== (value.schemaVersion === 'resume-completion-v4' ? 'resume-completion-template-v4' : value.schemaVersion === 'resume-completion-v3' ? 'resume-completion-template-v3'
      : value.schemaVersion === 'resume-completion-v2' ? 'resume-completion-template-v2' : 'resume-completion-template-v1')) {
    return fail(issue('COMPLETION_VERSION_UNSUPPORTED', '填写文档版本不受支持，请在对应行修复原文。'))
  }
  if (value.recovery !== undefined) return fail(issue('COMPLETION_RECOVERY_BLOCKED', '当前结构尚未恢复，不能保存或导出为普通文本。'))
  if (!shortString(value.documentId) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !shortString(value.markdownFingerprint) || !Array.isArray(value.blocks) || value.blocks.length > MAX_BLOCKS) {
    return fail(issue('COMPLETION_DOCUMENT_INVALID', '填写文档结构不完整，请检查原文。'))
  }
  const ids = new Set<string>()
  const detailIds = new Set<string>()
  const version = value.schemaVersion as ResumeCompletionDocument['schemaVersion']
  let count = 0, length = 0
  const issues: CompletionIssue[] = []
  const addId = (id: string, blockId: string) => {
    if (ids.has(id)) issues.push(issue('COMPLETION_ID_DUPLICATED', '填写位置重复，请修复这一行。', blockId))
    ids.add(id)
  }
  const blockKinds = ['heading1', 'heading2', 'heading3', 'paragraph', 'bullet', 'numbered', 'divider', 'blank']
  for (const rawBlock of value.blocks) {
    if (!record(rawBlock) || !shortString(rawBlock.blockId) || !blockKinds.includes(String(rawBlock.kind))
      || typeof rawBlock.prefix !== 'string' || /[\r\n]/u.test(rawBlock.prefix) || rawBlock.prefix.length > 128
      || !Array.isArray(rawBlock.segments) || !validAssociation(rawBlock)) return fail(issue('COMPLETION_DOCUMENT_INVALID', '填写段落结构不完整。'))
    const blockId = rawBlock.blockId
    addId(blockId, blockId)
    length += rawBlock.prefix.length
    const inspect = (segment: unknown, inClaim = false): boolean => {
      count++
      if (!record(segment) || !validAssociation(segment)) return false
      if (validText(segment)) {
        length += segment.markdown.length
        addId(segment.segmentId, blockId)
      } else if ((!inClaim && segment.kind === 'optional_gap_clause' && segment.template !== 'identity_name' && validGap(segment, version))
        || (inClaim && segment.kind === 'required_detail_gap' && segment.template !== 'identity_name' && validGapField(segment, version))
        || (!inClaim && hasLinkedCompletion(version) && segment.kind === 'identity_gap' && segment.template === 'identity_name' && validGapField(segment, version))) {
        const gap = segment as unknown as CompletionGap
        if (version !== 'resume-completion-v1') {
          if (detailIds.has(gap.detailId!)) issues.push(issue('COMPLETION_DETAIL_DUPLICATED', '同一补充信息不能重复填写。', blockId, gap.gapId))
          detailIds.add(gap.detailId!)
        }
        length += gap.prefix.length + gap.suffix.length + gap.label.length + gap.instruction.length + gap.benefit.length
          + gap.candidates.reduce((sum, candidate) => sum + candidate.text.length, 0)
          + (gap.kind === 'optional_gap_clause' ? gap.retainedFacts.reduce((sum, anchor) => sum + anchor.exactText.length, 0) : 0)
          + (gap.fill.state === 'filled' ? gap.fill.value.length : 0)
        addId(gap.gapId, blockId)
      } else if (!inClaim && version !== 'resume-completion-v1' && segment.kind === 'dependent_claim') {
        if (!shortString(segment.claimId) || !Array.isArray(segment.sourceEvidenceIds) || !segment.sourceEvidenceIds.length
          || !segment.sourceEvidenceIds.every(id => shortString(id)) || new Set(segment.sourceEvidenceIds).size !== segment.sourceEvidenceIds.length
          || !Array.isArray(segment.sourceSpans) || !segment.sourceSpans.length || !segment.sourceSpans.every(span => record(span)
            && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end) && Number(span.start) >= 0 && Number(span.end) > Number(span.start)
            && (span.sourceBlockId === undefined || shortString(span.sourceBlockId)))
          || !['metadata_missing', 'context_incomplete', 'conflicted'].includes(String(segment.readiness))
          || !Array.isArray(segment.qualifiers) || !segment.qualifiers.every(q => shortString(q))
          || segment.fillPolicy !== 'all_required' || !Array.isArray(segment.parts) || !segment.parts.length
          || !Array.isArray(segment.requiredGapIds) || !segment.requiredGapIds.length
          || !segment.requiredGapIds.every(id => shortString(id)) || new Set(segment.requiredGapIds).size !== segment.requiredGapIds.length
          || (segment.resolution !== undefined && (!hasLinkedCompletion(version) || !validResolution(segment.resolution)))) return false
        addId(segment.claimId, blockId)
        if (!segment.parts.every(part => inspect(part, true))) return false
        const claim = segment as unknown as ResumeDependentClaim
        const required = claim.parts.filter((part): part is ResumeRequiredDetailGap => part.kind === 'required_detail_gap')
        const text = claim.parts.filter((part): part is ResumeTextSegment => part.kind === 'text').map(part => part.markdown).join('')
        if (!text.trim() || required.length !== claim.requiredGapIds.length || required.some(gap => !claim.requiredGapIds.includes(gap.gapId))
          || claim.qualifiers.some(q => !text.includes(q)) || claim.parts[0]?.kind !== 'text'
          || claim.parts[claim.parts.length - 1]?.kind !== 'text') return false
        length += claim.sourceEvidenceIds.join('').length + claim.qualifiers.join('').length
      } else return false
      return true
    }
    for (const segment of rawBlock.segments) {
      if (!inspect(segment)) return fail(issue('COMPLETION_DOCUMENT_INVALID', '填写片段或依赖关系无效，请恢复这一行。', blockId))
      if (length > MAX_TEXT || count > MAX_SEGMENTS) return fail(issue('COMPLETION_DOCUMENT_TOO_LARGE', '填写文档超过可处理的范围。'))
    }
  }
  if (issues.length) return {ok: false, issues}
  if (value.claimLineage !== undefined) {
    if (!hasLinkedCompletion(version) || !Array.isArray(value.claimLineage) || value.claimLineage.length > MAX_SEGMENTS) return fail(issue('COMPLETION_LINEAGE_INVALID', '声明来源记录无效。'))
    const lineageIds = new Set<string>()
    for (const lineage of value.claimLineage) {
      if (!record(lineage) || !shortString(lineage.claimId) || lineageIds.has(lineage.claimId) || !record(lineage.originalClaim)
        || lineage.originalClaim.claimId !== lineage.claimId || lineage.originalClaim.kind !== 'dependent_claim'
        || (lineage.resolution !== undefined && !validResolution(lineage.resolution))) return fail(issue('COMPLETION_LINEAGE_INVALID', '声明来源记录无效。'))
      lineageIds.add(lineage.claimId)
      // Validate archived groups independently: their IDs may intentionally also exist in the live document.
      const archived: ResumeCompletionDocument = {schemaVersion: 'resume-completion-v3', templateVersion: 'resume-completion-template-v3',
        documentId: 'lineage-check', revision: 0, markdownFingerprint: 'structural-check', blocks: [{blockId: 'lineage-block', kind: 'paragraph', prefix: '', segments: [lineage.originalClaim as unknown as ResumeDependentClaim]}]}
      const checked = validateCompletionDocument(archived)
      if (!checked.ok && checked.issues.some(item => item.code !== 'COMPLETION_MARKDOWN_MISMATCH')) return fail(issue('COMPLETION_LINEAGE_INVALID', '声明来源记录无效。'))
    }
  }
  if (hasLinkedCompletion(version)) {
    const knownClaims = new Set([...(value.claimLineage as ResumeClaimLineage[] | undefined ?? []).map(item => item.claimId),
      ...(value.blocks as ResumeCompletionBlock[]).flatMap(block => block.segments.filter((s): s is ResumeDependentClaim => s.kind === 'dependent_claim').map(s => s.claimId))])
    if ((value.blocks as ResumeCompletionBlock[]).some(block => block.segments.some(s => s.kind === 'text' && s.replacedClaimIds?.some(id => !knownClaims.has(id))))) return fail(issue('COMPLETION_LINEAGE_MISSING', '改写声明缺少原始依赖记录。'))
  }
  const document = value as unknown as ResumeCompletionDocument
  const markdown = serializeDraft(document)
  if (resumeTextFingerprint(markdown) !== document.markdownFingerprint || (expectedMarkdown !== undefined && markdown !== expectedMarkdown)) {
    return fail(issue('COMPLETION_MARKDOWN_MISMATCH', '正文与填写状态不一致，请保留当前正文并修复标记。'))
  }
  return {ok: true, document}
}

export function validateOmissionSafety(document: ResumeCompletionDocument, gapIds?: readonly string[]): CompletionIssue[] {
  const selected = gapIds ? new Set(gapIds) : undefined
  const textNodes = new Map(document.blocks.flatMap(block => block.segments.flatMap(segment => segment.kind === 'text' ? [[segment.segmentId, segment.markdown] as const] : [])))
  const issues: CompletionIssue[] = []
  for (const block of document.blocks) {
    for (const [index, segment] of block.segments.entries()) {
      if (segment.kind !== 'optional_gap_clause' || (selected ? !selected.has(segment.gapId) : segment.fill.state !== 'empty')) continue
      // Each optional clause owns its connector. Adjacent clauses therefore
      // share the same complete fact anchors and remain removable independently.
      let beforeIndex = index - 1, afterIndex = index + 1
      while (block.segments[beforeIndex]?.kind === 'optional_gap_clause') beforeIndex--
      while (block.segments[afterIndex]?.kind === 'optional_gap_clause') afterIndex++
      const before = block.segments[beforeIndex], after = block.segments[afterIndex]
      if (before?.kind !== 'text' || after?.kind !== 'text' || !before.markdown.trim()
        || /[，。；：！？、,;:!?]\s*$/u.test(before.markdown) || !/^[，。；！？,;.!?]/u.test(after.markdown)
        || /(?:针对|围绕|采用|交付|负责|提升至|降低至|从|至|为|达|约)\s*$/u.test(before.markdown)) {
        issues.push(issue('COMPLETION_OMISSION_BOUNDARY_INVALID', '这一处补充的前后文字已改动，请补成完整正文或删去整个补充分句。', block.blockId, segment.gapId))
      }
      if (segment.retainedFacts.some(anchor => !textNodes.get(anchor.textSegmentId)?.includes(anchor.exactText))) {
        issues.push(issue('COMPLETION_RETAINED_FACT_MISSING', '删去此处会丢失仍在分句中的已知数据，请保留相关事实或将该处改成完整正文。', block.blockId, segment.gapId))
      }
    }
    for (const claim of block.segments.filter((segment): segment is ResumeDependentClaim => segment.kind === 'dependent_claim')) {
      const resultFragments = claim.parts.filter((part): part is ResumeTextSegment => part.kind === 'text')
        .flatMap(part => part.markdown.split(/[，。；;！!？?]/u)).map(text => text.trim())
        .filter(text => /\d/u.test(text) && /[\p{L}]/u.test(text))
      if (resultFragments.some(text => block.segments.some(segment => segment.kind === 'text' && segment.markdown.includes(text)))) {
        issues.push(issue('COMPLETION_DEPENDENT_FACT_LEAK', '待补证结果重复出现在普通正文中，请将该结果完整保留在关联字段内。', block.blockId))
      }
      const index = block.segments.indexOf(claim)
      const before = block.segments[index - 1], after = block.segments[index + 1]
      if (before?.kind === 'text' && /(?:针对|围绕|采用|交付|负责|提升至|降低至|从|至|为|达|约)\s*$/u.test(before.markdown)
        || after?.kind === 'text' && after.markdown.trim() && !/^[，。；！？,;.!?]/u.test(after.markdown)
          && before?.kind === 'text' && before.markdown.trim() && !/[。；！？;.!?]\s*$/u.test(before.markdown)) {
        issues.push(issue('COMPLETION_DEPENDENT_BOUNDARY_INVALID', '关联结果删除后正文不能独立成句，请修改分句边界。', block.blockId))
      }
    }
  }
  return issues
}

function cloneDocument(document: ResumeCompletionDocument): ResumeCompletionDocument {
  return JSON.parse(JSON.stringify(document)) as ResumeCompletionDocument
}

function seal(document: ResumeCompletionDocument, revision: number): ResumeCompletionDocument {
  document.revision = revision
  document.markdownFingerprint = resumeTextFingerprint(serializeDraft(document))
  return document
}

export function applyCompletionCommand(document: ResumeCompletionDocument, command: CompletionCommand): CompletionEditResult {
  const checked = validateCompletionDocument(document)
  if (!checked.ok) return checked
  if (!record(command) || !shortString(command.documentId) || !Number.isSafeInteger(command.baseRevision)
    || command.baseRevision < 0 || !shortString(command.gapId) || !['fill', 'clear', 'omit', 'undo'].includes(String(command.type))
    || (command.value !== undefined && (typeof command.value !== 'string' || command.value.length > 6000))) {
    return fail(issue('COMPLETION_COMMAND_INVALID', '填写操作格式无效。'))
  }
  if (command.documentId !== document.documentId || command.baseRevision !== document.revision) {
    return fail(issue('COMPLETION_REVISION_CONFLICT', '简历已更新，请重新打开这个位置再编辑。', undefined, command.gapId))
  }
  let block: ResumeCompletionBlock | undefined
  visitSegments(document, (segment, owner) => {
    if ((segment.kind === 'optional_gap_clause' || segment.kind === 'required_detail_gap' || segment.kind === 'identity_gap') && segment.gapId === command.gapId) block = owner
  })
  const gap = findGap(document, command.gapId)
  if (!gap || !block) return fail(issue('COMPLETION_GAP_NOT_FOUND', '该填写位置已变更，请重新选择。', undefined, command.gapId))
  let fill: GapFill
  if (command.type === 'fill') {
    const value = normalizeGapValue(command.value ?? '')
    if (hasCompletionFragment(value) || value === gap.instruction || value === renderCompletionPlaceholder(gap)) {
      return fail(issue('COMPLETION_VALUE_IS_PLACEHOLDER', '请填写实际内容，或清空以保留待补状态。', block.blockId, gap.gapId))
    }
    fill = value ? {state: 'filled', value, origin: 'user'} : {state: 'empty'}
  } else if (command.type === 'clear') fill = {state: 'empty'}
  else if (command.type === 'omit') fill = {state: 'omitted'}
  else if (command.type === 'undo' && gap.fill.state === 'omitted' && command.previousFill && validFill(command.previousFill)) fill = command.previousFill
  else return fail(issue('COMPLETION_COMMAND_INVALID', '此修改已失效，请重新编辑。', block.blockId, gap.gapId))
  if (JSON.stringify(gap.fill) === JSON.stringify(fill)) return {ok: true, document, changed: false}
  if (fill.state === 'empty' || fill.state === 'omitted') {
    const issues = validateOmissionSafety(document, [gap.gapId])
    if (issues.length) return {ok: false, issues}
  }
  const next = cloneDocument(document)
  const target = findGap(next, gap.gapId)!
  target.fill = fill
  seal(next, document.revision + 1)
  const valid = validateCompletionDocument(next)
  if (!valid.ok) return valid
  return {ok: true, document: next, changed: true, operation: {kind: 'gap', command: {...command}}, ...(command.type === 'omit' ? {undo: {
    type: 'undo' as const, documentId: next.documentId, baseRevision: next.revision, gapId: gap.gapId, previousFill: gap.fill,
  }} : {})}
}

/** Confirmation is a separate audited user decision; filling a value never resolves a claim. */
export function resolveCompletionClaim(document: ResumeCompletionDocument, operation: Extract<CompletionForwardOperation, {kind: 'resolve_claim'}>): CompletionEditResult {
  const checked = validateCompletionDocument(document)
  if (!checked.ok) return checked
  if (document.schemaVersion !== 'resume-completion-v3' || !record(operation) || !shortString(operation.claimId)
    || !validResolution(operation.resolution)) return fail(issue('COMPLETION_RESOLUTION_INVALID', '请提供明确的核对结论和依据。'))
  if (operation.documentId !== document.documentId || operation.baseRevision !== document.revision) return fail(issue('COMPLETION_REVISION_CONFLICT', '简历已更新，请重新核对这项结果。'))
  const next = cloneDocument(document)
  const claim = findClaim(next, operation.claimId)
  const lineage = next.claimLineage?.find(item => item.claimId === operation.claimId)
  if (!claim && !lineage) return fail(issue('COMPLETION_CLAIM_NOT_FOUND', '该结果已变更，无法核对。'))
  if (claim) claim.resolution = {...operation.resolution}
  if (lineage) lineage.resolution = {...operation.resolution}
  seal(next, document.revision + 1)
  return {ok: true, document: next, changed: true, operation}
}

function classifyLine(raw: string): Pick<ResumeCompletionBlock, 'kind' | 'prefix'> & { text: string } {
  const heading = raw.match(/^((#{1,3})[ \t]+)([^\n]*)$/u)
  if (heading) return {kind: `heading${heading[2].length}` as 'heading1' | 'heading2' | 'heading3', prefix: heading[1], text: heading[3]}
  const bullet = raw.match(/^([ \t]*[-*+][ \t]+)([^\n]*)$/u)
  if (bullet) return {kind: 'bullet', prefix: bullet[1], text: bullet[2]}
  const numbered = raw.match(/^([ \t]*\d+\.[ \t]+)([^\n]*)$/u)
  if (numbered) return {kind: 'numbered', prefix: numbered[1], text: numbered[2]}
  return {kind: raw.trim() === '' ? 'blank' : /^\s*-{3,}\s*$/u.test(raw) ? 'divider' : 'paragraph', prefix: '', text: raw}
}

function nextIdFactory(documentId: string, supplied?: () => string): () => string {
  let index = 0
  return supplied ?? (() => `${documentId}:node:${++index}`)
}

export function createPlainCompletionDocument(markdown: string, options: CompletionOptions = {}): ResumeCompletionDocument {
  const documentId = options.documentId ?? `legacy:${resumeTextFingerprint(markdown)}`
  const id = nextIdFactory(documentId, options.idFactory)
  return createCompletionDocument({documentId, blocks: markdown.split('\n').map(raw => {
    const line = classifyLine(raw)
    return {blockId: id(), kind: line.kind, prefix: line.prefix, segments: [{kind: 'text', segmentId: id(), markdown: line.text, origin: 'user'}]}
  })})
}

function unresolvedMarkers(document: ResumeCompletionDocument): CompletionIssue[] {
  const blocks = new Set<string>()
  visitSegments(document, (segment, block) => { if (segment.kind === 'text' && hasCompletionFragment(segment.markdown)) blocks.add(block.blockId) })
  return [...blocks].map(blockId => issue('COMPLETION_MARKER_DAMAGED', '这一行仍有待填写标记，请补成实际内容或删去完整补充分句。', blockId))
}

function legacyGap(marker: string, template: Exclude<GapTemplate, 'metric_detail'>, gapId: string): ResumeGapSegment | undefined {
  const base = COMPLETION_TEMPLATES[template]
  const gap: ResumeGapSegment = {kind: 'optional_gap_clause', gapId, template, ...base, candidates: [], fill: {state: 'empty'}, retainedFacts: []}
  if (marker === renderCompletionPlaceholder(gap)) return gap
  if (template === 'design_deliverable') {
    gap.candidates = ['需求文档', '页面原型', '交互流程'].map(text => ({text, kind: 'category_example'}))
    if (marker === renderCompletionPlaceholder(gap)) return gap
  }
  const source = marker.match(/；可参考“([^”]+)”，须实际适用/u)
  if (source && !['problem', 'research_problem'].includes(template)) {
    const values = source[1].split('/')
    if (values.length <= 3 && values.every(value => /^[\p{L}\p{M} ·-]+$/u.test(value))) {
      gap.candidates = values.map(text => ({text, kind: 'source_reference'}))
      if (marker === renderCompletionPlaceholder(gap)) return gap
    }
  }
  return undefined
}

export function migrateLegacyCompletion(markdown: string, options: CompletionOptions = {}): CompletionLoadResult {
  const document = createPlainCompletionDocument(markdown, options)
  if (markdown.length > MAX_TEXT) return {status: 'repair_required', document, migrated: false, issues: [issue('COMPLETION_DOCUMENT_TOO_LARGE', '简历文本超过可处理的范围。')]}
  let sequence = 0, migrated = false
  const ids = new Set(document.blocks.flatMap(block => [block.blockId, ...block.segments.map(segment => segment.kind === 'text' ? segment.segmentId : segment.kind === 'dependent_claim' ? segment.claimId : segment.gapId)]))
  const nextId = () => {
    let id: string
    do { id = options.idFactory?.() ?? `${document.documentId}:legacy:${++sequence}` } while (ids.has(id) && ++sequence < 100000)
    ids.add(id)
    return id
  }
  for (const block of document.blocks) {
    const text = block.segments.map(segment => renderCompletionSegment(segment)).join('')
    const segments: Array<ResumeTextSegment | ResumeGapSegment> = []
    let cursor = 0
    for (const match of text.matchAll(/【待完善[：:][^\r\n】]*】/gu)) {
      const markerIndex = match.index
      for (const template of Object.keys(COMPLETION_TEMPLATES) as GapTemplate[]) {
        if (template === 'metric_detail') continue
        const base = COMPLETION_TEMPLATES[template]
        const start = markerIndex - base.prefix.length, end = markerIndex + match[0].length + base.suffix.length
        if (start < cursor || text.slice(start, markerIndex) !== base.prefix || text.slice(markerIndex + match[0].length, end) !== base.suffix) continue
        const gap = legacyGap(match[0], template, nextId())
        if (!gap) continue
        segments.push({kind: 'text', segmentId: nextId(), markdown: text.slice(cursor, start), origin: 'user'}, gap)
        cursor = end
        migrated = true
        break
      }
    }
    if (segments.length) {
      segments.push({kind: 'text', segmentId: nextId(), markdown: text.slice(cursor), origin: 'user'})
      block.segments = segments
    }
  }
  seal(document, 0)
  // Legacy text may still contain the exact template after its surrounding clause
  // was edited. Keep unsafe instances as repairable text rather than persisting
  // an invalid empty node that prevents saving a different, repaired row.
  const unsafeGapIds = new Set(validateOmissionSafety(document).flatMap(value => value.gapId ? [value.gapId] : []))
  if (unsafeGapIds.size) {
    for (const block of document.blocks) {
      block.segments = block.segments.map(segment => segment.kind === 'optional_gap_clause' && unsafeGapIds.has(segment.gapId)
        ? {kind: 'text', segmentId: nextId(), markdown: renderCompletionSegment(segment), origin: 'user'} : segment)
    }
    seal(document, 0)
  }
  const checked = validateCompletionDocument(document, markdown)
  const issues = [...(checked.ok ? [] : checked.issues), ...unresolvedMarkers(document), ...validateOmissionSafety(document)]
  return {status: issues.length ? 'repair_required' : 'ready', document, issues, migrated}
}

export function normalizeCompletionDocument(markdown: string, value?: unknown, options: CompletionOptions = {}): CompletionLoadResult {
  if (value === undefined || value === null) return migrateLegacyCompletion(markdown, options)
  const checked = validateCompletionDocument(value, markdown)
  if (!checked.ok) {
    if (!record(value) || value.schemaVersion !== 'resume-completion-v1') {
      const document = createPlainCompletionDocument(markdown, options)
      document.recovery = {rawDocument: value, markdown}
      return {status: 'repair_required', blocked: true, rawDocument: value, document, migrated: false, issues: checked.issues}
    }
    const migrated = migrateLegacyCompletion(markdown, options)
    return {...migrated, status: 'repair_required', issues: [...checked.issues, ...migrated.issues]}
  }
  const issues = [...unresolvedMarkers(checked.document), ...validateOmissionSafety(checked.document)]
  return {status: issues.length ? 'repair_required' : 'ready', document: checked.document, issues, migrated: false}
}

export function beginRowEdit(document: ResumeCompletionDocument, blockId: string): CompletionRowEditSession | undefined {
  if (document.recovery) return undefined
  const block = document.blocks.find(item => item.blockId === blockId)
  if (!block) return undefined
  const tokens: CompletionRowEditSession['tokens'] = []
  const render = (segment: ResumeCompletionSegment | ResumeRequiredDetailGap): string => {
    if (segment.kind === 'dependent_claim') return segment.parts.map(render).join('')
    if ((segment.kind !== 'optional_gap_clause' && segment.kind !== 'required_detail_gap' && segment.kind !== 'identity_gap') || segment.fill.state === 'filled'
      || (segment.kind === 'optional_gap_clause' && segment.fill.state === 'omitted')) return renderCompletionSegment(segment)
    const token = `〔待补 ${tokens.length + 1}：${segment.label}〕`
    tokens.push({token, gapId: segment.gapId})
    return segment.prefix + token + segment.suffix
  }
  const draft = block.prefix + block.segments.map(render).join('')
  return {documentId: document.documentId, baseRevision: document.revision, blockId, draft, originalBlock: JSON.parse(JSON.stringify(block)) as ResumeCompletionBlock, tokens}
}

function occurrences(value: string, needle: string): number[] {
  if (!needle) return []
  const found: number[] = []
  let cursor = 0
  while (cursor <= value.length) {
    const index = value.indexOf(needle, cursor)
    if (index < 0) break
    found.push(index)
    cursor = index + needle.length
  }
  return found
}

function reconcilePlainRowEdit(document: ResumeCompletionDocument, session: CompletionRowEditSession, draft: string, idFactory?: () => string): CompletionEditResult {
  if (document.documentId !== session.documentId || document.revision !== session.baseRevision) return fail(issue('COMPLETION_REVISION_CONFLICT', '简历已更新，请重新打开这一行。', session.blockId))
  const blockIndex = document.blocks.findIndex(block => block.blockId === session.blockId)
  if (blockIndex < 0) return fail(issue('COMPLETION_BLOCK_NOT_FOUND', '这一行已变更，请重新选择。', session.blockId))
  if (draft === session.draft) return {ok: true, document, changed: false}
  if (draft.length > MAX_TEXT) return fail(issue('COMPLETION_DOCUMENT_TOO_LARGE', '本行文字超过可处理范围。', session.blockId))
  let remaining = draft
  const kept: Array<{ start: number; end: number; gap: ResumeGapSegment | ResumeIdentityGap }> = []
  const automaticallyRemoved: ResumeGapSegment[] = []
  const noticeParts: string[] = []
  const gaps = session.originalBlock.segments.filter((segment): segment is ResumeGapSegment | ResumeIdentityGap => segment.kind === 'optional_gap_clause' || segment.kind === 'identity_gap')
  for (const gap of gaps) {
    const token = session.tokens.find(item => item.gapId === gap.gapId)?.token
    if (gap.fill.state === 'omitted') continue
    if (gap.fill.state === 'filled') continue
    if (gap.kind === 'identity_gap') continue
    const positions = token ? occurrences(remaining, token) : []
    if (positions.length > 1) return fail(issue('COMPLETION_TOKEN_DUPLICATED', '同一个填写标记出现多次，请保留一个或改成实际正文。', session.blockId, gap.gapId))
    if (!positions.length) {
      const emptyPositions = occurrences(remaining, gap.prefix).flatMap(index => {
        const afterPrefix = index + gap.prefix.length
        const whitespace = remaining.slice(afterPrefix).match(/^[ \t]*/u)![0].length
        const end = afterPrefix + whitespace + gap.suffix.length
        if (remaining.slice(afterPrefix + whitespace, end) !== gap.suffix) return []
        if (!gap.suffix && end !== remaining.length && !/^[，。；！？,;.!?]/u.test(remaining.slice(end))) return []
        return [{index, end}]
      })
      if (emptyPositions.length > 1) return fail(issue('COMPLETION_OMISSION_BOUNDARY_INVALID', '无法确定应删除哪个补充分句，请修复这一行。', session.blockId, gap.gapId))
      if (emptyPositions.length === 1) {
        const safety = validateOmissionSafety(document, [gap.gapId])
        if (safety.length) return {ok: false, issues: safety}
        const {index, end} = emptyPositions[0]
        remaining = remaining.slice(0, index) + remaining.slice(end)
        automaticallyRemoved.push(gap)
        noticeParts.push('已移除未填补充分句')
      }
    }
  }
  for (const gap of gaps) {
    if (gap.fill.state === 'omitted') continue
    const token = session.tokens.find(item => item.gapId === gap.gapId)?.token
    const content = gap.fill.state === 'empty' ? token : renderCompletionSegment(gap)
    if (!content) continue
    const clause = gap.fill.state === 'empty' ? gap.prefix + content + gap.suffix : content
    const positions = occurrences(remaining, clause)
    const tokenPositions = gap.fill.state === 'empty' ? occurrences(remaining, content) : []
    if (gap.fill.state === 'empty' && tokenPositions.length && positions.length !== 1) return fail(issue('COMPLETION_TOKEN_DAMAGED', '填写标记旁的连接词已改变，请补成完整正文或删除整个补充分句。', session.blockId, gap.gapId))
    if (positions.length === 1) {
      const start = positions[0], end = start + clause.length
      if (/[\r\n]/u.test(remaining.slice(start, end))) return fail(issue('COMPLETION_TOKEN_DAMAGED', '一个空位不能跨行，请将补充分句放在同一行。', session.blockId, gap.gapId))
      if (kept.some(item => start < item.end && end > item.start)) {
        if (gap.fill.state === 'empty') return fail(issue('COMPLETION_TOKEN_DAMAGED', '填写位置重叠，请将这一行改成完整正文。', session.blockId, gap.gapId))
      } else kept.push({start, end, gap})
    }
  }
  let inspected = remaining
  for (const item of [...kept].sort((a, b) => b.start - a.start)) inspected = inspected.slice(0, item.start) + inspected.slice(item.end)
  if (hasCompletionFragment(inspected)) return fail(issue('COMPLETION_TOKEN_DAMAGED', '仍有损坏或未知的填写标记，请补成实际正文或删去完整补充分句。', session.blockId))
  const existingIds = new Set(document.blocks.flatMap(block => [block.blockId, ...block.segments.map(segment => segment.kind === 'text' ? segment.segmentId : segment.kind === 'dependent_claim' ? segment.claimId : segment.gapId)]))
  let sequence = 0
  const nextId = () => {
    let id: string
    do {id = idFactory?.() ?? `${document.documentId}:edit:${document.revision + 1}:${++sequence}`} while (existingIds.has(id) && ++sequence < 100000)
    existingIds.add(id)
    return id
  }
  const oldTexts = session.originalBlock.segments.filter((segment): segment is ResumeTextSegment => segment.kind === 'text')
  const usedOldTextIds = new Set<string>()
  const makeText = (markdown: string): ResumeTextSegment => {
    const same = oldTexts.filter(segment => segment.markdown === markdown && !usedOldTextIds.has(segment.segmentId))
    if (same.length === 1) {usedOldTextIds.add(same[0].segmentId); return {...same[0]}}
    return {kind: 'text', segmentId: nextId(), markdown, origin: 'user'}
  }
  let offset = 0
  const blocks: ResumeCompletionBlock[] = remaining.split('\n').map((raw, index) => {
    const line = classifyLine(raw)
    const start = offset + line.prefix.length, end = offset + raw.length
    const localGaps = kept.filter(item => item.start >= start && item.end <= end).sort((a, b) => a.start - b.start)
    const segments: ResumeCompletionBlock['segments'] = []
    let cursor = start
    for (const item of localGaps) {
      segments.push(makeText(remaining.slice(cursor, item.start)), JSON.parse(JSON.stringify(item.gap)) as ResumeGapSegment | ResumeIdentityGap)
      cursor = item.end
    }
    segments.push(makeText(remaining.slice(cursor, end)))
    offset += raw.length + 1
    return {blockId: index === 0 ? session.blockId : nextId(), kind: line.kind, prefix: line.prefix, segments,
      ...(session.originalBlock.unitId ? {unitId: session.originalBlock.unitId} : {}),
      ...(session.originalBlock.actionIds ? {actionIds: [...session.originalBlock.actionIds]} : {})}
  })
  const next = cloneDocument(document)
  next.blocks.splice(blockIndex, 1, ...blocks)
  if (hasLinkedCompletion(document)) {
    const inherited = [...new Set(oldTexts.flatMap(segment => segment.replacedClaimIds ?? []))]
    if (inherited.length) for (const block of blocks) for (const segment of block.segments) if (segment.kind === 'text' && segment.markdown.trim()) {
      segment.replacedClaimIds = [...new Set([...(segment.replacedClaimIds ?? []), ...inherited])]
    }
  }
  // A user may delete both a baseline and its token in one row edit. The original
  // document was safe, but the current removal must still preserve that baseline.
  for (const gap of automaticallyRemoved) for (const anchor of gap.retainedFacts) {
    const oldAnchorWasEdited = oldTexts.some(segment => segment.segmentId === anchor.textSegmentId)
    const texts = (oldAnchorWasEdited ? blocks : next.blocks).flatMap(block => block.segments.filter((segment): segment is ResumeTextSegment => segment.kind === 'text'))
    if (!texts.some(segment => (oldAnchorWasEdited || segment.segmentId === anchor.textSegmentId) && segment.markdown.includes(anchor.exactText))) {
      return fail(issue('COMPLETION_RETAINED_FACT_MISSING', '删除空位后这项已知数据也会消失，请将相关内容改成完整正文或明确删除完整分句。', session.blockId, gap.gapId))
    }
  }
  // Exact retained snippets may stay valid after a surrounding text segment was split.
  for (const block of next.blocks) for (const gap of block.segments) {
    if (gap.kind !== 'optional_gap_clause' || gap.fill.state !== 'empty') continue
    for (const anchor of gap.retainedFacts) {
      if (next.blocks.some(item => item.segments.some(segment => segment.kind === 'text' && segment.segmentId === anchor.textSegmentId && segment.markdown.includes(anchor.exactText)))) continue
      const candidates = blocks.flatMap(item => item.segments.filter((segment): segment is ResumeTextSegment => segment.kind === 'text' && segment.markdown.includes(anchor.exactText)))
      if (candidates.length === 1) anchor.textSegmentId = candidates[0].segmentId
    }
  }
  seal(next, document.revision + 1)
  const valid = validateCompletionDocument(next)
  if (!valid.ok) return valid
  const previousSafety = new Set(validateOmissionSafety(document).map(item => `${item.code}:${item.blockId}:${item.gapId}`))
  const editedBlocks = new Set(blocks.map(block => block.blockId))
  const safety = validateOmissionSafety(next).filter(item => editedBlocks.has(item.blockId ?? '')
    || !previousSafety.has(`${item.code}:${item.blockId}:${item.gapId}`))
  if (safety.length) return {ok: false, issues: safety}
  return {ok: true, document: next, changed: true,
    operation: {kind: 'row', documentId: document.documentId, baseRevision: document.revision, blockId: session.blockId, draft},
    ...(noticeParts.length ? {notice: [...new Set(noticeParts)].join('；')} : {})}
}

const regexLiteral = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/** Preserve dependency groups through ordinary row editing; ambiguous partial rewrites fail closed. */
export function reconcileRowEdit(document: ResumeCompletionDocument, session: CompletionRowEditSession, draft: string, idFactory?: () => string): CompletionEditResult {
  if (document.recovery) return fail(issue('COMPLETION_RECOVERY_BLOCKED', '请先恢复原始填写文档。'))
  if (document.documentId !== session.documentId || document.revision !== session.baseRevision) return fail(issue('COMPLETION_REVISION_CONFLICT', '简历已更新，请重新打开这一行。', session.blockId))
  const original = document.blocks.find(block => block.blockId === session.blockId)
  if (!original) return fail(issue('COMPLETION_BLOCK_NOT_FOUND', '这一行已变更，请重新选择。', session.blockId))
  if (JSON.stringify(original) !== JSON.stringify(session.originalBlock)) return fail(issue('COMPLETION_ROW_BASE_MISMATCH', '行编辑的原始结构已变化，请重新打开。', session.blockId))
  const claims = original.segments.filter((segment): segment is ResumeDependentClaim => segment.kind === 'dependent_claim')
  if (!claims.length) return reconcilePlainRowEdit(document, session, draft, idFactory)
  if (draft === session.draft) return {ok: true, document, changed: false}
  let protectedDraft = draft
  const restored = new Map<string, ResumeDependentClaim>()
  const removed: ResumeDependentClaim[] = []
  const surrogates = new Map(claims.map(claim => [claim.claimId, `⟦关联结果:${claim.claimId}⟧`]))
  if ([...surrogates.values()].some(marker => draft.includes(marker))) return fail(issue('COMPLETION_TOKEN_DAMAGED', '正文包含内部关联标记，请删除后重试。', session.blockId))
  for (const claim of claims) {
    const required = claim.parts.filter((part): part is ResumeRequiredDetailGap => part.kind === 'required_detail_gap')
    const pattern = claim.parts.map(part => part.kind === 'text' ? regexLiteral(part.markdown)
      : `${regexLiteral(part.prefix)}([^\\r\\n]*?)${regexLiteral(part.suffix)}`).join('')
    const matches = [...protectedDraft.matchAll(new RegExp(pattern, 'gu'))]
    if (matches.length > 1) return fail(issue('COMPLETION_TOKEN_DUPLICATED', '同一关联结果出现多次，请保留一处。', session.blockId))
    if (matches.length === 1) {
      const match = matches[0]
      const nextClaim = JSON.parse(JSON.stringify(claim)) as ResumeDependentClaim
      for (let index = 0; index < required.length; index++) {
        const field = nextClaim.parts.find((part): part is ResumeRequiredDetailGap => part.kind === 'required_detail_gap' && part.gapId === required[index].gapId)!
        const token = session.tokens.find(item => item.gapId === field.gapId)?.token
        const value = normalizeGapValue(match[index + 1])
        if (value === token) continue
        if (!value) field.fill = {state: 'empty'}
        else {
          if (hasCompletionFragment(value) || value === field.instruction) return fail(issue('COMPLETION_TOKEN_DAMAGED', '关联结果中有未正确填写的标记。', session.blockId, field.gapId))
          const previous = field.fill.state === 'filled' ? escapeCompletionValue(field.fill.value) : undefined
          if (value !== previous) field.fill = {state: 'filled', value, origin: 'user'}
        }
      }
      const marker = surrogates.get(claim.claimId)!
      protectedDraft = protectedDraft.slice(0, match.index) + marker + protectedDraft.slice(match.index! + match[0].length)
      restored.set(marker, nextClaim)
      continue
    }
    const parts = claim.parts.filter((part): part is ResumeTextSegment => part.kind === 'text')
    const outside = original.segments.filter(segment => segment !== claim).map(segment => renderCompletionSegment(segment)).join('')
    const anchors = parts.flatMap(part => part.markdown.split(/[，。；;！？!?]/u)).map(value => value.trim()).filter(Boolean)
    const numbers = parts.flatMap(part => part.markdown.match(/\d+(?:[,.]\d+)*(?:%|％)?/gu) ?? []).filter(value => !outside.includes(value))
    if (required.some(field => protectedDraft.includes(session.tokens.find(item => item.gapId === field.gapId)?.token ?? '\u0000'))
      || anchors.some(anchor => !outside.includes(anchor) && protectedDraft.includes(anchor))
      || numbers.some(number => protectedDraft.includes(number))) {
      return fail(issue('COMPLETION_DEPENDENT_EDIT_AMBIGUOUS', '关联结果只改动了一部分，无法确认必要口径是否保留。请填写原字段，或完整删除、重写整条结果。', session.blockId))
    }
    removed.push(claim)
  }
  const surrogateDocument = cloneDocument(document)
  const surrogateBlock = surrogateDocument.blocks.find(block => block.blockId === session.blockId)!
  surrogateBlock.segments = surrogateBlock.segments.map(segment => segment.kind === 'dependent_claim'
    ? {kind: 'text', segmentId: `${segment.claimId}:row-protected`, markdown: surrogates.get(segment.claimId)!, origin: 'generated'} : segment)
  seal(surrogateDocument, document.revision)
  const surrogateSession = beginRowEdit(surrogateDocument, session.blockId)!
  const tokenReplacements = session.tokens.flatMap(token => {
    const replacement = surrogateSession.tokens.find(item => item.gapId === token.gapId)
    return replacement && replacement.token !== token.token ? [{from: token.token, to: replacement.token}] : []
  })
  for (const [index, replacement] of tokenReplacements.entries()) protectedDraft = protectedDraft.split(replacement.from).join(`⟦保留字段:${index}⟧`)
  for (const [index, replacement] of tokenReplacements.entries()) protectedDraft = protectedDraft.split(`⟦保留字段:${index}⟧`).join(replacement.to)
  const edited = reconcilePlainRowEdit(surrogateDocument, surrogateSession, protectedDraft, idFactory)
  if (!edited.ok) return edited
  const next = edited.document
  if (hasLinkedCompletion(document) && removed.length) {
    next.claimLineage = [...(document.claimLineage ?? [])]
    for (const claim of removed) if (!next.claimLineage.some(item => item.claimId === claim.claimId)) {
      next.claimLineage.push({claimId: claim.claimId, originalClaim: JSON.parse(JSON.stringify(claim)) as ResumeDependentClaim,
        ...(claim.resolution ? {resolution: {...claim.resolution}} : {})})
    }
  }
  for (const block of next.blocks) {
    block.segments = block.segments.flatMap((segment): ResumeCompletionSegment[] => {
      if (segment.kind !== 'text') return [segment]
      const matches = [...restored.keys()].flatMap(marker => occurrences(segment.markdown, marker).map(start => ({marker, start}))).sort((a, b) => a.start - b.start)
      if (!matches.length) {
        if (removed.length && segment.origin === 'user') return [{...segment, replacedClaimIds: removed.map(claim => claim.claimId)}]
        return [segment]
      }
      const parts: ResumeCompletionSegment[] = []
      let offset = 0
      for (const [index, match] of matches.entries()) {
        if (match.start > offset) parts.push({...segment, segmentId: `${segment.segmentId}:before:${index}`, markdown: segment.markdown.slice(offset, match.start)})
        parts.push(restored.get(match.marker)!)
        offset = match.start + match.marker.length
      }
      if (offset < segment.markdown.length) parts.push({...segment, segmentId: `${segment.segmentId}:after`, markdown: segment.markdown.slice(offset)})
      return parts
    })
  }
  seal(next, document.revision + 1)
  const checked = validateCompletionDocument(next)
  if (!checked.ok) return checked
  const issues = validateOmissionSafety(next)
  if (issues.length) return {ok: false, issues}
  return {ok: true, document: next, changed: true, operation: {kind: 'row', documentId: document.documentId,
    baseRevision: document.revision, blockId: session.blockId, draft},
    ...(removed.length ? {notice: '已移除原关联结果；新写入的文字按用户正文保存'} : {})}
}

export function replayCompletionOperation(document: ResumeCompletionDocument, operation: CompletionOperation): CompletionEditResult {
  const checked = validateCompletionDocument(document)
  if (!checked.ok) return checked
  if (!record(operation) || !['gap', 'row', 'restore', 'resolve_claim'].includes(String(operation.kind))) return fail(issue('COMPLETION_OPERATION_INVALID', '编辑操作格式无效。'))
  if (operation.kind === 'gap') return applyCompletionCommand(document, operation.command)
  if (operation.kind === 'resolve_claim') return resolveCompletionClaim(document, operation)
  if (!shortString(operation.documentId) || !Number.isSafeInteger(operation.baseRevision) || operation.baseRevision < 0) {
    return fail(issue('COMPLETION_OPERATION_INVALID', '编辑操作缺少原始版本。'))
  }
  if (operation.documentId !== document.documentId || operation.baseRevision !== document.revision) return fail(issue('COMPLETION_REVISION_CONFLICT', '简历已更新，无法重放旧编辑。'))
  if (operation.kind === 'restore') {
    if (!record(operation.operation) || !['gap', 'row', 'resolve_claim'].includes(String(operation.operation.kind))) return fail(issue('COMPLETION_RESTORE_INVALID', '只能撤回一次明确的编辑操作。'))
    const forward = replayCompletionOperation(operation.previousDocument, operation.operation)
    if (!forward.ok || JSON.stringify(forward.document) !== JSON.stringify(document)) return fail(issue('COMPLETION_RESTORE_INVALID', '无法核对要撤回的编辑，原稿已保留。'))
    const next = seal(cloneDocument(operation.previousDocument), document.revision + 1)
    return {ok: true, document: next, changed: true, operation}
  }
  if (!shortString(operation.blockId) || typeof operation.draft !== 'string' || operation.draft.length > MAX_TEXT) {
    return fail(issue('COMPLETION_OPERATION_INVALID', '整行编辑内容无效。'))
  }
  const session = beginRowEdit(document, operation.blockId)
  if (!session) return fail(issue('COMPLETION_BLOCK_NOT_FOUND', '原始编辑行不存在。', operation.blockId))
  return reconcileRowEdit(document, session, operation.draft)
}

export function prepareResumeExport(document: ResumeCompletionDocument, expectedMarkdown?: string): CompletionExportResult {
  const checked = validateCompletionDocument(document, expectedMarkdown)
  if (!checked.ok) return checked
  const issues = [...unresolvedMarkers(document), ...validateOmissionSafety(document)]
  if (issues.length) return {ok: false, issues}
  let omittedCount = 0
  let omittedClaimCount = 0
  const omittedGapIds: string[] = [], omittedClaimIds: string[] = [], exportedUnitIds: string[] = [], excludedBlockIds: string[] = []
  const markdown = document.blocks.flatMap(block => {
    const content = block.segments.map(segment => {
      if ((segment.kind === 'optional_gap_clause' || segment.kind === 'identity_gap') && segment.fill.state !== 'filled') {
        if (segment.fill.state === 'empty') omittedCount++
        omittedGapIds.push(segment.gapId)
      }
      if (segment.kind === 'dependent_claim' && !dependentClaimExportable(segment, document.schemaVersion)) {
        omittedClaimCount++; omittedClaimIds.push(segment.claimId)
        omittedGapIds.push(...segment.requiredGapIds.filter(id => findGap(document, id)?.fill.state !== 'filled'))
        return ''
      }
      if (hasLinkedCompletion(document) && segment.kind === 'text' && segment.replacedClaimIds?.some(id => {
        const lineage = document.claimLineage?.find(item => item.claimId === id)
        return isCompletionV4(document) ? (lineage?.resolution?.state ?? lineage?.originalClaim.resolution?.state) === 'rejected'
          : lineage?.resolution?.state !== 'confirmed'
      })) {
        omittedClaimIds.push(...segment.replacedClaimIds)
        return ''
      }
      if (segment.unitId) exportedUnitIds.push(segment.unitId)
      return renderCompletionSegment(segment, 'export')
    }).join('')
    if (hasStructuredCompletion(document) && !content.trim() && block.kind !== 'blank' && block.kind !== 'divider') { excludedBlockIds.push(block.blockId); return [] }
    if (block.unitId && content.trim()) exportedUnitIds.push(block.unitId)
    return [block.prefix + content]
  }).join('\n')
  if (markerPattern.test(markdown) || hasCompletionFragment(markdown)) return fail(issue('COMPLETION_EXPORT_MARKER_REMAINING', '导出内容仍有填写标记，请修复后下载。'))
  return {ok: true, markdown, omittedCount, ...(hasStructuredCompletion(document) ? {omittedClaimCount: hasLinkedCompletion(document) ? new Set(omittedClaimIds).size : omittedClaimCount} : {}),
    ...(hasLinkedCompletion(document) ? {omittedGapIds: [...new Set(omittedGapIds)], omittedClaimIds: [...new Set(omittedClaimIds)],
      exportedUnitIds: [...new Set(exportedUnitIds)], excludedBlockIds, identityMissing: collectGaps(document).some(g => g.kind === 'identity_gap') && !completionIdentityName(document),
      plainTextDigest: resumeTextFingerprint(markdown)} : {})}
}
