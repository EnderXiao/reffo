import type { CanonicalSourceDocument, ResumeExtractionCandidate } from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'

export const DEFAULT_RESUME_EXTRACTION_CONCURRENCY = 2
export const DEFAULT_RESUME_EXTRACTION_CHUNK_RETRY_ATTEMPTS = 1
// Block count is a packing target. A single indivisible experience scope may
// exceed it only while staying inside the hard character/output-cost limits.
export const DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS = 20
export const DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS = 1_000
export const DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS = 13_500
export const RESUME_EXTRACTION_CHUNK_PLAN_VERSION = 'scope-context-output-shards-v5'

export interface ResumeExtractionScopeContext {
  /** Server-owned scope ID shared by every output shard of one source scope. */
  serverScopeLocalId: string
  /** Complete source scope. These blocks are read-only context, not output targets. */
  blocks: CanonicalSourceDocument['blocks']
}

export interface ResumeExtractionScopeAssignment {
  serverScopeLocalId: string
  sourceBlockIds: string[]
}

export interface ResumeExtractionChunk extends CanonicalSourceDocument {
  /** Stable metadata used to merge concurrent responses deterministically. */
  chunkIndex?: number
  sourceOrderStart?: number
  sourceOrderEnd?: number
  /** Present only when one logical scope needs multiple bounded output shards. */
  extractionScopeContext?: ResumeExtractionScopeContext
  /** Server-owned business-scope membership for target blocks. */
  extractionScopeAssignments?: ResumeExtractionScopeAssignment[]
}

export function resumeExtractionFactCandidateLimit(blockCount: number) {
  if (!Number.isSafeInteger(blockCount) || blockCount < 0) {
    throw new RangeError('blockCount must be a non-negative safe integer')
  }
  // Most canonical blocks are already one heading or one complete statement.
  // Three extra slots cover compact identity/contact lines without permitting
  // unbounded overlapping substring extraction in JSON-object transports.
  return blockCount + 3
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
      `P01 单一逻辑范围预计需要 ${metrics.estimatedOutputTokens} 输出 tokens`
      + `（${metrics.blocks} blocks / ${metrics.characters} chars），超过安全容量；为避免拆散事实归属，已阻断。`
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

  for (const block of document.blocks) {
    const heading = parseHeading(block.text)
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

function collectNodeBlocks(node: OutlineNode): CanonicalSourceDocument['blocks'] {
  const blocks = node.heading ? [node.heading] : []
  for (const entry of node.entries) {
    blocks.push(...(isOutlineNode(entry) ? collectNodeBlocks(entry) : [entry]))
  }
  return blocks
}

function isStructuralNode(node: OutlineNode) {
  if (!node.heading || node.level === 1) return true
  return node.title !== null && STRUCTURAL_SECTION_HEADINGS.has(normalizedHeadingTitle(node.title))
}

/**
 * Converts the Markdown outline into indivisible, source-ordered groups. Generic
 * document/section headings may be separated from their children; every
 * non-structural heading owns its complete subtree, so nested headings cannot
 * split one detailed experience or project scope across extraction requests.
 * Text without an explicit scope boundary remains one conservative group.
 */
interface LogicalScopeGroup {
  blocks: CanonicalSourceDocument['blocks']
  serverScopeLocalId?: string
}

function buildLogicalScopeGroups(document: CanonicalSourceDocument) {
  const groups: LogicalScopeGroup[] = []
  const stableScopeId = (blocks: CanonicalSourceDocument['blocks']) => (
    `srv_scope_${document.sha256.slice(0, 12)}_${blocks[0].sourceBlockId}`
  )
  const containsExplicitTimelineRange = (blocks: CanonicalSourceDocument['blocks']) => blocks.some(block => (
    /(?:19|20)\d{2}[.年/-]?\s*\d{0,2}\s*[-–—~至]\s*(?:(?:19|20)\d{2}|至今|现在|present)/iu.test(block.text)
  ))

  const visit = (node: OutlineNode) => {
    if (!isStructuralNode(node)) {
      const blocks = collectNodeBlocks(node)
      groups.push({ blocks, serverScopeLocalId: stableScopeId(blocks) })
      return
    }

    const pushLooseBlocks = (blocks: CanonicalSourceDocument['blocks']) => {
      if (blocks.length === 0) return
      groups.push({
        blocks,
        ...(node.level === 1 && containsExplicitTimelineRange(blocks)
          ? { serverScopeLocalId: stableScopeId(blocks) }
          : {}),
      })
    }
    let looseBlocks = node.heading ? [node.heading] : []
    for (const entry of node.entries) {
      if (!isOutlineNode(entry)) {
        looseBlocks.push(entry)
        continue
      }
      pushLooseBlocks(looseBlocks)
      looseBlocks = []
      visit(entry)
    }
    pushLooseBlocks(looseBlocks)
  }

  visit(buildOutline(document))
  return groups
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

  const metrics = (blocks: CanonicalSourceDocument['blocks']) => {
    const characters = blocks.reduce((sum, block) => sum + block.text.length, 0)
    return {
      blocks: blocks.length,
      characters,
      // P01 emits several typed records for many source blocks. Block count is
      // the dominant cost; characters cover dense prose and long single lines.
      // The strict schema expands each source block into facts, mappings and
      // quality references. Production canaries show block count costs closer
      // to 480 tokens once that repeated structure is included.
      estimatedOutputTokens: 1_200 + blocks.length * 480 + Math.ceil(characters / 4),
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

  if (withinPackingTarget(document.blocks)) return [document]

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
      chunkIndex: chunks.length,
      sourceOrderStart: blocks[0]?.canonicalStart,
      sourceOrderEnd: blocks.at(-1)?.canonicalEnd,
      ...(extractionScopeContext ? { extractionScopeContext } : {}),
      ...(extractionScopeAssignments.length > 0 ? { extractionScopeAssignments } : {}),
    })
  }

  for (const group of buildLogicalScopeGroups(document)) {
    const groupMetrics = metrics(group.blocks)
    if (groupMetrics.characters > maxCharacters) {
      throw new ResumeExtractionChunkCapacityError(groupMetrics)
    }

    if (groupMetrics.estimatedOutputTokens > maxEstimatedOutputTokens) {
      appendChunk(currentBlocks, undefined, currentScopeAssignments)
      currentBlocks = []
      currentScopeAssignments = []

      const extractionScopeContext: ResumeExtractionScopeContext = {
        serverScopeLocalId: group.serverScopeLocalId
          ?? `srv_scope_${document.sha256.slice(0, 12)}_${group.blocks[0].sourceBlockId}`,
        blocks: group.blocks,
      }
      let targetBlocks: CanonicalSourceDocument['blocks'] = []
      for (const block of group.blocks) {
        if (targetBlocks.length > 0 && !withinPackingTarget([...targetBlocks, block])) {
          appendChunk(targetBlocks, extractionScopeContext, [{
            serverScopeLocalId: extractionScopeContext.serverScopeLocalId,
            sourceBlockIds: targetBlocks.map(item => item.sourceBlockId),
          }])
          targetBlocks = []
        }
        const blockMetrics = metrics([block])
        if (!withinHardCapacity(blockMetrics)) throw new ResumeExtractionChunkCapacityError(blockMetrics)
        targetBlocks.push(block)
      }
      appendChunk(targetBlocks, extractionScopeContext, [{
        serverScopeLocalId: extractionScopeContext.serverScopeLocalId,
        sourceBlockIds: targetBlocks.map(item => item.sourceBlockId),
      }])
      continue
    }

    if (currentBlocks.length > 0 && !withinPackingTarget([...currentBlocks, ...group.blocks])) {
      appendChunk(currentBlocks, undefined, currentScopeAssignments)
      currentBlocks = []
      currentScopeAssignments = []
    }

    const assignment = group.serverScopeLocalId
      ? [{ serverScopeLocalId: group.serverScopeLocalId, sourceBlockIds: group.blocks.map(block => block.sourceBlockId) }]
      : []
    if (group.blocks.length > maxBlocks) {
      appendChunk(group.blocks, undefined, assignment)
      continue
    }
    currentBlocks.push(...group.blocks)
    currentScopeAssignments.push(...assignment)
  }
  appendChunk(currentBlocks, undefined, currentScopeAssignments)

  return chunks
}

/**
 * Repeated full-scope blocks are read-only context. Only target-block records
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
      || targetBlockIds.has(context.blocks[0]?.sourceBlockId ?? '')
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
      } else {
        timelineByScope.set(scopeLocalId, { ...item, scopeLocalId, factLocalIds: scopedFactLocalIds })
      }
    }
  }
  const timelineCandidates = [...timelineByScope.values()]
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
  const sourceBlockOrder = (sourceBlockId: string) => {
    const match = sourceBlockId.match(/^(?:B|block[_-]?)(\d+)$/i)
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY
  }
  const firstSourceBlockOrder = (candidate: ResumeExtractionCandidate) => {
    const ids = candidate.factCandidates.map(item => sourceBlockOrder(item.sourceBlockId))
    return ids.length > 0 ? Math.min(...ids) : Number.POSITIVE_INFINITY
  }
  const orderedCandidates = candidates
    .map((candidate, inputIndex) => ({ candidate, inputIndex }))
    .sort((left, right) => (
      firstSourceBlockOrder(left.candidate) - firstSourceBlockOrder(right.candidate)
      || left.inputIndex - right.inputIndex
    ))
    .map(item => item.candidate)
  const namespaced = orderedCandidates.map(namespaceCandidate)
  const unique = <T>(values: T[]) => [...new Set(values)]
  const sortSourceBlockIds = (ids: string[]) => unique(ids).sort((left, right) => (
    sourceBlockOrder(left) - sourceBlockOrder(right) || left.localeCompare(right)
  ))
  const mapped = sortSourceBlockIds(namespaced.flatMap(item => item.coverageClaim.mappedSourceBlockIds))
  const unmapped = sortSourceBlockIds(namespaced.flatMap(item => item.coverageClaim.unmappedSourceBlockIds))
    .filter(id => !mapped.includes(id))
  const factOrder = new Map(mapped.concat(unmapped).map((id, index) => [id, index]))
  const factSort = (left: { sourceBlockId: string }, right: { sourceBlockId: string }) => (
    (factOrder.get(left.sourceBlockId) ?? Number.POSITIVE_INFINITY)
      - (factOrder.get(right.sourceBlockId) ?? Number.POSITIVE_INFINITY)
      || left.sourceBlockId.localeCompare(right.sourceBlockId)
  )
  const minFactOrder = (factLocalIds: string[]) => {
    const indexByFactId = new Map(namespaced.flatMap(item => item.factCandidates)
      .map((item, index) => [item.factLocalId, factOrder.get(item.sourceBlockId) ?? index]))
    const orders = factLocalIds.map(id => indexByFactId.get(id) ?? Number.POSITIVE_INFINITY)
    return orders.length > 0 ? Math.min(...orders) : Number.POSITIVE_INFINITY
  }
  const relatedSort = (left: { factLocalIds: string[] }, right: { factLocalIds: string[] }) => (
    minFactOrder(left.factLocalIds) - minFactOrder(right.factLocalIds)
  )
  const sortedIdentity = namespaced.flatMap(item => item.identityCandidates)
    .sort((left, right) => minFactOrder(left.factLocalIds) - minFactOrder(right.factLocalIds))
  const sortedTimeline = namespaced.flatMap(item => item.timelineCandidates).sort(relatedSort)
  const sortedSections = namespaced.flatMap(item => item.sectionCandidates).sort(relatedSort)
  const sortedFacts = namespaced.flatMap(item => item.factCandidates).sort(factSort)
  const sortedUnmapped = namespaced.flatMap(item => item.unmappedFragments)
    .filter(item => unmapped.includes(item.sourceBlockId))
    .sort(factSort)
  const sortedConflicts = namespaced.flatMap(item => item.conflicts).sort((left, right) => (
    minFactOrder(left.factLocalIds) - minFactOrder(right.factLocalIds)
  ))
  return {
    schemaVersion: V5_SCHEMA_VERSION,
    identityCandidates: sortedIdentity,
    timelineCandidates: sortedTimeline,
    sectionCandidates: sortedSections,
    factCandidates: sortedFacts,
    unmappedFragments: sortedUnmapped,
    conflicts: sortedConflicts,
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
