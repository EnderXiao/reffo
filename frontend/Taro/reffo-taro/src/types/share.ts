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

export interface PublicShareLink {
  share_id: string
  schema_version: number
  mode: ShareContentMode
  theme: ShareTheme
  card: JobShareCardSnapshot | BlankShareCardSnapshot
  landing: ShareLandingCopy
}

export interface CreatedShareLink {
  id: string
  token: string
  share_url: string
  mode: ShareContentMode
  schema_version: number
  expires_at: string
}

export interface CreateShareLinkInput {
  history_id: string
  mode: ShareContentMode
  created_via: ShareCreatedVia
}
