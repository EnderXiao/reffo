import { resumeTextFingerprint } from './resume-strategy'

export type FiveElement = 'responsibility' | 'project' | 'problem' | 'solution' | 'result'
export type GapTemplate = 'problem' | 'research_problem' | 'method' | 'role_detail' | 'project_name' | 'design_deliverable' | 'metric_detail'
export type GapFill = { state: 'empty' } | { state: 'filled'; value: string; origin: 'user' } | { state: 'omitted' }
export interface ResumeTextSegment { kind: 'text'; segmentId: string; markdown: string; origin: 'generated' | 'user' }
export interface ResumeGapSegment {
  kind: 'optional_gap_clause'
  gapId: string
  element: FiveElement
  template: GapTemplate
  prefix: string
  suffix: string
  label: string
  instruction: string
  benefit: string
  candidates: Array<{ text: string; kind: 'source_reference' | 'category_example' }>
  fill: GapFill
  retainedFacts: Array<{ textSegmentId: string; exactText: string }>
}
export interface ResumeCompletionBlock {
  blockId: string
  kind: 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullet' | 'numbered' | 'divider' | 'blank'
  prefix: string
  segments: Array<ResumeTextSegment | ResumeGapSegment>
}
export interface ResumeCompletionDocument {
  schemaVersion: 'resume-completion-v1'
  templateVersion: 'resume-completion-template-v1'
  documentId: string
  revision: number
  markdownFingerprint: string
  blocks: ResumeCompletionBlock[]
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
export type CompletionEditResult = { ok: true; document: ResumeCompletionDocument; changed: boolean; undo?: CompletionCommand; notice?: string }
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
}
export interface CompletionOptions { documentId?: string; idFactory?: () => string }
export type CompletionExportResult = { ok: true; markdown: string; omittedCount: number } | { ok: false; issues: CompletionIssue[] }

export const COMPLETION_TEMPLATES = {
  problem: { element: 'problem', prefix: '，针对', suffix: '的问题', label: '实际业务问题', instruction: '填一项实际业务问题', benefit: '使方案对应的痛点明确' },
  research_problem: { element: 'problem', prefix: '，围绕', suffix: '这一研究问题', label: '实际研究问题', instruction: '填一项实际研究过的使用问题', benefit: '使研究对象更具体' },
  method: { element: 'solution', prefix: '，采用', suffix: '的方法', label: '实际方法或规则', instruction: '填一种实际采用的方法或规则', benefit: '说明实际解决路径' },
  role_detail: { element: 'responsibility', prefix: '，本人承担的具体工作为', suffix: '', label: '本人具体工作', instruction: '填一项本人实际承担的工作环节', benefit: '明确个人分工' },
  project_name: { element: 'project', prefix: '，具体项目为', suffix: '', label: '真实项目或模块', instruction: '填真实项目或模块名称', benefit: '明确实践对象' },
  design_deliverable: { element: 'result', prefix: '，交付设计产物', suffix: '', label: '实际交付名称', instruction: '填实际交付的设计产物名称', benefit: '补明具体产出' },
  metric_detail: { element: 'result', prefix: '，', suffix: '', label: '指标缺失项', instruction: '补一个已有对比记录中缺失的数值、单位或月份', benefit: '补全可核对的指标口径' },
} as const

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

export function renderCompletionPlaceholder(gap: ResumeGapSegment): string {
  const references = gap.candidates.some(candidate => candidate.kind === 'category_example')
    ? `；类别示例“${gap.candidates.filter(candidate => candidate.kind === 'category_example').map(candidate => candidate.text).join('/')}”，可组合且须确实完成`
    : gap.candidates.length ? `；可参考“${gap.candidates.map(candidate => candidate.text).join('/')}”，须实际适用` : ''
  return `【待完善：${gap.instruction}${references}；${gap.benefit}；无法确认时删去“${gap.prefix}……${gap.suffix}”分句】`
}

export function renderCompletionSegment(segment: ResumeTextSegment | ResumeGapSegment, mode: 'draft' | 'export' | 'facts' = 'draft'): string {
  if (segment.kind === 'text') return segment.markdown
  if (mode === 'facts' || segment.fill.state === 'omitted') return ''
  if (segment.fill.state === 'filled') return segment.prefix + escapeCompletionValue(segment.fill.value) + segment.suffix
  return mode === 'export' ? '' : segment.prefix + renderCompletionPlaceholder(segment) + segment.suffix
}

export function serializeDraft(document: ResumeCompletionDocument): string {
  return document.blocks.map(block => block.prefix + block.segments.map(segment => renderCompletionSegment(segment)).join('')).join('\n')
}

export function serializeWithoutAllGapClauses(document: ResumeCompletionDocument): string {
  return document.blocks.map(block => block.prefix + block.segments.map(segment => renderCompletionSegment(segment, 'facts')).join('')).join('\n')
}

export function createCompletionDocument(input: { documentId: string; blocks: ResumeCompletionBlock[]; revision?: number }): ResumeCompletionDocument {
  const document: ResumeCompletionDocument = {schemaVersion: 'resume-completion-v1', templateVersion: 'resume-completion-template-v1',
    documentId: input.documentId, revision: input.revision ?? 0, markdownFingerprint: '', blocks: input.blocks}
  document.markdownFingerprint = resumeTextFingerprint(serializeDraft(document))
  return document
}

function validFill(value: unknown): value is GapFill {
  if (!record(value)) return false
  if (value.state === 'empty' || value.state === 'omitted') return value.value === undefined && value.origin === undefined
  return value.state === 'filled' && value.origin === 'user' && shortString(value.value, 6000)
    && normalizeGapValue(value.value) === value.value && value.value.length > 0 && !hasCompletionFragment(value.value)
}

function validGap(value: Record<string, unknown>): value is Record<string, unknown> & ResumeGapSegment {
  if (!shortString(value.gapId) || typeof value.template !== 'string' || !Object.prototype.hasOwnProperty.call(COMPLETION_TEMPLATES, value.template)) return false
  const template = COMPLETION_TEMPLATES[value.template as GapTemplate]
  if (value.element !== template.element || !shortString(value.prefix, 1024) || typeof value.suffix !== 'string'
    || value.suffix.length > 1024 || /[\r\n【】<>]/u.test(value.prefix + value.suffix)
    || !shortString(value.label) || !shortString(value.instruction, 1024) || !shortString(value.benefit, 1024)
    || /[【】]/u.test(`${value.label}${value.instruction}${value.benefit}`) || !validFill(value.fill)
    || !Array.isArray(value.candidates) || value.candidates.length > 3 || !Array.isArray(value.retainedFacts) || value.retainedFacts.length > 64) return false
  if (value.template !== 'metric_detail' && (value.prefix !== template.prefix || value.suffix !== template.suffix)) return false
  if (value.template === 'metric_detail' && (!value.prefix.startsWith('，') || value.retainedFacts.length === 0)) return false
  if (!value.candidates.every(candidate => record(candidate) && ['source_reference', 'category_example'].includes(String(candidate.kind))
    && shortString(candidate.text, 96) && !/[【】“”]/u.test(candidate.text))) return false
  if (!value.retainedFacts.every(anchor => record(anchor) && shortString(anchor.textSegmentId) && shortString(anchor.exactText, 6000))) return false
  return true
}

export function validateCompletionDocument(value: unknown, expectedMarkdown?: string): CompletionValidationResult {
  if (!record(value) || value.schemaVersion !== 'resume-completion-v1' || value.templateVersion !== 'resume-completion-template-v1') {
    return fail(issue('COMPLETION_VERSION_UNSUPPORTED', '填写文档版本不受支持，请在对应行修复原文。'))
  }
  if (!shortString(value.documentId) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !shortString(value.markdownFingerprint) || !Array.isArray(value.blocks) || value.blocks.length > MAX_BLOCKS) {
    return fail(issue('COMPLETION_DOCUMENT_INVALID', '填写文档结构不完整，请检查原文。'))
  }
  const ids = new Set<string>()
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
      || !Array.isArray(rawBlock.segments)) return fail(issue('COMPLETION_DOCUMENT_INVALID', '填写段落结构不完整。'))
    addId(rawBlock.blockId, rawBlock.blockId)
    length += rawBlock.prefix.length
    for (const segment of rawBlock.segments) {
      count++
      if (count > MAX_SEGMENTS) return fail(issue('COMPLETION_DOCUMENT_TOO_LARGE', '填写文档超过可处理的范围。'))
      if (!record(segment)) return fail(issue('COMPLETION_DOCUMENT_INVALID', '填写片段结构不完整。', rawBlock.blockId))
      if (segment.kind === 'text' && shortString(segment.segmentId) && typeof segment.markdown === 'string'
        && !/\n/u.test(segment.markdown) && ['generated', 'user'].includes(String(segment.origin))) {
        length += segment.markdown.length
        addId(segment.segmentId, rawBlock.blockId)
      } else if (segment.kind === 'optional_gap_clause' && validGap(segment)) {
        length += segment.prefix.length + segment.suffix.length + segment.label.length + segment.instruction.length + segment.benefit.length
          + segment.candidates.reduce((sum, candidate) => sum + candidate.text.length, 0)
          + segment.retainedFacts.reduce((sum, anchor) => sum + anchor.exactText.length, 0)
          + (segment.fill.state === 'filled' ? segment.fill.value.length : 0)
        addId(segment.gapId, rawBlock.blockId)
      } else return fail(issue('COMPLETION_DOCUMENT_INVALID', '填写片段或空位状态无效，请修复这一行。', rawBlock.blockId, typeof segment.gapId === 'string' ? segment.gapId : undefined))
      if (length > MAX_TEXT) return fail(issue('COMPLETION_DOCUMENT_TOO_LARGE', '填写文档超过可处理的范围。'))
    }
  }
  if (issues.length) return {ok: false, issues}
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
      const before = block.segments[index - 1], after = block.segments[index + 1]
      if (before?.kind !== 'text' || after?.kind !== 'text' || !before.markdown.trim()
        || /[，。；：！？、,;:!?]\s*$/u.test(before.markdown) || !/^[，。；！？,;.!?]/u.test(after.markdown)
        || /(?:针对|围绕|采用|交付|负责|提升至|降低至|从|至|为|达|约)\s*$/u.test(before.markdown)) {
        issues.push(issue('COMPLETION_OMISSION_BOUNDARY_INVALID', '这一处补充的前后文字已改动，请补成完整正文或删去整个补充分句。', block.blockId, segment.gapId))
      }
      if (segment.retainedFacts.some(anchor => !textNodes.get(anchor.textSegmentId)?.includes(anchor.exactText))) {
        issues.push(issue('COMPLETION_RETAINED_FACT_MISSING', '删去此处会丢失仍在分句中的已知数据，请保留相关事实或将该处改成完整正文。', block.blockId, segment.gapId))
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
  if (command.documentId !== document.documentId || command.baseRevision !== document.revision) {
    return fail(issue('COMPLETION_REVISION_CONFLICT', '简历已更新，请重新打开这个位置再编辑。', undefined, command.gapId))
  }
  const block = document.blocks.find(item => item.segments.some(segment => segment.kind === 'optional_gap_clause' && segment.gapId === command.gapId))
  const gap = block?.segments.find((segment): segment is ResumeGapSegment => segment.kind === 'optional_gap_clause' && segment.gapId === command.gapId)
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
  const target = next.blocks.flatMap(item => item.segments).find((segment): segment is ResumeGapSegment => segment.kind === 'optional_gap_clause' && segment.gapId === gap.gapId)!
  target.fill = fill
  seal(next, document.revision + 1)
  const valid = validateCompletionDocument(next)
  if (!valid.ok) return valid
  return {ok: true, document: next, changed: true, ...(command.type === 'omit' ? {undo: {
    type: 'undo' as const, documentId: next.documentId, baseRevision: next.revision, gapId: gap.gapId, previousFill: gap.fill,
  }} : {})}
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
  return document.blocks.flatMap(block => block.segments.some(segment => segment.kind === 'text' && hasCompletionFragment(segment.markdown))
    ? [issue('COMPLETION_MARKER_DAMAGED', '这一行仍有待填写标记，请补成实际内容或删去完整补充分句。', block.blockId)] : [])
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
  const ids = new Set(document.blocks.flatMap(block => [block.blockId, ...block.segments.map(segment => segment.kind === 'text' ? segment.segmentId : segment.gapId)]))
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
    const migrated = migrateLegacyCompletion(markdown, options)
    return {...migrated, status: 'repair_required', issues: [...checked.issues, ...migrated.issues]}
  }
  const issues = [...unresolvedMarkers(checked.document), ...validateOmissionSafety(checked.document)]
  return {status: issues.length ? 'repair_required' : 'ready', document: checked.document, issues, migrated: false}
}

export function beginRowEdit(document: ResumeCompletionDocument, blockId: string): CompletionRowEditSession | undefined {
  const block = document.blocks.find(item => item.blockId === blockId)
  if (!block) return undefined
  const tokens: CompletionRowEditSession['tokens'] = []
  const draft = block.prefix + block.segments.map(segment => {
    if (segment.kind !== 'optional_gap_clause' || segment.fill.state !== 'empty') return renderCompletionSegment(segment)
    const token = `〔待补 ${tokens.length + 1}：${segment.label}〕`
    tokens.push({token, gapId: segment.gapId})
    return segment.prefix + token + segment.suffix
  }).join('')
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

export function reconcileRowEdit(document: ResumeCompletionDocument, session: CompletionRowEditSession, draft: string, idFactory?: () => string): CompletionEditResult {
  if (document.documentId !== session.documentId || document.revision !== session.baseRevision) return fail(issue('COMPLETION_REVISION_CONFLICT', '简历已更新，请重新打开这一行。', session.blockId))
  const blockIndex = document.blocks.findIndex(block => block.blockId === session.blockId)
  if (blockIndex < 0) return fail(issue('COMPLETION_BLOCK_NOT_FOUND', '这一行已变更，请重新选择。', session.blockId))
  if (draft === session.draft) return {ok: true, document, changed: false}
  if (draft.length > MAX_TEXT) return fail(issue('COMPLETION_DOCUMENT_TOO_LARGE', '本行文字超过可处理范围。', session.blockId))
  let remaining = draft
  const kept: Array<{ start: number; end: number; gap: ResumeGapSegment }> = []
  const automaticallyRemoved: ResumeGapSegment[] = []
  const noticeParts: string[] = []
  const gaps = session.originalBlock.segments.filter((segment): segment is ResumeGapSegment => segment.kind === 'optional_gap_clause')
  for (const gap of gaps) {
    const token = session.tokens.find(item => item.gapId === gap.gapId)?.token
    if (gap.fill.state === 'omitted') continue
    if (gap.fill.state === 'filled') continue
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
  const existingIds = new Set(document.blocks.flatMap(block => [block.blockId, ...block.segments.map(segment => segment.kind === 'text' ? segment.segmentId : segment.gapId)]))
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
      segments.push(makeText(remaining.slice(cursor, item.start)), JSON.parse(JSON.stringify(item.gap)) as ResumeGapSegment)
      cursor = item.end
    }
    segments.push(makeText(remaining.slice(cursor, end)))
    offset += raw.length + 1
    return {blockId: index === 0 ? session.blockId : nextId(), kind: line.kind, prefix: line.prefix, segments}
  })
  const next = cloneDocument(document)
  next.blocks.splice(blockIndex, 1, ...blocks)
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
  return {ok: true, document: next, changed: true, ...(noticeParts.length ? {notice: [...new Set(noticeParts)].join('；')} : {})}
}

export function prepareResumeExport(document: ResumeCompletionDocument, expectedMarkdown?: string): CompletionExportResult {
  const checked = validateCompletionDocument(document, expectedMarkdown)
  if (!checked.ok) return checked
  const issues = [...unresolvedMarkers(document), ...validateOmissionSafety(document)]
  if (issues.length) return {ok: false, issues}
  let omittedCount = 0
  const markdown = document.blocks.map(block => block.prefix + block.segments.map(segment => {
    if (segment.kind === 'optional_gap_clause' && segment.fill.state === 'empty') omittedCount++
    return renderCompletionSegment(segment, 'export')
  }).join('')).join('\n')
  if (markerPattern.test(markdown) || hasCompletionFragment(markdown)) return fail(issue('COMPLETION_EXPORT_MARKER_REMAINING', '导出内容仍有填写标记，请修复后下载。'))
  return {ok: true, markdown, omittedCount}
}
