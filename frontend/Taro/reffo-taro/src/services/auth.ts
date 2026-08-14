import {apiClient} from './api';
import {getSupabasePublicConfig} from './runtime-config';
import {getJSON, setJSON, storage} from '@/utils/storage';

function getAuthSessionStorageKey() {
  const env = process.env.REFFO_ENV?.trim() || process.env.API_BASE_URL?.trim() || 'local';

  return `reffo.auth.session.${env}`;
}

interface SupabaseAuthUser {
  id: string;
  email?: string;
}

interface SupabasePasswordResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  token_type: string;
  user: SupabaseAuthUser;
}

interface SupabaseErrorResponse {
  msg?: string;
  message?: string;
  error_description?: string;
  error?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  user: SupabaseAuthUser;
}

export interface SignInWithPasswordInput {
  email: string;
  password: string;
}

function mapAuthResponse(response: SupabasePasswordResponse): AuthSession {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: response.expires_at,
    user: response.user,
  };
}

function getSupabaseErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return '登录失败';
  }

  const error = payload as SupabaseErrorResponse;
  return error.error_description || error.message || error.msg || error.error || '登录失败';
}

async function requestSupabaseAuth<T>(path: string, body?: unknown): Promise<T> {
  const config = await getSupabasePublicConfig();

  const response = await fetch(`${config.url}${path}`, {
    method: 'POST',
    headers: {
      apikey: config.publishableKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as unknown : null;

  if (!response.ok) {
    throw new Error(getSupabaseErrorMessage(payload));
  }

  return payload as T;
}

export class AuthApi {
  async signInWithPassword(input: SignInWithPasswordInput): Promise<AuthSession> {
    const response = await requestSupabaseAuth<SupabasePasswordResponse>(
      '/auth/v1/token?grant_type=password',
      {
        email: input.email,
        password: input.password,
      },
    );
    const session = mapAuthResponse(response);

    await this.persistSession(session);
    return session;
  }

  async restoreSession(): Promise<AuthSession | null> {
    const session = await getJSON<AuthSession>(getAuthSessionStorageKey());

    if (!session?.accessToken) {
      apiClient.setAuthToken(null);
      return null;
    }

    apiClient.setAuthToken(session.accessToken);
    return session;
  }

  async persistSession(session: AuthSession): Promise<void> {
    await setJSON(getAuthSessionStorageKey(), session);
    apiClient.setAuthToken(session.accessToken);
  }

  async signOut(): Promise<void> {
    await storage.removeItem(getAuthSessionStorageKey());
    apiClient.setAuthToken(null);
  }
}

export const authApi = new AuthApi();
