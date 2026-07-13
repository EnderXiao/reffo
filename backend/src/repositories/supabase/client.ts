import { env } from '@/config/env'

interface SupabaseClientOptions {
  accessToken?: string
  useServiceRole?: boolean
}

interface SupabaseRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  searchParams?: Record<string, string | number | boolean | undefined>
  body?: unknown
  prefer?: string
}

export class SupabaseRestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'SupabaseRestError'
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function getSupabaseBaseUrl() {
  return trimTrailingSlash(env.SUPABASE_URL)
}

function getApiKey(options: SupabaseClientOptions) {
  if (options.useServiceRole) {
    return env.SUPABASE_SECRET_KEY
  }

  return env.SUPABASE_PUBLISHABLE_KEY
}

function buildUrl(path: string, searchParams?: SupabaseRequestOptions['searchParams']) {
  const url = new URL(`${getSupabaseBaseUrl()}${path}`)

  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    if (value === undefined) {
      return
    }

    url.searchParams.set(key, String(value))
  })

  return url
}

async function parseResponse(response: Response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export class SupabaseRestClient {
  constructor(private readonly options: SupabaseClientOptions) {}

  async request<T>(path: string, options: SupabaseRequestOptions = {}): Promise<T> {
    const apiKey = getApiKey(this.options)
    const accessToken = this.options.accessToken || apiKey
    const response = await fetch(buildUrl(path, options.searchParams), {
      method: options.method ?? 'GET',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${accessToken}`,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.prefer ? { Prefer: options.prefer } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })

    const payload = await parseResponse(response)

    if (!response.ok) {
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? String((payload as { message?: unknown }).message || 'Supabase request failed')
          : `Supabase request failed with status ${response.status}`

      throw new SupabaseRestError(message, response.status, payload)
    }

    return payload as T
  }
}

export function createSupabaseRestClient(options: SupabaseClientOptions) {
  return new SupabaseRestClient(options)
}

export async function getSupabaseAuthUser(accessToken: string) {
  const response = await fetch(`${getSupabaseBaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const payload = await parseResponse(response)

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'msg' in payload
        ? String((payload as { msg?: unknown }).msg || 'Invalid Supabase token')
        : 'Invalid Supabase token'

    throw new SupabaseRestError(message, response.status, payload)
  }

  if (typeof payload !== 'object' || payload === null || !('id' in payload)) {
    throw new SupabaseRestError('Supabase auth response missing user id', 401, payload)
  }

  return payload as { id: string; email?: string }
}
