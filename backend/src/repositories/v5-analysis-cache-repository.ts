import { randomBytes } from 'node:crypto'
import { env } from '@/config/env'
import { getDatabase } from '@/repositories/database'
import { createSupabaseRestClient, SupabaseRestError } from '@/repositories/supabase/client'

export const V5_ANALYSIS_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const V5_ANALYSIS_CACHE_LEASE_MS = 150 * 1000

export type V5AnalysisCacheStatus = 'pending' | 'ready'
export type V5AnalysisCacheResultStatus = 'miss' | 'hit' | 'coalesced' | 'disabled'

export interface V5AnalysisCacheRow {
  cache_key: string
  owner_id: string
  fingerprint: string
  status: V5AnalysisCacheStatus
  lease_token: string
  lease_expires_at: string
  payload: unknown
  expires_at: string
  hit_count: number
  created_at: string
  updated_at: string
}

export interface V5AnalysisCacheClaim {
  row: V5AnalysisCacheRow
  acquired: boolean
}

export interface V5AnalysisCacheStorage {
  read(cacheKey: string, owner: string, fingerprint: string): Promise<V5AnalysisCacheRow | null>
  claim(input: {
    cacheKey: string
    owner: string
    fingerprint: string
    leaseToken: string
    leaseExpiresAt: string
  }): Promise<V5AnalysisCacheClaim>
  complete(input: {
    cacheKey: string
    owner: string
    fingerprint: string
    leaseToken: string
    payload: unknown
    expiresAt: string
  }): Promise<void>
  recordHit(input: {
    cacheKey: string
    owner: string
    fingerprint: string
    expectedHitCount: number
  }): Promise<void>
  fail(input: {
    cacheKey: string
    owner: string
    fingerprint: string
    leaseToken: string
  }): Promise<void>
  health(): Promise<void>
  cleanup(): Promise<void>
}

export interface V5AnalysisCacheResolveInput<T> {
  cacheKey: string
  owner: string
  fingerprint: string
  leaseMs?: number
  pollIntervalMs?: number
  compute: () => Promise<T>
}

export interface V5AnalysisCacheResolveResult<T> {
  value: T
  cacheStatus: V5AnalysisCacheResultStatus
}

function sqliteAnalysisCache() {
  const db = getDatabase()
  db.exec(`CREATE TABLE IF NOT EXISTS v5_analysis_cache (
    cache_key TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    lease_token TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    payload TEXT,
    expires_at TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_v5_analysis_cache_expiry
    ON v5_analysis_cache(expires_at);
  CREATE INDEX IF NOT EXISTS idx_v5_analysis_cache_owner
    ON v5_analysis_cache(owner_id, fingerprint, expires_at);`)
  return db
}

function parseSqliteRow(row: (V5AnalysisCacheRow & {payload: string | null}) | null): V5AnalysisCacheRow | null {
  return row ? {...row, payload: row.payload === null ? null : JSON.parse(row.payload)} : null
}

function logAnalysisCacheUnavailable(operation: string, error: unknown) {
  const providerStatus = error && typeof error === 'object' && 'status' in error
    && typeof (error as {status?: unknown}).status === 'number'
    ? (error as {status: number}).status
    : undefined
  console.error(JSON.stringify({
    type: 'analysis_cache.unavailable',
    code: 'V5_ANALYSIS_CACHE_UNAVAILABLE',
    operation,
    errorName: error instanceof Error ? error.name : 'UnknownError',
    ...(providerStatus === undefined ? {} : {providerStatus}),
  }))
}

export const v5AnalysisCacheStorage: V5AnalysisCacheStorage = {
  async read(cacheKey, owner, fingerprint) {
    if (env.DATABASE_PROVIDER === 'supabase') {
      const rows = await createSupabaseRestClient({useServiceRole: true}).request<V5AnalysisCacheRow[]>(
        '/rest/v1/v5_analysis_cache',
        {
          searchParams: {
            cache_key: `eq.${cacheKey}`,
            owner_id: `eq.${owner}`,
            fingerprint: `eq.${fingerprint}`,
            select: '*',
            limit: 1,
          },
        },
      )
      return rows[0] ?? null
    }
    const row = sqliteAnalysisCache().query(
      'SELECT * FROM v5_analysis_cache WHERE cache_key = ? AND owner_id = ? AND fingerprint = ?',
    ).get(cacheKey, owner, fingerprint) as (V5AnalysisCacheRow & {payload: string | null}) | null
    return parseSqliteRow(row)
  },

  async claim(input) {
    const now = new Date()
    const nowIso = now.toISOString()
    const row: V5AnalysisCacheRow = {
      cache_key: input.cacheKey,
      owner_id: input.owner,
      fingerprint: input.fingerprint,
      status: 'pending',
      lease_token: input.leaseToken,
      lease_expires_at: input.leaseExpiresAt,
      payload: null,
      expires_at: input.leaseExpiresAt,
      hit_count: 0,
      created_at: nowIso,
      updated_at: nowIso,
    }

    if (env.DATABASE_PROVIDER === 'supabase') {
      const client = createSupabaseRestClient({useServiceRole: true})
      try {
        await client.request('/rest/v1/v5_analysis_cache', {method: 'POST', body: row})
        return {row, acquired: true}
      } catch (error) {
        if (!(error instanceof SupabaseRestError) || error.status !== 409) throw error
      }
    } else {
      const result = sqliteAnalysisCache().query(`INSERT INTO v5_analysis_cache (
        cache_key, owner_id, fingerprint, status, lease_token, lease_expires_at,
        payload, expires_at, hit_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)
      ON CONFLICT(cache_key) DO NOTHING`).run(
        row.cache_key, row.owner_id, row.fingerprint, row.status, row.lease_token,
        row.lease_expires_at, row.expires_at, row.created_at, row.updated_at,
      )
      if (result.changes > 0) return {row, acquired: true}
    }

    const existing = await this.read(input.cacheKey, input.owner, input.fingerprint)
    if (!existing) throw new Error('V5 analyze cache claim disappeared')
    if (existing.status === 'ready' && Date.parse(existing.expires_at) > now.getTime()) {
      return {row: existing, acquired: false}
    }
    if (existing.status === 'pending' && Date.parse(existing.lease_expires_at) > now.getTime()) {
      return {row: existing, acquired: false}
    }

    const updates: Pick<
      V5AnalysisCacheRow,
      'status' | 'lease_token' | 'lease_expires_at' | 'payload' | 'expires_at' | 'updated_at'
    > = {
      status: 'pending',
      lease_token: input.leaseToken,
      lease_expires_at: input.leaseExpiresAt,
      payload: null,
      expires_at: input.leaseExpiresAt,
      updated_at: nowIso,
    }
    if (env.DATABASE_PROVIDER === 'supabase') {
      const rows = await createSupabaseRestClient({useServiceRole: true}).request<V5AnalysisCacheRow[]>(
        '/rest/v1/v5_analysis_cache',
        {
          method: 'PATCH',
          searchParams: {
            cache_key: `eq.${existing.cache_key}`,
            owner_id: `eq.${existing.owner_id}`,
            fingerprint: `eq.${existing.fingerprint}`,
            status: `eq.${existing.status}`,
            lease_token: `eq.${existing.lease_token}`,
            lease_expires_at: `eq.${existing.lease_expires_at}`,
            select: '*',
          },
          body: updates,
          prefer: 'return=representation',
        },
      )
      return rows[0] ? {row: rows[0], acquired: true} : {row: existing, acquired: false}
    }
    const result = sqliteAnalysisCache().query(`UPDATE v5_analysis_cache SET
      status = ?, lease_token = ?, lease_expires_at = ?, payload = NULL,
      expires_at = ?, updated_at = ?
      WHERE cache_key = ? AND owner_id = ? AND fingerprint = ?
        AND status = ? AND lease_token = ? AND lease_expires_at = ?`).run(
      updates.status, updates.lease_token, updates.lease_expires_at, updates.expires_at, updates.updated_at,
      existing.cache_key, existing.owner_id, existing.fingerprint,
      existing.status, existing.lease_token, existing.lease_expires_at,
    )
    return result.changes > 0 ? {row: {...existing, ...updates}, acquired: true} : {row: existing, acquired: false}
  },

  async complete(input) {
    const updates = {
      status: 'ready',
      lease_token: '',
      lease_expires_at: input.expiresAt,
      payload: input.payload,
      expires_at: input.expiresAt,
      updated_at: new Date().toISOString(),
    }
    if (env.DATABASE_PROVIDER === 'supabase') {
      const rows = await createSupabaseRestClient({useServiceRole: true}).request<V5AnalysisCacheRow[]>(
        '/rest/v1/v5_analysis_cache',
        {
          method: 'PATCH',
          searchParams: {
            cache_key: `eq.${input.cacheKey}`,
            owner_id: `eq.${input.owner}`,
            fingerprint: `eq.${input.fingerprint}`,
            status: 'eq.pending',
            lease_token: `eq.${input.leaseToken}`,
            select: '*',
          },
          body: updates,
          prefer: 'return=representation',
        },
      )
      if (!rows[0]) throw new Error('V5 analyze cache completion lost its lease')
      return
    }
    const result = sqliteAnalysisCache().query(`UPDATE v5_analysis_cache SET
      status = ?, lease_token = ?, lease_expires_at = ?, payload = ?,
      expires_at = ?, updated_at = ?
      WHERE cache_key = ? AND owner_id = ? AND fingerprint = ?
        AND status = 'pending' AND lease_token = ?`).run(
      updates.status, updates.lease_token, updates.lease_expires_at,
      JSON.stringify(input.payload), updates.expires_at, updates.updated_at,
      input.cacheKey, input.owner, input.fingerprint, input.leaseToken,
    )
    if (result.changes === 0) throw new Error('V5 analyze cache completion lost its lease')
  },

  async recordHit(input) {
    const updatedHitCount = input.expectedHitCount + 1
    const updatedAt = new Date().toISOString()
    if (env.DATABASE_PROVIDER === 'supabase') {
      await createSupabaseRestClient({useServiceRole: true}).request('/rest/v1/v5_analysis_cache', {
        method: 'PATCH',
        searchParams: {
          cache_key: `eq.${input.cacheKey}`,
          owner_id: `eq.${input.owner}`,
          fingerprint: `eq.${input.fingerprint}`,
          status: 'eq.ready',
          hit_count: `eq.${input.expectedHitCount}`,
        },
        body: {hit_count: updatedHitCount, updated_at: updatedAt},
        prefer: 'return=minimal',
      })
      return
    }
    sqliteAnalysisCache().query(`UPDATE v5_analysis_cache SET hit_count = ?, updated_at = ?
      WHERE cache_key = ? AND owner_id = ? AND fingerprint = ?
        AND status = 'ready' AND hit_count = ?`).run(
      updatedHitCount, updatedAt, input.cacheKey, input.owner, input.fingerprint, input.expectedHitCount,
    )
  },

  async fail(input) {
    if (env.DATABASE_PROVIDER === 'supabase') {
      await createSupabaseRestClient({useServiceRole: true}).request('/rest/v1/v5_analysis_cache', {
        method: 'DELETE',
        searchParams: {
          cache_key: `eq.${input.cacheKey}`,
          owner_id: `eq.${input.owner}`,
          fingerprint: `eq.${input.fingerprint}`,
          status: 'eq.pending',
          lease_token: `eq.${input.leaseToken}`,
        },
        prefer: 'return=minimal',
      })
      return
    }
    sqliteAnalysisCache().query(`DELETE FROM v5_analysis_cache
      WHERE cache_key = ? AND owner_id = ? AND fingerprint = ?
        AND status = 'pending' AND lease_token = ?`).run(
      input.cacheKey, input.owner, input.fingerprint, input.leaseToken,
    )
  },

  async health() {
    if (env.DATABASE_PROVIDER === 'supabase') {
      await createSupabaseRestClient({useServiceRole: true}).request<V5AnalysisCacheRow[]>(
        '/rest/v1/v5_analysis_cache',
        {searchParams: {cache_key: 'eq.__health_check__', select: 'cache_key', limit: 1}},
      )
      return
    }
    sqliteAnalysisCache().query('SELECT 1 AS ok FROM v5_analysis_cache LIMIT 1').get()
  },

  async cleanup() {
    const now = new Date().toISOString()
    if (env.DATABASE_PROVIDER === 'supabase') {
      const client = createSupabaseRestClient({useServiceRole: true})
      await client.request('/rest/v1/v5_analysis_cache', {
        method: 'DELETE', searchParams: {expires_at: `lte.${now}`}, prefer: 'return=minimal',
      })
      await client.request('/rest/v1/v5_analysis_cache', {
        method: 'DELETE',
        searchParams: {status: 'eq.pending', lease_expires_at: `lte.${now}`},
        prefer: 'return=minimal',
      })
      return
    }
    sqliteAnalysisCache().query(
      "DELETE FROM v5_analysis_cache WHERE expires_at <= ? OR (status = 'pending' AND lease_expires_at <= ?)",
    ).run(now, now)
  },
}

export async function getV5AnalysisCacheHealth(
  storage: Pick<V5AnalysisCacheStorage, 'health'> = v5AnalysisCacheStorage,
): Promise<{
  status: 'ok' | 'degraded'
  errorCode?: string
}> {
  try {
    await storage.health()
    return {status: 'ok'}
  } catch {
    return {status: 'degraded', errorCode: 'V5_ANALYSIS_CACHE_UNAVAILABLE'}
  }
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export class V5AnalysisCacheRepository {
  private readonly inFlight = new Map<string, Promise<V5AnalysisCacheResolveResult<unknown>>>()

  constructor(private readonly storage: V5AnalysisCacheStorage = v5AnalysisCacheStorage) {}

  private async computeWithoutCache<T>(
    input: V5AnalysisCacheResolveInput<T>,
    operation: string,
    error: unknown,
  ): Promise<V5AnalysisCacheResolveResult<T>> {
    logAnalysisCacheUnavailable(operation, error)
    return {value: await input.compute(), cacheStatus: 'disabled'}
  }

  async resolve<T>(input: V5AnalysisCacheResolveInput<T>): Promise<V5AnalysisCacheResolveResult<T>> {
    const existing = this.inFlight.get(input.cacheKey)
    if (existing) {
      const result = await existing
      return {...result, value: cloneValue(result.value) as T, cacheStatus: 'coalesced'}
    }

    const pending = this.resolveDistributed(input)
    this.inFlight.set(input.cacheKey, pending)
    try {
      const result = await pending
      return {...result, value: cloneValue(result.value)}
    } finally {
      if (this.inFlight.get(input.cacheKey) === pending) this.inFlight.delete(input.cacheKey)
    }
  }

  private async resolveDistributed<T>(
    input: V5AnalysisCacheResolveInput<T>,
  ): Promise<V5AnalysisCacheResolveResult<T>> {
    const leaseMs = input.leaseMs ?? V5_ANALYSIS_CACHE_LEASE_MS
    const pollIntervalMs = Math.max(25, input.pollIntervalMs ?? 500)
    for (let claimAttempt = 0; claimAttempt < 3; claimAttempt += 1) {
      const leaseToken = randomBytes(24).toString('hex')
      const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString()
      let claim: V5AnalysisCacheClaim
      try {
        claim = await this.storage.claim({
          cacheKey: input.cacheKey,
          owner: input.owner,
          fingerprint: input.fingerprint,
          leaseToken,
          leaseExpiresAt,
        })
      } catch (error) {
        return this.computeWithoutCache(input, 'claim', error)
      }

      if (claim.acquired) {
        let value: T
        try {
          value = await input.compute()
        } catch (error) {
          try {
            await this.storage.fail({
              cacheKey: input.cacheKey,
              owner: input.owner,
              fingerprint: input.fingerprint,
              leaseToken,
            })
          } catch (cleanupError) {
            logAnalysisCacheUnavailable('fail_after_compute_error', cleanupError)
          }
          throw error
        }

        try {
          await this.storage.complete({
            cacheKey: input.cacheKey,
            owner: input.owner,
            fingerprint: input.fingerprint,
            leaseToken,
            payload: value,
            expiresAt: new Date(Date.now() + V5_ANALYSIS_CACHE_TTL_MS).toISOString(),
          })
          return {value, cacheStatus: 'miss'}
        } catch (error) {
          logAnalysisCacheUnavailable('complete', error)
          try {
            await this.storage.fail({
              cacheKey: input.cacheKey,
              owner: input.owner,
              fingerprint: input.fingerprint,
              leaseToken,
            })
          } catch (cleanupError) {
            logAnalysisCacheUnavailable('fail_after_complete_error', cleanupError)
          }
          return {value, cacheStatus: 'disabled'}
        }
      }

      if (claim.row.status === 'ready') {
        try {
          const value = cloneValue(claim.row.payload) as T
          try {
            await this.storage.recordHit({
              cacheKey: input.cacheKey,
              owner: input.owner,
              fingerprint: input.fingerprint,
              expectedHitCount: claim.row.hit_count,
            })
          } catch (error) {
            logAnalysisCacheUnavailable('record_hit', error)
          }
          return {value, cacheStatus: 'hit'}
        } catch (error) {
          return this.computeWithoutCache(input, 'read_ready', error)
        }
      }

      const deadline = Date.parse(claim.row.lease_expires_at)
      while (Date.now() < deadline) {
        await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())))
        let row: V5AnalysisCacheRow | null
        try {
          row = await this.storage.read(input.cacheKey, input.owner, input.fingerprint)
        } catch (error) {
          return this.computeWithoutCache(input, 'poll', error)
        }
        if (row?.status === 'ready') {
          try {
            const value = cloneValue(row.payload) as T
            try {
              await this.storage.recordHit({
                cacheKey: input.cacheKey,
                owner: input.owner,
                fingerprint: input.fingerprint,
                expectedHitCount: row.hit_count,
              })
            } catch (error) {
              logAnalysisCacheUnavailable('record_hit', error)
            }
            return {value, cacheStatus: 'hit'}
          } catch (error) {
            return this.computeWithoutCache(input, 'read_polled_result', error)
          }
        }
        if (!row || Date.parse(row.lease_expires_at) <= Date.now()) break
      }
    }
    return this.computeWithoutCache(
      input,
      'coordination_retry_exhausted',
      new Error('V5 analyze cache coordination failed'),
    )
  }
}
