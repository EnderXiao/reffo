export type RouteParamValue = string | number | boolean
export type RouteParams = Readonly<Record<string, RouteParamValue | undefined>>

export function readRouteString(params: Record<string, unknown>, key: string) {
  const value = params[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function readRouteBoolean(params: Record<string, unknown>, key: string) {
  const value = params[key]
  return value === true || value === '1' || value === 'true'
}

export function readRouteNumber(params: Record<string, unknown>, key: string) {
  const value = params[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function appendRouteParams(path: string, params?: RouteParams) {
  const entries = Object.entries(params ?? {}).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return path

  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  return `${path}${path.includes('?') ? '&' : '?'}${query}`
}
