import { encryptPasswordPayload, type PasswordEncryptionConfig } from './password-encryption.ts';
import { secureOrigin } from './secure-url.ts';

export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthSession {
  user: AuthUser;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export class AuthRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'AuthRequestError';
    this.status = status;
    this.code = code;
  }
}

export interface AuthClientOptions {
  apiOrigin?: string;
  fetcher?: typeof fetch;
  now?: () => number;
}

interface AuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id?: string; email?: string };
}

const AUTH_BASE = '/api/v1/auth';
const DEFAULT_SESSION_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 浏览器只与自有 API 通信：密码经应用层加密后交给服务端代理 Supabase，
 * 页面不再需要 Supabase URL/Key，也不直连 supabase.co。
 */
export function createAuthClient(options: AuthClientOptions = {}) {
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? (() => Date.now());
  let encryptionConfig: PasswordEncryptionConfig | undefined;

  function resolveOrigin() {
    try {
      return secureOrigin(options.apiOrigin ?? window.location.origin, 'VITE_API_BASE_URL');
    } catch {
      throw new AuthRequestError(
        'VITE_API_BASE_URL 必须为 HTTPS origin（本地允许 loopback HTTP），不要包含 /api/v1 或查询参数',
        0,
        'INVALID_ORIGIN',
      );
    }
  }

  async function request<T>(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const url = resolveOrigin() + AUTH_BASE + path;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init.signal?.aborted) controller.abort();
    init.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      controller.signal.throwIfAborted();
      const response = await fetcher(url, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        controller.signal.throwIfAborted();
        throw new AuthRequestError('认证服务响应格式异常，请重试', response.status, 'INVALID_JSON');
      }
      controller.signal.throwIfAborted();
      // 后端统一信封：成功 {success:true,data}，失败 {success:false,error:{code,message}}。
      if (isRecord(payload) && payload.success === false) {
        const error = isRecord(payload.error) ? payload.error : {};
        const code = typeof error.code === 'string' && error.code ? error.code : 'AUTH_REQUEST_FAILED';
        const message = typeof error.message === 'string' && error.message ? error.message : '登录服务暂时不可用，请稍后重试';
        throw new AuthRequestError(message, response.status, code);
      }
      if (!response.ok) {
        throw new AuthRequestError('登录服务暂时不可用，请稍后重试', response.status, 'AUTH_REQUEST_FAILED');
      }
      if (!isRecord(payload) || payload.success !== true || !('data' in payload) || payload.data == null) {
        throw new AuthRequestError('认证服务响应格式异常，请重试', response.status, 'INVALID_RESPONSE');
      }
      return payload.data as T;
    } catch (error) {
      if (timedOut) throw new AuthRequestError('认证服务响应超时，请重试', 0, 'TIMEOUT');
      if (error instanceof AuthRequestError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new AuthRequestError('无法连接认证服务，请检查网络后重试', 0, 'NETWORK_ERROR');
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', abort);
    }
  }

  async function getEncryptionConfig(refresh = false) {
    if (!refresh && encryptionConfig) return encryptionConfig;
    const config = await request<PasswordEncryptionConfig>('/crypto-key');
    const valid = isRecord(config) &&
      typeof config.version === 'number' &&
      typeof config.key_id === 'string' &&
      config.key_id.length > 0 &&
      typeof config.public_key === 'string' &&
      config.public_key.includes('BEGIN PUBLIC KEY');
    if (!valid) throw new AuthRequestError('认证服务返回的加密公钥无效，请重试', 200, 'INVALID_CRYPTO_KEY');
    encryptionConfig = config;
    return config;
  }

  function toSession(data: AuthTokenResponse): AuthSession {
    if (!data.access_token || !data.refresh_token || !data.user?.id) {
      throw new AuthRequestError('认证响应缺少访问令牌，请重试', 200, 'AUTH_TOKEN_MISSING');
    }
    const seconds = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : DEFAULT_SESSION_SECONDS;
    const expiresAt = typeof data.expires_at === 'number' && data.expires_at > 0 ? data.expires_at : Math.floor(now() / 1000) + seconds;

    return {
      user: { id: data.user.id, email: data.user.email },
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
    };
  }

  async function signIn(email: string, password: string, signal?: AbortSignal): Promise<AuthSession> {
    for (let attempt = 0; ; attempt += 1) {
      // 服务端换钥或载荷被拒时，重新拉取公钥后只重试一次。
      const config = await getEncryptionConfig(attempt > 0);
      let payload: Awaited<ReturnType<typeof encryptPasswordPayload>>;
      try {
        payload = await encryptPasswordPayload(config, { email: email.trim(), password });
      } catch (error) {
        throw new AuthRequestError(
          error instanceof Error ? error.message : '密码加密失败，请升级浏览器后重试',
          0,
          'ENCRYPTION_UNAVAILABLE',
        );
      }
      try {
        const data = await request<AuthTokenResponse>('/sign-in', { method: 'POST', body: payload, signal });
        return toSession(data);
      } catch (error) {
        if (attempt === 0 && error instanceof AuthRequestError && error.code === 'AUTH_ENCRYPTION_INVALID') continue;
        throw error;
      }
    }
  }

  async function refresh(refreshToken: string, signal?: AbortSignal): Promise<AuthSession> {
    const data = await request<AuthTokenResponse>('/refresh', {
      method: 'POST',
      body: { refresh_token: refreshToken },
      signal,
    });

    return toSession(data);
  }

  return { signIn, refresh };
}

export const authClient = createAuthClient({
  apiOrigin: import.meta.env?.VITE_API_BASE_URL?.trim() || undefined,
});
