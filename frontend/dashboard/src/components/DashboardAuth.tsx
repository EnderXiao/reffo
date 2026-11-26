import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import DitherWave from '@/components/react-bits/dither-wave';
import { AuthRequestError, authClient, type AuthSession } from '@/services/auth';
import { clearSession, fetchDashboardSession, setAccessErrorHandler, setAccessToken, type DashboardSession } from '@/services/dashboard';
import { createDashboardSessionController, type DashboardAuthState } from '@/services/dashboard-session';

const card = 'w-full max-w-sm space-y-5 rounded-2xl border border-white/25 bg-[#1a1430]/75 p-6 backdrop-blur-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_8px_32px_rgba(0,0,0,0.5)]';
const action = 'h-10 rounded-xl border border-white/25 bg-white/15 px-4 text-[13px] text-white hover:bg-white/25';
const input = 'h-10 w-full rounded-xl border border-white/25 bg-black/30 px-3 text-[14px] text-white outline-none focus:border-white/50';

const REFRESH_LEAD_MS = 60_000;
const REFRESH_RETRY_MS = 30_000;
const REFRESH_RETRIES = 3;

export default function DashboardAuth({ children }: { children: (session: DashboardSession, logout: () => void) => ReactNode }) {
  const [state, setState] = useState<DashboardAuthState>('login');
  const [session, setSession] = useState<DashboardSession | null>(null);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const credential = useRef<AuthSession>();
  const checks = useRef<ReturnType<typeof createDashboardSessionController>>();
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();
  const refreshRef = useRef<(next: AuthSession, attempt?: number) => Promise<void>>(async () => {});
  const refreshing = useRef(false);
  const version = useRef(0);

  const verify = useCallback(() => checks.current?.retry(), []);

  const stopRefresh = useCallback(() => {
    if (refreshTimer.current !== undefined) clearTimeout(refreshTimer.current);
    refreshTimer.current = undefined;
  }, []);

  const logout = useCallback(() => {
    version.current += 1;
    credential.current = undefined;
    refreshing.current = false;
    stopRefresh();
    checks.current?.signOut();
    setPassword('');
    setMessage('');
    setSubmitting(false);
  }, [stopRefresh]);

  const scheduleRefresh = useCallback((next: AuthSession, attempt = 0) => {
    stopRefresh();
    const delay = Math.max(0, next.expires_at * 1000 - Date.now() - REFRESH_LEAD_MS);
    refreshTimer.current = setTimeout(() => { void refreshRef.current(next, attempt); }, delay);
  }, [stopRefresh]);

  const retryRefresh = useCallback((next: AuthSession, attempt: number) => {
    stopRefresh();
    refreshTimer.current = setTimeout(() => { void refreshRef.current(next, attempt); }, REFRESH_RETRY_MS);
  }, [stopRefresh]);

  // 刷新只轮转 token，由会话控制器复用已核验的权限对象，不重建看板子树。
  const refreshSession = useCallback(async (current: AuthSession, attempt = 0) => {
    if (refreshing.current || credential.current?.refresh_token !== current.refresh_token) return;
    refreshing.current = true;
    try {
      const next = await authClient.refresh(current.refresh_token);
      refreshing.current = false;
      if (credential.current?.refresh_token !== current.refresh_token) return;
      credential.current = next;
      checks.current?.handleAuthStateChange('TOKEN_REFRESHED', next);
      scheduleRefresh(next);
    } catch (error) {
      refreshing.current = false;
      if (credential.current?.refresh_token !== current.refresh_token) return;
      const invalid = error instanceof AuthRequestError &&
        (error.status === 401 || error.status === 403 || error.code === 'AUTH_SESSION_INVALID');
      if (!invalid && attempt < REFRESH_RETRIES) {
        retryRefresh(current, attempt + 1);
        return;
      }
      logout();
      setMessage(invalid ? '登录已失效，请重新登录' : '登录态刷新失败，请重新登录');
    }
  }, [logout, retryRefresh, scheduleRefresh]);

  useEffect(() => {
    refreshRef.current = refreshSession;
  }, [refreshSession]);

  // 后台标签页的定时器会被浏览器节流，回到前台时补一次到期检查，避免会话整点掉线。
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      const current = credential.current;
      if (!current) return;
      if (current.expires_at * 1000 - Date.now() <= REFRESH_LEAD_MS) void refreshRef.current(current, 0);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = createDashboardSessionController({
      clearSession,
      setAccessToken,
      fetchDashboardSession,
      onChange(snapshot) {
        if (!active) return;
        setState(snapshot.state);
        setSession(snapshot.session);
        setMessage(snapshot.message);
      },
    });
    checks.current = controller;
    setAccessErrorHandler((status) => {
      if (!active) return;
      if (status === 401) {
        logout();
        setMessage('登录已失效，请重新登录');
      } else controller.accessDenied(status);
    });
    return () => {
      active = false;
      version.current += 1;
      refreshing.current = false;
      stopRefresh();
      controller.dispose();
      checks.current = undefined;
      credential.current = undefined;
      setAccessErrorHandler(undefined);
    };
  }, [logout, stopRefresh]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const attempt = ++version.current;
    setSubmitting(true);
    setMessage('');
    try {
      const next = await authClient.signIn(email, password);
      if (attempt !== version.current) return;
      credential.current = next;
      setPassword('');
      checks.current?.handleAuthStateChange('SIGNED_IN', next);
      scheduleRefresh(next);
    } catch (error) {
      if (attempt !== version.current) return;
      setMessage(error instanceof AuthRequestError ? error.message : '无法连接认证服务，请稍后重试');
    } finally {
      if (attempt === version.current) setSubmitting(false);
    }
  }

  if (state === 'ready' && session) return <>{children(session, logout)}</>;

  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden p-6 text-white">
      <DitherWave className="absolute inset-0" speed={0.3} primaryColor="#6d28d9" secondaryColor="#3b0764" tertiaryColor="#a78bfa" opacity={0.7} />
      <main className={'relative z-10 ' + card}>
        <div>
          <h1 className="text-[18px] font-[550] tracking-tight">Reffo 看板</h1>
          <p className="mt-2 text-[13px] leading-5 text-white/70">使用已获授权的后台账号登录</p>
        </div>
        {state === 'login' ? (
          <form className="space-y-4" onSubmit={login}>
            <label className="block space-y-2 text-[13px]">邮箱<input className={input} type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} /></label>
            <label className="block space-y-2 text-[13px]">密码<input className={input} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} /></label>
            <Button type="submit" variant="ghost" className={action + ' w-full'} disabled={submitting}>{submitting ? '登录中…' : '登录'}</Button>
          </form>
        ) : state === 'checking' ? (
          <p role="status" className="text-[13px] text-white/80">正在验证后台权限…</p>
        ) : (
          <>
            <h2 className="text-[15px] font-[500]">{state === 'forbidden' ? '无后台权限' : '暂时无法验证后台权限'}</h2>
            <div className="flex gap-3">
              <Button type="button" variant="ghost" className={action} onClick={verify}>重试</Button>
              <Button type="button" variant="ghost" className={action} onClick={logout}>退出登录</Button>
            </div>
          </>
        )}
        {message && <p role="alert" className="text-[13px] leading-5 text-amber-200">{message}</p>}
        {state === 'checking' && <Button type="button" variant="ghost" className={action} onClick={logout}>取消并退出</Button>}
      </main>
    </div>
  );
}
