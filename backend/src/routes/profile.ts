import { Elysia } from 'elysia'
import { RequestAuthError, resolveRequestUser } from '@/auth/request-context'
import { env } from '@/config/env'
import { createSupabaseRestClient } from '@/repositories/supabase/client'
import type { ApiResponse } from '@/types'

interface ProfileRow {
  id: string
  display_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

interface ProfileRecord {
  id: string
  displayName: string | null
  avatarUrl: string
  createdAt: string | null
  updatedAt: string | null
}

function hashSeed(seed: string) {
  return seed.split('').reduce((value, char) => ((value * 33) + char.charCodeAt(0)) >>> 0, 17)
}

function buildGeneratedAvatar(userId: string) {
  const hash = hashSeed(userId)
  const hue = hash % 360
  const accentHue = (hue + 34 + ((hash >> 8) % 28)) % 360
  const rotation = -18 + ((hash >> 12) % 36)
  const glyphColor = `hsl(${(hue + 180) % 360} 30% 98%)`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><defs><linearGradient id="g" x1="22" y1="12" x2="172" y2="180" gradientUnits="userSpaceOnUse"><stop stop-color="hsl(${hue} 78% 72%)"/><stop offset="1" stop-color="hsl(${accentHue} 72% 48%)"/></linearGradient></defs><rect width="192" height="192" rx="48" fill="url(#g)"/><g transform="translate(96 96) rotate(${rotation}) translate(-48 -47)" fill="${glyphColor}"><path d="M48 36C48 42.075 43.075 47 37 47S26 42.075 26 36s4.925-11 11-11 11 4.925 11 11Z"/><path d="M0 25v22h10c5.6 0 7.667-6.333 8-9.5V22c0-2.4 2-2.667 3-2.5h8.5C34.7 19.5 37.333 13.833 38 11V0H26c-3.2 0-5.333 2-6 3C14.667 8 3.6 18.4 2 20c-1.6 1.6-2 4-2 5Z"/></g><circle cx="152" cy="38" r="10" fill="rgba(255,255,255,.28)"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function mapProfile(row: ProfileRow, fallbackAvatar: string): ProfileRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url || fallbackAvatar,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

function authError(error: RequestAuthError, set: {status?: unknown}) {
  set.status = error.status
  return {
    success: false,
    error: {code: error.code, message: error.message},
  } satisfies ApiResponse<never>
}

export const profileRoutes = new Elysia({prefix: '/api/v1/profile'})
  .get('/', async ({headers, set}) => {
    try {
      const context = await resolveRequestUser(headers)
      const avatar = buildGeneratedAvatar(context.userId)

      if (env.DATABASE_PROVIDER !== 'supabase') {
        return {success: true, data: {id: context.userId, displayName: null, avatarUrl: avatar, createdAt: null, updatedAt: null}} satisfies ApiResponse<ProfileRecord>
      }

      const client = createSupabaseRestClient(context)
      const rows = await client.request<ProfileRow[]>('/rest/v1/profiles', {
        searchParams: {
          select: 'id,display_name,avatar_url,created_at,updated_at',
          id: `eq.${context.userId}`,
          limit: 1,
        },
      })

      if (rows[0]) {
        if (!rows[0].avatar_url) {
          const updated = await client.request<ProfileRow[]>('/rest/v1/profiles', {
            method: 'PATCH',
            searchParams: {id: `eq.${context.userId}`},
            prefer: 'return=representation',
            body: {avatar_url: avatar, updated_at: new Date().toISOString()},
          })
          if (updated[0]) {
            return {success: true, data: mapProfile(updated[0], avatar)} satisfies ApiResponse<ProfileRecord>
          }
        }
        return {success: true, data: mapProfile(rows[0], avatar)} satisfies ApiResponse<ProfileRecord>
      }

      const created = await client.request<ProfileRow[]>('/rest/v1/profiles', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=representation',
        body: {id: context.userId, avatar_url: avatar},
      })

      const profile = created[0]
      if (!profile) {
        throw new Error('profile insert returned no row')
      }

      return {success: true, data: mapProfile(profile, avatar)} satisfies ApiResponse<ProfileRecord>
    } catch (error) {
      if (error instanceof RequestAuthError) {
        return authError(error, set)
      }
      console.error('获取用户资料失败:', error)
      set.status = 500
      return {success: false, error: {code: 'PROFILE_GET_FAILED', message: '获取用户资料失败，请稍后重试'}} satisfies ApiResponse<never>
    }
  }, {
    detail: {summary: '获取用户资料', description: '返回当前登录用户资料，并为首次登录用户生成稳定头像。', tags: ['Auth']},
  })
