const SENSITIVE_KEYS = new Set([
  'email',
  'password',
  'confirmpassword',
  'confirm_password',
  'token',
  'access_token',
  'refresh_token',
])

export function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveData)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      SENSITIVE_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redactSensitiveData(child),
    ]),
  )
}
