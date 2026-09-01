import type { CanonicalSourceDocument, ResumeExtractionCandidate } from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'

export const DEFAULT_RESUME_EXTRACTION_CONCURRENCY = 2
// Block count is a packing target. A single indivisible experience scope may
// exceed it only while staying inside the hard character/output-cost limits.
export const DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS = 24
export const DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS = 1_000
export const DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS = 12_500
export const RESUME_EXTRACTION_CHUNK_PLAN_VERSION = 'heading-capacity-safe-v2'

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
function buildLogicalScopeGroups(document: CanonicalSourceDocument) {
  const groups: CanonicalSourceDocument['blocks'][] = []

  const visit = (node: OutlineNode) => {
    if (!isStructuralNode(node)) {
      groups.push(collectNodeBlocks(node))
      return
    }

    let looseBlocks = node.heading ? [node.heading] : []
    for (const entry of node.entries) {
      if (!isOutlineNode(entry)) {
        looseBlocks.push(entry)
        continue
      }
      if (looseBlocks.length > 0) groups.push(looseBlocks)
      looseBlocks = []
      visit(entry)
    }
    if (looseBlocks.length > 0) groups.push(looseBlocks)
  }

  visit(buildOutline(document))
  return groups
}

export function splitResumeDocument(
  document: CanonicalSourceDocument,
  optionsOrMaxBlocks: number | ResumeExtractionChunkOptions = {}
) {
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
      estimatedOutputTokens: 1_200 + blocks.length * 320 + Math.ceil(characters / 4),
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

  const chunks: CanonicalSourceDocument[] = []
  let currentBlocks: CanonicalSourceDocument['blocks'] = []

  const appendChunk = (blocks: CanonicalSourceDocument['blocks']) => {
    if (blocks.length === 0) return
    chunks.push({
      ...document,
      documentId: `${document.documentId}:chunk:${chunks.length + 1}`,
      blocks,
    })
  }

  for (const group of buildLogicalScopeGroups(document)) {
    const groupMetrics = metrics(group)
    if (!withinHardCapacity(groupMetrics)) {
      throw new ResumeExtractionChunkCapacityError(groupMetrics)
    }

    if (currentBlocks.length > 0 && !withinPackingTarget([...currentBlocks, ...group])) {
      appendChunk(currentBlocks)
      currentBlocks = []
    }

    if (group.length > maxBlocks) {
      appendChunk(group)
      continue
    }
    currentBlocks.push(...group)
  }
  appendChunk(currentBlocks)

  return chunks
}

function namespaceCandidate(candidate: ResumeExtractionCandidate, chunkIndex: number): ResumeExtractionCandidate {
  const prefix = `c${String(chunkIndex + 1).padStart(2, '0')}`
  const factIds = new Map(candidate.factCandidates.map(item => [item.factLocalId, `${prefix}_${item.factLocalId}`]))
  const scopeIds = new Map<string, string>()
  for (const item of candidate.timelineCandidates) scopeIds.set(item.scopeLocalId, `${prefix}_${item.scopeLocalId}`)
  for (const item of candidate.factCandidates) {
    if (!scopeIds.has(item.sourceScopeLocalId)) scopeIds.set(item.sourceScopeLocalId, `${prefix}_${item.sourceScopeLocalId}`)
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
