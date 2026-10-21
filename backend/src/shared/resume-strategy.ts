// 由 shared/sync-resume-strategy.mjs 生成，请修改 shared/resume-strategy.ts 后重新同步。
/** Shared by the API and local history; these links show provenance, not semantic completion. */
export interface ResumeStrategyReference {
  outputPath: string
  location: string
  quote: string
}

export interface ResumeStrategyOutcome {
  strategyId: string
  strategy: string
  status: 'linked' | 'needs_material' | 'not_selected' | 'not_located'
  explanation: string
  references: ResumeStrategyReference[]
}

export interface ResumeStrategyReview {
  version: 'resume-strategy-v1'
  resumeFingerprint: string
  items: ResumeStrategyOutcome[]
}

// A synchronous content identity for stale UI detection, never for authentication.
export function resumeTextFingerprint(markdown: string): string {
  let first = 2166136261
  let second = 5381
  for (let index = 0; index < markdown.length; index++) {
    const char = markdown.charCodeAt(index)
    first = Math.imul(first ^ char, 16777619)
    second = Math.imul(second, 33) ^ char
  }
  return `text-v1:${markdown.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`
}

export function currentStrategyReview(review: ResumeStrategyReview | undefined, markdown: string): ResumeStrategyReview | undefined {
  return normalizeStrategyReview(review, markdown)
}

export function normalizeStrategyReview(value: unknown, markdown: string): ResumeStrategyReview | undefined {
  if (typeof markdown !== 'string' || !value || typeof value !== 'object') return undefined
  const review = value as Partial<ResumeStrategyReview>
  if (review.version !== 'resume-strategy-v1' || review.resumeFingerprint !== resumeTextFingerprint(markdown)
    || !Array.isArray(review.items)) return undefined
  const statuses = new Set(['linked', 'needs_material', 'not_selected', 'not_located'])
  const items = review.items.filter(item => item && typeof item.strategyId === 'string'
    && typeof item.strategy === 'string' && typeof item.explanation === 'string'
    && statuses.has(item.status) && Array.isArray(item.references)).map(item => {
      const references = item.references.filter(ref => ref && typeof ref.outputPath === 'string'
        && typeof ref.location === 'string' && typeof ref.quote === 'string'
        && ref.quote.trim().length > 0 && markdown.includes(ref.quote))
      return item.status === 'linked' && !references.length
        ? {...item, status: 'not_located' as const, explanation: '暂未找到可核对的对应正文。', references: []}
        : {...item, references}
    })
  return {version: review.version, resumeFingerprint: review.resumeFingerprint, items}
}

/** Exact delivered excerpts only; advice must never become a change summary. */
export function strategyResultExcerpts(review: ResumeStrategyReview | undefined, markdown: string): string[] {
  const current = normalizeStrategyReview(review, markdown)
  const seen = new Set<string>()
  return (current?.items ?? []).filter(item => item.status === 'linked').flatMap(item => item.references)
    .filter(ref => {
      if (seen.has(ref.quote)) return false
      seen.add(ref.quote)
      return true
    }).slice(0, 2).map(ref => `${ref.location}：${ref.quote}`)
}

export interface ResumeValueSummary {
  title: '这份简历的重点' | '优化建议'
  body: string
}

const businessParagraphPath = /^(?:experience|project|research)\.[^\s]+\.bullets\[\d+\]$/u
const withoutListMarker = (text: string) => text.trim().replace(/^[-*+]\s+/u, '')

/** Only whole delivered business paragraphs may become homepage highlights. */
export function buildResumeValueSummary(input: {
  markdown: string
  review?: unknown
  advice?: readonly unknown[]
}): ResumeValueSummary {
  const markdown = typeof input.markdown === 'string' ? input.markdown : ''
  const review = normalizeStrategyReview(input.review, markdown)
  const bodyLines = new Set(markdown.split(/\r?\n/u).map(line => line.trim())
    .filter(line => line && !/^(?:#{1,6}\s|```|~~~|\|)/u.test(line))
    .map(withoutListMarker))
  const seen = new Set<string>()
  const paragraphs: string[] = []
  for (const item of review?.items ?? []) {
    if (item.status !== 'linked') continue
    for (const reference of item.references) {
      if (!businessParagraphPath.test(reference.outputPath) || !reference.location.trim()) continue
      const quote = withoutListMarker(reference.quote)
      if (!quote || /[\r\n]/u.test(quote) || !bodyLines.has(quote) || seen.has(quote)) continue
      seen.add(quote)
      paragraphs.push(`${reference.location.trim()}：${quote}`)
      if (paragraphs.length === 2) break
    }
    if (paragraphs.length === 2) break
  }
  if (paragraphs.length) return {title: '这份简历的重点', body: paragraphs.join('\n\n')}

  const advice = [...new Set((input.advice ?? []).filter((value): value is string => typeof value === 'string')
    .map(value => value.trim()).filter(Boolean))].slice(0, 2)
  return {title: '优化建议', body: advice.join('\n\n') || '暂无可展示的优化建议。'}
}
