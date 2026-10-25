export type ShareContentMode = 'job' | 'blank'
export type ShareCreatedVia = 'image' | 'link'
export type ShareTheme = 'green' | 'blue'

export interface ShareLandingCopy {
  brand: string
  teaser_title: string
  teaser_subtitle: string
  teaser_hint: string
  revealed_title: string
  revealed_body: string
  cta: string
}

export interface JobShareCardSnapshot {
  kind: 'job'
  display_name: string
  company: string
  position: string
  location: string
  generated_date: string
  match_score: number
  summary_lines: string[]
  card_color?: string
  card_pattern?: string
}

export interface BlankShareCardSnapshot {
  kind: 'blank'
  title: string
  prompt: string
  action: string
}

export interface ShareSnapshot {
  schema_version: 1
  mode: ShareContentMode
  theme: ShareTheme
  card: JobShareCardSnapshot | BlankShareCardSnapshot
  landing: ShareLandingCopy
}

export interface ShareLinkRecord {
  id: string
  user_id: string
  source_history_id: string
  mode: ShareContentMode
  token_hash: string
  idempotency_key_hash: string
  snapshot: ShareSnapshot
  schema_version: number
  created_via: ShareCreatedVia
  expires_at: string
  revoked_at: string | null
  created_at: string
  updated_at: string
  last_viewed_at: string | null
  view_count: number
}

export interface CreateShareLinkInput {
  id: string
  user_id: string
  source_history_id: string
  mode: ShareContentMode
  token_hash: string
  idempotency_key_hash: string
  snapshot: ShareSnapshot
  schema_version: number
  created_via: ShareCreatedVia
  expires_at: string
}

export interface CreatedShareLink {
  id: string
  token: string
  share_url: string
  mode: ShareContentMode
  schema_version: number
  expires_at: string
}

export interface PublicShareLink {
  share_id: string
  schema_version: number
  mode: ShareContentMode
  theme: ShareTheme
  card: JobShareCardSnapshot | BlankShareCardSnapshot
  landing: ShareLandingCopy
}
