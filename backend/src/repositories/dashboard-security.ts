import { env } from '@/config/env'
import { getDatabase } from './database'
import { dashboardClient } from './dashboard-client'

export type DashboardRole = 'owner' | 'viewer'
export interface DashboardMember { user_id: string; role: DashboardRole; status: 'active' | 'disabled' }
export interface DashboardAudit {
  actor_user_id: string
  actor_role: DashboardRole
  action: string
  resource_type: string
  resource_id: string | null
  metadata: Record<string, unknown>
}

function database() {
  const db = getDatabase()
  db.exec("CREATE TABLE IF NOT EXISTS dashboard_members (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK (role IN ('owner','viewer')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);")
  db.exec("CREATE TABLE IF NOT EXISTS dashboard_audit_logs (id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL, actor_role TEXT NOT NULL, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);")
  return db
}

export async function findDashboardMember(userId: string): Promise<DashboardMember | null> {
  if (env.DATABASE_PROVIDER === 'supabase') {
    const rows = await dashboardClient().request<DashboardMember[]>('/rest/v1/dashboard_members', {
      searchParams: {select: 'user_id,role,status', user_id: 'eq.' + userId, limit: 1},
    })
    return rows[0] ?? null
  }
  return database().query('SELECT user_id, role, status FROM dashboard_members WHERE user_id = ? LIMIT 1').get(userId) as DashboardMember | null
}

export async function insertDashboardAudit(audit: DashboardAudit): Promise<void> {
  const row = {...audit, id: crypto.randomUUID(), created_at: new Date().toISOString()}
  if (env.DATABASE_PROVIDER === 'supabase') {
    await dashboardClient().request('/rest/v1/dashboard_audit_logs', {method: 'POST', body: row})
    return
  }
  database().query('INSERT INTO dashboard_audit_logs (id, actor_user_id, actor_role, action, resource_type, resource_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.actor_user_id, row.actor_role, row.action, row.resource_type, row.resource_id, JSON.stringify(row.metadata), row.created_at)
}
