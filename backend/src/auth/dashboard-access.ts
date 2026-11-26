import { env } from '@/config/env'
import { getSupabaseAuthUser, SupabaseRestError } from '@/repositories/supabase/client'
import { findDashboardMember, insertDashboardAudit, type DashboardRole } from '@/repositories/dashboard-security'

export type { DashboardRole }
export interface DashboardAccess { userId: string; role: DashboardRole }
export class DashboardAccessError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message)
    this.name = 'DashboardAccessError'
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 管理后台始终校验远端身份，不沿用主产品 local 的开发用户免登录。
export async function requireDashboardAccess(headers: Record<string, string | undefined>, write = false): Promise<DashboardAccess> {
  const authorization = headers.authorization ?? headers.Authorization ?? ''
  const token = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1]
  if (!token || token.length > 8192) throw new DashboardAccessError('DASHBOARD_AUTH_REQUIRED', '请先登录管理后台', 401)
  let userId: string
  try { userId = (await getSupabaseAuthUser(token)).id } catch (error) {
    if (error instanceof SupabaseRestError && (error.status === 401 || error.status === 403)) {
      throw new DashboardAccessError('DASHBOARD_AUTH_REQUIRED', '登录状态已失效，请重新登录', 401)
    }
    throw new DashboardAccessError('DASHBOARD_ACCESS_UNAVAILABLE', '认证服务暂不可用，请稍后重试', 503)
  }
  if (!UUID.test(userId)) throw new DashboardAccessError('DASHBOARD_AUTH_REQUIRED', '登录状态无效', 401)
  let member
  try { member = await findDashboardMember(userId) } catch {
    throw new DashboardAccessError('DASHBOARD_ACCESS_UNAVAILABLE', '后台权限校验暂不可用', 503)
  }
  const bootstrap = env.DASHBOARD_OWNER_USER_IDS.includes(userId)
  // 显式禁用/降权优先于环境中的引导 owner 名单。
  const role = member ? (member.status === 'active' ? member.role : null) : bootstrap ? 'owner' : null
  if (role !== 'viewer' && role !== 'owner') throw new DashboardAccessError('DASHBOARD_FORBIDDEN', '当前账号没有管理后台权限', 403)
  if (write && role !== 'owner') throw new DashboardAccessError('DASHBOARD_FORBIDDEN', '当前账号为只读权限', 403)
  return {userId, role}
}

export function dashboardPermissions(role: DashboardRole) {
  return {canRead: true, canViewDetails: true, canWrite: role === 'owner'}
}

export async function recordDashboardAudit(access: DashboardAccess, action: string, resourceType: string, resourceId: string | null, outcome: 'attempt' | 'succeeded' | 'failed') {
  await insertDashboardAudit({actor_user_id: access.userId, actor_role: access.role, action, resource_type: resourceType, resource_id: resourceId?.slice(0, 160) ?? null, metadata: {outcome}})
}
