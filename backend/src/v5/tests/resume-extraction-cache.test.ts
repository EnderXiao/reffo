import { describe, expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import {
  createTrustedResumeExtractionCache,
  V5ResumeExtractionCacheError,
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
})
