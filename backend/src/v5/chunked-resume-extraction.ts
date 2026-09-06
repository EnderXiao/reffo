import type { CanonicalSourceDocument, ResumeExtractionCandidate, SourceBlock } from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'

export const DEFAULT_RESUME_EXTRACTION_CONCURRENCY = 2
export const RESUME_EXTRACTION_INITIAL_REPAIR_RATIO = 0.2
export const RESUME_EXTRACTION_MAX_REPAIR_RATIO = 0.5
// Block count is a transport packing target. Only the small timeline-anchor
// prefix may exceed it so organization/role/date metadata stays indivisible.
export const DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS = 24
export const DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS = 1_000
export const DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS = 15_500
export const RESUME_EXTRACTION_OUTPUT_TOKEN_BASE = 1_200
export const RESUME_EXTRACTION_OUTPUT_TOKENS_PER_FACT = 400
export const RESUME_EXTRACTION_OUTPUT_CHARACTERS_PER_TOKEN = 4
export const RESUME_EXTRACTION_FACT_CANDIDATE_HEADROOM = 4
export const RESUME_EXTRACTION_RAW_FACT_SLOP_MAX = 16
export const RESUME_EXTRACTION_CHUNK_PLAN_VERSION = 'deterministic-scope-plan-v9'

export interface ResumeExtractionScopeContext {
  /** Server-owned scope ID shared by every output shard of one source scope. */
  serverScopeLocalId: string
  /** Minimal timeline anchor. These blocks are read-only context, not output targets. */
  blocks: CanonicalSourceDocument['blocks']
  /** Complete membership is explicit so a target-only chunk can verify ownership. */
  scopeMemberBlockIds?: string[]
  /** Contiguous metadata prefix that must stay together in the anchor shard. */
  timelineAnchorBlockIds?: string[]
}

export interface ResumeExtractionScopeAssignment {
  serverScopeLocalId: string
  /** Output targets in this transport chunk. */
  sourceBlockIds: string[]
  /** Complete semantic scope; unlike sourceBlockIds this does not shrink per shard. */
  scopeMemberBlockIds?: string[]
  /** Server-planned timeline metadata prefix for this semantic scope. */
  timelineAnchorBlockIds?: string[]
}

export interface ResumeExtractionChunk extends CanonicalSourceDocument {
  /** Present only when one logical scope needs multiple bounded output shards. */
  extractionScopeContext?: ResumeExtractionScopeContext
  /** Server-owned business-scope membership for target blocks. */
  extractionScopeAssignments?: ResumeExtractionScopeAssignment[]
}

export interface ResumeExtractionScopePlanScope {
  serverScopeLocalId: string
  memberBlockIds: string[]
  timelineAnchorBlockIds: string[]
  /** True when memberBlockIds describe the complete source scope. */
  hasCompleteScopeContext: boolean
  /** True when the complete, server-selected anchor is available as source blocks. */
  hasTrustedAnchorContext: boolean
}

export interface ResumeExtractionScopePlan {
  scopes: ResumeExtractionScopePlanScope[]
  /** Structural/layout blocks intentionally have no entry. */
  scopeBySourceBlockId: ReadonlyMap<string, string>
}

export class ResumeExtractionChunkPlanError extends Error {
  readonly code = 'P01_SCOPE_PLAN_INVALID' as const

  constructor(message: string) {
    super(`P01 deterministic scope plan invalid: ${message}`)
    this.name = 'ResumeExtractionChunkPlanError'
  }
}

export interface IndexedResumeExtractionCandidate<T = ResumeExtractionCandidate> {
  chunkIndex: number
  candidate: T
}

function assertResumeExtractionShardCount(shardCount: number) {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1) {
    throw new RangeError('shardCount must be a positive safe integer')
  }
}

/**
 * P01 repair capacity is owned by the server and scales with the transport
 * plan. A small initial window prevents a malformed batch from immediately
 * spending the whole budget; every successful repair unlocks one more slot.
 */
export function resumeExtractionInitialRepairBudget(shardCount: number) {
  assertResumeExtractionShardCount(shardCount)
  return Math.min(
    shardCount,
    Math.max(1, Math.ceil(shardCount * RESUME_EXTRACTION_INITIAL_REPAIR_RATIO))
  )
}

/** Hard ceiling for P01R calls, independent of provider completion order. */
export function resumeExtractionMaxRepairBudget(shardCount: number) {
  assertResumeExtractionShardCount(shardCount)
  return Math.min(
    shardCount,
    Math.max(
      resumeExtractionInitialRepairBudget(shardCount),
      Math.ceil(shardCount * RESUME_EXTRACTION_MAX_REPAIR_RATIO)
    )
  )
}

/**
 * Provider calls may finish in any order. The server owns every sequence number
 * and rejects missing/duplicate indexes before merge, so transport timing can
 * never change evidence namespaces or the final source order.
 */
export function orderResumeExtractionCandidates<T>(
  results: IndexedResumeExtractionCandidate<T>[],
  expectedCount: number
) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1) {
    throw new RangeError('expectedCount must be a positive safe integer')
  }
  if (results.length !== expectedCount) {
    throw new Error(`P01 chunk sequence incomplete: expected ${expectedCount}, received ${results.length}`)
  }
  const ordered = [...results].sort((left, right) => left.chunkIndex - right.chunkIndex)
  for (let index = 0; index < expectedCount; index += 1) {
    if (ordered[index]?.chunkIndex !== index) {
      throw new Error(`P01 chunk sequence invalid at ${index}`)
    }
  }
  return ordered.map(item => item.candidate)
}

/** Waits for every already-started call before surfacing the first failure. */
export async function settleResumeExtractionBatch<T>(
  pending: Array<Promise<IndexedResumeExtractionCandidate<T>>>
) {
  const settled = await Promise.allSettled(pending)
  const completed = settled.flatMap(result => (
    result.status === 'fulfilled' ? [result.value] : []
  ))
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  )
  if (failed) throw failed.reason
  return completed
}

/**
 * Structural upper bound for independent, non-overlapping facts in one source
 * block. It is deliberately based only on source layout, never model labels.
 */
export function resumeExtractionFactCandidateLimitForBlock(
  block: Pick<SourceBlock, 'text'>
) {
  const text = block.text.trim()
  if (!text || /^#{1,6}\s/u.test(text)) return 1

  const withoutListMarker = text.replace(/^[-*+•·]\s*/u, '')
  const strongBoundaries = withoutListMarker.match(/[；;。！？!?](?=\s*\S)/gu)?.length ?? 0
  const contactSignals = [
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u,
    /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/u,
    /https?:\/\//iu,
  ].filter(pattern => pattern.test(withoutListMarker)).length

  if (contactSignals >= 2) return Math.min(3, contactSignals)
  if (strongBoundaries >= 2 || withoutListMarker.length >= 120) return 3
  if (strongBoundaries >= 1 || withoutListMarker.length >= 64) return 2
  return 1
}

export function resumeExtractionFactCandidateLimit(
  blocks: readonly Pick<SourceBlock, 'text'>[]
) {
  if (!Array.isArray(blocks)) throw new TypeError('blocks must be an array')
  // Empty documents still need a valid schema maxItems value; the downstream
  // coverage validator is responsible for accepting an empty candidate list.
  return Math.max(1, blocks.reduce(
    (total, block) => total + resumeExtractionFactCandidateLimitForBlock(block),
    0
  ))
}

/**
 * Transport/storage hard bound. The structural 1-3 facts-per-block estimate is
 * advisory; a small fixed headroom lets an exact long line contain additional
 * independent facts without giving an unbounded model or cache payload room.
 */
export function resumeExtractionFactCandidateTransportLimit(
  blocks: readonly Pick<SourceBlock, 'text'>[]
) {
  return resumeExtractionFactCandidateStorageLimit(blocks, 1)
}

/** Additive storage bound for candidates merged from server-numbered shards. */
export function resumeExtractionFactCandidateStorageLimit(
  blocks: readonly Pick<SourceBlock, 'text'>[],
  shardCount: number
) {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1) {
    throw new RangeError('shardCount must be a positive safe integer')
  }
  return resumeExtractionFactCandidateLimit(blocks)
    + RESUME_EXTRACTION_FACT_CANDIDATE_HEADROOM * shardCount
}

/**
 * Pre-normalization hard bound used by the model schema and validator entry.
 * It permits a bounded amount of overlap duplication so deterministic code can
 * coalesce it before enforcing the smaller transport/storage limit.
 */
export function resumeExtractionRawFactCandidateLimit(
  blocks: readonly Pick<SourceBlock, 'text'>[],
  shardCount = 1
) {
  const storageLimit = resumeExtractionFactCandidateStorageLimit(blocks, shardCount)
  const normalizationSlop = Math.min(
    RESUME_EXTRACTION_RAW_FACT_SLOP_MAX,
    Math.max(4, Math.ceil(storageLimit / 4))
  )
  return storageLimit + normalizationSlop
}

/**
 * Conservative output estimate used only for deterministic transport packing.
 * The per-fact reserve is calibrated from successful non-production P01
 * telemetry and still leaves substantial room above observed aggregate output
 * cost. Keeping that reserve separate from the hard ceiling avoids paying the
 * full prompt/schema overhead again merely because one source line can contain
 * two independent facts.
 */
export function estimateResumeExtractionOutputTokens(
  blocks: readonly Pick<SourceBlock, 'text'>[]
) {
  const characters = blocks.reduce((sum, block) => sum + block.text.length, 0)
  return RESUME_EXTRACTION_OUTPUT_TOKEN_BASE
    + resumeExtractionFactCandidateTransportLimit(blocks) * RESUME_EXTRACTION_OUTPUT_TOKENS_PER_FACT
    + Math.ceil(characters / RESUME_EXTRACTION_OUTPUT_CHARACTERS_PER_TOKEN)
}

export interface ResumeExtractionChunkOptions {
  maxBlocks?: number
  maxCharacters?: number
  maxEstimatedOutputTokens?: number
}

export class ResumeExtractionChunkCapacityError extends Error {
  readonly code = 'P01_LOGICAL_SCOPE_CAPACITY_EXCEEDED' as const

  constructor(readonly metrics: { blocks: number; characters: number; estimatedOutputTokens: number }) {
    super(
      `P01 单个不可拆分的 source block 或 timeline anchor 预计需要 ${metrics.estimatedOutputTokens} 输出 tokens`
      + `（${metrics.blocks} blocks / ${metrics.characters} chars），超过安全容量，已在外部调用前阻断。`
    )
    this.name = 'ResumeExtractionChunkCapacityError'
  }
}

interface OutlineNode {
  heading: CanonicalSourceDocument['blocks'][number] | null
  level: number
  title: string | null
  entries: Array<CanonicalSourceDocument['blocks'][number] | OutlineNode>
}

const STRUCTURAL_SECTION_HEADINGS = new Set([
  'about',
  'awards',
  'basicinformation',
  'certifications',
  'contact',
  'contactinformation',
  'education',
  'educationbackground',
  'employmenthistory',
  'experience',
  'honors',
  'internshipexperience',
  'internships',
  'languages',
  'otherexperience',
  'patents',
  'personalinformation',
  'portfolio',
  'profile',
  'professionalexperience',
  'projects',
  'projectexperience',
  'publications',
  'research',
  'researchexperience',
  'skills',
  'summary',
  'training',
  'volunteer',
  'volunteerexperience',
  'workexperience',
  '个人信息',
  '个人简介',
  '作品集',
  '其他经历',
  '基本信息',
  '实习经历',
  '工作经历',
  '志愿经历',
  '技能',
  '教育经历',
  '教育背景',
  '培训经历',
  '专业技能',
  '专利',
  '研究经历',
  '科研经历',
  '简历概述',
  '职业概述',
  '职业摘要',
  '自我介绍',
  '自我评价',
  '联系方式',
  '语言能力',
  '证书',
  '项目经历',
  '荣誉',
  '荣誉奖项',
  '论文',
])

function parseHeading(text: string) {
  const match = text.match(/^(#{1,6})\s+(.+?)\s*#*$/)
  if (!match) return null
  return { level: match[1].length, title: match[2].trim() }
}

function normalizedHeadingTitle(title: string) {
  return title.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '')
}

function isOutlineNode(entry: OutlineNode['entries'][number]): entry is OutlineNode {
  return 'entries' in entry
}

function buildOutline(document: CanonicalSourceDocument) {
  const root: OutlineNode = { heading: null, level: 0, title: null, entries: [] }
  const stack = [root]

  for (const [index, block] of document.blocks.entries()) {
    const heading = parseHeading(block.text) ?? (isSourceProjectCardTitle(document.blocks, index)
      ? { level: Math.max(2, stack.at(-1)!.level), title: block.text.trim() } : null)
    if (!heading) {
      stack.at(-1)!.entries.push(block)
      continue
    }

    while (stack.length > 1 && stack.at(-1)!.level >= heading.level) stack.pop()
    const node: OutlineNode = { heading: block, level: heading.level, title: heading.title, entries: [] }
    stack.at(-1)!.entries.push(node)
    stack.push(node)
  }

  return root
}

const TIMELINE_DATE_POINT = String.raw`(?:19|20)\d{2}(?:\s*(?:[./-]\s*(?:0?[1-9]|1[0-2])|年(?:\s*(?:0?[1-9]|1[0-2])\s*月?)?))?`
const EXPLICIT_TIMELINE_RANGE = new RegExp(
  `${TIMELINE_DATE_POINT}\\s*(?:[-–—~]\\s*(?:至今|现在|present|${TIMELINE_DATE_POINT})|至\\s*(?:今|现在|${TIMELINE_DATE_POINT}))`,
  'iu'
)
const STRONG_ENTITY_MARKER = /(?:公司|集团|企业|大学|学院|研究院|实验室|工作室|银行|医院|药房|药店|事务所|company\b|corporation\b|university\b|college\b|institute\b|laboratory\b|studio\b|bank\b|hospital\b)/iu
const STRONG_ENTITY_AT_END = /(?:公司|集团|企业|大学|学院|研究院|实验室|工作室|银行|医院|药房|药店|事务所|company|corporation|university|college|institute|laboratory|studio|bank|hospital)\s*$/iu
const ENGLISH_ENTITY_AT_START = /^(?:company|corporation|university|college|institute|laboratory|studio|bank|hospital)\b/iu
const STRONG_ROLE_HEADING = /(?:产品经理|项目经理|运营经理|客户经理|设计师|工程师|分析师|咨询师|顾问|研究员|专员|助理|实习生|负责人|总监|主管|经理|product\s+manager|project\s+manager|designer|engineer|analyst|consultant|specialist|intern|director|lead)$/iu

function isTimelineRangeBlock(text: string) {
  // Reporting periods attached to a metric are not a new employment entry.
  return EXPLICIT_TIMELINE_RANGE.test(text)
    && !/(?:完成率|及时率|转化率|覆盖率|崩溃率|统计周期|报表周期|统计期间)/u.test(text)
}

/** PDF/OCR case cards often lose heading markers. Require a title plus a
 * nearby case-body label; neither an isolated keyword nor a date is enough. */
function isSourceProjectCardTitle(blocks: CanonicalSourceDocument['blocks'], index: number) {
  const text = blocks[index]?.text.trim() ?? ''
  if (text.length < 5 || text.length > 100 || /^(?:#|[-*•]|[ABC]\s*[|｜丨]|背景|目标|关键动作|结果|职责|角色|CASE BANK)/iu.test(text)
    || /[。；;，,！？]/u.test(text) || isTimelineRangeBlock(text)
    || /^(?:(?:19|20)\d{2}|硕士|博士|与导师)/u.test(text) || /\d+\s*页/u.test(text)) return false
  if (!/(?:系统|平台|专项治理|共创|规划|辅导|论文|项目)/u.test(text)) return false
  const following: string[] = []
  for (const block of blocks.slice(index + 1, index + 5)) {
    if (parseHeading(block.text)) break
    following.push(block.text.trim())
  }
  return following.some(line => /^(?:背景|项目背景|关键动作|硕士毕业论文|博士(?:毕业)?论文)\s*[:：]?/u.test(line))
}

function containsExplicitTimelineRange(blocks: CanonicalSourceDocument['blocks']) {
  return blocks.some(block => isTimelineRangeBlock(block.text))
}

function leadingNodeBlocks(node: OutlineNode) {
  const blocks: CanonicalSourceDocument['blocks'] = node.heading ? [node.heading] : []
  for (const entry of node.entries) {
    if (isOutlineNode(entry)) break
    blocks.push(entry)
  }
  return blocks
}

function headingText(node: OutlineNode) {
  return node.title ?? ''
}

function isNamedStructuralNode(node: OutlineNode) {
  return node.title !== null && (STRUCTURAL_SECTION_HEADINGS.has(normalizedHeadingTitle(node.title))
    || /^(?:课程与能力|课程|能力概述)\s*[:：]/u.test(node.title))
}

function hasStrongEntitySignal(text: string) {
  const normalized = text.trim()
  return STRONG_ENTITY_AT_END.test(normalized)
    || ENGLISH_ENTITY_AT_START.test(normalized)
    || (STRONG_ENTITY_MARKER.test(normalized) && /[|｜丨]/u.test(normalized))
}

/**
 * A nested heading below an active timeline normally describes that same role.
 * Only source-level evidence of a new entity/role closes the parent. This is a
 * deliberately narrow negative boundary, not a whitelist of subsection names.
 */
function hasStrongIndependentHeadingSignal(node: OutlineNode) {
  const title = headingText(node).trim()
  if (!title) return false
  if (hasStrongEntitySignal(title)) return true
  return title.length <= 48 && STRONG_ROLE_HEADING.test(title)
}

function hasTopLevelScopeHeadingSignal(node: OutlineNode) {
  return hasStrongEntitySignal(headingText(node))
}

function timelineAnchorBlocks(node: OutlineNode) {
  const leading = leadingNodeBlocks(node)
  const timelineIndex = leading.findIndex(block => isTimelineRangeBlock(block.text))
  if (timelineIndex >= 0) return leading.slice(0, timelineIndex + 1)
  return node.heading ? [node.heading] : leading.slice(0, 1)
}

function isUnheadedStructuralLine(text: string) {
  const normalized = normalizedHeadingTitle(text)
  if (STRUCTURAL_SECTION_HEADINGS.has(normalized)) return true
  const label = text.match(/^([^:：]{1,24})[:：]/u)?.[1]?.trim()
  return Boolean(label && STRUCTURAL_SECTION_HEADINGS.has(normalizedHeadingTitle(label)))
}

function isUnheadedTimelineMetadata(text: string) {
  const normalized = text.replace(/^[-*+]\s*/u, '').trim()
  const heading = parseHeading(normalized)
  if (heading?.level === 1) return hasStrongEntitySignal(heading.title)
  return hasStrongEntitySignal(normalized)
    || (normalized.length <= 64 && STRONG_ROLE_HEADING.test(normalized))
}

interface LogicalScopeGroup {
  blocks: CanonicalSourceDocument['blocks']
  serverScopeLocalId?: string
  timelineAnchorBlockIds: string[]
}

interface PlannedScopeState {
  serverScopeLocalId: string
  timelineAnchorBlockIds: string[]
}

/**
 * Builds source-ordered semantic groups before any transport packing happens.
 * A timeline-bearing parent owns its nested subsections by default. Once a
 * named structural section, explicit new timeline, or strong new entity/role
 * appears, that parent scope is closed monotonically and can never resume later.
 */
function buildLogicalScopeGroups(document: CanonicalSourceDocument) {
  const groups: LogicalScopeGroup[] = []
  const stableScopeId = (block: CanonicalSourceDocument['blocks'][number]) => (
    `srv_scope_${document.sha256.slice(0, 12)}_${block.sourceBlockId}`
  )
  const append = (
    block: CanonicalSourceDocument['blocks'][number],
    scope?: PlannedScopeState
  ) => {
    const previous = groups.at(-1)
    if (previous && previous.serverScopeLocalId === scope?.serverScopeLocalId) {
      previous.blocks.push(block)
      return
    }
    groups.push({
      blocks: [block],
      serverScopeLocalId: scope?.serverScopeLocalId,
      timelineAnchorBlockIds: scope?.timelineAnchorBlockIds ?? [],
    })
  }

  const appendLinearBlocks = (
    blocks: CanonicalSourceDocument['blocks'],
    defaultScope?: PlannedScopeState
  ) => {
    if (blocks.length === 0) return defaultScope
    const timelineIndexes = blocks.flatMap((block, index) => (
      isTimelineRangeBlock(block.text) ? [index] : []
    ))
    const scopeStarts = timelineIndexes.map((timelineIndex, timelinePosition) => {
      const previousTimelineIndex = timelineIndexes[timelinePosition - 1] ?? -1
      let start = timelineIndex
      for (let index = timelineIndex - 1; index > previousTimelineIndex && timelineIndex - index <= 4; index -= 1) {
        const block = blocks[index]
        if (isUnheadedStructuralLine(block.text) || !isUnheadedTimelineMetadata(block.text)) break
        start = index
      }
      return start
    })
    const scopesByBlockIndex = new Map<number, PlannedScopeState>()
    const firstTimelineIndex = timelineIndexes[0]
    const defaultBoundary = blocks.findIndex((block, index) => (
      index <= (firstTimelineIndex ?? blocks.length) && isUnheadedStructuralLine(block.text)
    ))
    const firstTimelineUsesDefault = Boolean(
      defaultScope
      && firstTimelineIndex !== undefined
      && defaultBoundary < 0
    )

    if (defaultScope) {
      const defaultEnd = firstTimelineUsesDefault
        ? -1
        : Math.min(
            scopeStarts[0] ?? blocks.length,
            defaultBoundary >= 0 ? defaultBoundary : blocks.length
          ) - 1
      for (let index = 0; index <= defaultEnd; index += 1) {
        scopesByBlockIndex.set(index, defaultScope)
      }
    }

    timelineIndexes.forEach((timelineIndex, timelinePosition) => {
      const useDefault = timelinePosition === 0 && firstTimelineUsesDefault
      const start = useDefault ? 0 : scopeStarts[timelinePosition]
      const nextStart = scopeStarts[timelinePosition + 1] ?? blocks.length
      const structuralBoundary = blocks.findIndex((block, index) => (
        index > timelineIndex && index < nextStart && isUnheadedStructuralLine(block.text)
      ))
      const end = (structuralBoundary >= 0 ? structuralBoundary : nextStart) - 1
      const scope: PlannedScopeState = useDefault
        ? {
            ...defaultScope!,
            timelineAnchorBlockIds: blocks
              .slice(start, timelineIndex + 1)
              .map(block => block.sourceBlockId),
          }
        : {
            serverScopeLocalId: stableScopeId(blocks[start]),
            timelineAnchorBlockIds: blocks
              .slice(start, timelineIndex + 1)
              .map(block => block.sourceBlockId),
          }
      for (let index = start; index <= end; index += 1) scopesByBlockIndex.set(index, scope)
    })

    blocks.forEach((block, index) => append(block, scopesByBlockIndex.get(index)))
    return scopesByBlockIndex.get(blocks.length - 1)
  }

  const visit = (node: OutlineNode, inheritedScope?: PlannedScopeState): { closesInheritedScope: boolean } => {
    const leading = leadingNodeBlocks(node)
    const explicitTimeline = containsExplicitTimelineRange(leading)
    const namedStructural = !node.heading || isNamedStructuralNode(node)
    const topLevelWrapper = node.level === 1
      && !EXPLICIT_TIMELINE_RANGE.test(node.heading?.text ?? '')
      && !hasTopLevelScopeHeadingSignal(node)
    const structuralBoundary = namedStructural || topLevelWrapper
    const strongIndependentBoundary = Boolean(
      inheritedScope
      && !structuralBoundary
      && (explicitTimeline || hasStrongIndependentHeadingSignal(node))
    )
    const startsOwnScope = Boolean(
      node.heading
      && !structuralBoundary
      && (!inheritedScope || strongIndependentBoundary)
    )
    const nodeScope = startsOwnScope
      ? {
          serverScopeLocalId: stableScopeId(node.heading ?? leading[0]),
          timelineAnchorBlockIds: timelineAnchorBlocks(node).map(block => block.sourceBlockId),
        }
      : structuralBoundary
        ? undefined
        : inheritedScope
    let activeScope = nodeScope
    let looseBlocks: CanonicalSourceDocument['blocks'] = node.heading ? [node.heading] : []
    for (const entry of node.entries) {
      if (!isOutlineNode(entry)) {
        looseBlocks.push(entry)
        continue
      }
      activeScope = appendLinearBlocks(looseBlocks, activeScope)
      looseBlocks = []
      const result = visit(entry, activeScope)
      if (activeScope && result.closesInheritedScope) activeScope = undefined
    }
    activeScope = appendLinearBlocks(looseBlocks, activeScope)

    return {
      closesInheritedScope: Boolean(inheritedScope && (structuralBoundary || strongIndependentBoundary)),
    }
  }

  visit(buildOutline(document))
  const coalesced: LogicalScopeGroup[] = []
  for (const group of groups) {
    const previous = coalesced.at(-1)
    const previousHeading = previous && previous.blocks.length <= 3
      && previous.blocks.slice(1).every(block => !/(?:主导|负责|推动|参与|完成|交付|\d)/u.test(block.text))
      ? parseHeading(previous.blocks[0].text) : null
    const currentHeading = parseHeading(group.blocks[0]?.text ?? '')
    const complementaryTimelineMetadata = Boolean(
      previous?.serverScopeLocalId
      && group.serverScopeLocalId
      && previousHeading
      && currentHeading
      && (hasStrongEntitySignal(previousHeading.title)
        || (/[|｜丨]/u.test(previousHeading.title) && !/[与和]/u.test(previousHeading.title.split(/[|｜丨]/u)[0])))
      && STRONG_ROLE_HEADING.test(currentHeading.title)
      && containsExplicitTimelineRange(group.blocks)
    )
    if (!previous || !complementaryTimelineMetadata) {
      coalesced.push(group)
      continue
    }
    previous.blocks.push(...group.blocks)
    previous.timelineAnchorBlockIds = [
      ...previous.timelineAnchorBlockIds,
      ...group.timelineAnchorBlockIds.filter(id => !previous.timelineAnchorBlockIds.includes(id)),
    ]
  }
  return coalesced
}

export function buildResumeExtractionScopePlan(
  document: CanonicalSourceDocument
): ResumeExtractionScopePlan {
  const scopes = new Map<string, ResumeExtractionScopePlanScope>()
  const scopeBySourceBlockId = new Map<string, string>()
  for (const group of buildLogicalScopeGroups(document)) {
    if (!group.serverScopeLocalId) continue
    const existing = scopes.get(group.serverScopeLocalId)
    const memberBlockIds = group.blocks.map(block => block.sourceBlockId)
    if (existing) {
      existing.memberBlockIds.push(...memberBlockIds)
    } else {
      scopes.set(group.serverScopeLocalId, {
        serverScopeLocalId: group.serverScopeLocalId,
        memberBlockIds: [...memberBlockIds],
        timelineAnchorBlockIds: [...group.timelineAnchorBlockIds],
        hasCompleteScopeContext: true,
        hasTrustedAnchorContext: group.timelineAnchorBlockIds.length > 0,
      })
    }
    for (const sourceBlockId of memberBlockIds) {
      scopeBySourceBlockId.set(sourceBlockId, group.serverScopeLocalId)
    }
  }
  return { scopes: [...scopes.values()], scopeBySourceBlockId }
}

/**
 * Reads the same plan from a full document or from server-produced chunk
 * metadata. A chunk never guesses ownership from its truncated target blocks.
 */
export function readResumeExtractionScopePlan(
  document: CanonicalSourceDocument | ResumeExtractionChunk
): ResumeExtractionScopePlan {
  const chunk = document as ResumeExtractionChunk
  const assignments = chunk.extractionScopeAssignments
  const context = chunk.extractionScopeContext
  if (!assignments?.length && !context) return buildResumeExtractionScopePlan(document)
  const effectiveAssignments = assignments?.length
    ? assignments
    : context
      ? [{
          serverScopeLocalId: context.serverScopeLocalId,
          sourceBlockIds: document.blocks.map(block => block.sourceBlockId),
          scopeMemberBlockIds: context.scopeMemberBlockIds ?? context.blocks.map(block => block.sourceBlockId),
          timelineAnchorBlockIds: context.timelineAnchorBlockIds ?? [],
        }]
      : []

  const availableBlockIds = new Set([
    ...document.blocks.map(block => block.sourceBlockId),
    ...(context?.blocks.map(block => block.sourceBlockId) ?? []),
  ])
  const scopes = new Map<string, ResumeExtractionScopePlanScope>()
  const scopeBySourceBlockId = new Map<string, string>()
  for (const assignment of effectiveAssignments) {
    const isContextScope = context?.serverScopeLocalId === assignment.serverScopeLocalId
    const memberBlockIds = assignment.scopeMemberBlockIds
      ?? (isContextScope ? context.blocks.map(block => block.sourceBlockId) : assignment.sourceBlockIds)
    const anchorBlockIds = assignment.timelineAnchorBlockIds
      ?? (isContextScope ? context.timelineAnchorBlockIds ?? [] : [])
    const hasCompleteScopeContext = Boolean(assignment.scopeMemberBlockIds || isContextScope)
    const hasTrustedAnchorContext = hasCompleteScopeContext
      && anchorBlockIds.length > 0
      && anchorBlockIds.every(id => memberBlockIds.includes(id) && availableBlockIds.has(id))
    const existing = scopes.get(assignment.serverScopeLocalId)
    if (!existing) {
      scopes.set(assignment.serverScopeLocalId, {
        serverScopeLocalId: assignment.serverScopeLocalId,
        memberBlockIds: [...memberBlockIds],
        timelineAnchorBlockIds: [...anchorBlockIds],
        hasCompleteScopeContext,
        hasTrustedAnchorContext,
      })
    }
    for (const sourceBlockId of assignment.sourceBlockIds) {
      scopeBySourceBlockId.set(sourceBlockId, assignment.serverScopeLocalId)
    }
  }
  return { scopes: [...scopes.values()], scopeBySourceBlockId }
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/**
 * Zero-provider preflight for the exact transport plan. It proves that packing
 * neither loses/reorders blocks nor changes deterministic semantic ownership.
 */
export function validateResumeExtractionChunkPlan(
  document: CanonicalSourceDocument,
  chunks: ResumeExtractionChunk[]
): void {
  if (document.blocks.length === 0) {
    if (chunks.length !== 1 || chunks[0].blocks.length !== 0) {
      throw new ResumeExtractionChunkPlanError('empty document must produce one empty chunk')
    }
    return
  }
  if (chunks.length === 0) throw new ResumeExtractionChunkPlanError('non-empty document produced no chunks')

  const sourceBlockIds = document.blocks.map(block => block.sourceBlockId)
  const targetBlockIds = chunks.flatMap(chunk => chunk.blocks.map(block => block.sourceBlockId))
  if (!sameIds(targetBlockIds, sourceBlockIds)) {
    throw new ResumeExtractionChunkPlanError('target blocks are missing, duplicated, or out of source order')
  }
  if (new Set(targetBlockIds).size !== sourceBlockIds.length) {
    throw new ResumeExtractionChunkPlanError('a source block is targeted more than once')
  }
  const fullPlan = buildResumeExtractionScopePlan(document)
  const fullScopes = new Map(fullPlan.scopes.map(scope => [scope.serverScopeLocalId, scope]))
  const assignmentChunks = new Map<string, Array<{ chunk: ResumeExtractionChunk; assignment: ResumeExtractionScopeAssignment }>>()

  for (const chunk of chunks) {
    if (chunk.sha256 !== document.sha256) {
      throw new ResumeExtractionChunkPlanError(`${chunk.documentId} has a different source hash`)
    }
    const chunkBlockIds = new Set(chunk.blocks.map(block => block.sourceBlockId))
    const assignedTargets = new Set<string>()
    for (const assignment of chunk.extractionScopeAssignments ?? []) {
      const fullScope = fullScopes.get(assignment.serverScopeLocalId)
      if (!fullScope) {
        throw new ResumeExtractionChunkPlanError(`unknown scope ${assignment.serverScopeLocalId}`)
      }
      if (assignment.sourceBlockIds.length === 0) {
        throw new ResumeExtractionChunkPlanError(`scope ${assignment.serverScopeLocalId} has no targets`)
      }
      const memberBlockIds = assignment.scopeMemberBlockIds ?? assignment.sourceBlockIds
      const anchorBlockIds = assignment.timelineAnchorBlockIds ?? []
      if (!sameIds(memberBlockIds, fullScope.memberBlockIds)) {
        throw new ResumeExtractionChunkPlanError(`scope ${assignment.serverScopeLocalId} has incomplete membership`)
      }
      if (!sameIds(anchorBlockIds, fullScope.timelineAnchorBlockIds)) {
        throw new ResumeExtractionChunkPlanError(`scope ${assignment.serverScopeLocalId} has a different anchor`)
      }
      for (const sourceBlockId of assignment.sourceBlockIds) {
        if (!chunkBlockIds.has(sourceBlockId)) {
          throw new ResumeExtractionChunkPlanError(`assignment targets absent block ${sourceBlockId}`)
        }
        if (assignedTargets.has(sourceBlockId)) {
          throw new ResumeExtractionChunkPlanError(`block ${sourceBlockId} has duplicate assignments`)
        }
        if (fullPlan.scopeBySourceBlockId.get(sourceBlockId) !== assignment.serverScopeLocalId) {
          throw new ResumeExtractionChunkPlanError(`block ${sourceBlockId} changed semantic scope`)
        }
        assignedTargets.add(sourceBlockId)
      }
      assignmentChunks.set(assignment.serverScopeLocalId, [
        ...(assignmentChunks.get(assignment.serverScopeLocalId) ?? []),
        { chunk, assignment },
      ])
    }
    for (const sourceBlockId of chunkBlockIds) {
      const plannedScopeId = fullPlan.scopeBySourceBlockId.get(sourceBlockId)
      if (plannedScopeId && !assignedTargets.has(sourceBlockId)) {
        throw new ResumeExtractionChunkPlanError(`scoped block ${sourceBlockId} has no assignment`)
      }
      if (!plannedScopeId && assignedTargets.has(sourceBlockId)) {
        throw new ResumeExtractionChunkPlanError(`structural block ${sourceBlockId} received a semantic scope`)
      }
    }
  }

  for (const scope of fullPlan.scopes) {
    const appearances = assignmentChunks.get(scope.serverScopeLocalId) ?? []
    const assignedScopeBlocks = appearances.flatMap(item => item.assignment.sourceBlockIds)
    if (!sameIds(assignedScopeBlocks, scope.memberBlockIds)) {
      throw new ResumeExtractionChunkPlanError(`scope ${scope.serverScopeLocalId} targets are incomplete or reordered`)
    }
    const anchorAppearances = appearances.filter(item => item.assignment.sourceBlockIds.some(id => (
      scope.timelineAnchorBlockIds.includes(id)
    )))
    if (anchorAppearances.length !== 1 || !scope.timelineAnchorBlockIds.every(id => (
      anchorAppearances[0].assignment.sourceBlockIds.includes(id)
    ))) {
      throw new ResumeExtractionChunkPlanError(`scope ${scope.serverScopeLocalId} anchor was split across shards`)
    }
    if (appearances.length <= 1) continue
    for (const { chunk } of appearances) {
      const context = chunk.extractionScopeContext
      if (!context || context.serverScopeLocalId !== scope.serverScopeLocalId) {
        throw new ResumeExtractionChunkPlanError(`shard ${chunk.documentId} lacks trusted anchor context`)
      }
      if (!sameIds(context.blocks.map(block => block.sourceBlockId), scope.timelineAnchorBlockIds)) {
        throw new ResumeExtractionChunkPlanError(`shard ${chunk.documentId} has incomplete anchor context`)
      }
      if (!sameIds(context.scopeMemberBlockIds ?? [], scope.memberBlockIds)
        || !sameIds(context.timelineAnchorBlockIds ?? [], scope.timelineAnchorBlockIds)) {
        throw new ResumeExtractionChunkPlanError(`shard ${chunk.documentId} has unverifiable context metadata`)
      }
    }
  }
}

export function splitResumeDocument(
  document: CanonicalSourceDocument,
  optionsOrMaxBlocks: number | ResumeExtractionChunkOptions = {}
): ResumeExtractionChunk[] {
  const options = typeof optionsOrMaxBlocks === 'number'
    ? { maxBlocks: optionsOrMaxBlocks }
    : optionsOrMaxBlocks
  const maxBlocks = options.maxBlocks ?? DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS
  const maxCharacters = options.maxCharacters ?? DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS
  const maxEstimatedOutputTokens = options.maxEstimatedOutputTokens
    ?? DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS
  if (!Number.isSafeInteger(maxBlocks) || maxBlocks < 1) {
    throw new RangeError('maxBlocks must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    throw new RangeError('maxCharacters must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxEstimatedOutputTokens) || maxEstimatedOutputTokens < 1) {
    throw new RangeError('maxEstimatedOutputTokens must be a positive safe integer')
  }
  if (document.blocks.length === 0) {
    const chunks = [document]
    validateResumeExtractionChunkPlan(document, chunks)
    return chunks
  }

  const metrics = (blocks: CanonicalSourceDocument['blocks']) => {
    const characters = blocks.reduce((sum, block) => sum + block.text.length, 0)
    return {
      blocks: blocks.length,
      characters,
      // P01 emits several typed records for many source blocks. Block count is
      // the dominant cost; characters cover dense prose and long single lines.
      // The shared estimator is deliberately kept below the compiler's 14,400
      // token minimum, preserving output headroom without over-fragmenting P01.
      estimatedOutputTokens: estimateResumeExtractionOutputTokens(blocks),
    }
  }
  const withinHardCapacity = (value: ReturnType<typeof metrics>) => (
    value.characters <= maxCharacters
    && value.estimatedOutputTokens <= maxEstimatedOutputTokens
  )
  const withinPackingTarget = (blocks: CanonicalSourceDocument['blocks']) => {
    const value = metrics(blocks)
    return value.blocks <= maxBlocks && withinHardCapacity(value)
  }

  const chunks: ResumeExtractionChunk[] = []
  let currentBlocks: CanonicalSourceDocument['blocks'] = []
  let currentScopeAssignments: ResumeExtractionScopeAssignment[] = []

  const appendChunk = (
    blocks: CanonicalSourceDocument['blocks'],
    extractionScopeContext?: ResumeExtractionScopeContext,
    extractionScopeAssignments: ResumeExtractionScopeAssignment[] = []
  ) => {
    if (blocks.length === 0) return
    chunks.push({
      ...document,
      documentId: `${document.documentId}:chunk:${chunks.length + 1}`,
      blocks,
      ...(extractionScopeContext ? { extractionScopeContext } : {}),
      ...(extractionScopeAssignments.length > 0 ? { extractionScopeAssignments } : {}),
    })
  }

  for (const group of buildLogicalScopeGroups(document)) {
    if (!withinPackingTarget(group.blocks)) {
      appendChunk(currentBlocks, undefined, currentScopeAssignments)
      currentBlocks = []
      currentScopeAssignments = []

      const scopeMemberBlockIds = group.blocks.map(block => block.sourceBlockId)
      const anchorBlockIds = new Set(group.timelineAnchorBlockIds)
      const anchorBlocks = group.blocks.filter(block => anchorBlockIds.has(block.sourceBlockId))
      const extractionScopeContext = group.serverScopeLocalId
        ? {
            serverScopeLocalId: group.serverScopeLocalId,
            blocks: anchorBlocks,
            scopeMemberBlockIds,
            timelineAnchorBlockIds: group.timelineAnchorBlockIds,
          } satisfies ResumeExtractionScopeContext
        : undefined
      if (anchorBlocks.length > 0 && !withinHardCapacity(metrics(anchorBlocks))) {
        throw new ResumeExtractionChunkCapacityError(metrics(anchorBlocks))
      }
      let targetBlocks: CanonicalSourceDocument['blocks'] = []
      let emittedTargetShard = false
      for (const block of group.blocks) {
        const nextBlocks = [...targetBlocks, block]
        const anchorPrefixIsPending = !emittedTargetShard && group.timelineAnchorBlockIds.some(id => (
          !targetBlocks.some(item => item.sourceBlockId === id)
        ))
        if (targetBlocks.length > 0 && !withinPackingTarget(nextBlocks) && !anchorPrefixIsPending) {
          appendChunk(targetBlocks, extractionScopeContext, group.serverScopeLocalId ? [{
            serverScopeLocalId: group.serverScopeLocalId,
            sourceBlockIds: targetBlocks.map(item => item.sourceBlockId),
            scopeMemberBlockIds,
            timelineAnchorBlockIds: group.timelineAnchorBlockIds,
          }] : [])
          emittedTargetShard = true
          targetBlocks = []
        }
        const blockMetrics = metrics([block])
        if (!withinHardCapacity(blockMetrics)) throw new ResumeExtractionChunkCapacityError(blockMetrics)
        targetBlocks.push(block)
      }
      appendChunk(targetBlocks, extractionScopeContext, group.serverScopeLocalId ? [{
        serverScopeLocalId: group.serverScopeLocalId,
        sourceBlockIds: targetBlocks.map(item => item.sourceBlockId),
        scopeMemberBlockIds,
        timelineAnchorBlockIds: group.timelineAnchorBlockIds,
      }] : [])
      continue
    }

    if (currentBlocks.length > 0 && !withinPackingTarget([...currentBlocks, ...group.blocks])) {
      appendChunk(currentBlocks, undefined, currentScopeAssignments)
      currentBlocks = []
      currentScopeAssignments = []
    }

    const assignment = group.serverScopeLocalId
      ? [{
          serverScopeLocalId: group.serverScopeLocalId,
          sourceBlockIds: group.blocks.map(block => block.sourceBlockId),
          scopeMemberBlockIds: group.blocks.map(block => block.sourceBlockId),
          timelineAnchorBlockIds: group.timelineAnchorBlockIds,
        }]
      : []
    currentBlocks.push(...group.blocks)
    currentScopeAssignments.push(...assignment)
  }
  appendChunk(currentBlocks, undefined, currentScopeAssignments)

  validateResumeExtractionChunkPlan(document, chunks)
  return chunks
}

/**
 * Repeated anchor blocks are read-only context. Only target-block records
 * survive, and the server fixes one scope ID across every output shard.
 */
export function normalizeResumeExtractionChunkCandidate(
  chunk: ResumeExtractionChunk,
  candidate: ResumeExtractionCandidate
): ResumeExtractionCandidate {
  const context = chunk.extractionScopeContext
  const assignments = chunk.extractionScopeAssignments ?? (context ? [{
    serverScopeLocalId: context.serverScopeLocalId,
    sourceBlockIds: chunk.blocks.map(block => block.sourceBlockId),
  }] : [])
  if (!context && assignments.length === 0) return candidate

  const factLocalIds = candidate.factCandidates.map(fact => fact.factLocalId)
  // Duplicate IDs make every map-based reference rewrite ambiguous. Preserve
  // the untouched model output so the canonical validator can reject it and
  // P01R can repair the actual defect instead of silently choosing one fact.
  if (new Set(factLocalIds).size !== factLocalIds.length) return candidate

  const targetBlockIds = new Set(chunk.blocks.map(block => block.sourceBlockId))
  const scopeByBlockId = new Map(assignments.flatMap(assignment => (
    assignment.sourceBlockIds.map(sourceBlockId => [sourceBlockId, assignment.serverScopeLocalId] as const)
  )))
  const originalFactCandidates = candidate.factCandidates
    .filter(fact => targetBlockIds.has(fact.sourceBlockId))
  const originalFactsById = new Map(originalFactCandidates.map(fact => [fact.factLocalId, fact]))
  const factCandidates = originalFactCandidates.map(fact => ({
    ...fact,
    sourceScopeLocalId: scopeByBlockId.get(fact.sourceBlockId) ?? fact.sourceScopeLocalId,
  }))
  const factsById = new Map(factCandidates.map(fact => [fact.factLocalId, fact]))
  const factIds = new Set(factCandidates.map(fact => fact.factLocalId))
  const mapFacts = (ids: string[]) => ids.filter(id => factIds.has(id))
  const anchorScopeIds = new Set(assignments
    .filter(assignment => (
      !context
      || context.serverScopeLocalId !== assignment.serverScopeLocalId
      || (assignment.timelineAnchorBlockIds
        ?? context.timelineAnchorBlockIds
        ?? [context.blocks[0]?.sourceBlockId ?? ''])
        .some(sourceBlockId => targetBlockIds.has(sourceBlockId))
    ))
    .map(assignment => assignment.serverScopeLocalId))
  const timelineByScope = new Map<string, ResumeExtractionCandidate['timelineCandidates'][number]>()
  for (const item of candidate.timelineCandidates) {
    const referencedOriginalFacts = mapFacts(item.factLocalIds)
      .map(id => originalFactsById.get(id))
      .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact))
    const inferredOriginalFacts = referencedOriginalFacts.length > 0
      ? referencedOriginalFacts
      : originalFactCandidates.filter(fact => fact.sourceScopeLocalId === item.scopeLocalId)
    const serverScopeIds = [...new Set(inferredOriginalFacts
      .map(fact => scopeByBlockId.get(fact.sourceBlockId))
      .filter((id): id is string => Boolean(id)))]
    const outputScopeIds = serverScopeIds.length > 0 ? serverScopeIds : [item.scopeLocalId]

    for (const scopeLocalId of outputScopeIds) {
      if (scopeLocalId.startsWith('srv_scope_') && !anchorScopeIds.has(scopeLocalId)) continue
      const scopedFactLocalIds = serverScopeIds.length > 0
        ? factCandidates
            .filter(fact => fact.sourceScopeLocalId === scopeLocalId)
            .map(fact => fact.factLocalId)
        : mapFacts(item.factLocalIds)
      const existing = timelineByScope.get(scopeLocalId)
      if (existing) {
        existing.factLocalIds = [...new Set([...existing.factLocalIds, ...scopedFactLocalIds])]
        if (existing.kind === 'other' && ['experience', 'internship'].includes(item.kind)
          && (item.start || item.end)) existing.kind = item.kind
        for (const key of ['organization', 'title', 'start', 'end'] as const) {
          if (!existing[key] && item[key]) existing[key] = item[key]
        }
      } else {
        timelineByScope.set(scopeLocalId, { ...item, scopeLocalId, factLocalIds: scopedFactLocalIds })
      }
    }
  }
  const timelineCandidates = [...timelineByScope.values()]
  // Undated case-study sections still own real work. Recover only their
  // structural container from a trusted source heading; never invent an
  // employer, role, date, claim or evidence status to satisfy the gate.
  const scopePlan = readResumeExtractionScopePlan(chunk)
  for (const scope of scopePlan.scopes) {
    if (!scope.hasCompleteScopeContext || !scope.hasTrustedAnchorContext
      || !scope.timelineAnchorBlockIds.every(id => targetBlockIds.has(id))) continue
    const scopeFacts = factCandidates.filter(fact => fact.sourceScopeLocalId === scope.serverScopeLocalId)
    if (!scopeFacts.some(fact => fact.proposedStatus !== 'excluded'
      && ['responsibility', 'action', 'deliverable', 'result'].includes(fact.claimType))) continue
    const anchor = chunk.blocks.find(block => block.sourceBlockId === scope.timelineAnchorBlockIds[0])
    const anchorIndex = chunk.blocks.findIndex(block => block === anchor)
    const cardTitle = anchorIndex >= 0 && isSourceProjectCardTitle(chunk.blocks, anchorIndex)
    const heading = anchor ? parseHeading(anchor.text) ?? (cardTitle ? { title: anchor.text.trim() } : null) : null
    if (!heading) continue
    const scopeText = scopeFacts.map(fact => fact.verbatimText).join('\n')
    const projectSection = candidate.sectionCandidates.find(section => (
      ['project', 'research'].includes(section.type)
      && section.factLocalIds.some(id => scopeFacts.some(fact => fact.factLocalId === id))
    ))
    if (!projectSection && !/(?:关键动作|项目|系统|平台|研究|论文|原型|project|research)/iu.test(scopeText)) continue
    const existing = timelineByScope.get(scope.serverScopeLocalId)
    if (existing) {
      // A model timeline can reference multiple server scopes. Retain a field
      // only if the source inside this scope contains it, never borrow it.
      for (const key of ['organization', 'title', 'start', 'end'] as const) {
        if (existing[key] && !scopeText.includes(existing[key]!)) existing[key] = null
      }
      if (cardTitle) existing.kind = /(?:论文|研究)/u.test(scopeText) ? 'research' : 'project'
      if (['project', 'research'].includes(existing.kind)) existing.title = heading.title
      continue
    }
    timelineCandidates.push({
      scopeLocalId: scope.serverScopeLocalId,
      kind: projectSection?.type === 'research' ? 'research' : 'project',
      organization: null, title: heading.title, start: null, end: null,
      factLocalIds: scopeFacts.map(fact => fact.factLocalId),
    })
  }
  const timelineScopeIds = new Set(timelineCandidates.map(item => item.scopeLocalId))
  const identityCandidates = candidate.identityCandidates
    .map(item => ({ ...item, factLocalIds: mapFacts(item.factLocalIds) }))
    .filter(item => item.factLocalIds.length > 0)
  const sectionCandidates = candidate.sectionCandidates
    .map(item => {
      const factLocalIds = mapFacts(item.factLocalIds)
      const scopeLocalIds = [...new Set(factLocalIds
        .map(id => factsById.get(id)?.sourceScopeLocalId)
        .filter((id): id is string => Boolean(id && timelineScopeIds.has(id))))]
      return {
        ...item,
        scopeLocalIds,
        factLocalIds,
      }
    })
    .filter(item => item.factLocalIds.length > 0 || item.scopeLocalIds.length > 0)
  const conflicts = candidate.conflicts
    .map(item => ({ ...item, factLocalIds: mapFacts(item.factLocalIds) }))
    .filter(item => item.factLocalIds.length > 0)
  const unmappedFragments = candidate.unmappedFragments.filter(item => targetBlockIds.has(item.sourceBlockId))
  const mappedSourceBlockIds = [...new Set(factCandidates.map(item => item.sourceBlockId))]
  const unmappedSourceBlockIds = [...new Set(unmappedFragments.map(item => item.sourceBlockId))]
    .filter(id => !mappedSourceBlockIds.includes(id))
  const filterQualityReferences = <T extends { factLocalIds: string[]; sourceBlockIds: string[] }>(items: T[]) => (
    items.map(item => ({
      ...item,
      factLocalIds: mapFacts(item.factLocalIds),
      sourceBlockIds: item.sourceBlockIds.filter(id => targetBlockIds.has(id)),
    }))
  )

  return {
    ...candidate,
    identityCandidates,
    timelineCandidates,
    sectionCandidates,
    factCandidates,
    unmappedFragments: unmappedFragments.filter(item => unmappedSourceBlockIds.includes(item.sourceBlockId)),
    conflicts,
    coverageClaim: { mappedSourceBlockIds, unmappedSourceBlockIds },
    qualityAssessment: {
      ...candidate.qualityAssessment,
      strengths: filterQualityReferences(candidate.qualityAssessment.strengths),
      weaknesses: filterQualityReferences(candidate.qualityAssessment.weaknesses),
      suggestions: candidate.qualityAssessment.suggestions.map(item => ({
        ...item,
        sourceBlockIds: item.sourceBlockIds.filter(id => targetBlockIds.has(id)),
      })),
    },
  }
}

function namespaceCandidate(candidate: ResumeExtractionCandidate, chunkIndex: number): ResumeExtractionCandidate {
  const prefix = `c${String(chunkIndex + 1).padStart(2, '0')}`
  const factIds = new Map(candidate.factCandidates.map(item => [item.factLocalId, `${prefix}_${item.factLocalId}`]))
  const scopeIds = new Map<string, string>()
  const namespacedScopeId = (scopeLocalId: string) => (
    scopeLocalId.startsWith('srv_scope_') ? scopeLocalId : `${prefix}_${scopeLocalId}`
  )
  for (const item of candidate.timelineCandidates) scopeIds.set(item.scopeLocalId, namespacedScopeId(item.scopeLocalId))
  for (const item of candidate.factCandidates) {
    if (!scopeIds.has(item.sourceScopeLocalId)) scopeIds.set(item.sourceScopeLocalId, namespacedScopeId(item.sourceScopeLocalId))
  }
  const mapFacts = (ids: string[]) => ids.map(id => factIds.get(id)).filter((id): id is string => Boolean(id))
  const mapScopes = (ids: string[]) => ids.map(id => scopeIds.get(id)).filter((id): id is string => Boolean(id))
  return {
    ...candidate,
    identityCandidates: candidate.identityCandidates.map(item => ({ ...item, factLocalIds: mapFacts(item.factLocalIds) })),
    timelineCandidates: candidate.timelineCandidates.map(item => ({
      ...item,
      scopeLocalId: scopeIds.get(item.scopeLocalId) ?? `${prefix}_${item.scopeLocalId}`,
      factLocalIds: mapFacts(item.factLocalIds),
    })),
    sectionCandidates: candidate.sectionCandidates.map(item => ({
      ...item,
      sectionLocalId: `${prefix}_${item.sectionLocalId}`,
      scopeLocalIds: mapScopes(item.scopeLocalIds),
      factLocalIds: mapFacts(item.factLocalIds),
    })),
    factCandidates: candidate.factCandidates.map(item => ({
      ...item,
      factLocalId: factIds.get(item.factLocalId) ?? `${prefix}_${item.factLocalId}`,
      sourceScopeLocalId: scopeIds.get(item.sourceScopeLocalId) ?? `${prefix}_${item.sourceScopeLocalId}`,
    })),
    conflicts: candidate.conflicts.map(item => ({
      ...item,
      conflictLocalId: `${prefix}_${item.conflictLocalId}`,
      factLocalIds: mapFacts(item.factLocalIds),
    })),
    qualityAssessment: {
      ...candidate.qualityAssessment,
      strengths: candidate.qualityAssessment.strengths.map(item => ({ ...item, factLocalIds: mapFacts(item.factLocalIds) })),
      weaknesses: candidate.qualityAssessment.weaknesses.map(item => ({ ...item, factLocalIds: mapFacts(item.factLocalIds) })),
    },
  }
}

export function mergeResumeExtractionCandidates(candidates: ResumeExtractionCandidate[]): ResumeExtractionCandidate {
  const namespaced = candidates.map(namespaceCandidate)
  const unique = <T>(values: T[]) => [...new Set(values)]
  const mapped = unique(namespaced.flatMap(item => item.coverageClaim.mappedSourceBlockIds))
  const unmapped = unique(namespaced.flatMap(item => item.coverageClaim.unmappedSourceBlockIds)).filter(id => !mapped.includes(id))
  return {
    schemaVersion: V5_SCHEMA_VERSION,
    identityCandidates: namespaced.flatMap(item => item.identityCandidates),
    timelineCandidates: namespaced.flatMap(item => item.timelineCandidates),
    sectionCandidates: namespaced.flatMap(item => item.sectionCandidates),
    factCandidates: namespaced.flatMap(item => item.factCandidates),
    unmappedFragments: namespaced.flatMap(item => item.unmappedFragments).filter(item => unmapped.includes(item.sourceBlockId)),
    conflicts: namespaced.flatMap(item => item.conflicts),
    coverageClaim: { mappedSourceBlockIds: mapped, unmappedSourceBlockIds: unmapped },
    qualityAssessment: {
      scoreInputs: {
        identityCompleteness: 0,
        timelineCompleteness: 0,
        evidenceResultDensity: 0,
        clarity: 0,
        sectionCoverage: 0,
      },
      strengths: namespaced.flatMap(item => item.qualityAssessment.strengths).slice(0, 5),
      weaknesses: namespaced.flatMap(item => item.qualityAssessment.weaknesses).slice(0, 5),
      suggestions: namespaced.flatMap(item => item.qualityAssessment.suggestions).slice(0, 5),
      capabilitySummary: namespaced.map(item => item.qualityAssessment.capabilitySummary).filter(Boolean).join('；'),
    },
  }
}

function sourceBlockOrder(sourceBlockId: string) {
  const numeric = Number(sourceBlockId.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER)
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER
}

function normalizedOrganization(value: string | null) {
  return (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/(?:连锁)?股份有限公司|有限责任公司|有限公司|集团|公司|数字化中心|产品部/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function normalizedTimelineValue(value: string | null) {
  return (value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '')
}

function looksLikeCareerRole(value: string | null) {
  return /(?:产品|设计|运营|研发|开发|工程|分析|咨询|策略|市场|销售|研究|项目|数据|算法|测试|架构|经理|助理|专员|顾问|总监|负责人|实习|leader|lead|manager|designer|engineer|analyst|consultant|specialist|intern)/iu.test(value ?? '')
}

function deriveTimelineRange(text: string) {
  const date = '(?:19|20)\\d{2}(?:\\s*[./年-]\\s*\\d{1,2}(?:\\s*[月日])?)?'
  const match = text.match(new RegExp(`(${date})\\s*[-–—~至]\\s*(至今|现在|present|${date})`, 'iu'))
  return match ? { start: match[1].trim(), end: match[2].trim() } : null
}

/**
 * P01 may describe visually nested headings as separate timelines. The server
 * repairs only conservative, source-local cases: duplicate organizations with
 * compatible roles, adjacent complementary metadata fragments, and empty child
 * headings. Ambiguous wrappers remain as `other` instead of becoming fake jobs.
 */
export function consolidateResumeExtractionScopes(
  document: CanonicalSourceDocument,
  candidate: ResumeExtractionCandidate
): ResumeExtractionCandidate {
  const blocksById = new Map(document.blocks.map(block => [block.sourceBlockId, block]))
  const factsById = new Map(candidate.factCandidates.map(fact => [fact.factLocalId, fact]))
  const timelines = candidate.timelineCandidates.map(item => {
    const supportingText = item.factLocalIds.map(id => factsById.get(id)?.verbatimText ?? '').join('\n')
    const derivedRange = deriveTimelineRange(supportingText)
    const workKind = item.kind === 'experience' || item.kind === 'internship'
    const wrapperOnly = workKind
      && !item.organization
      && !item.start
      && !item.end
      && Boolean(item.title)
      && !looksLikeCareerRole(item.title)
    return {
      ...item,
      kind: wrapperOnly ? 'other' as const : item.kind,
      title: workKind && !wrapperOnly && item.title && !looksLikeCareerRole(item.title) ? null : item.title,
      start: item.start ?? derivedRange?.start ?? null,
      end: item.end ?? derivedRange?.end ?? null,
    }
  })
  const firstBlock = (item: ResumeExtractionCandidate['timelineCandidates'][number]) => Math.min(
    ...item.factLocalIds.map(id => sourceBlockOrder(factsById.get(id)?.sourceBlockId ?? '')),
    Number.MAX_SAFE_INTEGER
  )
  const ordered = [...timelines].sort((left, right) => firstBlock(left) - firstBlock(right))
  const canonicalByScope = new Map(ordered.map(item => [item.scopeLocalId, item.scopeLocalId]))
  const retained = new Map(ordered.map(item => [item.scopeLocalId, { ...item, factLocalIds: [...item.factLocalIds] }]))

  const sectionHints = (item: ResumeExtractionCandidate['timelineCandidates'][number]) => new Set(
    item.factLocalIds
      .map(id => factsById.get(id)?.sourceBlockId)
      .map(id => id ? blocksById.get(id)?.sectionHint?.trim() : null)
      .filter((value): value is string => Boolean(value))
  )
  const sameSourceSection = (
    left: ResumeExtractionCandidate['timelineCandidates'][number],
    right: ResumeExtractionCandidate['timelineCandidates'][number]
  ) => {
    const leftHints = sectionHints(left)
    const rightHints = sectionHints(right)
    return leftHints.size > 0
      && rightHints.size > 0
      && [...leftHints].some(value => rightHints.has(value))
  }

  const compatibleValue = (left: string | null, right: string | null) => {
    const a = normalizedTimelineValue(left)
    const b = normalizedTimelineValue(right)
    return !a || !b || a === b || a.startsWith(b) || b.startsWith(a)
  }
  const hasTimelineMetadata = (item: ResumeExtractionCandidate['timelineCandidates'][number]) => Boolean(
    item.organization || item.title || item.start || item.end
  )
  const mergeInto = (
    target: ResumeExtractionCandidate['timelineCandidates'][number],
    source: ResumeExtractionCandidate['timelineCandidates'][number]
  ) => {
    target.organization ??= source.organization
    target.title ??= source.title
    target.start ??= source.start
    target.end ??= source.end
    target.factLocalIds = [...new Set([...target.factLocalIds, ...source.factLocalIds])]
    canonicalByScope.set(source.scopeLocalId, target.scopeLocalId)
    retained.delete(source.scopeLocalId)
  }

  for (const source of ordered) {
    const current = retained.get(source.scopeLocalId)
    if (!current) continue
    if (current.kind !== 'experience' && current.kind !== 'internship' && current.kind !== 'education') continue
    const sourceOrder = firstBlock(current)
    const sourceOrg = normalizedOrganization(current.organization)
    const sourceRole = normalizedTimelineValue(current.title)
    const candidates = [...retained.values()]
      .filter(target => target.scopeLocalId !== current.scopeLocalId)
      .filter(target => target.kind === current.kind || (
        ['experience', 'internship'].includes(target.kind) && ['experience', 'internship'].includes(current.kind)
      ))
      .map(target => {
        const distance = Math.abs(sourceOrder - firstBlock(target))
        const targetOrg = normalizedOrganization(target.organization)
        const targetRole = normalizedTimelineValue(target.title)
        const sameOrganization = Boolean(sourceOrg && targetOrg && (
          sourceOrg === targetOrg || sourceOrg.includes(targetOrg) || targetOrg.includes(sourceOrg)
        ))
        const sameRole = Boolean(sourceRole && targetRole && sourceRole === targetRole)
        const organizationConflict = Boolean(sourceOrg && targetOrg && !sameOrganization)
        const roleConflict = Boolean(sourceRole && targetRole && !sameRole)
        const currentSectionHints = sectionHints(current)
        const targetSectionHints = sectionHints(target)
        const sameOrEntirelyUnheadedSourceSection = sameSourceSection(current, target)
          || (currentSectionHints.size === 0 && targetSectionHints.size === 0)
        const crossesServerOwnedScope = current.scopeLocalId !== target.scopeLocalId
          && (
            current.scopeLocalId.startsWith('srv_scope_')
            || target.scopeLocalId.startsWith('srv_scope_')
          )
        const adjacentComplement = distance <= 4
          && sameOrEntirelyUnheadedSourceSection
          && !crossesServerOwnedScope
          && hasTimelineMetadata(current)
          && hasTimelineMetadata(target)
          && !organizationConflict
          && !roleConflict
          && compatibleValue(current.start, target.start)
          && compatibleValue(current.end, target.end)
          && Boolean(
            (!current.organization && target.organization)
            || (!target.organization && current.organization)
            || (!current.title && target.title)
            || (!target.title && current.title)
            || (!current.start && target.start)
            || (!target.start && current.start)
          )
        // Distinct Markdown sections often describe separate projects or
        // responsibility areas at the same employer. Repeated organization or
        // role text alone must never collapse those source scopes. Exact source
        // sections may still be deduplicated when a model emitted two timeline
        // records for the same heading.
        const duplicateCareer = sameSourceSection(current, target)
          && !crossesServerOwnedScope
          && (sameOrganization || sameRole)
          && !roleConflict
          && compatibleValue(current.start, target.start)
          && (compatibleValue(current.end, target.end) || !current.title || !target.title)
        const eligible = adjacentComplement || duplicateCareer
        const score = (sameOrganization ? 12 : 0)
          + (sameRole ? 10 : 0)
          + (adjacentComplement ? 8 : 0)
          - Math.min(distance, 20) / 10
        return { target, eligible, score, distance }
      })
      .filter(item => item.eligible)
      .sort((left, right) => right.score - left.score || left.distance - right.distance)

    const best = candidates[0]?.target
    if (!best) continue
    const target = firstBlock(best) <= sourceOrder ? best : current
    const child = target.scopeLocalId === current.scopeLocalId ? best : current
    mergeInto(target, child)
  }

  const resolveScope = (scopeLocalId: string) => {
    let current = scopeLocalId
    const seen = new Set<string>()
    while (canonicalByScope.get(current) && canonicalByScope.get(current) !== current && !seen.has(current)) {
      seen.add(current)
      current = canonicalByScope.get(current)!
    }
    return current
  }
  const factCandidates = candidate.factCandidates.map(fact => ({
    ...fact,
    sourceScopeLocalId: resolveScope(fact.sourceScopeLocalId),
    numericAtoms: fact.numericAtoms.map(atom => ({
      ...atom,
      ownerScope: resolveScope(fact.sourceScopeLocalId),
    })),
  }))
  const timelineCandidates = [...retained.values()]
    .map(item => ({
      ...item,
      factLocalIds: [...new Set(factCandidates
        .filter(fact => fact.sourceScopeLocalId === item.scopeLocalId)
        .map(fact => fact.factLocalId))],
    }))
    .sort((left, right) => firstBlock(left) - firstBlock(right))
  const validScopeIds = new Set(timelineCandidates.map(item => item.scopeLocalId))
  const sectionCandidates = candidate.sectionCandidates.map(section => ({
    ...section,
    scopeLocalIds: [...new Set(section.scopeLocalIds.map(resolveScope).filter(id => validScopeIds.has(id)))],
  }))
  return { ...candidate, timelineCandidates, factCandidates, sectionCandidates }
}
