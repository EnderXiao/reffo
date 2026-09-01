import { createDigest } from '@/harness/run-context'
import {
  DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
  DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS,
  DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS,
  DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
  RESUME_EXTRACTION_CHUNK_PLAN_VERSION,
  splitResumeDocument,
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

export const V5_RESUME_EXTRACTION_CACHE_VERSION = 'trusted-resume-extraction-cache-v1'

export interface ResumeExtractionCacheStats {
  hits: number
  misses: number
  coalesced: number
  integrityFailures: number
  evictions: number
  entries: number
  inFlight: number
}

export interface ResumeExtractionComputeContext {
  chunks: CanonicalSourceDocument[]
  concurrency: number
}

export interface TrustedResumeExtractionCache {
  readonly [trustedResumeExtractionCacheBrand]: true
  resolve(
    document: CanonicalSourceDocument,
    compute: (context: ResumeExtractionComputeContext) => Promise<ResumeExtractionCandidate>
  ): Promise<ResumeExtractionCandidate>
  clear(): void
  stats(): Readonly<ResumeExtractionCacheStats>
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
}

interface CacheEntry {
  candidate: ResumeExtractionCandidate
  candidateDigest: string
  evidenceBundleDigest: string
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

class InMemoryTrustedResumeExtractionCache implements TrustedResumeExtractionCache {
  readonly [trustedResumeExtractionCacheBrand] = true as const
  private readonly entries = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<ResumeExtractionCandidate>>()
  private readonly implementationFingerprint: string
  private readonly providerConfigFingerprint: string
  private readonly maxEntries: number
  private readonly chunkMaxBlocks: number
  private readonly chunkMaxCharacters: number
  private readonly chunkMaxEstimatedOutputTokens: number
  private readonly chunkConcurrency: number
  private epoch = 0
  private counters = {
    hits: 0,
    misses: 0,
    coalesced: 0,
    integrityFailures: 0,
    evictions: 0,
  }

  constructor(options: TrustedResumeExtractionCacheOptions) {
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
    const document = canonicalSourceDocumentSchema.parse(unsafeDocument)
    const descriptor = this.describe(document)
    const cached = this.entries.get(descriptor.key)
    if (cached) {
      this.counters.hits += 1
      this.entries.delete(descriptor.key)
      this.entries.set(descriptor.key, cached)
      return cloneCandidate(this.validateEntry(document, cached))
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

  clear() {
    this.epoch += 1
    this.entries.clear()
    this.inFlight.clear()
  }

  stats(): Readonly<ResumeExtractionCacheStats> {
    return Object.freeze({
      ...this.counters,
      entries: this.entries.size,
      inFlight: this.inFlight.size,
    })
  }

  private describe(document: CanonicalSourceDocument): CacheDescriptor {
    const chunks = splitResumeDocument(document, {
      maxBlocks: this.chunkMaxBlocks,
      maxCharacters: this.chunkMaxCharacters,
      maxEstimatedOutputTokens: this.chunkMaxEstimatedOutputTokens,
    })
    const blockMap = document.blocks.map(block => ({
      sourceBlockId: block.sourceBlockId,
      canonicalStart: block.canonicalStart,
      canonicalEnd: block.canonicalEnd,
      textSha256: createDigest(block.text),
      sectionHint: block.sectionHint,
      inputRiskFlags: [...block.inputRiskFlags],
    }))
    const chunkPlan = chunks.map(chunk => chunk.blocks.map(block => block.sourceBlockId))
    const key = createDigest({
      cacheVersion: V5_RESUME_EXTRACTION_CACHE_VERSION,
      resumeSha256: document.sha256,
      blockMap,
      chunkPlanVersion: RESUME_EXTRACTION_CHUNK_PLAN_VERSION,
      chunkPlan,
      promptVersions: { P01: V5_PROMPT_VERSIONS.P01, P01R: V5_PROMPT_VERSIONS.P01R },
      schemaVersion: V5_SCHEMA_VERSION,
      validatorVersion: V5_VALIDATOR_VERSION,
      workflowVersion: V5_WORKFLOW_VERSION,
      chunkConfig: {
        maxBlocks: this.chunkMaxBlocks,
        maxCharacters: this.chunkMaxCharacters,
        maxEstimatedOutputTokens: this.chunkMaxEstimatedOutputTokens,
        concurrency: this.chunkConcurrency,
      },
      implementationFingerprint: this.implementationFingerprint,
      providerConfigFingerprint: this.providerConfigFingerprint,
    })
    return {
      key,
      context: { chunks: structuredClone(chunks), concurrency: this.chunkConcurrency },
    }
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
    })
    const entry = this.createEntry(input.document, computed)
    if (this.epoch === input.startedEpoch) {
      this.entries.set(input.descriptor.key, entry)
      this.evictIfNeeded()
    }
    return cloneCandidate(entry.candidate)
  }

  private createEntry(document: CanonicalSourceDocument, candidate: ResumeExtractionCandidate): CacheEntry {
    try {
      const parsed = resumeExtractionCandidateSchema.parse(candidate)
      const validation = validateResumeExtractionCandidate(document, parsed)
      if (!validation.passed) throw new Error('candidate validation failed')
      const normalized = resumeExtractionCandidateSchema.parse(validation.value ?? parsed)
      const bundle = resumeEvidenceBundleSchema.parse(buildResumeEvidenceBundle(document, normalized))
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

  private validateEntry(document: CanonicalSourceDocument, entry: CacheEntry) {
    try {
      const parsed = resumeExtractionCandidateSchema.parse(structuredClone(entry.candidate))
      if (createDigest(parsed) !== entry.candidateDigest) throw new Error('candidate digest mismatch')
      const validation = validateResumeExtractionCandidate(document, parsed)
      if (!validation.passed) throw new Error('candidate validation failed')
      const normalized = resumeExtractionCandidateSchema.parse(validation.value ?? parsed)
      if (createDigest(normalized) !== entry.candidateDigest) throw new Error('normalized candidate digest mismatch')
      const bundle = resumeEvidenceBundleSchema.parse(buildResumeEvidenceBundle(document, normalized))
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
  }
}

/**
 * Creates the only supported cache implementation. It stores validated P01
 * output in process memory and cannot be populated from an HTTP request body.
 */
export function createTrustedResumeExtractionCache(
  options: TrustedResumeExtractionCacheOptions
): TrustedResumeExtractionCache {
  return new InMemoryTrustedResumeExtractionCache(options)
}
