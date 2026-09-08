import { describe, expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { createDigest } from '@/harness/run-context'
import { mergeResumeExtractionCandidates, ResumeExtractionChunkCapacityError, type ResumeExtractionChunk } from '@/v5/chunked-resume-extraction'
import {
  createTrustedResumeExtractionCache,
  legacyResumeExtractionCacheKeyForPromotion,
  validateLegacyResumeExtractionCacheSnapshotForPromotion,
  V5_RESUME_EXTRACTION_CACHE_LEGACY_VERSION,
  V5ResumeExtractionCacheError,
  type TrustedResumeExtractionPartialSnapshot,
} from '@/v5/resume-extraction-cache'
import { createResumeFixture, FIXTURE_RESUME } from '@/v5/tests/fixtures'
import type { ResumeExtractionCandidate } from '@/v5/types'

function createCache(overrides: Partial<Parameters<typeof createTrustedResumeExtractionCache>[0]> = {}) {
  return createTrustedResumeExtractionCache({
    implementationFingerprint: 'implementation-a',
    providerConfigFingerprint: 'provider-a',
    ...overrides,
  })
}

function candidateForResume(markdown: string) {
  const document = canonicalizeSourceDocument(markdown, 'cache-test').canonicalDocument
  const candidate = structuredClone(createResumeFixture().candidate)
  candidate.factCandidates.forEach((fact, index) => {
    const block = document.blocks[index]
    fact.sourceBlockId = block.sourceBlockId
    fact.blockRelativeSpan = { start: 0, end: block.text.length }
    fact.verbatimText = block.text
    fact.normalizedClaim = block.text
  })
  candidate.coverageClaim.mappedSourceBlockIds = document.blocks.map(block => block.sourceBlockId)
  return { document, candidate }
}

function shardCandidate(chunk: ResumeExtractionChunk): ResumeExtractionCandidate {
  const candidate = structuredClone(createResumeFixture().candidate)
  candidate.identityCandidates = []
  candidate.timelineCandidates = []
  candidate.sectionCandidates = []
  candidate.factCandidates = chunk.blocks.map((block, index) => ({
    ...structuredClone(candidate.factCandidates[3]),
    factLocalId: `skill${index}`,
    sourceBlockId: block.sourceBlockId,
    blockRelativeSpan: { start: 0, end: block.text.length },
    verbatimText: block.text,
    normalizedClaim: block.text,
  }))
  candidate.coverageClaim = { mappedSourceBlockIds: chunk.blocks.map(block => block.sourceBlockId), unmappedSourceBlockIds: [] }
  candidate.qualityAssessment = {
    ...candidate.qualityAssessment,
    strengths: [],
    weaknesses: [],
    suggestions: [],
    capabilitySummary: '',
  }
  return candidate
}

function partialFixture() {
  return canonicalizeSourceDocument('技能：SQL\n技能：Python\n技能：Excel\n技能：Figma', 'partial-cache').canonicalDocument
}

function rehashPartial(snapshot: TrustedResumeExtractionPartialSnapshot) {
  const { payloadDigest: _, ...payload } = snapshot
  snapshot.payloadDigest = createDigest(payload)
  return snapshot
}

describe('trusted resume extraction cache', () => {
  test('reuses one validated extraction for the same resume across different JD requests', async () => {
    const cache = createCache()
    const { candidate } = createResumeFixture()
    const observedJds: string[] = []
    let computations = 0
    const request = async (jobDescription: string, requestId: string) => {
      observedJds.push(jobDescription)
      const document = canonicalizeSourceDocument(FIXTURE_RESUME, requestId).canonicalDocument
      return cache.resolve(document, async context => {
        computations += 1
        expect(context.chunks.flatMap(chunk => chunk.blocks)).toHaveLength(document.blocks.length)
        return candidate
      })
    }

    await request('JD A', 'request-1')
    await request('JD B', 'request-2')

    expect(observedJds).toEqual(['JD A', 'JD B'])
    expect(computations).toBe(1)
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 })
  })

  test('runs deterministic chunk-plan preflight before invoking the cache compute callback', async () => {
    const cache = createCache()
    const document = canonicalizeSourceDocument(
      `# 工作经历\n## 甲公司\n${'甲'.repeat(1_001)}`,
      'preflight-before-compute'
    ).canonicalDocument
    let computations = 0

    await expect(cache.resolve(document, async () => {
      computations += 1
      return createResumeFixture().candidate
    })).rejects.toBeInstanceOf(ResumeExtractionChunkCapacityError)

    expect(computations).toBe(0)
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 0, inFlight: 0, entries: 0 })
  })

  test('returns defensive clones so a caller cannot pollute a cached candidate', async () => {
    const cache = createCache()
    const { document, candidate } = createResumeFixture()
    const first = await cache.resolve(document, async () => candidate)
    first.factCandidates[0].normalizedClaim = '被调用方篡改'

    const second = await cache.resolve(document, async () => {
      throw new Error('cache should have been used')
    })

    expect(second.factCandidates[0].normalizedClaim).toBe(candidate.factCandidates[0].normalizedClaim)
    expect(first).not.toBe(second)
    expect(first.factCandidates).not.toBe(second.factCandidates)
  })

  test('coalesces concurrent misses into one computation and returns independent clones', async () => {
    const cache = createCache()
    const { document, candidate } = createResumeFixture()
    let computations = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const compute = async () => {
      computations += 1
      await gate
      return candidate
    }

    const firstPromise = cache.resolve(document, compute)
    const secondPromise = cache.resolve(document, compute)
    expect(computations).toBe(1)
    release()
    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(computations).toBe(1)
    expect(first).not.toBe(second)
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, coalesced: 1 })
  })

  test('treats implementation and provider fingerprints as isolated cache namespaces', async () => {
    const { document, candidate } = createResumeFixture()
    const caches = [
      createCache(),
      createCache({ implementationFingerprint: 'implementation-b' }),
      createCache({ providerConfigFingerprint: 'provider-b' }),
    ]
    expect(new Set(caches.map(cache => cache.keyFor(document))).size).toBe(3)
    let computations = 0
    for (const cache of caches) {
      await cache.resolve(document, async () => {
        computations += 1
        return candidate
      })
    }

    expect(computations).toBe(3)
    expect(caches.map(cache => cache.stats().misses)).toEqual([1, 1, 1])
    caches[0].clear()
    expect(caches.map(cache => cache.stats().entries)).toEqual([0, 1, 1])
  })

  test('reuses a snapshot for canonically identical LF and CRLF input', async () => {
    const source = createCache()
    const target = createCache()
    const lf = canonicalizeSourceDocument(FIXTURE_RESUME, 'lf-request').canonicalDocument
    const crlf = canonicalizeSourceDocument(FIXTURE_RESUME.replace(/\n/g, '\r\n'), 'crlf-request').canonicalDocument
    const candidate = createResumeFixture().candidate

    expect(crlf.sha256).toBe(lf.sha256)
    const normalized = await source.resolve(lf, async () => candidate)
    const snapshot = source.snapshot(lf)
    if (!snapshot) throw new Error('snapshot was not created')
    expect(target.keyFor(crlf)).toBe(source.keyFor(lf))

    target.hydrate(crlf, snapshot)
    await expect(target.resolve(crlf, async () => {
      throw new Error('canonical snapshot should have been used')
    })).resolves.toEqual(normalized)
  })

  test('fails closed on stored candidate tampering instead of silently recomputing', async () => {
    const cache = createCache()
    const { document, candidate } = createResumeFixture()
    let computations = 0
    await cache.resolve(document, async () => {
      computations += 1
      return candidate
    })

    const unsafe = cache as unknown as {
      entries: Map<string, { candidate: ResumeExtractionCandidate }>
    }
    const stored = unsafe.entries.values().next().value
    if (!stored) throw new Error('test setup did not create an entry')
    stored.candidate.factCandidates[0].normalizedClaim = '缓存内容已被篡改'

    try {
      await cache.resolve(document, async () => {
        computations += 1
        return candidate
      })
      throw new Error('expected integrity failure')
    } catch (error) {
      expect(error).toBeInstanceOf(V5ResumeExtractionCacheError)
      expect((error as V5ResumeExtractionCacheError).code).toBe('P01_CACHE_INTEGRITY_FAILED')
    }
    expect(computations).toBe(1)
    expect(cache.stats().integrityFailures).toBe(1)
  })

  test('hydrates a validated local snapshot across process-equivalent cache instances', async () => {
    const source = createCache()
    const target = createCache()
    const { document, candidate } = createResumeFixture()
    const normalized = await source.resolve(document, async () => candidate)
    const snapshot = source.snapshot(document)
    if (!snapshot) throw new Error('snapshot was not created')

    target.hydrate(document, structuredClone(snapshot))
    const restored = await target.resolve(document, async () => {
      throw new Error('hydrated cache should have been used')
    })

    expect(restored).toEqual(normalized)
    expect(target.keyFor(document)).toBe(snapshot.cacheKey)
    expect(target.stats()).toMatchObject({ hits: 1, misses: 0, entries: 1 })
  })

  test('promotes only a legacy v1 snapshot whose old key and current full integrity checks pass', async () => {
    const source = createCache()
    const { document, candidate } = createResumeFixture()
    await source.resolve(document, async () => candidate)
    const currentSnapshot = source.snapshot(document)
    if (!currentSnapshot) throw new Error('snapshot was not created')
    const options = {
      implementationFingerprint: 'legacy-full-implementation',
      providerConfigFingerprint: 'legacy-provider-config',
    }
    const legacySnapshot = {
      ...currentSnapshot,
      cacheVersion: V5_RESUME_EXTRACTION_CACHE_LEGACY_VERSION,
      cacheKey: legacyResumeExtractionCacheKeyForPromotion({ document, options }),
    }

    const promoted = validateLegacyResumeExtractionCacheSnapshotForPromotion({
      document,
      snapshot: legacySnapshot,
      options,
    })
    const target = createCache()
    let localPromotions = 0
    await target.resolve(document, async () => {
      localPromotions += 1
      return promoted
    })
    await target.resolve(document, async () => {
      throw new Error('promoted candidate should have been cached')
    })

    expect(localPromotions).toBe(1)
    expect(target.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 })
    expect(() => validateLegacyResumeExtractionCacheSnapshotForPromotion({
      document,
      snapshot: { ...legacySnapshot, cacheKey: 'different-key' },
      options,
    })).toThrow(V5ResumeExtractionCacheError)
    expect(() => validateLegacyResumeExtractionCacheSnapshotForPromotion({
      document,
      snapshot: legacySnapshot,
      options: { ...options, providerConfigFingerprint: 'changed-provider' },
    })).toThrow(V5ResumeExtractionCacheError)
    expect(() => validateLegacyResumeExtractionCacheSnapshotForPromotion({
      document,
      snapshot: { ...legacySnapshot, candidateDigest: 'tampered' },
      options,
    })).toThrow(V5ResumeExtractionCacheError)
  })

  test('rejects a tampered or differently fingerprinted local snapshot', async () => {
    const source = createCache()
    const { document, candidate } = createResumeFixture()
    await source.resolve(document, async () => candidate)
    const snapshot = source.snapshot(document)
    if (!snapshot) throw new Error('snapshot was not created')

    const tampered = structuredClone(snapshot)
    tampered.candidateDigest = 'tampered'
    expect(() => createCache().hydrate(document, tampered)).toThrow(V5ResumeExtractionCacheError)
    expect(() => createCache({ implementationFingerprint: 'implementation-b' }).hydrate(document, snapshot))
      .toThrow(V5ResumeExtractionCacheError)
    expect(() => createCache({ providerConfigFingerprint: 'provider-b' }).hydrate(document, snapshot))
      .toThrow(V5ResumeExtractionCacheError)
    expect(() => createCache({ chunkMaxBlocks: 1 }).hydrate(document, snapshot))
      .toThrow(V5ResumeExtractionCacheError)
  })

  test('keeps a bounded LRU and recomputes an evicted resume', async () => {
    const cache = createCache({ maxEntries: 1 })
    const first = candidateForResume(FIXTURE_RESUME)
    const second = candidateForResume(FIXTURE_RESUME.replace('SQL', 'Python'))
    let computations = 0
    const resolve = (fixture: ReturnType<typeof candidateForResume>) => cache.resolve(fixture.document, async () => {
      computations += 1
      return fixture.candidate
    })

    await resolve(first)
    await resolve(second)
    await resolve(first)

    expect(computations).toBe(3)
    expect(cache.stats()).toMatchObject({ entries: 1, evictions: 2, misses: 3 })
  })

  test('retains only validated shards after a failed compute and resumes without regenerating them', async () => {
    const cache = createCache({ chunkMaxBlocks: 1 })
    const document = partialFixture()
    let generated = 0
    await expect(cache.resolve(document, async context => {
      const candidate = shardCandidate(context.chunks[1])
      generated += 1
      await context.storeValidatedShard!(1, candidate)
      candidate.factCandidates[0].normalizedClaim = 'caller mutation'
      throw new Error('another shard failed')
    })).rejects.toThrow('another shard failed')
    expect(cache.snapshot(document)).toBeNull()
    expect(cache.progress(document)).toEqual({ shardCount: 4, validatedShardIndices: [1], missingShardIndices: [0, 2, 3], complete: false })

    const result = await cache.resolve(document, async context => {
      const candidates = []
      for (let index = 0; index < context.chunks.length; index += 1) {
        let candidate = context.getValidatedShard!(index)
        if (!candidate) {
          generated += 1
          candidate = shardCandidate(context.chunks[index])
          await context.storeValidatedShard!(index, candidate)
        }
        candidates.push(candidate)
      }
      return mergeResumeExtractionCandidates(candidates)
    })
    expect(generated).toBe(4)
    expect(result.factCandidates).toHaveLength(4)
    expect(result.factCandidates.some(fact => fact.normalizedClaim === 'caller mutation')).toBe(false)
    expect(cache.partialSnapshot(document)).toBeNull()
    expect(cache.progress(document)).toEqual({ shardCount: 4, validatedShardIndices: [0, 1, 2, 3], missingShardIndices: [], complete: true })
  })

  test('hydrates source-ordered partial checkpoints across instances and defensively copies every boundary', async () => {
    const checkpoints: TrustedResumeExtractionPartialSnapshot[] = []
    const document = partialFixture()
    const source = createCache({
      chunkMaxBlocks: 1,
      onValidatedShard: async (snapshot, checkpointDocument) => {
        expect(checkpointDocument.sha256).toBe(document.sha256)
        checkpoints.push(structuredClone(snapshot))
        snapshot.shards[0].candidate.factCandidates[0].normalizedClaim = 'callback mutation'
        checkpointDocument.blocks[0].text = 'callback document mutation'
      },
    })
    await expect(source.resolve(document, async context => {
      for (const index of [2, 0]) {
        await context.storeValidatedShard!(index, shardCandidate(context.chunks[index]))
      }
      await context.storeValidatedShard!(0, shardCandidate(context.chunks[0]))
      throw new Error('stopped')
    })).rejects.toThrow('stopped')
    expect(checkpoints.map(snapshot => snapshot.shards.map(shard => shard.index))).toEqual([[2], [0, 2]])
    const snapshot = source.partialSnapshot(document)!
    expect(snapshot.shards.map(shard => shard.index)).toEqual([0, 2])
    const target = createCache({ chunkMaxBlocks: 1 })
    target.hydratePartial(document, snapshot)
    snapshot.shards[0].candidate.factCandidates[0].normalizedClaim = 'snapshot mutation'
    expect(target.progress(document).validatedShardIndices).toEqual([0, 2])
    await expect(target.resolve(document, async context => {
      const cached = context.getValidatedShard!(0)!
      expect(cached.factCandidates[0].normalizedClaim).toBe(document.blocks[0].text)
      cached.factCandidates[0].normalizedClaim = 'read mutation'
      expect(context.getValidatedShard!(0)!.factCandidates[0].normalizedClaim).toBe(document.blocks[0].text)
      throw new Error('stopped')
    })).rejects.toThrow('stopped')
  })

  test('rejects mutated, reordered, duplicate, unknown, out-of-range and mismatched partial snapshots atomically', async () => {
    const document = partialFixture()
    const source = createCache({ chunkMaxBlocks: 1 })
    await expect(source.resolve(document, async context => {
      for (const index of [0, 1]) await context.storeValidatedShard!(index, shardCandidate(context.chunks[index]))
      throw new Error('stopped')
    })).rejects.toThrow('stopped')
    const valid = source.partialSnapshot(document)!
    const mutations: Array<(snapshot: TrustedResumeExtractionPartialSnapshot) => void> = [
      snapshot => { snapshot.shards[0].candidate.factCandidates[0].normalizedClaim = 'tampered' },
      snapshot => { snapshot.shards.reverse(); rehashPartial(snapshot) },
      snapshot => { snapshot.shards[1] = structuredClone(snapshot.shards[0]); rehashPartial(snapshot) },
      snapshot => { Object.assign(snapshot, { privateText: 'unknown' }); rehashPartial(snapshot) },
      snapshot => { Object.assign(snapshot.shards[0], { unknown: true }); rehashPartial(snapshot) },
      snapshot => { snapshot.shards[1].index = snapshot.shardCount; rehashPartial(snapshot) },
      snapshot => { snapshot.shards[1].index = 0.5; rehashPartial(snapshot) },
      snapshot => { snapshot.cacheKey = 'unknown'; rehashPartial(snapshot) },
      snapshot => { snapshot.shardCount += 1; rehashPartial(snapshot) },
      snapshot => { snapshot.shards[1].candidate.factCandidates[0].sourceBlockId = 'B9999'; snapshot.shards[1].candidateDigest = createDigest(snapshot.shards[1].candidate); rehashPartial(snapshot) },
    ]
    for (const mutate of mutations) {
      const target = createCache({ chunkMaxBlocks: 1 })
      const snapshot = structuredClone(valid)
      mutate(snapshot)
      expect(() => target.hydratePartial(document, snapshot)).toThrow(V5ResumeExtractionCacheError)
      expect(target.partialSnapshot(document)).toBeNull()
    }
    expect(() => createCache({ chunkMaxBlocks: 1, providerConfigFingerprint: 'other' }).hydratePartial(document, valid)).toThrow(V5ResumeExtractionCacheError)
  })

  test('invalid or foreign shard output never reaches memory or checkpoint callbacks', async () => {
    const document = partialFixture()
    let callbacks = 0
    const cache = createCache({ chunkMaxBlocks: 1, onValidatedShard: () => { callbacks += 1 } })
    await expect(cache.resolve(document, async context => {
      await expect(context.storeValidatedShard!(-1, shardCandidate(context.chunks[0]))).rejects.toThrow(V5ResumeExtractionCacheError)
      const invalid = shardCandidate(context.chunks[0])
      invalid.factCandidates[0].verbatimText = 'not the source'
      await expect(context.storeValidatedShard!(0, invalid)).rejects.toThrow(V5ResumeExtractionCacheError)
      await expect(context.storeValidatedShard!(1, shardCandidate(context.chunks[0]))).rejects.toThrow(V5ResumeExtractionCacheError)
      throw new Error('stopped')
    })).rejects.toThrow('stopped')
    expect(callbacks).toBe(0)
    expect(cache.partialSnapshot(document)).toBeNull()
  })

  test('preserves a validated shard if checkpoint I/O fails and still rejects invalid full completion', async () => {
    const document = partialFixture()
    const cache = createCache({ chunkMaxBlocks: 1, onValidatedShard: () => { throw new Error('disk unavailable') } })
    await expect(cache.resolve(document, async context => {
      await context.storeValidatedShard!(0, shardCandidate(context.chunks[0]))
      return shardCandidate(context.chunks[0])
    })).rejects.toThrow('disk unavailable')
    expect(cache.progress(document).validatedShardIndices).toEqual([0])
    await expect(cache.resolve(document, async context => {
      const invalid = context.getValidatedShard!(0)!
      invalid.factCandidates[0].verbatimText = 'not source text'
      return invalid
    })).rejects.toThrow(V5ResumeExtractionCacheError)
    expect(cache.snapshot(document)).toBeNull()
    expect(cache.progress(document).validatedShardIndices).toEqual([0])
  })

  test('captures immutable inputs before compute and clear prevents stale in-flight shard resurrection', async () => {
    const original = partialFixture()
    const document = structuredClone(original)
    const cache = createCache({ chunkMaxBlocks: 1 })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const pending = cache.resolve(document, async context => {
      await gate
      const shard = shardCandidate(context.chunks[0])
      context.chunks[0].blocks[0].text = 'context mutated after candidate built'
      await context.storeValidatedShard!(0, shard)
      expect(context.getValidatedShard!(0)).toBeNull()
      throw new Error('stopped')
    })
    document.blocks[0].text = 'caller input mutation'
    cache.clear()
    release()
    await expect(pending).rejects.toThrow('stopped')
    expect(cache.partialSnapshot(original)).toBeNull()
    expect(cache.stats()).toMatchObject({ entries: 0, partialEntries: 0, validatedShards: 0, inFlight: 0 })
  })

  test('bounds failed partial documents using the configured cache capacity', async () => {
    const cache = createCache({ chunkMaxBlocks: 1, maxEntries: 1 })
    const first = partialFixture()
    const second = canonicalizeSourceDocument('技能：Rust\n技能：Go', 'second-partial').canonicalDocument
    for (const document of [first, second]) {
      await expect(cache.resolve(document, async context => {
        await context.storeValidatedShard!(0, shardCandidate(context.chunks[0]))
        throw new Error('stopped')
      })).rejects.toThrow('stopped')
    }
    expect(cache.partialSnapshot(first)).toBeNull()
    expect(cache.progress(second).validatedShardIndices).toEqual([0])
    expect(cache.stats()).toMatchObject({ partialEntries: 1, validatedShards: 1, evictions: 1 })
  })
})
