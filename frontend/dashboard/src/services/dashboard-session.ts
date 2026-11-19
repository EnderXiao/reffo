import type { AuthChangeEvent } from '@supabase/supabase-js';
import { DashboardRequestError, requestMessage, type DashboardSession } from './dashboard.ts';

export type DashboardAuthState = 'login' | 'checking' | 'ready' | 'forbidden' | 'error';
type AuthSession = { user: { id: string }; access_token: string };
type Verification = { userId: string; controller: AbortController };

export interface DashboardAuthSnapshot {
  state: DashboardAuthState;
  session: DashboardSession | null;
  message: string;
}

interface SessionDependencies {
  clearSession(): void;
  setAccessToken(token: string | null): void;
  fetchDashboardSession(signal?: AbortSignal): Promise<DashboardSession>;
  onChange(snapshot: DashboardAuthSnapshot): void;
}

/** Owns only the mounted auth boundary's in-memory verification, never a persisted credential. */
export function createDashboardSessionController(api: SessionDependencies) {
  let credential: AuthSession | null = null;
  let verified: DashboardSession | null = null;
  let pending: Verification | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function publish(state: DashboardAuthState, message = '') {
    api.onChange({ state, session: verified, message });
  }

  function invalidate() {
    pending?.controller.abort();
    pending = undefined;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    verified = null;
    api.clearSession();
  }

  function signOut(message = '') {
    if (disposed) return;
    credential = null;
    invalidate();
    publish('login', message);
  }

  function accessDenied(status: 401 | 403, message?: string) {
    if (disposed) return;
    if (status === 401) {
      signOut(message ?? '登录已失效，请重新登录');
      return;
    }
    invalidate();
    if (credential) api.setAccessToken(credential.access_token);
    publish('forbidden', message ?? '当前账号无后台权限，请联系管理员授权后重试');
  }

  function isCurrent(attempt: Verification) {
    return !disposed && pending === attempt && !attempt.controller.signal.aborted && credential?.user.id === attempt.userId;
  }

  async function verify(attempt: Verification) {
    try {
      const data = await api.fetchDashboardSession(attempt.controller.signal);
      if (!isCurrent(attempt)) return;
      if (data.userId !== attempt.userId) {
        throw new DashboardRequestError('后台权限响应身份不匹配，请重试', 200, 'INVALID_SESSION');
      }
      pending = undefined;
      verified = data;
      publish('ready');
    } catch (error: unknown) {
      if (!isCurrent(attempt)) return;
      if (error instanceof DashboardRequestError && (error.status === 401 || error.status === 403)) {
        accessDenied(error.status, requestMessage(error));
      } else {
        invalidate();
        if (credential) api.setAccessToken(credential.access_token);
        publish('error', requestMessage(error));
      }
    }
  }

  function startVerification() {
    if (disposed || !credential || pending?.userId === credential.user.id) return;
    invalidate();
    api.setAccessToken(credential.access_token);
    const attempt = { userId: credential.user.id, controller: new AbortController() };
    pending = attempt;
    publish('checking');
    // Supabase notifies under its auth lock. Start external work after that callback returns.
    timer = setTimeout(() => {
      timer = undefined;
      if (isCurrent(attempt)) void verify(attempt);
    }, 0);
  }

  return {
    handleAuthStateChange(event: AuthChangeEvent, next: AuthSession | null) {
      if (disposed) return;
      if (event === 'SIGNED_OUT' || !next) { signOut(); return; }
      const sameIdentity = credential?.user.id === next.user.id;
      credential = { user: { id: next.user.id }, access_token: next.access_token };
      // Focus can re-emit SIGNED_IN; retain the exact verified role object and mounted children.
      const reusable = (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && verified?.userId === next.user.id;
      if (sameIdentity && (reusable || pending)) {
        api.setAccessToken(next.access_token);
        return;
      }
      startVerification();
    },
    retry: startVerification,
    signOut,
    accessDenied,
    dispose() {
      disposed = true;
      credential = null;
      invalidate();
    },
  };
}
