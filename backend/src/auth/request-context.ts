import { env } from '@/config/env'
import { getSupabaseAuthUser } from '@/repositories/supabase/client'

export interface RequestUserContext {
  userId: string
  accessToken?: string
  useServiceRole: boolean
}

export class RequestAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 401
  ) {
    super(message)
    this.name = 'RequestAuthError'
  }
}

function readAuthorizationHeader(headers: Record<string, string | undefined>) {
  return headers.authorization || headers.Authorization
}

function readBearerToken(headers: Record<string, string | undefined>) {
  const authorization = readAuthorizationHeader(headers)?.trim()

  if (!authorization) {
    return null
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    throw new RequestAuthError('INVALID_AUTHORIZATION_HEADER', 'Authorization 必须使用 Bearer token')
  }

  return match[1].trim()
}

export async function resolveRequestUser(headers: Record<string, string | undefined>): Promise<RequestUserContext> {
  const accessToken = readBearerToken(headers)

  if (!accessToken) {
    if (env.AUTH_REQUIRED) {
      throw new RequestAuthError('AUTH_REQUIRED', '请先登录后再继续')
    }

    return {
      userId: env.DEV_USER_ID,
      useServiceRole: true,
    }
  }

  try {
    const user = await getSupabaseAuthUser(accessToken)

    return {
      userId: user.id,
      accessToken,
      useServiceRole: false,
    }
  } catch (error) {
    if (error instanceof RequestAuthError) {
      throw error
    }

    throw new RequestAuthError(
      'INVALID_ACCESS_TOKEN',
      error instanceof Error ? error.message : '登录状态无效，请重新登录'
    )
  }
}
