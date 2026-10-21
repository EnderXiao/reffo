import type {
  V5AnalysisCacheClaim,
  V5AnalysisCacheRow,
  V5AnalysisCacheStorage,
} from '@/repositories/v5-analysis-cache-repository'

export class MemoryAnalysisCacheStorage implements V5AnalysisCacheStorage {
  readonly rows = new Map<string, V5AnalysisCacheRow>()

  private key(input: {cacheKey: string; owner: string; fingerprint: string}) {
    return `${input.cacheKey}:${input.owner}:${input.fingerprint}`
  }

  async read(cacheKey: string, owner: string, fingerprint: string) {
    return this.rows.get(this.key({cacheKey, owner, fingerprint})) ?? null
  }

  async claim(input: {
    cacheKey: string
    owner: string
    fingerprint: string
    leaseToken: string
    leaseExpiresAt: string
  }): Promise<V5AnalysisCacheClaim> {
    const key = this.key(input)
    const existing = this.rows.get(key)
    const now = Date.now()
    if (existing?.status === 'ready' && Date.parse(existing.expires_at) > now) {
      return {row: structuredClone(existing), acquired: false}
    }
    if (existing?.status === 'pending' && Date.parse(existing.lease_expires_at) > now) {
      return {row: structuredClone(existing), acquired: false}
    }
    const nowIso = new Date(now).toISOString()
    const row: V5AnalysisCacheRow = {
      cache_key: input.cacheKey,
      owner_id: input.owner,
      fingerprint: input.fingerprint,
      status: 'pending',
      lease_token: input.leaseToken,
      lease_expires_at: input.leaseExpiresAt,
      payload: null,
      expires_at: input.leaseExpiresAt,
      hit_count: existing?.status === 'ready' ? existing.hit_count : existing?.hit_count ?? 0,
      created_at: existing?.created_at ?? nowIso,
      updated_at: nowIso,
    }
    this.rows.set(key, row)
    return {row: structuredClone(row), acquired: true}
  }

  async complete(input: {
    cacheKey: string
    owner: string
    fingerprint: string
    leaseToken: string
    payload: unknown
    expiresAt: string
  }) {
    const key = this.key(input)
    const row = this.rows.get(key)
    if (!row || row.status !== 'pending' || row.lease_token !== input.leaseToken) return
    this.rows.set(key, {
      ...row,
      status: 'ready',
      lease_token: '',
      lease_expires_at: input.expiresAt,
      payload: structuredClone(input.payload),
      expires_at: input.expiresAt,
      updated_at: new Date().toISOString(),
    })
  }

  async recordHit(input: {
    cacheKey: string
    owner: string
    fingerprint: string
    expectedHitCount: number
  }) {
    const key = this.key(input)
    const row = this.rows.get(key)
    if (!row || row.status !== 'ready' || row.hit_count !== input.expectedHitCount) return
    this.rows.set(key, {...row, hit_count: row.hit_count + 1, updated_at: new Date().toISOString()})
  }

  async fail(input: {
    cacheKey: string
    owner: string
    fingerprint: string
    leaseToken: string
  }) {
    const key = this.key(input)
    const row = this.rows.get(key)
    if (row?.status === 'pending' && row.lease_token === input.leaseToken) this.rows.delete(key)
  }

  async health() {}

  async cleanup() {
    const now = Date.now()
    for (const [key, row] of this.rows) {
      if (Date.parse(row.expires_at) <= now
        || (row.status === 'pending' && Date.parse(row.lease_expires_at) <= now)) {
        this.rows.delete(key)
      }
    }
  }
}
