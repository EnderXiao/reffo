import {apiClient} from './api';
import {getJSON, setJSON, storage} from '@/utils/storage';

const AUTH_SESSION_STORAGE_KEY = 'reffo.auth.session';

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

function getSupabaseUrl() {
  return process.env.SUPABASE_URL?.replace(/\/+$/, '') || '';
}

function getSupabasePublishableKey() {
  return process.env.SUPABASE_PUBLISHABLE_KEY || '';
}

function assertSupabaseAuthConfigured() {
  if (!getSupabaseUrl() || !getSupabasePublishableKey()) {
    throw new Error('Supabase Auth 未配置');
  }
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
  assertSupabaseAuthConfigured();

  const response = await fetch(`${getSupabaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      apikey: getSupabasePublishableKey(),
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
    const session = await getJSON<AuthSession>(AUTH_SESSION_STORAGE_KEY);

    if (!session?.accessToken) {
      apiClient.setAuthToken(null);
      return null;
    }

    apiClient.setAuthToken(session.accessToken);
    return session;
  }

  async persistSession(session: AuthSession): Promise<void> {
    await setJSON(AUTH_SESSION_STORAGE_KEY, session);
    apiClient.setAuthToken(session.accessToken);
  }

  async signOut(): Promise<void> {
    await storage.removeItem(AUTH_SESSION_STORAGE_KEY);
    apiClient.setAuthToken(null);
  }
}

export const authApi = new AuthApi();
