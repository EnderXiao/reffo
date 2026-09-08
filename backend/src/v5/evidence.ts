import { createHash } from 'node:crypto'
import type {
  CanonicalSourceDocument,
  JobExtractionCandidate,
  JobRequirementBundle,
  NumericAtom,
  ResumeEvidenceBundle,
  ResumeExtractionCandidate,
  ValidationIssue,
  ValidationResult,
} from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'
import { bindSourceLineContinuations } from '@/v5/composition/source-continuation-proof'
import { localizeTemporalRisk } from '@/v5/temporal-risk'
import {
  readResumeExtractionScopePlan,
  resumeExtractionFactCandidateLimit,
  resumeExtractionFactCandidateLimitForBlock,
  resumeExtractionFactCandidateStorageLimit,
  resumeExtractionRawFactCandidateLimit,
  type ResumeExtractionChunk,
} from '@/v5/chunked-resume-extraction'

function stableId(prefix: string, parts: Array<string | number>) {
  const digest = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 20)
  return `${prefix}_${digest}`
}

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

export interface ResumeExtractionValidationOptions {
  /**
   * Server-owned number of deterministic P01 shards represented by this
   * candidate. Never derive this value from model-returned IDs.
   */
  trustedShardCount?: number
}

function trustedShardCountForValidation(
  document: CanonicalSourceDocument,
  options?: ResumeExtractionValidationOptions
) {
  const trustedShardCount = options?.trustedShardCount ?? 1
  if (
    !Number.isSafeInteger(trustedShardCount)
    || trustedShardCount < 1
    || trustedShardCount > Math.max(1, document.blocks.length)
  ) {
    throw new RangeError('trustedShardCount must be a positive safe integer bounded by source blocks')
  }
  return trustedShardCount
}

function createIssue(input: Omit<ValidationIssue, 'issueId' | 'severity' | 'outputPath' | 'claimId' | 'evidenceIds' | 'requirementIds' | 'replacementText'> & {
  severity?: ValidationIssue['severity']
  outputPath?: string | null
  evidenceIds?: string[]
  requirementIds?: string[]
}) : ValidationIssue {
  return {
    issueId: stableId('issue', [input.code, input.outputPath ?? '', input.message]),
    severity: input.severity ?? 'error',
    code: input.code,
    outputPath: input.outputPath ?? null,
    claimId: null,
    evidenceIds: input.evidenceIds ?? [],
    requirementIds: input.requirementIds ?? [],
    message: input.message,
    expectedConstraint: input.expectedConstraint,
    replacementText: null,
  }
}

function duplicateValues(values: string[]) {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function hasExecutableInputRisk(flags: string[]) {
  return flags.some(flag => [
    'prompt_injection_like_text',
    'delimiter_breakout_attempt',
    'hidden_markup',
  ].includes(flag))
}

function isLayoutOnlyBlockText(text: string) {
  const trimmed = text.trim()
  return /^!\[[^\]]*\]\([^)]*\)$/.test(trimmed) || /^(?:page|bbox)\s*[=:]/i.test(trimmed)
}

const SOURCE_NUMBER_PATTERN = /(?:(?:(?:日|周|月|季|年)均|每(?:日|周|月|季|年))\s*)?(?:(?:约|近|超过|超|至少|最多|不足|逾)\s*)?(?:[¥￥$]\s*)?\d+(?:[.,]\d+)*(?:%|％|万|亿|千|百|人|次|个|项|家|天|周|月|年|小时|分钟|QPS|ms|MB|GB)?/gi
const SOURCE_NUMBER_QUALIFIERS = ['超过', '至少', '最多', '不足', '约', '近', '超', '逾']
const SOURCE_NUMBER_PERIODS = ['日均', '周均', '月均', '季均', '年均', '每日', '每周', '每月', '每季', '每年']
const SOURCE_NUMBER_UNITS = ['小时', '分钟', 'QPS', 'ms', 'MB', 'GB', '%', '％', '万', '亿', '千', '百', '人', '次', '个', '项', '家', '天', '周', '月', '年']

function numericAtomIsSourceExact(quote: string, atom: NumericAtom) {
  return quote.includes(atom.raw)
    && atom.raw.includes(atom.valueText)
    && (!atom.unit || atom.raw.includes(atom.unit))
    && (!atom.qualifier || atom.raw.includes(atom.qualifier))
    && (!atom.period || atom.raw.includes(atom.period))
}

function deriveSourceNumericAtoms(quote: string, ownerScope: string): NumericAtom[] {
  return [...quote.matchAll(SOURCE_NUMBER_PATTERN)].flatMap(match => {
    const raw = match[0]
    const valueText = raw.match(/\d+(?:[.,]\d+)*/)?.[0]
    if (!valueText) return []
    const suffixUnit = SOURCE_NUMBER_UNITS.find(unit => raw.endsWith(unit)) ?? null
    const currencyUnit = raw.match(/[¥￥$]/)?.[0] ?? null
    return [{
      raw,
      valueText,
      unit: suffixUnit ?? currencyUnit,
      qualifier: SOURCE_NUMBER_QUALIFIERS.find(value => raw.includes(value)) ?? null,
      period: SOURCE_NUMBER_PERIODS.find(value => raw.includes(value)) ?? null,
      ownerScope,
    }]
  })
}

function normalizeSourceNumericAtoms(quote: string, ownerScope: string, atoms: NumericAtom[]) {
  const exactModelAtoms = atoms
    .filter(atom => numericAtomIsSourceExact(quote, atom))
    .map(atom => ({ ...atom, ownerScope }))
  const normalized: NumericAtom[] = []
  const seen = new Set<string>()
  for (const atom of [...deriveSourceNumericAtoms(quote, ownerScope), ...exactModelAtoms]) {
    const key = `${atom.raw}\u0000${atom.valueText}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(atom)
  }
  return normalized
}

function validateRelativeQuote(input: {
  blockText: string
  span: { start: number; end: number }
  quote: string
  path: string
  quoteCode: string
  spanCode: string
}) {
  const issues: ValidationIssue[] = []
  const { start, end } = input.span
  if (start < 0 || end <= start || end > input.blockText.length) {
    issues.push(createIssue({
      code: input.spanCode,
      outputPath: input.path,
      message: `引用位置 ${start}-${end} 超出 source block 边界。`,
      expectedConstraint: 'span 必须定位 source block 内一个非空连续片段',
    }))
    return issues
  }

  if (input.blockText.slice(start, end) !== input.quote) {
    issues.push(createIssue({
      code: input.quoteCode,
      outputPath: input.path,
      message: 'verbatimText 与声明的 source span 不逐字一致。',
      expectedConstraint: 'verbatimText 必须等于 block.text.slice(start, end)',
    }))
  }
  return issues
}

function isRelativeSpanInBounds(blockText: string, span: { start: number; end: number }) {
  return span.start >= 0 && span.end > span.start && span.end <= blockText.length
}

function validateNumericAtoms(input: {
  quote: string
  numericAtoms: Array<{ raw: string; valueText: string; unit: string | null; qualifier: string | null }>
  path: string
}) {
  const issues: ValidationIssue[] = []
  for (const [index, atom] of input.numericAtoms.entries()) {
    if (!input.quote.includes(atom.raw) || !atom.raw.includes(atom.valueText)) {
      issues.push(createIssue({
        code: 'NUMERIC_ATOM_MISMATCH',
        outputPath: `${input.path}.numericAtoms[${index}]`,
        message: `数字事实“${atom.raw}”无法在原文引用中逐字定位。`,
        expectedConstraint: 'numeric atom 的 raw/valueText 必须来自同一 verbatimText',
      }))
    }
    if (atom.qualifier && !atom.raw.includes(atom.qualifier)) {
      issues.push(createIssue({
        code: 'QUALIFIER_EXTRACTION_LOSS',
        outputPath: `${input.path}.numericAtoms[${index}]`,
        message: `限定词“${atom.qualifier}”未与数字 raw 保持为同一事实原子。`,
        expectedConstraint: '数字、限定词和单位必须作为不可拆分原子保留',
      }))
    }
    if (atom.unit && !atom.raw.includes(atom.unit)) {
      issues.push(createIssue({
        code: 'NUMERIC_ATOM_MISMATCH',
        outputPath: `${input.path}.numericAtoms[${index}]`,
        message: `单位“${atom.unit}”未包含在数字 raw 中。`,
        expectedConstraint: '单位必须与数字逐字共存于 raw',
      }))
    }
  }
  return issues
}

type ResumeFactCandidate = ResumeExtractionCandidate['factCandidates'][number]

function isPersistedServerPartitionFact(
  document: CanonicalSourceDocument,
  fact: ResumeFactCandidate
) {
  const expected = stableId('fact_partition', [
    document.sha256,
    fact.sourceBlockId,
    fact.blockRelativeSpan.start,
    fact.blockRelativeSpan.end,
  ])
  if (fact.factLocalId === expected) return true
  if (!fact.factLocalId.endsWith(expected)) return false
  return /^c\d+_$/.test(fact.factLocalId.slice(0, -expected.length))
}

interface IndexedExactFact {
  index: number
  fact: ResumeFactCandidate
  start: number
  end: number
  signature: string
}

interface FactPartitionGroup {
  facts: IndexedExactFact[]
  start: number
  end: number
}

function exactFactForBlock(
  block: CanonicalSourceDocument['blocks'][number],
  fact: ResumeFactCandidate,
  index: number
): IndexedExactFact | null {
  const { start, end } = fact.blockRelativeSpan
  if (
    start < 0
    || end <= start
    || end > block.text.length
    || block.text.slice(start, end) !== fact.verbatimText
  ) return null
  return {
    index,
    fact,
    start,
    end,
    signature: [
      String(start).padStart(8, '0'),
      String(end).padStart(8, '0'),
      fact.proposedStatus,
      fact.claimType,
      fact.verbatimText,
      fact.normalizedClaim,
      fact.factLocalId,
    ].join('\u0000'),
  }
}

function factsOverlap(facts: IndexedExactFact[]) {
  const ordered = [...facts].sort((left, right) => (
    left.start - right.start || left.end - right.end || compareCodePoints(left.signature, right.signature)
  ))
  let furthestEnd = -1
  for (const fact of ordered) {
    if (fact.start < furthestEnd) return true
    furthestEnd = Math.max(furthestEnd, fact.end)
  }
  return false
}

function partitionGroups(facts: IndexedExactFact[]) {
  const ordered = [...facts].sort((left, right) => (
    left.start - right.start
    || left.end - right.end
    || compareCodePoints(left.signature, right.signature)
  ))
  const groups: FactPartitionGroup[] = []
  for (const fact of ordered) {
    const current = groups.at(-1)
    if (!current || fact.start >= current.end) {
      groups.push({ facts: [fact], start: fact.start, end: fact.end })
      continue
    }
    current.facts.push(fact)
    current.end = Math.max(current.end, fact.end)
  }
  return groups
}

function weakestAttribution(facts: IndexedExactFact[]) {
  const rank: Record<ResumeFactCandidate['attributionLevel'], number> = {
    unspecified: 0,
    supported: 1,
    contributed: 2,
    drove: 3,
    owned: 4,
  }
  return facts
    .map(item => item.fact.attributionLevel)
    .sort((left, right) => rank[left] - rank[right])[0]
}

function conservativeStatus(facts: IndexedExactFact[]) {
  if (facts.some(item => item.fact.proposedStatus === 'excluded')) return 'excluded' as const
  if (facts.some(item => item.fact.proposedStatus === 'source_qualified')) return 'source_qualified' as const
  return 'source_supported' as const
}

function coalesceFactPartition(input: {
  document: CanonicalSourceDocument
  block: CanonicalSourceDocument['blocks'][number]
  group: FactPartitionGroup
  serverScopeLocalId?: string
}): ResumeFactCandidate {
  if (input.group.facts.length === 1) return input.group.facts[0].fact
  const facts = input.group.facts
  const verbatimText = input.block.text.slice(input.group.start, input.group.end)
  const modelScopes = [...new Set(facts.map(item => item.fact.sourceScopeLocalId))]
  const hasScopeConflict = !input.serverScopeLocalId && modelScopes.length !== 1
  const sourceScopeLocalId = input.serverScopeLocalId
    ?? (modelScopes.length === 1 ? modelScopes[0] : 'excluded_unresolved')
  const claimTypes = [...new Set(facts.map(item => item.fact.claimType))]
  const fullSpanClaimTypes = [...new Set(facts
    .filter(item => item.start === input.group.start && item.end === input.group.end)
    .map(item => item.fact.claimType))]
  const actionVerbs = [...new Set(facts.map(item => item.fact.sourceActionVerb))]
  const sourceActionVerb = actionVerbs.length === 1
    && actionVerbs[0]
    && verbatimText.includes(actionVerbs[0])
    ? actionVerbs[0]
    : null
  const riskFlags = [...new Set([
    ...facts.flatMap(item => item.fact.riskFlags),
    ...(hasScopeConflict ? ['uncertain' as const] : []),
  ])].sort()
  const qualifiers = [...new Set(facts
    .flatMap(item => item.fact.qualifiers)
    .filter(qualifier => qualifier.length > 0 && verbatimText.includes(qualifier)))]
    .sort((left, right) => verbatimText.indexOf(left) - verbatimText.indexOf(right) || compareCodePoints(left, right))
  const proposedStatus = hasScopeConflict ? 'excluded' as const : conservativeStatus(facts)

  return {
    factLocalId: stableId('fact_partition', [
      input.document.sha256,
      input.block.sourceBlockId,
      input.group.start,
      input.group.end,
    ]),
    sourceBlockId: input.block.sourceBlockId,
    blockRelativeSpan: { start: input.group.start, end: input.group.end },
    verbatimText,
    // A server-created aggregate never reuses a model-authored paraphrase.
    // The exact source slice is conservative and cannot add a new assertion.
    normalizedClaim: verbatimText,
    // A source-exact candidate that already spans the complete union is the
    // most informative safe label. Nested duplicates must not erase its
    // business type and make otherwise-usable resume content disappear.
    claimType: fullSpanClaimTypes.length === 1
      ? fullSpanClaimTypes[0]
      : claimTypes.length === 1 ? claimTypes[0] : 'other',
    sourceScopeLocalId,
    proposedStatus,
    attributionLevel: weakestAttribution(facts),
    sourceActionVerb,
    qualifiers,
    numericAtoms: normalizeSourceNumericAtoms(
      verbatimText,
      sourceScopeLocalId,
      facts.flatMap(item => item.fact.numericAtoms)
    ),
    riskFlags,
  }
}

function normalizeResumeFactPartitions(
  document: CanonicalSourceDocument,
  candidate: ResumeExtractionCandidate,
  scopeBySourceBlockId: ReadonlyMap<string, string>
) {
  // A duplicate model ID makes reference ownership ambiguous. Never allow a
  // later alias-map write to hide it behind otherwise-safe span coalescing.
  if (duplicateValues(candidate.factCandidates.map(fact => fact.factLocalId)).length > 0) {
    return { candidate, normalizedBlockCount: 0, coalescedFactCount: 0 }
  }
  const blocks = new Map(document.blocks.map((block, index) => [block.sourceBlockId, { block, index }]))
  const factsByBlock = new Map<string, Array<{ fact: ResumeFactCandidate; index: number }>>()
  candidate.factCandidates.forEach((fact, index) => {
    const blockFacts = factsByBlock.get(fact.sourceBlockId)
    if (blockFacts) blockFacts.push({ fact, index })
    else factsByBlock.set(fact.sourceBlockId, [{ fact, index }])
  })

  const normalizedBlockIds = new Set<string>()
  const aliases = new Map<string, string>()
  const normalizedFacts: ResumeFactCandidate[] = []
  for (const [sourceBlockId, indexedFacts] of factsByBlock) {
    const source = blocks.get(sourceBlockId)
    if (!source) {
      normalizedFacts.push(...indexedFacts.map(item => item.fact))
      continue
    }
    const exactFacts = indexedFacts.map(item => exactFactForBlock(source.block, item.fact, item.index))
    // Never hide a bad quote/span behind structural normalization. Those facts
    // still go through the ordinary repair path.
    if (exactFacts.some(item => item === null)) {
      normalizedFacts.push(...indexedFacts.map(item => item.fact))
      continue
    }
    const located = exactFacts.filter((item): item is IndexedExactFact => item !== null)
    if (!factsOverlap(located)) {
      normalizedFacts.push(...located.map(item => item.fact))
      continue
    }
    // Only overlapping source intervals are coalesced. Bridging a non-empty
    // semantic gap could silently promote text that the model never selected,
    // including an unrelated number, into a source-supported fact.
    const groups = partitionGroups(located)
    for (const group of groups) {
      const coalesced = coalesceFactPartition({
        document,
        block: source.block,
        group,
        serverScopeLocalId: scopeBySourceBlockId.get(sourceBlockId),
      })
      normalizedFacts.push(coalesced)
      for (const item of group.facts) aliases.set(item.fact.factLocalId, coalesced.factLocalId)
    }
    normalizedBlockIds.add(sourceBlockId)
  }

  if (normalizedBlockIds.size === 0) {
    return { candidate, normalizedBlockCount: 0, coalescedFactCount: 0 }
  }

  const canonicalFacts = [...normalizedFacts].sort((left, right) => {
    const leftBlock = blocks.get(left.sourceBlockId)?.index ?? Number.MAX_SAFE_INTEGER
    const rightBlock = blocks.get(right.sourceBlockId)?.index ?? Number.MAX_SAFE_INTEGER
    return leftBlock - rightBlock
      || left.blockRelativeSpan.start - right.blockRelativeSpan.start
      || left.blockRelativeSpan.end - right.blockRelativeSpan.end
      || compareCodePoints(left.factLocalId, right.factLocalId)
  })
  // A deterministic aggregate ID can still collide with a unique model ID on
  // an untouched singleton. Abort the whole partition rewrite before aliases
  // are applied; the original overlap then remains an unambiguous repair error.
  if (duplicateValues(canonicalFacts.map(fact => fact.factLocalId)).length > 0) {
    return { candidate, normalizedBlockCount: 0, coalescedFactCount: 0 }
  }
  const factOrderById = new Map(canonicalFacts.map((fact, index) => [fact.factLocalId, index]))
  const remapFactIds = (ids: string[]) => [...new Set(ids.map(id => aliases.get(id) ?? id))]
    .sort((left, right) => {
      const leftOrder = factOrderById.get(left)
      const rightOrder = factOrderById.get(right)
      if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder
      if (leftOrder !== undefined) return -1
      if (rightOrder !== undefined) return 1
      return compareCodePoints(left, right)
    })

  return {
    normalizedBlockCount: normalizedBlockIds.size,
    coalescedFactCount: candidate.factCandidates.length - canonicalFacts.length,
    candidate: {
      ...candidate,
      identityCandidates: candidate.identityCandidates
        .map(item => ({ ...item, factLocalIds: remapFactIds(item.factLocalIds) })),
      timelineCandidates: candidate.timelineCandidates.map(item => ({
        ...item,
        factLocalIds: remapFactIds(item.factLocalIds),
      })),
      sectionCandidates: candidate.sectionCandidates.map(item => ({
        ...item,
        factLocalIds: remapFactIds(item.factLocalIds),
      })),
      factCandidates: canonicalFacts,
      conflicts: candidate.conflicts
        .map(item => ({ ...item, factLocalIds: remapFactIds(item.factLocalIds) })),
      qualityAssessment: {
        ...candidate.qualityAssessment,
        strengths: candidate.qualityAssessment.strengths.map(item => ({
          ...item,
          factLocalIds: remapFactIds(item.factLocalIds),
        })),
        weaknesses: candidate.qualityAssessment.weaknesses.map(item => ({
          ...item,
          factLocalIds: remapFactIds(item.factLocalIds),
        })),
      },
      coverageClaim: {
        mappedSourceBlockIds: [...new Set(canonicalFacts.map(fact => fact.sourceBlockId))],
        unmappedSourceBlockIds: [...new Set(candidate.unmappedFragments.map(fragment => fragment.sourceBlockId))]
          .filter(id => !canonicalFacts.some(fact => fact.sourceBlockId === id)),
      },
    },
  }
}

export function validateResumeExtractionCandidate(
  document: CanonicalSourceDocument,
  candidate: ResumeExtractionCandidate,
  options?: ResumeExtractionValidationOptions
): ValidationResult<ResumeExtractionCandidate> {
  const issues: ValidationIssue[] = []
  const trustedShardCount = trustedShardCountForValidation(document, options)
  const rawFactLimit = resumeExtractionRawFactCandidateLimit(document.blocks, trustedShardCount)
  if (candidate.factCandidates.length > rawFactLimit) {
    issues.push(createIssue({
      code: 'FACT_CANDIDATE_ABSOLUTE_LIMIT_EXCEEDED',
      outputPath: 'factCandidates',
      message: `事实候选 ${candidate.factCandidates.length} 条，超过预归一化绝对上限 ${rawFactLimit}。`,
      expectedConstraint: '异常模型或缓存载荷必须在任何分组、排序和引用改写前有界失败',
    }))
    return { passed: false, issues, value: candidate }
  }
  const blocks = new Map(document.blocks.map(block => [block.sourceBlockId, block]))
  const scopePlan = readResumeExtractionScopePlan(document as ResumeExtractionChunk)
  const plannedScopes = new Map(scopePlan.scopes.map(scope => [scope.serverScopeLocalId, scope]))
  const existingMappedBlockIds = new Set(candidate.factCandidates.map(fact => fact.sourceBlockId))
  const promotedUnresolvedFragments = candidate.unmappedFragments.filter(fragment => {
    const block = blocks.get(fragment.sourceBlockId)
    return fragment.importance === 'high'
      && !existingMappedBlockIds.has(fragment.sourceBlockId)
      && Boolean(block)
      && block!.text === fragment.text
      && !hasExecutableInputRisk(block!.inputRiskFlags)
  })
  if (promotedUnresolvedFragments.length > 0) {
    const promotedBlockIds = new Set(promotedUnresolvedFragments.map(fragment => fragment.sourceBlockId))
    candidate = {
      ...candidate,
      factCandidates: [
        ...candidate.factCandidates,
        ...promotedUnresolvedFragments.map(fragment => {
          const block = blocks.get(fragment.sourceBlockId)!
          return {
            factLocalId: stableId('excluded_unresolved', [document.sha256, block.sourceBlockId]),
            sourceBlockId: block.sourceBlockId,
            blockRelativeSpan: { start: 0, end: block.text.length },
            verbatimText: block.text,
            normalizedClaim: block.text,
            claimType: 'other' as const,
            sourceScopeLocalId: 'excluded_unresolved',
            proposedStatus: 'excluded' as const,
            attributionLevel: 'unspecified' as const,
            sourceActionVerb: null,
            qualifiers: [],
            numericAtoms: [],
            riskFlags: ['uncertain' as const],
          }
        }),
      ],
      unmappedFragments: candidate.unmappedFragments.filter(
        fragment => !promotedBlockIds.has(fragment.sourceBlockId)
      ),
    }
    issues.push(createIssue({
      code: 'HIGH_IMPORTANCE_AMBIGUITY_SERVER_EXCLUDED',
      severity: 'warning',
      outputPath: 'unmappedFragments',
      message: `${promotedUnresolvedFragments.length} 个逐字可定位但语义未决的高重要度片段已转为 excluded 证据。`,
      expectedConstraint: '真实材料中的歧义必须保留审计轨迹并禁止生成，但不得阻断其他已验证内容',
    }))
  }
  const coveredAfterAmbiguityNormalization = new Set([
    ...candidate.factCandidates.map(fact => fact.sourceBlockId),
    ...candidate.unmappedFragments.map(fragment => fragment.sourceBlockId),
  ])
  const silentlyDroppedBlocks = document.blocks.filter(block => (
    !coveredAfterAmbiguityNormalization.has(block.sourceBlockId)
    && !isLayoutOnlyBlockText(block.text)
  ))
  if (silentlyDroppedBlocks.length > 0) {
    candidate = {
      ...candidate,
      factCandidates: [
        ...candidate.factCandidates,
        ...silentlyDroppedBlocks.map(block => ({
          factLocalId: stableId('excluded_omitted', [document.sha256, block.sourceBlockId]),
          sourceBlockId: block.sourceBlockId,
          blockRelativeSpan: { start: 0, end: block.text.length },
          verbatimText: block.text,
          normalizedClaim: block.text,
          claimType: 'other' as const,
          sourceScopeLocalId: 'excluded_unresolved',
          proposedStatus: 'excluded' as const,
          attributionLevel: 'unspecified' as const,
          sourceActionVerb: null,
          qualifiers: [],
          numericAtoms: [],
          riskFlags: hasExecutableInputRisk(block.inputRiskFlags)
            ? ['prompt_injection_like_text' as const]
            : ['uncertain' as const],
        })),
      ],
    }
    issues.push(createIssue({
      code: 'SILENT_SOURCE_BLOCK_SERVER_EXCLUDED',
      severity: 'warning',
      outputPath: 'factCandidates',
      message: `${silentlyDroppedBlocks.length} 个被模型漏掉的真实 source blocks 已按完整原文转为 excluded 证据。`,
      expectedConstraint: '模型漏抽取不得制造可用事实，也不得阻断其他内容；服务端仅能保留逐字原文并强制 excluded',
    }))
  }
  const temporal = localizeTemporalRisk(document, candidate, resumeExtractionFactCandidateStorageLimit(document.blocks, trustedShardCount))
  candidate = temporal.candidate
  for (const observation of temporal.observations) issues.push(createIssue({
    code: observation.code, severity: 'warning', outputPath: `factCandidates[${observation.factIndex}].temporalRiskQuote`,
    message: observation.code === 'TEMPORAL_RISK_LOCALIZED'
      ? '时间风险已限定到可逐字定位的完整句，独立当前职责保留限定，风险句仍隔离。'
      : '时间风险缺少可安全隔离的原文依据，保留原有风险处理，不自动清除标签。',
    expectedConstraint: '定位不是真实性认证；不得跨句补义、恢复风险句或增加模型修复调用',
  }))
  const normalizedFacts = candidate.factCandidates.map((fact, index) => {
    const block = blocks.get(fact.sourceBlockId)
    if (!block) return fact
    const quotedSlice = isRelativeSpanInBounds(block.text, fact.blockRelativeSpan)
      ? block.text.slice(fact.blockRelativeSpan.start, fact.blockRelativeSpan.end)
      : null
    let locatedText: string | null = quotedSlice === fact.verbatimText ? fact.verbatimText : null
    let locatedStart = fact.blockRelativeSpan.start
    if (!locatedText && fact.verbatimText.length >= 2) {
      const first = block.text.indexOf(fact.verbatimText)
      const last = block.text.lastIndexOf(fact.verbatimText)
      if (first >= 0 && first === last) {
        locatedText = fact.verbatimText
        locatedStart = first
      }
    }
    let quoteAligned = locatedText
      ? {
          ...fact,
          blockRelativeSpan: { start: locatedStart, end: locatedStart + locatedText.length },
          verbatimText: locatedText,
        }
      : fact
    if (
      quoteAligned.verbatimText !== fact.verbatimText
      || quoteAligned.blockRelativeSpan.start !== fact.blockRelativeSpan.start
      || quoteAligned.blockRelativeSpan.end !== fact.blockRelativeSpan.end
    ) {
      issues.push(createIssue({
        code: 'SOURCE_QUOTE_SPAN_SERVER_ALIGNED',
        severity: 'warning',
        outputPath: `factCandidates[${index}]`,
        message: '事实 quote/span 已由服务端回填为对应 canonical source block 的逐字内容。',
        expectedConstraint: 'EvidenceAtom 的 quote 必须逐字可定位，且不得使用模型改写文本作为 verbatimText',
      }))
    }
    const riskFlags = hasExecutableInputRisk(block.inputRiskFlags)
      ? [...new Set([...quoteAligned.riskFlags, 'prompt_injection_like_text' as const])]
      : quoteAligned.riskFlags
    const mustExclude = riskFlags.includes('prompt_injection_like_text')
      || (
        quoteAligned.proposedStatus === 'source_supported'
        && (riskFlags.includes('conflicting') || riskFlags.includes('future_or_planned'))
      )
    const safetyAligned = mustExclude
      ? { ...quoteAligned, riskFlags, proposedStatus: 'excluded' as const }
      : { ...quoteAligned, riskFlags }
    if (
      safetyAligned.proposedStatus !== quoteAligned.proposedStatus
      || safetyAligned.riskFlags.length !== quoteAligned.riskFlags.length
    ) {
      issues.push(createIssue({
        code: 'UNSAFE_EVIDENCE_SERVER_EXCLUDED',
        severity: 'warning',
        outputPath: `factCandidates[${index}].proposedStatus`,
        message: '风险事实已由服务端补齐风险标记并强制设为 excluded。',
        expectedConstraint: '注入、冲突或未来规划事实不得作为可用简历证据',
      }))
    }
    const numericAtoms = normalizeSourceNumericAtoms(
      safetyAligned.verbatimText,
      safetyAligned.sourceScopeLocalId,
      safetyAligned.numericAtoms
    )
    if (JSON.stringify(numericAtoms) !== JSON.stringify(safetyAligned.numericAtoms)) {
      issues.push(createIssue({
        code: 'NUMERIC_ATOMS_SERVER_ALIGNED',
        severity: 'warning',
        outputPath: `factCandidates[${index}].numericAtoms`,
        message: '数字原子已由服务端按 verbatimText 重建；删除了非原文标注并补齐可逐字定位的阿拉伯数字短语。',
        expectedConstraint: 'numericAtoms 只是源文派生索引，raw/value/unit/qualifier/period 必须逐字可定位',
      }))
    }
    return { ...safetyAligned, numericAtoms }
  })
  const partitionNormalization = normalizeResumeFactPartitions(
    document,
    { ...candidate, factCandidates: normalizedFacts },
    scopePlan.scopeBySourceBlockId
  )
  candidate = partitionNormalization.candidate
  if (partitionNormalization.normalizedBlockCount > 0) {
    issues.push(createIssue({
      code: 'FACT_CANDIDATE_PARTITION_SERVER_COALESCED',
      severity: 'warning',
      outputPath: 'factCandidates',
      message: `${partitionNormalization.normalizedBlockCount} 个 source blocks 包含服务端规范化的重叠事实分区。`,
      expectedConstraint: '只允许合并相互重叠的逐字 span；引用须重映射且事实状态不得升级',
    }))
  } else {
    const persistedPartitionBlockCount = new Set(candidate.factCandidates
      .filter(fact => isPersistedServerPartitionFact(document, fact))
      .map(fact => fact.sourceBlockId)).size
    if (persistedPartitionBlockCount > 0) {
      issues.push(createIssue({
        code: 'FACT_CANDIDATE_PARTITION_SERVER_COALESCED',
        severity: 'warning',
        outputPath: 'factCandidates',
        message: `${persistedPartitionBlockCount} 个 source blocks 包含服务端规范化的重叠事实分区。`,
        expectedConstraint: '只允许合并相互重叠的逐字 span；引用须重映射且事实状态不得升级',
      }))
    }
  }
  const partitionedFacts = candidate.factCandidates
  const factCandidateLimit = resumeExtractionFactCandidateLimit(document.blocks)
  const storageFactLimit = resumeExtractionFactCandidateStorageLimit(
    document.blocks,
    trustedShardCount
  )
  if (partitionedFacts.length > factCandidateLimit) {
    issues.push(createIssue({
      code: 'FACT_CANDIDATE_DENSITY_EXCEEDED',
      severity: 'warning',
      outputPath: 'factCandidates',
      message: `事实候选 ${partitionedFacts.length} 条，超过当前 ${document.blocks.length} 个 source blocks 的安全上限 ${factCandidateLimit}。`,
      expectedConstraint: '事实密度仅作为成本与粒度遥测；transport/storage 使用独立硬上限',
    }))
  }
  if (partitionedFacts.length > storageFactLimit) {
    issues.push(createIssue({
      code: 'FACT_CANDIDATE_TRANSPORT_LIMIT_EXCEEDED',
      outputPath: 'factCandidates',
      message: `事实候选 ${partitionedFacts.length} 条，超过 transport/storage 硬上限 ${storageFactLimit}。`,
      expectedConstraint: '归一化后的事实总数不得超过代码定义的有界传输与存储上限',
    }))
  }
  const normalizedFactsById = new Map(partitionedFacts.map(fact => [fact.factLocalId, fact]))
  const factsByBlock = new Map<string, typeof partitionedFacts>()
  for (const fact of partitionedFacts) {
    const blockFacts = factsByBlock.get(fact.sourceBlockId)
    if (blockFacts) blockFacts.push(fact)
    else factsByBlock.set(fact.sourceBlockId, [fact])
  }
  for (const [sourceBlockId, blockFacts] of factsByBlock) {
    const block = blocks.get(sourceBlockId)
    if (!block) continue
    const blockLimit = resumeExtractionFactCandidateLimitForBlock(block)
    if (blockFacts.length > blockLimit) {
      issues.push(createIssue({
        code: 'FACT_CANDIDATE_BLOCK_DENSITY_EXCEEDED',
        severity: 'warning',
        outputPath: 'factCandidates',
        message: `${sourceBlockId} 输出 ${blockFacts.length} 条事实，超过该 block 的代码上限 ${blockLimit}。`,
        expectedConstraint: '密度仅作为成本与粒度遥测；逐字、有效且互不重叠的事实不得因此触发模型返修',
      }))
    }
    const orderedFacts = [...blockFacts].sort((left, right) => (
      left.blockRelativeSpan.start - right.blockRelativeSpan.start
      || left.blockRelativeSpan.end - right.blockRelativeSpan.end
      || compareCodePoints(left.factLocalId, right.factLocalId)
    ))
    let furthest = orderedFacts[0]
    for (let index = 1; index < orderedFacts.length; index += 1) {
      const current = orderedFacts[index]
      if (current.blockRelativeSpan.start < furthest.blockRelativeSpan.end) {
        issues.push(createIssue({
          code: 'FACT_CANDIDATE_SOURCE_OVERLAP',
          outputPath: 'factCandidates',
          message: `${sourceBlockId} 中 ${furthest.factLocalId} 与 ${current.factLocalId} 的原文 span 重叠。`,
          expectedConstraint: '同一 source block 的事实 quote 必须按 UTF-16 半开区间互不重叠；数字和短语应留在所属完整事实内',
        }))
      }
      if (current.blockRelativeSpan.end > furthest.blockRelativeSpan.end) furthest = current
    }
  }
  const scopeAlignedTimelineCandidates = candidate.timelineCandidates.map(timeline => ({
    ...timeline,
    factLocalIds: [...new Set([
      ...timeline.factLocalIds.filter(id => normalizedFactsById.get(id)?.sourceScopeLocalId === timeline.scopeLocalId),
      ...partitionedFacts
        .filter(fact => fact.sourceScopeLocalId === timeline.scopeLocalId)
        .map(fact => fact.factLocalId),
    ])],
  }))
  const normalizedTimeline = scopeAlignedTimelineCandidates.map((timeline, index) => {
    const supportingText = timeline.factLocalIds
      .map(id => normalizedFactsById.get(id)?.verbatimText ?? '')
      .join('\n')
    let changed = false
    const exactOrNull = (value: string | null) => {
      if (!value || supportingText.includes(value)) return value
      changed = true
      return null
    }
    const normalized = {
      ...timeline,
      organization: exactOrNull(timeline.organization),
      title: exactOrNull(timeline.title),
      start: exactOrNull(timeline.start),
      end: exactOrNull(timeline.end),
    }
    if (changed) {
      issues.push(createIssue({
        code: 'UNSUPPORTED_TIMELINE_VALUE_DROPPED',
        severity: 'warning',
        outputPath: `timelineCandidates[${index}]`,
        message: '无法在同 scope 逐字证据中定位的时间线字段已由服务端置空。',
        expectedConstraint: '公司、学校、项目、职位和日期只能使用同 scope 逐字支持值',
      }))
    }
    return normalized
  })
  const businessTimelines = normalizedTimeline
    .filter(item => ['experience', 'internship', 'project', 'research'].includes(item.kind))
  const broadSectionHeading = /^(?:个人信息|基本信息|个人简介|工作经历|实习经历|项目经历|研究经历|教育背景|专业技能|技能|证书|语言|获奖|作品集|experience|projects?|research|education|skills?)$/i
  for (const timeline of businessTimelines) {
    const scopeLocalId = timeline.scopeLocalId
    const scopeFacts = partitionedFacts.filter(fact => fact.sourceScopeLocalId === scopeLocalId)
    const sectionHints = new Set(scopeFacts
      .map(fact => blocks.get(fact.sourceBlockId)?.sectionHint?.trim())
      .filter((value): value is string => Boolean(value && !broadSectionHeading.test(value))))

    const plannedScope = plannedScopes.get(scopeLocalId)
    const hasTrustedPlannedMembership = Boolean(
      plannedScope?.hasCompleteScopeContext
      && plannedScope.hasTrustedAnchorContext
      && plannedScope.timelineAnchorBlockIds.length > 0
      && scopeFacts.length > 0
      && scopeFacts.every(fact => (
        scopePlan.scopeBySourceBlockId.get(fact.sourceBlockId) === scopeLocalId
        && plannedScope.memberBlockIds.includes(fact.sourceBlockId)
      ))
    )
    const claimsServerOwnedScope = scopeLocalId.startsWith('srv_scope_')
    if (claimsServerOwnedScope && !hasTrustedPlannedMembership) {
      issues.push(createIssue({
        code: 'SOURCE_SCOPE_SECTION_MISMATCH',
        outputPath: 'factCandidates.sourceScopeLocalId',
        message: `业务 scope ${scopeLocalId} 的事实归属与服务端 deterministic scope plan 不一致。`,
        expectedConstraint: '服务端 scope ID 只能覆盖 scope plan 明确归入该经历、项目或研究的 source blocks',
      }))
      continue
    }

    if (sectionHints.size > 1) {
      if (hasTrustedPlannedMembership) {
        issues.push(createIssue({
          code: 'SOURCE_SCOPE_CHILD_SECTION_INHERITED',
          severity: 'warning',
          outputPath: 'factCandidates.sourceScopeLocalId',
          message: `业务 scope ${scopeLocalId} 的子标题已按服务端 scope plan 继承同一时间线锚点。`,
          expectedConstraint: '只有 deterministic scope plan 明确归属同一 scope 的父岗位与子节才能跨 source section',
        }))
        continue
      }
      issues.push(createIssue({
        code: 'SOURCE_SCOPE_SECTION_MISMATCH',
        outputPath: 'factCandidates.sourceScopeLocalId',
        message: `业务 scope ${scopeLocalId} 横跨多个原始标题：${[...sectionHints].join('、')}。`,
        expectedConstraint: '不同工作、项目或研究标题下的事实必须由提取器建立不同 scope',
      }))
    }
  }
  const detailedAddressPattern = /(?:身份证|身份证号|居民身份证|\d{6}(?:19|20)\d{2}[01]\d[0-3]\d\d{3}[\dXx])|(?:省|市|自治区).{0,20}(?:区|县).{0,20}(?:街道|路|巷|弄|号楼|室)/
  const normalizedIdentity = candidate.identityCandidates.filter((identity, index) => {
    if (identity.field !== 'city_level_location' || !detailedAddressPattern.test(identity.value)) return true
    issues.push(createIssue({
      code: 'DETAILED_LOCATION_IDENTITY_DROPPED',
      severity: 'warning',
      outputPath: `identityCandidates[${index}]`,
      message: '包含街道或门牌级信息的地点未进入城市级简历身份字段。',
      expectedConstraint: '简历身份仅允许城市级地点；详细地址只能留在受保护源证据中',
    }))
    return false
  })
  candidate = {
    ...candidate,
    factCandidates: partitionedFacts,
    timelineCandidates: normalizedTimeline,
    identityCandidates: normalizedIdentity,
  }
  const factMappedBlockIds = new Set(candidate.factCandidates.map(fact => fact.sourceBlockId))
  const nonOverlappingUnmapped = candidate.unmappedFragments.filter(fragment => !factMappedBlockIds.has(fragment.sourceBlockId))
  if (nonOverlappingUnmapped.length !== candidate.unmappedFragments.length) {
    issues.push(createIssue({
      code: 'OVERLAPPING_UNMAPPED_FRAGMENT_DROPPED',
      severity: 'warning',
      outputPath: 'unmappedFragments',
      message: '已由逐字事实覆盖的 source block 不再重复声明为 unmapped。',
      expectedConstraint: 'block 级 mapped/unmapped 集合必须互斥，mapped 证据优先',
    }))
    candidate = { ...candidate, unmappedFragments: nonOverlappingUnmapped }
  }
  const conflictFactIdsToExclude = new Set<string>()
  const normalizedConflicts = candidate.conflicts.map(conflict => {
    const facts = conflict.factLocalIds
      .map(id => candidate.factCandidates.find(fact => fact.factLocalId === id))
      .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact))
    const retainIsSafe = conflict.proposedResolution === 'retain_with_qualifier'
      && facts.length === conflict.factLocalIds.length
      && facts.every(fact => fact.qualifiers.length > 0)
    if (conflict.proposedResolution !== 'retain_with_qualifier' || !retainIsSafe) {
      for (const factId of conflict.factLocalIds) conflictFactIdsToExclude.add(factId)
      return retainIsSafe ? conflict : { ...conflict, proposedResolution: 'needs_user_confirmation' as const }
    }
    return conflict
  })
  if (conflictFactIdsToExclude.size > 0) {
    issues.push(createIssue({
      code: 'UNRESOLVED_CONFLICT_SERVER_EXCLUDED',
      severity: 'warning',
      outputPath: 'conflicts',
      message: '排除、待确认或缺少限定词的冲突事实已由服务端强制设为 excluded。',
      expectedConstraint: '未解决冲突绝不进入可用 EvidenceAtom',
    }))
    candidate = {
      ...candidate,
      conflicts: normalizedConflicts,
      factCandidates: candidate.factCandidates.map(fact => conflictFactIdsToExclude.has(fact.factLocalId)
        ? {
            ...fact,
            proposedStatus: 'excluded' as const,
            riskFlags: [...new Set([...fact.riskFlags, 'conflicting' as const])],
          }
        : fact),
    }
  }
  const factIds = new Set(candidate.factCandidates.map(fact => fact.factLocalId))
  const derivedScopeIds = new Set(candidate.timelineCandidates.map(timeline => timeline.scopeLocalId))
  const identityCandidates = candidate.identityCandidates.map(identity => ({
    ...identity,
    factLocalIds: identity.factLocalIds.filter(id => factIds.has(id)),
  }))
  const timelineCandidates = candidate.timelineCandidates.map(timeline => ({
    ...timeline,
    factLocalIds: timeline.factLocalIds.filter(id => factIds.has(id)),
  }))
  const sectionCandidates = candidate.sectionCandidates.map(section => ({
    ...section,
    factLocalIds: section.factLocalIds.filter(id => factIds.has(id)),
    scopeLocalIds: section.scopeLocalIds.filter(id => derivedScopeIds.has(id)),
  }))
  const referencesChanged = identityCandidates.some((item, index) => item.factLocalIds.length !== candidate.identityCandidates[index].factLocalIds.length)
    || timelineCandidates.some((item, index) => item.factLocalIds.length !== candidate.timelineCandidates[index].factLocalIds.length)
    || sectionCandidates.some((item, index) => (
      item.factLocalIds.length !== candidate.sectionCandidates[index].factLocalIds.length
      || item.scopeLocalIds.length !== candidate.sectionCandidates[index].scopeLocalIds.length
    ))
  if (referencesChanged) {
    issues.push(createIssue({
      code: 'UNKNOWN_DERIVED_REFERENCE_DROPPED',
      severity: 'warning',
      outputPath: 'identityCandidates/timelineCandidates/sectionCandidates',
      message: '身份、时间线或章节中的未知 fact/scope 派生引用已由服务端移除。',
      expectedConstraint: '派生结构只能引用当前候选中存在的 factLocalId 和 scopeLocalId',
    }))
    candidate = { ...candidate, identityCandidates, timelineCandidates, sectionCandidates }
  }
  const scopeKinds = new Map<string, string>()

  for (const duplicate of duplicateValues(candidate.factCandidates.map(fact => fact.factLocalId))) {
    issues.push(createIssue({
      code: 'DUPLICATE_FACT_CANDIDATE',
      outputPath: 'factCandidates',
      message: `factLocalId 重复：${duplicate}`,
      expectedConstraint: '每个事实候选 ID 必须唯一',
    }))
  }

  for (const [index, fact] of candidate.factCandidates.entries()) {
    const path = `factCandidates[${index}]`
    const block = blocks.get(fact.sourceBlockId)
    if (!block) {
      issues.push(createIssue({
        code: 'SOURCE_QUOTE_NOT_FOUND',
        outputPath: `${path}.sourceBlockId`,
        message: `事实引用了不存在的 source block：${fact.sourceBlockId}`,
        expectedConstraint: '每个事实必须引用 canonical document 中的 block',
      }))
      continue
    }
    if (hasExecutableInputRisk(block.inputRiskFlags)) {
      if (!fact.riskFlags.includes('prompt_injection_like_text') || fact.proposedStatus !== 'excluded') {
        issues.push(createIssue({
          code: 'PROMPT_INJECTION_EVIDENCE_ENABLED',
          outputPath: path,
          message: '疑似 Prompt 注入文本未被标记并排除。',
          expectedConstraint: '来自注入风险 block 的事实必须带 prompt_injection_like_text 且为 excluded',
        }))
      }
    }
    issues.push(...validateRelativeQuote({
      blockText: block.text,
      span: fact.blockRelativeSpan,
      quote: fact.verbatimText,
      path,
      quoteCode: 'SOURCE_QUOTE_NOT_FOUND',
      spanCode: 'SOURCE_SPAN_MISMATCH',
    }))
    issues.push(...validateNumericAtoms({ quote: fact.verbatimText, numericAtoms: fact.numericAtoms, path }))

    const absoluteStart = block.canonicalStart + fact.blockRelativeSpan.start
    const absoluteEnd = block.canonicalStart + fact.blockRelativeSpan.end
    if (absoluteStart < block.canonicalStart || absoluteEnd > block.canonicalEnd) {
      issues.push(createIssue({
        code: 'SOURCE_SPAN_MISMATCH',
        outputPath: `${path}.blockRelativeSpan`,
        message: '相对位置无法安全映射到 canonical source 的绝对位置。',
        expectedConstraint: '绝对 span 必须完全位于对应 source block',
      }))
    }

    if (fact.riskFlags.includes('prompt_injection_like_text') && fact.proposedStatus !== 'excluded') {
      issues.push(createIssue({
        code: 'UNSAFE_EVIDENCE_STATUS',
        outputPath: `${path}.proposedStatus`,
        message: '疑似 Prompt 注入文本不得作为可用候选人事实。',
        expectedConstraint: 'prompt_injection_like_text 必须标记 excluded',
      }))
    }
    if (
      (fact.riskFlags.includes('conflicting') || fact.riskFlags.includes('future_or_planned'))
      && fact.proposedStatus === 'source_supported'
    ) {
      issues.push(createIssue({
        code: 'UNSAFE_EVIDENCE_STATUS',
        outputPath: `${path}.proposedStatus`,
        message: '冲突或未来规划事实必须带限定使用或排除。',
        expectedConstraint: 'conflicting/future_or_planned 只能 source_qualified 或 excluded',
      }))
    }
  }

  for (const [index, timeline] of candidate.timelineCandidates.entries()) {
    const existingKind = scopeKinds.get(timeline.scopeLocalId)
    if (existingKind && existingKind !== timeline.kind) {
      issues.push(createIssue({
        code: 'SCOPE_COLLISION',
        outputPath: `timelineCandidates[${index}].scopeLocalId`,
        message: `同一 scopeLocalId 同时用于 ${existingKind} 和 ${timeline.kind}。`,
        expectedConstraint: '不同经历、项目、研究和教育必须使用不同 scope',
      }))
    }
    scopeKinds.set(timeline.scopeLocalId, timeline.kind)
    for (const factId of timeline.factLocalIds) {
      if (!factIds.has(factId)) {
        issues.push(createIssue({
          code: 'UNKNOWN_FACT_REFERENCE',
          outputPath: `timelineCandidates[${index}].factLocalIds`,
          message: `时间线引用不存在的 factLocalId：${factId}`,
          expectedConstraint: '时间线只能引用当前提取结果内的事实',
        }))
      }
    }
    const supportingText = timeline.factLocalIds
      .map(id => candidate.factCandidates.find(fact => fact.factLocalId === id)?.verbatimText ?? '')
      .join('\n')
    for (const [field, value] of Object.entries({
      organization: timeline.organization,
      title: timeline.title,
      start: timeline.start,
      end: timeline.end,
    })) {
      if (value && !supportingText.includes(value)) {
        issues.push(createIssue({
          code: 'TIMELINE_VALUE_UNSUPPORTED',
          outputPath: `timelineCandidates[${index}].${field}`,
          message: `时间线值“${value}”无法在所引事实中逐字定位。`,
          expectedConstraint: '公司、学校、项目、职位和日期必须由同 scope 事实逐字支持',
        }))
      }
    }
  }

  const extractionScopeContext = (document as ResumeExtractionChunk).extractionScopeContext
  const targetBlockIds = new Set(document.blocks.map(block => block.sourceBlockId))
  const contextBlockIds = new Set(extractionScopeContext?.blocks.map(block => block.sourceBlockId) ?? [])
  const continuationScopeIds = new Set(scopePlan.scopes
    .filter(scope => (
      extractionScopeContext?.serverScopeLocalId === scope.serverScopeLocalId
      && scope.hasCompleteScopeContext
      && scope.hasTrustedAnchorContext
      && scope.timelineAnchorBlockIds.length > 0
      && scope.timelineAnchorBlockIds.every(id => contextBlockIds.has(id))
      && scope.timelineAnchorBlockIds.every(id => !targetBlockIds.has(id))
    ))
    .map(scope => scope.serverScopeLocalId))
  const orphanBusinessFacts = candidate.factCandidates.filter(fact => (
    fact.proposedStatus !== 'excluded'
    && ['responsibility', 'action', 'deliverable', 'result'].includes(fact.claimType)
    && !scopeKinds.has(fact.sourceScopeLocalId)
    && !(
      continuationScopeIds.has(fact.sourceScopeLocalId)
      && scopePlan.scopeBySourceBlockId.get(fact.sourceBlockId) === fact.sourceScopeLocalId
    )
  ))
  if (orphanBusinessFacts.length > 0) {
    issues.push(createIssue({
      code: 'BUSINESS_FACT_WITHOUT_TIMELINE',
      outputPath: 'factCandidates.sourceScopeLocalId',
      message: `${orphanBusinessFacts.length} 条可用业务事实没有对应 timeline，继续执行会静默丢失真实经历。`,
      expectedConstraint: '每条可用 responsibility/action/deliverable/result 必须归属一个已提取 timeline；只有 scope plan 可证明完整成员和锚点上下文的非 anchor shard 可暂时省略 timeline',
    }))
  }

  const alreadyCoveredBlocks = new Set([
    ...candidate.factCandidates.map(fact => fact.sourceBlockId),
    ...candidate.unmappedFragments.map(fragment => fragment.sourceBlockId),
  ])
  const layoutOnlyBlocks = document.blocks.filter(block => (
    !alreadyCoveredBlocks.has(block.sourceBlockId)
    && isLayoutOnlyBlockText(block.text)
  ))
  if (layoutOnlyBlocks.length > 0) {
    issues.push(createIssue({
      code: 'LAYOUT_ONLY_BLOCK_AUTO_UNMAPPED',
      severity: 'warning',
      outputPath: 'unmappedFragments',
      message: `${layoutOnlyBlocks.length} 个图片或分页定位块已由服务端标记为低重要度 unmapped。`,
      expectedConstraint: '纯版式占位符不得成为候选人事实，但必须显式计入覆盖集合',
    }))
    candidate = {
      ...candidate,
      unmappedFragments: [
        ...candidate.unmappedFragments,
        ...layoutOnlyBlocks.map(block => ({
          sourceBlockId: block.sourceBlockId,
          text: block.text,
          reason: 'layout_only_block',
          importance: 'low' as const,
        })),
      ],
    }
  }

  const mapped = new Set(candidate.factCandidates.map(fact => fact.sourceBlockId))
  const unmapped = new Set(candidate.unmappedFragments.map(fragment => fragment.sourceBlockId))
  const claimedMapped = new Set(candidate.coverageClaim.mappedSourceBlockIds)
  const claimedUnmapped = new Set(candidate.coverageClaim.unmappedSourceBlockIds)
  if ([...mapped].some(id => unmapped.has(id))) {
    issues.push(createIssue({
      code: 'COVERAGE_SET_OVERLAP',
      outputPath: 'coverageClaim',
      message: '同一 source block 同时被声明为 mapped 和 unmapped。',
      expectedConstraint: 'mapped 与 unmapped 集合必须互斥',
    }))
  }
  if (
    mapped.size !== claimedMapped.size
    || [...mapped].some(id => !claimedMapped.has(id))
    || unmapped.size !== claimedUnmapped.size
    || [...unmapped].some(id => !claimedUnmapped.has(id))
  ) {
    issues.push(createIssue({
      code: 'COVERAGE_CLAIM_MISMATCH',
      severity: 'warning',
      outputPath: 'coverageClaim',
      message: '模型声明的 mapped/unmapped block 与实际事实和未映射片段不一致。',
      expectedConstraint: 'coverageClaim 由服务端从 factCandidates/unmappedFragments 重算并覆盖',
    }))
  }
  for (const block of document.blocks) {
    if (!mapped.has(block.sourceBlockId) && !unmapped.has(block.sourceBlockId)) {
      issues.push(createIssue({
        code: 'BLOCK_SILENTLY_DROPPED',
        outputPath: block.sourceBlockId,
        message: `source block ${block.sourceBlockId} 未映射且未列为 unmapped。`,
        expectedConstraint: '每个 source block 必须被映射或显式列为 unmapped',
      }))
    }
  }

  for (const [index, fragment] of candidate.unmappedFragments.entries()) {
    if (!blocks.has(fragment.sourceBlockId)) {
      issues.push(createIssue({
        code: 'SOURCE_QUOTE_NOT_FOUND',
        outputPath: `unmappedFragments[${index}].sourceBlockId`,
        message: `未映射片段引用不存在的 block：${fragment.sourceBlockId}`,
        expectedConstraint: 'unmapped fragment 必须来自 canonical source',
      }))
    }
    if (fragment.importance === 'high') {
      issues.push(createIssue({
        code: 'HIGH_IMPORTANCE_UNMAPPED',
        outputPath: `unmappedFragments[${index}]`,
        message: `高重要度内容尚未安全映射：${fragment.sourceBlockId}`,
        expectedConstraint: '高重要度未映射数量必须为 0 才能进入生成',
      }))
    }
  }

  for (const [index, identity] of candidate.identityCandidates.entries()) {
    for (const factId of identity.factLocalIds) {
      if (!factIds.has(factId)) {
        issues.push(createIssue({
          code: 'INVALID_IDENTITY_INFERENCE',
          outputPath: `identityCandidates[${index}].factLocalIds`,
          message: `身份字段引用不存在的事实：${factId}`,
          expectedConstraint: '身份值必须由事实候选直接支持',
        }))
      }
    }
    const supportingText = identity.factLocalIds.map(id => candidate.factCandidates.find(fact => fact.factLocalId === id)?.verbatimText ?? '').join('\n')
    if (!supportingText.includes(identity.value)) {
      issues.push(createIssue({
        code: 'INVALID_IDENTITY_INFERENCE',
        outputPath: `identityCandidates[${index}].value`,
        message: `身份值“${identity.value}”无法在引用事实中逐字定位。`,
        expectedConstraint: '姓名、联系方式、地点和链接必须由所引事实逐字支持',
      }))
    }
  }

  const scopeIds = new Set(candidate.timelineCandidates.map(item => item.scopeLocalId))
  for (const [index, section] of candidate.sectionCandidates.entries()) {
    const unknownFacts = section.factLocalIds.filter(id => !factIds.has(id))
    const unknownScopes = section.scopeLocalIds.filter(id => !scopeIds.has(id))
    if (unknownFacts.length > 0 || unknownScopes.length > 0) {
      issues.push(createIssue({
        code: 'UNKNOWN_SECTION_REFERENCE',
        outputPath: `sectionCandidates[${index}]`,
        message: '章节引用了不存在的 fact 或 scope。',
        expectedConstraint: 'section 只能引用当前候选内的事实和时间线 scope',
      }))
    }
  }

  const factsById = new Map(candidate.factCandidates.map(fact => [fact.factLocalId, fact]))
  for (const [index, conflict] of candidate.conflicts.entries()) {
    const conflictFacts = conflict.factLocalIds.map(id => factsById.get(id))
    if (conflictFacts.some(fact => !fact)) {
      issues.push(createIssue({
        code: 'UNKNOWN_FACT_REFERENCE',
        outputPath: `conflicts[${index}].factLocalIds`,
        message: '冲突组引用了不存在的事实候选。',
        expectedConstraint: '冲突组只能引用当前提取结果内的 factLocalId',
      }))
      continue
    }
    if (
      (conflict.proposedResolution === 'exclude_conflicting_claim' || conflict.proposedResolution === 'needs_user_confirmation')
      && conflictFacts.some(fact => fact?.proposedStatus !== 'excluded')
    ) {
      issues.push(createIssue({
        code: 'UNRESOLVED_CONFLICT_ENABLED',
        outputPath: `conflicts[${index}]`,
        message: '未解决或明确排除的冲突事实仍被标记为可用。',
        expectedConstraint: '需要用户确认或排除的冲突事实必须全部为 excluded',
      }))
    }
    if (
      conflict.proposedResolution === 'retain_with_qualifier'
      && conflictFacts.some(fact => fact?.proposedStatus !== 'source_qualified' || fact.qualifiers.length === 0)
    ) {
      issues.push(createIssue({
        code: 'CONFLICT_QUALIFIER_MISSING',
        outputPath: `conflicts[${index}]`,
        message: '保留冲突事实时缺少 source_qualified 状态或明确限定词。',
        expectedConstraint: 'retain_with_qualifier 的每个事实必须 source_qualified 且保留限定词',
      }))
    }
  }

  return {
    passed: !issues.some(issue => issue.severity === 'error'),
    issues,
    value: {
      ...candidate,
      coverageClaim: {
        mappedSourceBlockIds: [...mapped],
        unmappedSourceBlockIds: [...unmapped],
      },
    },
  }
}

function serviceQualityAssessment(document: CanonicalSourceDocument, candidate: ResumeExtractionCandidate) {
  const identityFields = new Set(candidate.identityCandidates.map(item => item.field))
  const identityCompleteness = Math.min(100,
    (identityFields.has('name') ? 40 : 0)
    + (identityFields.has('email') || identityFields.has('phone') ? 30 : 0)
    + (identityFields.has('city_level_location') ? 15 : 0)
    + (identityFields.has('link') ? 15 : 0))
  const timelineFieldCount = candidate.timelineCandidates.length * 4
  const populatedTimelineFields = candidate.timelineCandidates.reduce((sum, item) => (
    sum + [item.organization, item.title, item.start, item.end].filter(Boolean).length
  ), 0)
  const timelineCompleteness = timelineFieldCount === 0 ? 0 : Math.round(populatedTimelineFields / timelineFieldCount * 100)
  const businessFacts = candidate.factCandidates.filter(item => ['responsibility', 'action', 'deliverable', 'result'].includes(item.claimType))
  const evidenceResultDensity = businessFacts.length === 0 ? 0
    : Math.round(businessFacts.filter(item => item.claimType === 'result' || item.numericAtoms.length > 0).length / businessFacts.length * 100)
  const usableFacts = candidate.factCandidates.filter(item => item.proposedStatus !== 'excluded')
  const clarity = candidate.factCandidates.length === 0 ? 0
    : Math.round(usableFacts.filter(item => item.proposedStatus === 'source_supported').length / candidate.factCandidates.length * 100)
  const mappedBlocks = new Set(candidate.factCandidates.map(item => item.sourceBlockId)).size
  const sectionCoverage = document.blocks.length === 0 ? 100 : Math.round(mappedBlocks / document.blocks.length * 100)
  const scoreInputs = { identityCompleteness, timelineCompleteness, evidenceResultDensity, clarity, sectionCoverage }
  const values = Object.values(scoreInputs)
  return {
    scoreInputs,
    score: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
  }
}

export function buildResumeEvidenceBundle(
  document: CanonicalSourceDocument,
  candidate: ResumeExtractionCandidate,
  options?: ResumeExtractionValidationOptions
): ResumeEvidenceBundle {
  const validation = validateResumeExtractionCandidate(document, candidate, options)
  if (!validation.passed) {
    throw new V5EvidenceValidationError('V01_RESUME_EXTRACTION_FAILED', validation.issues)
  }
  candidate = validation.value ?? candidate

  const blocks = new Map(document.blocks.map(block => [block.sourceBlockId, block]))
  const localToEvidence = new Map<string, string>()
  const evidenceAtoms = candidate.factCandidates.map(fact => {
    const block = blocks.get(fact.sourceBlockId)!
    const sourceSpan = {
      start: block.canonicalStart + fact.blockRelativeSpan.start,
      end: block.canonicalStart + fact.blockRelativeSpan.end,
    }
    const evidenceId = stableId('ev', [
      document.sha256,
      fact.sourceBlockId,
      sourceSpan.start,
      sourceSpan.end,
      fact.sourceScopeLocalId,
      fact.claimType,
      fact.normalizedClaim,
    ])
    localToEvidence.set(fact.factLocalId, evidenceId)
    return {
      evidenceId,
      sourceDocumentHash: document.sha256,
      sourceBlockId: fact.sourceBlockId,
      sourceScopeId: fact.sourceScopeLocalId,
      sourceSpan,
      verbatimText: fact.verbatimText,
      normalizedClaim: fact.normalizedClaim,
      claimType: fact.claimType,
      status: fact.proposedStatus,
      attributionLevel: fact.attributionLevel,
      sourceActionVerb: fact.sourceActionVerb,
      qualifiers: fact.qualifiers,
      numericAtoms: fact.numericAtoms,
      riskFlags: fact.riskFlags,
    }
  })
  const evidenceIds = (localIds: string[]) => localIds.map(id => localToEvidence.get(id)).filter((id): id is string => Boolean(id))
  bindSourceLineContinuations(document, evidenceAtoms)
  const identityField = (field: ResumeExtractionCandidate['identityCandidates'][number]['field']) => {
    const items = candidate.identityCandidates.filter(item => item.field === field)
    return {
      value: items[0]?.value ?? null,
      evidenceIds: [...new Set(items.flatMap(item => evidenceIds(item.factLocalIds)))],
    }
  }
  const linkItems = candidate.identityCandidates.filter(item => item.field === 'link')
  const mappedBlocks = new Set(candidate.factCandidates.map(fact => fact.sourceBlockId))
  const unmappedBlocks = new Set(candidate.unmappedFragments.map(fragment => fragment.sourceBlockId))

  return {
    schemaVersion: V5_SCHEMA_VERSION,
    sourceDocument: {
      documentId: document.documentId,
      sha256: document.sha256,
      primaryLanguage: document.primaryLanguage,
    },
    identity: {
      name: identityField('name'),
      email: identityField('email'),
      phone: identityField('phone'),
      cityLevelLocation: identityField('city_level_location'),
      links: linkItems.map(item => ({ label: 'link', url: item.value, evidenceIds: evidenceIds(item.factLocalIds) })),
    },
    timeline: candidate.timelineCandidates.map(item => ({
      scopeId: item.scopeLocalId,
      kind: item.kind,
      organization: item.organization,
      title: item.title,
      start: item.start,
      end: item.end,
      evidenceIds: evidenceIds(item.factLocalIds),
    })),
    sections: candidate.sectionCandidates.map(item => ({
      sectionId: item.sectionLocalId,
      type: item.type,
      title: item.title,
      scopeIds: item.scopeLocalIds,
      evidenceIds: evidenceIds(item.factLocalIds),
    })),
    evidenceAtoms,
    unmappedFragments: candidate.unmappedFragments,
    conflicts: candidate.conflicts.map(conflict => ({
      conflictId: stableId('conflict', [document.sha256, conflict.conflictLocalId]),
      evidenceIds: evidenceIds(conflict.factLocalIds),
      description: conflict.description,
      resolution: conflict.proposedResolution,
    })),
    extractionCoverage: {
      sourceBlockCount: document.blocks.length,
      mappedBlockCount: mappedBlocks.size,
      unmappedBlockCount: unmappedBlocks.size,
      coverageRatio: document.blocks.length === 0 ? 1 : mappedBlocks.size / document.blocks.length,
      highImportanceUnmappedCount: candidate.unmappedFragments.filter(fragment => fragment.importance === 'high').length,
      warnings: validation.issues.filter(issue => issue.severity !== 'error').map(issue => issue.code),
    },
    qualityAssessment: {
      ...candidate.qualityAssessment,
      ...serviceQualityAssessment(document, candidate),
    },
  }
}

export function validateJobExtractionCandidate(
  document: CanonicalSourceDocument,
  candidate: JobExtractionCandidate
): ValidationResult<JobExtractionCandidate> {
  const issues: ValidationIssue[] = []
  const blocks = new Map(document.blocks.map(block => [block.sourceBlockId, block]))
  candidate = {
    ...candidate,
    requirementCandidates: candidate.requirementCandidates.map((originalRequirement, index) => {
      let requirement = originalRequirement
      if (Boolean(requirement.logicGroupLocalId) !== Boolean(requirement.logicOperator)) {
        issues.push(createIssue({
          code: 'JD_INCOMPLETE_LOGIC_METADATA_CLEARED',
          severity: 'warning',
          outputPath: `requirementCandidates[${index}].logicGroupLocalId`,
          message: '需求的逻辑分组与 operator 未成对提供，服务端已清空这组无效元数据并保留完整需求事实。',
          expectedConstraint: 'logicGroupLocalId 与 logicOperator 必须同时为空或同时提供',
        }))
        requirement = {
          ...requirement,
          logicGroupLocalId: null,
          logicOperator: null,
        }
      }
      const block = blocks.get(requirement.sourceBlockId)
      if (!block) return requirement
      const quotedSlice = isRelativeSpanInBounds(block.text, requirement.blockRelativeSpan)
        ? block.text.slice(requirement.blockRelativeSpan.start, requirement.blockRelativeSpan.end)
        : null
      if (quotedSlice === requirement.verbatimText) return requirement
      const first = block.text.indexOf(requirement.verbatimText)
      const last = block.text.lastIndexOf(requirement.verbatimText)
      if (requirement.verbatimText.length >= 2 && first >= 0 && first === last) {
        issues.push(createIssue({
          code: 'JD_QUOTE_SPAN_SERVER_ALIGNED',
          severity: 'warning',
          outputPath: `requirementCandidates[${index}]`,
          message: '需求 span 已由服务端对齐到唯一逐字 quote。',
          expectedConstraint: 'RequirementAtom 的 quote 必须保持不变且在对应 block 唯一可定位',
        }))
        return {
          ...requirement,
          blockRelativeSpan: { start: first, end: first + requirement.verbatimText.length },
        }
      }
      issues.push(createIssue({
        code: 'JD_QUOTE_NOT_FOUND',
        outputPath: `requirementCandidates[${index}]`,
        message: '需求 quote 无法在对应 canonical JD block 中唯一逐字定位。',
        expectedConstraint: '不得用整个 block 替换模型无法定位的需求 quote；必须修复或删除该需求',
      }))
      return requirement
    }),
  }
  const requirementMappedBlockIds = new Set([
    ...candidate.basicInfoSourceBlockIds,
    ...candidate.requirementCandidates.map(requirement => requirement.sourceBlockId),
  ])
  const nonOverlappingUnmapped = candidate.unmappedFragments.filter(fragment => !requirementMappedBlockIds.has(fragment.sourceBlockId))
  if (nonOverlappingUnmapped.length !== candidate.unmappedFragments.length) {
    issues.push(createIssue({
      code: 'OVERLAPPING_UNMAPPED_FRAGMENT_DROPPED',
      severity: 'warning',
      outputPath: 'unmappedFragments',
      message: '已由 basic info 或逐字需求覆盖的 JD block 不再重复声明为 unmapped。',
      expectedConstraint: 'JD block 级 mapped/unmapped 集合必须互斥，mapped 证据优先',
    }))
    candidate = { ...candidate, unmappedFragments: nonOverlappingUnmapped }
  }
  const requirementLocalIds = new Set(candidate.requirementCandidates.map(item => item.requirementLocalId))
  for (const duplicate of duplicateValues(candidate.requirementCandidates.map(item => item.requirementLocalId))) {
    issues.push(createIssue({
      code: 'DUPLICATE_REQUIREMENT',
      outputPath: 'requirementCandidates',
      message: `requirementLocalId 重复：${duplicate}`,
      expectedConstraint: '每个需求候选 ID 必须唯一',
    }))
  }

  for (const [index, requirement] of candidate.requirementCandidates.entries()) {
    const path = `requirementCandidates[${index}]`
    const block = blocks.get(requirement.sourceBlockId)
    if (!block) {
      issues.push(createIssue({
        code: 'JD_QUOTE_NOT_FOUND',
        outputPath: `${path}.sourceBlockId`,
        message: `需求引用不存在的 JD block：${requirement.sourceBlockId}`,
        expectedConstraint: '需求必须引用 canonical JD block',
      }))
      continue
    }
    if (hasExecutableInputRisk(block.inputRiskFlags)) {
      issues.push(createIssue({
        code: 'PROMPT_INJECTION_EXTRACTED_AS_REQUIREMENT',
        outputPath: path,
        message: '疑似 Prompt 注入文本被错误提取为岗位需求。',
        expectedConstraint: '输入中的指令型文本只能作为不可信数据，不得成为 RequirementAtom',
      }))
    }
    issues.push(...validateRelativeQuote({
      blockText: block.text,
      span: requirement.blockRelativeSpan,
      quote: requirement.verbatimText,
      path,
      quoteCode: 'JD_QUOTE_NOT_FOUND',
      spanCode: 'JD_SPAN_MISMATCH',
    }))
    if (requirement.importance === 'must_have' && requirement.explicitness !== 'explicit') {
      issues.push(createIssue({
        code: 'UNSUPPORTED_MUST_HAVE',
        outputPath: `${path}.importance`,
        message: '语义归纳项不得升级为 must-have。',
        expectedConstraint: 'must_have 必须有 explicit 原文依据',
      }))
    }
  }

  for (const [index, context] of candidate.sourcedContextCandidates.entries()) {
    try {
      const url = new URL(context.sourceUrl)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol')
    } catch {
      issues.push(createIssue({
        code: 'UNSOURCED_CONTEXT_CLAIM',
        outputPath: `sourcedContextCandidates[${index}].sourceUrl`,
        message: '外部语境缺少有效的 HTTP(S) 来源 URL。',
        expectedConstraint: 'sourced context 必须包含 URL、标题和日期',
      }))
    }
    if (!context.sourceTitle.trim() || !context.publishedOrRetrievedAt.trim()) {
      issues.push(createIssue({
        code: 'UNSOURCED_CONTEXT_CLAIM',
        outputPath: `sourcedContextCandidates[${index}]`,
        message: '外部语境缺少来源标题或发布日期/检索日期。',
        expectedConstraint: 'sourced context 必须包含 URL、标题和日期',
      }))
    }
  }

  const basicBlocks = candidate.basicInfoSourceBlockIds.map(id => blocks.get(id)).filter((block): block is NonNullable<typeof block> => Boolean(block))
  if (basicBlocks.length !== candidate.basicInfoSourceBlockIds.length) {
    issues.push(createIssue({
      code: 'INVALID_BASIC_INFO_REFERENCE',
      outputPath: 'basicInfoSourceBlockIds',
      message: 'basic info 引用了不存在的 JD block。',
      expectedConstraint: '岗位标题、公司和地点必须引用 canonical JD block',
    }))
  }
  for (const [field, value] of Object.entries(candidate.basicInfo)) {
    if (value && !basicBlocks.some(block => block.text.includes(value))) {
      issues.push(createIssue({
        code: 'INVALID_BASIC_INFO_INFERENCE',
        outputPath: `basicInfo.${field}`,
        message: `basic info“${value}”无法在引用 block 中逐字定位。`,
        expectedConstraint: '岗位标题、公司和地点只能来自 JD 明示文本',
      }))
    }
  }
  if (basicBlocks.some(block => hasExecutableInputRisk(block.inputRiskFlags))) {
    issues.push(createIssue({
      code: 'PROMPT_INJECTION_EXTRACTED_AS_REQUIREMENT',
      outputPath: 'basicInfoSourceBlockIds',
      message: '疑似 Prompt 注入 block 被用作 basic info。',
      expectedConstraint: '输入中的指令型文本不得成为岗位事实',
    }))
  }
  for (const [kind, signals] of [
    ['explicitCompanySignals', candidate.explicitCompanySignals],
    ['explicitLocationSignals', candidate.explicitLocationSignals],
  ] as const) {
    for (const [index, signal] of signals.entries()) {
      if (signal.requirementLocalIds.some(id => !requirementLocalIds.has(id))) {
        issues.push(createIssue({
          code: 'INVALID_SIGNAL_REFERENCE',
          outputPath: `${kind}[${index}].requirementLocalIds`,
          message: '明示语境引用了不存在的 requirementLocalId。',
          expectedConstraint: '公司/地点信号必须引用当前显式需求',
        }))
      }
    }
  }
  for (const [index, uncertainty] of candidate.uncertainties.entries()) {
    if (uncertainty.sourceBlockIds.some(id => !blocks.has(id))) {
      issues.push(createIssue({
        code: 'INVALID_UNCERTAINTY_REFERENCE',
        outputPath: `uncertainties[${index}].sourceBlockIds`,
        message: '不确定项引用了不存在的 JD block。',
        expectedConstraint: '不确定项只能引用 canonical JD block',
      }))
    }
  }

  const mapped = new Set([
    ...candidate.basicInfoSourceBlockIds,
    ...candidate.requirementCandidates.map(item => item.sourceBlockId),
  ])
  const unmapped = new Set(candidate.unmappedFragments.map(item => item.sourceBlockId))
  const claimedMapped = new Set(candidate.coverageClaim.mappedSourceBlockIds)
  const claimedUnmapped = new Set(candidate.coverageClaim.unmappedSourceBlockIds)
  if ([...mapped].some(id => unmapped.has(id))) {
    issues.push(createIssue({
      code: 'COVERAGE_SET_OVERLAP',
      outputPath: 'coverageClaim',
      message: '同一 JD block 同时被声明为 mapped 和 unmapped。',
      expectedConstraint: 'mapped 与 unmapped 集合必须互斥',
    }))
  }
  if (
    mapped.size !== claimedMapped.size
    || [...mapped].some(id => !claimedMapped.has(id))
    || unmapped.size !== claimedUnmapped.size
    || [...unmapped].some(id => !claimedUnmapped.has(id))
  ) {
    issues.push(createIssue({
      code: 'COVERAGE_CLAIM_MISMATCH',
      severity: 'warning',
      outputPath: 'coverageClaim',
      message: 'JD coverageClaim 与 basic info、requirements 和 unmappedFragments 的服务端重算不一致。',
      expectedConstraint: 'coverageClaim 由服务端根据实际映射集合重算并覆盖',
    }))
  }
  for (const block of document.blocks) {
    if (!mapped.has(block.sourceBlockId) && !unmapped.has(block.sourceBlockId)) {
      issues.push(createIssue({
        code: 'BLOCK_SILENTLY_DROPPED',
        outputPath: block.sourceBlockId,
        message: `JD source block ${block.sourceBlockId} 未映射且未列为 unmapped。`,
        expectedConstraint: '每个 JD block 必须映射到 basic info/requirement 或显式列为 unmapped',
      }))
    }
  }
  for (const [index, fragment] of candidate.unmappedFragments.entries()) {
    if (!blocks.has(fragment.sourceBlockId)) {
      issues.push(createIssue({
        code: 'SOURCE_QUOTE_NOT_FOUND',
        outputPath: `unmappedFragments[${index}].sourceBlockId`,
        message: 'JD unmapped fragment 引用了不存在的 source block。',
        expectedConstraint: 'unmapped fragment 必须来自 canonical JD',
      }))
    }
    if (fragment.importance === 'high') {
      issues.push(createIssue({
        code: 'HIGH_IMPORTANCE_UNMAPPED',
        outputPath: `unmappedFragments[${index}]`,
        message: '高重要度 JD 内容尚未安全映射。',
        expectedConstraint: '高重要度未映射数量必须为 0 才能进入匹配',
      }))
    }
  }

  return {
    passed: !issues.some(issue => issue.severity === 'error'),
    issues,
    value: {
      ...candidate,
      coverageClaim: {
        mappedSourceBlockIds: [...mapped],
        unmappedSourceBlockIds: [...unmapped],
      },
    },
  }
}

export function buildJobRequirementBundle(
  document: CanonicalSourceDocument,
  candidate: JobExtractionCandidate
): JobRequirementBundle {
  const validation = validateJobExtractionCandidate(document, candidate)
  if (!validation.passed) throw new V5EvidenceValidationError('V02_JOB_EXTRACTION_FAILED', validation.issues)
  candidate = validation.value ?? candidate
  const blocks = new Map(document.blocks.map(block => [block.sourceBlockId, block]))
  const localToRequirement = new Map<string, string>()
  const requirementAtoms = candidate.requirementCandidates.map(requirement => {
    const block = blocks.get(requirement.sourceBlockId)!
    const sourceSpan = {
      start: block.canonicalStart + requirement.blockRelativeSpan.start,
      end: block.canonicalStart + requirement.blockRelativeSpan.end,
    }
    const requirementId = stableId('req', [document.sha256, requirement.sourceBlockId, sourceSpan.start, sourceSpan.end])
    localToRequirement.set(requirement.requirementLocalId, requirementId)
    return {
      requirementId,
      sourceBlockId: requirement.sourceBlockId,
      sourceSpan,
      verbatimText: requirement.verbatimText,
      normalizedRequirement: requirement.normalizedRequirement,
      category: requirement.category,
      importance: requirement.importance,
      logicGroupId: requirement.logicGroupLocalId,
      logicOperator: requirement.logicOperator,
      explicitness: requirement.explicitness,
    }
  })

  return {
    schemaVersion: V5_SCHEMA_VERSION,
    basicInfo: candidate.basicInfo,
    requirementAtoms,
    explicitCompanySignals: candidate.explicitCompanySignals.map(item => item.statement),
    explicitLocationSignals: candidate.explicitLocationSignals.map(item => item.statement),
    uncertainties: candidate.uncertainties.map(item => item.statement),
    sourcedContext: candidate.sourcedContextCandidates,
    extractionCoverage: {
      sourceBlockCount: document.blocks.length,
      mappedBlockCount: new Set([
        ...candidate.basicInfoSourceBlockIds,
        ...candidate.requirementCandidates.map(item => item.sourceBlockId),
      ]).size,
      unmappedBlockCount: new Set(candidate.unmappedFragments.map(item => item.sourceBlockId)).size,
      coverageRatio: document.blocks.length === 0 ? 1 : new Set([
        ...candidate.basicInfoSourceBlockIds,
        ...candidate.requirementCandidates.map(item => item.sourceBlockId),
      ]).size / document.blocks.length,
      highImportanceUnmappedCount: candidate.unmappedFragments.filter(item => item.importance === 'high').length,
    },
  }
}

export class V5EvidenceValidationError extends Error {
  readonly code: string
  readonly issues: ValidationIssue[]

  constructor(code: string, issues: ValidationIssue[]) {
    super(issues.map(issue => issue.message).join('；') || code)
    this.name = 'V5EvidenceValidationError'
    this.code = code
    this.issues = issues
  }
}
