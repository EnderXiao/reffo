import { createDigest } from '@/harness/run-context'
import {
  DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
  DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS,
  DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS,
  DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
  RESUME_EXTRACTION_CHUNK_PLAN_VERSION,
  normalizeResumeExtractionChunkCandidate,
  splitResumeDocument,
  type ResumeExtractionChunk,
} from '@/v5/chunked-resume-extraction'
import { buildResumeEvidenceBundle, validateResumeExtractionCandidate } from '@/v5/evidence'
import { V5_PROMPT_VERSIONS } from '@/v5/prompts'
import {
  canonicalSourceDocumentSchema,
  resumeEvidenceBundleSchema,
  resumeExtractionCandidateSchema,
} from '@/v5/schemas'
import type { CanonicalSourceDocument, ResumeExtractionCandidate } from '@/v5/types'
import {
  V5_SCHEMA_VERSION,
  V5_VALIDATOR_VERSION,
  V5_WORKFLOW_VERSION,
} from '@/v5/types'

const trustedResumeExtractionCacheBrand = Symbol('TrustedResumeExtractionCache')

export const V5_RESUME_EXTRACTION_CACHE_LEGACY_VERSION = 'trusted-resume-extraction-cache-v1' as const
export const V5_RESUME_EXTRACTION_CACHE_VERSION = 'trusted-resume-extraction-cache-v2' as const
export const V5_RESUME_EXTRACTION_PARTIAL_CACHE_VERSION = 'trusted-resume-extraction-partial-cache-v1' as const
export const V5_RESUME_EXTRACTION_CONTRACT_VERSION = 'resume-extraction-contract-v1' as const

export interface ResumeExtractionCacheStats {
  hits: number
  misses: number
  coalesced: number
  integrityFailures: number
  evictions: number
  entries: number
  inFlight: number
  partialEntries: number
  validatedShards: number
}

export interface ResumeExtractionComputeContext {
  chunks: ResumeExtractionChunk[]
  concurrency: number
  getValidatedShard?: (index: number) => ResumeExtractionCandidate | null
  storeValidatedShard?: (index: number, candidate: ResumeExtractionCandidate) => Promise<void>
}

export interface TrustedResumeExtractionCache {
  readonly [trustedResumeExtractionCacheBrand]: true
  resolve(
    document: CanonicalSourceDocument,
    compute: (context: ResumeExtractionComputeContext) => Promise<ResumeExtractionCandidate>
  ): Promise<ResumeExtractionCandidate>
  keyFor(document: CanonicalSourceDocument): string
  shardCountFor(document: CanonicalSourceDocument): number
  progress(document: CanonicalSourceDocument): ResumeExtractionCacheProgress
  partialSnapshot(document: CanonicalSourceDocument): TrustedResumeExtractionPartialSnapshot | null
  hydratePartial(document: CanonicalSourceDocument, snapshot: TrustedResumeExtractionPartialSnapshot): void
  snapshot(document: CanonicalSourceDocument): TrustedResumeExtractionCacheSnapshot | null
  hydrate(
    document: CanonicalSourceDocument,
    snapshot: TrustedResumeExtractionCacheSnapshot
  ): void
  clear(): void
  stats(): Readonly<ResumeExtractionCacheStats>
}

export interface TrustedResumeExtractionCacheSnapshot {
  cacheVersion: typeof V5_RESUME_EXTRACTION_CACHE_VERSION
  cacheKey: string
  candidate: ResumeExtractionCandidate
  candidateDigest: string
  evidenceBundleDigest: string
}

export interface ResumeExtractionCacheProgress {
  shardCount: number
  validatedShardIndices: number[]
  missingShardIndices: number[]
  complete: boolean
}

export interface TrustedResumeExtractionPartialSnapshot {
  cacheVersion: typeof V5_RESUME_EXTRACTION_PARTIAL_CACHE_VERSION
  cacheKey: string
  shardCount: number
  shards: Array<{
    index: number
    candidate: ResumeExtractionCandidate
    candidateDigest: string
  }>
  payloadDigest: string
}

export interface LegacyTrustedResumeExtractionCacheSnapshot {
  cacheVersion: typeof V5_RESUME_EXTRACTION_CACHE_LEGACY_VERSION
  cacheKey: string
  candidate: ResumeExtractionCandidate
  candidateDigest: string
  evidenceBundleDigest: string
}

export interface TrustedResumeExtractionCacheOptions {
  /** Digest or release identifier for the exact code used by the caller. Never pass source code or secrets. */
  implementationFingerprint: string
  /** Digest of provider/model/runtime settings. Never pass an API key or raw provider configuration. */
  providerConfigFingerprint: string
  maxEntries?: number
  chunkMaxBlocks?: number
  chunkMaxCharacters?: number
  chunkMaxEstimatedOutputTokens?: number
  chunkConcurrency?: number
  /** Private checkpoint hook. Snapshots contain resume data and must never enter public diagnostics. */
  onValidatedShard?: (
    snapshot: TrustedResumeExtractionPartialSnapshot,
    document: CanonicalSourceDocument
  ) => void | Promise<void>
}

interface CacheEntry {
  candidate: ResumeExtractionCandidate
  candidateDigest: string
  evidenceBundleDigest: string
}

interface ShardCacheEntry {
  candidate: ResumeExtractionCandidate
  candidateDigest: string
}

function requireExactKeys(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid snapshot object')
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error('unknown snapshot fields')
  }
}

interface CacheDescriptor {
  key: string
  context: ResumeExtractionComputeContext
}

export class V5ResumeExtractionCacheError extends Error {
  readonly code = 'P01_CACHE_INTEGRITY_FAILED' as const

  constructor(message = 'P01 受信提取缓存未通过完整性校验。') {
    super(message)
    this.name = 'V5ResumeExtractionCacheError'
  }
}

function requireNonEmptyFingerprint(value: string, name: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty fingerprint`)
  }
  return value.trim()
}

function requirePositiveSafeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
  return value
}

function cloneCandidate(candidate: ResumeExtractionCandidate) {
  return structuredClone(candidate)
}

function evidenceBundleIntegrityDigest(bundle: ReturnType<typeof resumeEvidenceBundleSchema.parse>) {
  return createDigest({
    ...bundle,
    sourceDocument: {
      ...bundle.sourceDocument,
      // documentId is request-local; content identity is the canonical SHA and block map.
      documentId: null,
    },
  })
}

interface ResumeExtractionCacheDescriptorOptions {
  implementationFingerprint: string
  providerConfigFingerprint: string
  chunkMaxBlocks: number
  chunkMaxCharacters: number
  chunkMaxEstimatedOutputTokens: number
  chunkConcurrency: number
  format: 'current' | 'legacy-v1'
}

function describeResumeExtractionCache(
  document: CanonicalSourceDocument,
  options: ResumeExtractionCacheDescriptorOptions
): CacheDescriptor {
  const chunks = splitResumeDocument(document, {
    maxBlocks: options.chunkMaxBlocks,
    maxCharacters: options.chunkMaxCharacters,
    maxEstimatedOutputTokens: options.chunkMaxEstimatedOutputTokens,
  })
  const blockMap = document.blocks.map(block => ({
    sourceBlockId: block.sourceBlockId,
    canonicalStart: block.canonicalStart,
    canonicalEnd: block.canonicalEnd,
    textSha256: createDigest(block.text),
    sectionHint: block.sectionHint,
    inputRiskFlags: [...block.inputRiskFlags],
  }))
  const chunkPlan = chunks.map(chunk => ({
    targetSourceBlockIds: chunk.blocks.map(block => block.sourceBlockId),
    scopeContext: chunk.extractionScopeContext
      ? {
          serverScopeLocalId: chunk.extractionScopeContext.serverScopeLocalId,
          sourceBlockIds: chunk.extractionScopeContext.blocks.map(block => block.sourceBlockId),
          scopeMemberBlockIds: chunk.extractionScopeContext.scopeMemberBlockIds ?? [],
          timelineAnchorBlockIds: chunk.extractionScopeContext.timelineAnchorBlockIds ?? [],
        }
      : null,
    scopeAssignments: (chunk.extractionScopeAssignments ?? []).map(assignment => ({
      serverScopeLocalId: assignment.serverScopeLocalId,
      sourceBlockIds: assignment.sourceBlockIds,
      scopeMemberBlockIds: assignment.scopeMemberBlockIds ?? [],
      timelineAnchorBlockIds: assignment.timelineAnchorBlockIds ?? [],
    })),
  }))
  const shared = {
    resumeSha256: document.sha256,
    blockMap,
    chunkPlanVersion: RESUME_EXTRACTION_CHUNK_PLAN_VERSION,
    chunkPlan,
    promptVersions: { P01: V5_PROMPT_VERSIONS.P01, P01R: V5_PROMPT_VERSIONS.P01R },
    schemaVersion: V5_SCHEMA_VERSION,
    chunkConfig: {
      maxBlocks: options.chunkMaxBlocks,
      maxCharacters: options.chunkMaxCharacters,
      maxEstimatedOutputTokens: options.chunkMaxEstimatedOutputTokens,
      concurrency: options.chunkConcurrency,
    },
    implementationFingerprint: options.implementationFingerprint,
    providerConfigFingerprint: options.providerConfigFingerprint,
  }
  const identity = options.format === 'legacy-v1'
    ? {
        cacheVersion: V5_RESUME_EXTRACTION_CACHE_LEGACY_VERSION,
        resumeSha256: shared.resumeSha256,
        blockMap: shared.blockMap,
        chunkPlanVersion: shared.chunkPlanVersion,
        chunkPlan: shared.chunkPlan,
        promptVersions: shared.promptVersions,
        schemaVersion: shared.schemaVersion,
        validatorVersion: V5_VALIDATOR_VERSION,
        workflowVersion: V5_WORKFLOW_VERSION,
        chunkConfig: shared.chunkConfig,
        implementationFingerprint: shared.implementationFingerprint,
        providerConfigFingerprint: shared.providerConfigFingerprint,
      }
    : {
        cacheVersion: V5_RESUME_EXTRACTION_CACHE_VERSION,
        ...shared,
        extractionContractVersion: V5_RESUME_EXTRACTION_CONTRACT_VERSION,
      }
  return {
    key: createDigest(identity),
    context: { chunks: structuredClone(chunks), concurrency: options.chunkConcurrency },
  }
}

function normalizedDescriptorOptions(
  options: TrustedResumeExtractionCacheOptions,
  format: ResumeExtractionCacheDescriptorOptions['format']
): ResumeExtractionCacheDescriptorOptions {
  return {
    implementationFingerprint: requireNonEmptyFingerprint(
      options.implementationFingerprint,
      'implementationFingerprint'
    ),
    providerConfigFingerprint: requireNonEmptyFingerprint(
      options.providerConfigFingerprint,
      'providerConfigFingerprint'
    ),
    chunkMaxBlocks: requirePositiveSafeInteger(
      options.chunkMaxBlocks ?? DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS,
      'chunkMaxBlocks'
    ),
    chunkMaxCharacters: requirePositiveSafeInteger(
      options.chunkMaxCharacters ?? DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS,
      'chunkMaxCharacters'
    ),
    chunkMaxEstimatedOutputTokens: requirePositiveSafeInteger(
      options.chunkMaxEstimatedOutputTokens ?? DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
      'chunkMaxEstimatedOutputTokens'
    ),
    chunkConcurrency: requirePositiveSafeInteger(
      options.chunkConcurrency ?? DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
      'chunkConcurrency'
    ),
    format,
  }
}

export function validateLegacyResumeExtractionCacheSnapshotForPromotion(input: {
  document: CanonicalSourceDocument
  snapshot: LegacyTrustedResumeExtractionCacheSnapshot
  options: TrustedResumeExtractionCacheOptions
}) {
  const document = canonicalSourceDocumentSchema.parse(input.document)
  const descriptor = describeResumeExtractionCache(
    document,
    normalizedDescriptorOptions(input.options, 'legacy-v1')
  )
  try {
    if (
      input.snapshot.cacheVersion !== V5_RESUME_EXTRACTION_CACHE_LEGACY_VERSION
      || input.snapshot.cacheKey !== descriptor.key
    ) {
      throw new Error('legacy cache descriptor mismatch')
    }
    const parsed = resumeExtractionCandidateSchema.parse(structuredClone(input.snapshot.candidate))
    if (createDigest(parsed) !== input.snapshot.candidateDigest) {
      throw new Error('legacy candidate digest mismatch')
    }
    const validationOptions = { trustedShardCount: descriptor.context.chunks.length }
    const validation = validateResumeExtractionCandidate(document, parsed, validationOptions)
    if (!validation.passed) throw new Error('legacy candidate validation failed')
    const normalized = resumeExtractionCandidateSchema.parse(validation.value ?? parsed)
    if (createDigest(normalized) !== input.snapshot.candidateDigest) {
      throw new Error('legacy normalized candidate digest mismatch')
    }
    const bundle = resumeEvidenceBundleSchema.parse(
      buildResumeEvidenceBundle(document, normalized, validationOptions)
    )
    if (evidenceBundleIntegrityDigest(bundle) !== input.snapshot.evidenceBundleDigest) {
      throw new Error('legacy evidence bundle digest mismatch')
    }
    return cloneCandidate(normalized)
  } catch {
    throw new V5ResumeExtractionCacheError('旧版 P01 缓存未通过当前完整校验，禁止迁移。')
  }
}

export function legacyResumeExtractionCacheKeyForPromotion(input: {
  document: CanonicalSourceDocument
  options: TrustedResumeExtractionCacheOptions
}) {
  const document = canonicalSourceDocumentSchema.parse(input.document)
  return describeResumeExtractionCache(
    document,
    normalizedDescriptorOptions(input.options, 'legacy-v1')
  ).key
}

class InMemoryTrustedResumeExtractionCache implements TrustedResumeExtractionCache {
  readonly [trustedResumeExtractionCacheBrand] = true as const
  private readonly entries = new Map<string, CacheEntry>()
  private readonly partialEntries = new Map<string, Map<number, ShardCacheEntry>>()
  private readonly inFlight = new Map<string, Promise<ResumeExtractionCandidate>>()
  private readonly implementationFingerprint: string
  private readonly providerConfigFingerprint: string
  private readonly maxEntries: number
  private readonly chunkMaxBlocks: number
  private readonly chunkMaxCharacters: number
  private readonly chunkMaxEstimatedOutputTokens: number
  private readonly chunkConcurrency: number
  private readonly onValidatedShard: TrustedResumeExtractionCacheOptions['onValidatedShard']
  private epoch = 0
  private counters = {
    hits: 0,
    misses: 0,
    coalesced: 0,
    integrityFailures: 0,
    evictions: 0,
  }

  constructor(options: TrustedResumeExtractionCacheOptions) {
    this.onValidatedShard = options.onValidatedShard
    this.implementationFingerprint = requireNonEmptyFingerprint(
      options.implementationFingerprint,
      'implementationFingerprint'
    )
    this.providerConfigFingerprint = requireNonEmptyFingerprint(
      options.providerConfigFingerprint,
      'providerConfigFingerprint'
    )
    this.maxEntries = requirePositiveSafeInteger(options.maxEntries ?? 16, 'maxEntries')
    this.chunkMaxBlocks = requirePositiveSafeInteger(
      options.chunkMaxBlocks ?? DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS,
      'chunkMaxBlocks'
    )
    this.chunkMaxCharacters = requirePositiveSafeInteger(
      options.chunkMaxCharacters ?? DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS,
      'chunkMaxCharacters'
    )
    this.chunkMaxEstimatedOutputTokens = requirePositiveSafeInteger(
      options.chunkMaxEstimatedOutputTokens ?? DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
      'chunkMaxEstimatedOutputTokens'
    )
    this.chunkConcurrency = requirePositiveSafeInteger(
      options.chunkConcurrency ?? DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
      'chunkConcurrency'
    )
  }

  async resolve(
    unsafeDocument: CanonicalSourceDocument,
    compute: (context: ResumeExtractionComputeContext) => Promise<ResumeExtractionCandidate>
  ): Promise<ResumeExtractionCandidate> {
    const document = canonicalSourceDocumentSchema.parse(structuredClone(unsafeDocument))
    const descriptor = this.describe(document)
    const cached = this.entries.get(descriptor.key)
    if (cached) {
      this.counters.hits += 1
      this.entries.delete(descriptor.key)
      this.entries.set(descriptor.key, cached)
      return cloneCandidate(this.validateEntry(document, cached, descriptor.context.chunks.length))
    }

    const pending = this.inFlight.get(descriptor.key)
    if (pending) {
      this.counters.hits += 1
      this.counters.coalesced += 1
      return cloneCandidate(await pending)
    }

    this.counters.misses += 1
    const startedEpoch = this.epoch
    const computation = this.computeAndStore({ document, descriptor, startedEpoch, compute })
    this.inFlight.set(descriptor.key, computation)
    try {
      return cloneCandidate(await computation)
    } finally {
      if (this.inFlight.get(descriptor.key) === computation) this.inFlight.delete(descriptor.key)
    }
  }

  keyFor(unsafeDocument: CanonicalSourceDocument) {
    const document = canonicalSourceDocumentSchema.parse(unsafeDocument)
    return this.describe(document).key
  }

  shardCountFor(unsafeDocument: CanonicalSourceDocument) {
    const document = canonicalSourceDocumentSchema.parse(unsafeDocument)
    return this.describe(document).context.chunks.length
  }

  progress(unsafeDocument: CanonicalSourceDocument): ResumeExtractionCacheProgress {
    const document = canonicalSourceDocumentSchema.parse(structuredClone(unsafeDocument))
    const descriptor = this.describe(document)
    const shardCount = descriptor.context.chunks.length
    const fullEntry = this.entries.get(descriptor.key)
    if (fullEntry) this.validateEntry(document, fullEntry, shardCount)
    const snapshot = fullEntry ? null : this.createPartialSnapshot(descriptor)
    const validatedShardIndices = fullEntry
      ? Array.from({ length: shardCount }, (_, index) => index)
      : snapshot?.shards.map(shard => shard.index) ?? []
    const valid = new Set(validatedShardIndices)
    return {
      shardCount,
      validatedShardIndices,
      missingShardIndices: Array.from({ length: shardCount }, (_, index) => index).filter(index => !valid.has(index)),
      complete: Boolean(fullEntry),
    }
  }

  partialSnapshot(unsafeDocument: CanonicalSourceDocument): TrustedResumeExtractionPartialSnapshot | null {
    const document = canonicalSourceDocumentSchema.parse(structuredClone(unsafeDocument))
    return this.createPartialSnapshot(this.describe(document))
  }

  hydratePartial(
    unsafeDocument: CanonicalSourceDocument,
    unsafeSnapshot: TrustedResumeExtractionPartialSnapshot
  ) {
    const document = canonicalSourceDocumentSchema.parse(structuredClone(unsafeDocument))
    const descriptor = this.describe(document)
    try {
      const snapshot = structuredClone(unsafeSnapshot)
      requireExactKeys(snapshot, ['cacheVersion', 'cacheKey', 'shardCount', 'shards', 'payloadDigest'])
      if (
        snapshot.cacheVersion !== V5_RESUME_EXTRACTION_PARTIAL_CACHE_VERSION
        || snapshot.cacheKey !== descriptor.key
        || snapshot.shardCount !== descriptor.context.chunks.length
        || !Array.isArray(snapshot.shards)
        || snapshot.shards.length === 0
        || snapshot.shards.length > snapshot.shardCount
      ) throw new Error('partial cache descriptor mismatch')
      const { payloadDigest, ...payload } = snapshot
      if (createDigest(payload) !== payloadDigest) throw new Error('partial payload digest mismatch')
      const restored = new Map<number, ShardCacheEntry>()
      let previousIndex = -1
      for (const shard of snapshot.shards) {
        requireExactKeys(shard, ['index', 'candidate', 'candidateDigest'])
        this.requireShardIndex(descriptor, shard.index)
        if (shard.index <= previousIndex) throw new Error('partial shards must be unique and source ordered')
        previousIndex = shard.index
        if (createDigest(shard.candidate) !== shard.candidateDigest) throw new Error('partial stored candidate digest mismatch')
        const entry = this.createShardEntry(descriptor.context.chunks[shard.index], shard.candidate)
        if (entry.candidateDigest !== shard.candidateDigest) throw new Error('partial candidate digest mismatch')
        restored.set(shard.index, entry)
      }
      const fullEntry = this.entries.get(descriptor.key)
      if (fullEntry) {
        this.validateEntry(document, fullEntry, descriptor.context.chunks.length)
        return
      }
      const existing = this.partialEntries.get(descriptor.key)
      for (const [index, entry] of existing ?? []) {
        this.validateShardEntry(descriptor.context.chunks[index], entry)
        if (restored.has(index) && restored.get(index)?.candidateDigest !== entry.candidateDigest) {
          throw new Error('conflicting validated shard')
        }
        restored.set(index, entry)
      }
      this.partialEntries.delete(descriptor.key)
      this.partialEntries.set(descriptor.key, restored)
      this.evictIfNeeded()
    } catch (error) {
      if (!(error instanceof V5ResumeExtractionCacheError)) this.counters.integrityFailures += 1
      throw new V5ResumeExtractionCacheError()
    }
  }

  snapshot(unsafeDocument: CanonicalSourceDocument): TrustedResumeExtractionCacheSnapshot | null {
    const document = canonicalSourceDocumentSchema.parse(unsafeDocument)
    const descriptor = this.describe(document)
    const entry = this.entries.get(descriptor.key)
    if (!entry) return null
    const candidate = this.validateEntry(document, entry, descriptor.context.chunks.length)
    return {
      cacheVersion: V5_RESUME_EXTRACTION_CACHE_VERSION,
      cacheKey: descriptor.key,
      candidate: cloneCandidate(candidate),
      candidateDigest: entry.candidateDigest,
      evidenceBundleDigest: entry.evidenceBundleDigest,
    }
  }

  hydrate(
    unsafeDocument: CanonicalSourceDocument,
    snapshot: TrustedResumeExtractionCacheSnapshot
  ) {
    const document = canonicalSourceDocumentSchema.parse(unsafeDocument)
    const descriptor = this.describe(document)
    try {
      if (
        snapshot.cacheVersion !== V5_RESUME_EXTRACTION_CACHE_VERSION
        || snapshot.cacheKey !== descriptor.key
      ) {
        throw new Error('cache descriptor mismatch')
      }
      const entry = this.createEntry(
        document,
        snapshot.candidate,
        descriptor.context.chunks.length
      )
      if (
        entry.candidateDigest !== snapshot.candidateDigest
        || entry.evidenceBundleDigest !== snapshot.evidenceBundleDigest
      ) {
        throw new Error('snapshot digest mismatch')
      }
      this.entries.set(descriptor.key, entry)
      this.partialEntries.delete(descriptor.key)
      this.evictIfNeeded()
    } catch (error) {
      if (!(error instanceof V5ResumeExtractionCacheError)) this.counters.integrityFailures += 1
      throw new V5ResumeExtractionCacheError()
    }
  }

  clear() {
    this.epoch += 1
    this.entries.clear()
    this.partialEntries.clear()
    this.inFlight.clear()
  }

  stats(): Readonly<ResumeExtractionCacheStats> {
    return Object.freeze({
      ...this.counters,
      entries: this.entries.size,
      inFlight: this.inFlight.size,
      partialEntries: this.partialEntries.size,
      validatedShards: [...this.partialEntries.values()].reduce((sum, shards) => sum + shards.size, 0),
    })
  }

  private describe(document: CanonicalSourceDocument): CacheDescriptor {
    return describeResumeExtractionCache(document, {
      implementationFingerprint: this.implementationFingerprint,
      providerConfigFingerprint: this.providerConfigFingerprint,
      chunkMaxBlocks: this.chunkMaxBlocks,
      chunkMaxCharacters: this.chunkMaxCharacters,
      chunkMaxEstimatedOutputTokens: this.chunkMaxEstimatedOutputTokens,
      chunkConcurrency: this.chunkConcurrency,
      format: 'current',
    })
  }

  private async computeAndStore(input: {
    document: CanonicalSourceDocument
    descriptor: CacheDescriptor
    startedEpoch: number
    compute: (context: ResumeExtractionComputeContext) => Promise<ResumeExtractionCandidate>
  }) {
    const computed = await input.compute({
      chunks: structuredClone(input.descriptor.context.chunks),
      concurrency: input.descriptor.context.concurrency,
      getValidatedShard: index => {
        this.requireShardIndex(input.descriptor, index)
        if (this.epoch !== input.startedEpoch) return null
        const entry = this.partialEntries.get(input.descriptor.key)?.get(index)
        return entry ? cloneCandidate(this.validateShardEntry(input.descriptor.context.chunks[index], entry)) : null
      },
      storeValidatedShard: async (index, candidate) => {
        this.requireShardIndex(input.descriptor, index)
        const entry = this.createShardEntry(input.descriptor.context.chunks[index], candidate)
        if (this.epoch !== input.startedEpoch) return
        const shards = this.partialEntries.get(input.descriptor.key) ?? new Map<number, ShardCacheEntry>()
        const existing = shards.get(index)
        if (existing) {
          this.validateShardEntry(input.descriptor.context.chunks[index], existing)
          if (existing.candidateDigest !== entry.candidateDigest) throw new V5ResumeExtractionCacheError()
          return
        }
        shards.set(index, entry)
        this.partialEntries.delete(input.descriptor.key)
        this.partialEntries.set(input.descriptor.key, shards)
        this.evictIfNeeded()
        if (this.onValidatedShard) {
          const snapshot = this.createPartialSnapshot(input.descriptor)
          if (snapshot) await this.onValidatedShard(snapshot, structuredClone(input.document))
        }
      },
    })
    const entry = this.createEntry(
      input.document,
      computed,
      input.descriptor.context.chunks.length
    )
    if (this.epoch === input.startedEpoch) {
      this.entries.set(input.descriptor.key, entry)
      this.partialEntries.delete(input.descriptor.key)
      this.evictIfNeeded()
    }
    return cloneCandidate(entry.candidate)
  }

  private createEntry(
    document: CanonicalSourceDocument,
    candidate: ResumeExtractionCandidate,
    trustedShardCount: number
  ): CacheEntry {
    try {
      const parsed = resumeExtractionCandidateSchema.parse(candidate)
      const validationOptions = { trustedShardCount }
      const validation = validateResumeExtractionCandidate(document, parsed, validationOptions)
      if (!validation.passed) throw new Error('candidate validation failed')
      const normalized = resumeExtractionCandidateSchema.parse(validation.value ?? parsed)
      const bundle = resumeEvidenceBundleSchema.parse(
        buildResumeEvidenceBundle(document, normalized, validationOptions)
      )
      return {
        candidate: cloneCandidate(normalized),
        candidateDigest: createDigest(normalized),
        evidenceBundleDigest: evidenceBundleIntegrityDigest(bundle),
      }
    } catch {
      this.counters.integrityFailures += 1
      throw new V5ResumeExtractionCacheError()
    }
  }

  private requireShardIndex(descriptor: CacheDescriptor, index: number) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= descriptor.context.chunks.length) {
      throw new V5ResumeExtractionCacheError('P01 分片缓存索引不属于服务端分片计划。')
    }
  }

  private createShardEntry(chunk: ResumeExtractionChunk, candidate: ResumeExtractionCandidate): ShardCacheEntry {
    try {
      const parsed = resumeExtractionCandidateSchema.parse(structuredClone(candidate))
      const normalized = normalizeResumeExtractionChunkCandidate(chunk, parsed)
      const validation = validateResumeExtractionCandidate(chunk, normalized, { trustedShardCount: 1 })
      if (!validation.passed) throw new Error('shard candidate validation failed')
      const validated = resumeExtractionCandidateSchema.parse(validation.value ?? normalized)
      return { candidate: cloneCandidate(validated), candidateDigest: createDigest(validated) }
    } catch {
      this.counters.integrityFailures += 1
      throw new V5ResumeExtractionCacheError()
    }
  }

  private validateShardEntry(chunk: ResumeExtractionChunk, entry: ShardCacheEntry) {
    if (createDigest(entry.candidate) !== entry.candidateDigest) {
      this.counters.integrityFailures += 1
      throw new V5ResumeExtractionCacheError()
    }
    const validated = this.createShardEntry(chunk, entry.candidate)
    if (validated.candidateDigest !== entry.candidateDigest) {
      this.counters.integrityFailures += 1
      throw new V5ResumeExtractionCacheError()
    }
    return validated.candidate
  }

  private createPartialSnapshot(descriptor: CacheDescriptor): TrustedResumeExtractionPartialSnapshot | null {
    const entries = this.partialEntries.get(descriptor.key)
    if (!entries?.size) return null
    const payload = {
      cacheVersion: V5_RESUME_EXTRACTION_PARTIAL_CACHE_VERSION,
      cacheKey: descriptor.key,
      shardCount: descriptor.context.chunks.length,
      shards: [...entries].sort(([left], [right]) => left - right).map(([index, entry]) => {
        this.requireShardIndex(descriptor, index)
        return {
          index,
          candidate: cloneCandidate(this.validateShardEntry(descriptor.context.chunks[index], entry)),
          candidateDigest: entry.candidateDigest,
        }
      }),
    }
    return { ...payload, payloadDigest: createDigest(payload) }
  }

  private validateEntry(
    document: CanonicalSourceDocument,
    entry: CacheEntry,
    trustedShardCount: number
  ) {
    try {
      const parsed = resumeExtractionCandidateSchema.parse(structuredClone(entry.candidate))
      if (createDigest(parsed) !== entry.candidateDigest) throw new Error('candidate digest mismatch')
      const validationOptions = { trustedShardCount }
      const validation = validateResumeExtractionCandidate(document, parsed, validationOptions)
      if (!validation.passed) throw new Error('candidate validation failed')
      const normalized = resumeExtractionCandidateSchema.parse(validation.value ?? parsed)
      if (createDigest(normalized) !== entry.candidateDigest) throw new Error('normalized candidate digest mismatch')
      const bundle = resumeEvidenceBundleSchema.parse(
        buildResumeEvidenceBundle(document, normalized, validationOptions)
      )
      if (evidenceBundleIntegrityDigest(bundle) !== entry.evidenceBundleDigest) throw new Error('evidence bundle digest mismatch')
      return normalized
    } catch {
      this.counters.integrityFailures += 1
      throw new V5ResumeExtractionCacheError()
    }
  }

  private evictIfNeeded() {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (!oldest) return
      this.entries.delete(oldest)
      this.counters.evictions += 1
    }
    while (this.partialEntries.size > this.maxEntries) {
      const oldest = this.partialEntries.keys().next().value as string | undefined
      if (!oldest) return
      this.partialEntries.delete(oldest)
      this.counters.evictions += 1
    }
  }
}

/**
 * Creates the only supported cache implementation. Validated snapshots may be
 * hydrated only by trusted local orchestration; HTTP request data is never a
 * supported cache source.
 */
export function createTrustedResumeExtractionCache(
  options: TrustedResumeExtractionCacheOptions
): TrustedResumeExtractionCache {
  return new InMemoryTrustedResumeExtractionCache(options)
}
