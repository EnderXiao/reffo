const SENSITIVE_KEY = /password|passwd|secret|token|authorization|cookie|api.?key|email|phone|mobile|resume.?markdown|resume.?text|jd.?text|raw.?body/i

export function redactDashboardText(text: string, maxLength = 16_000): string {
  return text.slice(0, maxLength)
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sb_secret_|sb_publishable_|sk-)[A-Za-z0-9_.-]+/g, '[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED]')
    .replace(/(password|secret|token|api[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1$2[REDACTED]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    .replace(/\b1[3-9]\d{9}\b/g, '[PHONE]')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1?[REDACTED]')
}

export function redactDashboardValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]'
  if (typeof value === 'string') return redactDashboardText(value, 2000)
  if (Array.isArray(value)) return value.slice(0, 100).map(v => redactDashboardValue(v, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, v]) => [key.slice(0, 100), SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactDashboardValue(v, depth + 1)]))
  }
  return value
}

export function dashboardJson(value: unknown): Record<string, unknown> {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { return {} }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const result = redactDashboardValue(parsed) as Record<string, unknown>
  return JSON.stringify(result).length > 32_768 ? {_truncated: true, message: '上下文过大，已截断'} : result
}
