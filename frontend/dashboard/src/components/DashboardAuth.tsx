import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import DitherWave from '@/components/react-bits/dither-wave';
import { getAuthClient } from '@/services/auth';
import { clearSession, fetchDashboardSession, isAbortError, requestMessage, setAccessErrorHandler, setAccessToken, type DashboardSession } from '@/services/dashboard';

const card = 'w-full max-w-sm space-y-5 rounded-2xl border border-white/25 bg-[#1a1430]/75 p-6 backdrop-blur-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_8px_32px_rgba(0,0,0,0.5)]';
const action = 'h-10 rounded-xl border border-white/25 bg-white/15 px-4 text-[13px] text-white hover:bg-white/25';
const input = 'h-10 w-full rounded-xl border border-white/25 bg-black/30 px-3 text-[14px] text-white outline-none focus:border-white/50';
type AuthState = 'login' | 'checking' | 'ready' | 'forbidden' | 'error';

export default function DashboardAuth({ children }: { children: (session: DashboardSession, logout: () => void) => ReactNode }) {
  const [state, setState] = useState<AuthState>('login');
  const [session, setSession] = useState<DashboardSession | null>(null);
  const [message, setMessage] = useState('');
  const [configurationError, setConfigurationError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const auth = useRef<SupabaseClient>();
  const check = useRef<AbortController>();
  const verifiedUser = useRef<string>();
  const version = useRef(0);

  const verify = useCallback(() => {
    check.current?.abort();
    const controller = new AbortController();
    check.current = controller;
    setState('checking');
    setMessage('');
    void fetchDashboardSession(controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setSession(data);
      setState('ready');
    }).catch((error: unknown) => {
      if (controller.signal.aborted || isAbortError(error)) return;
      setSession(null);
      if (error instanceof Error && 'status' in error && error.status === 401) setState('login');
      else if (error instanceof Error && 'status' in error && error.status === 403) setState('forbidden');
      else setState('error');
      setMessage(requestMessage(error));
    });
  }, []);

  const logout = useCallback(() => {
    version.current += 1;
    check.current?.abort();
    verifiedUser.current = undefined;
    clearSession();
    setSession(null);
    setState('login');
    setPassword('');
    setMessage('');
    setSubmitting(false);
    // The SDK also owns only an in-memory session; clear its refresh token on logout.
    void auth.current?.auth.signOut({ scope: 'local' }).catch(() => {
      setMessage('登录已退出，认证服务暂时不可用');
    });
  }, []);

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe(): void } | undefined;
    setAccessErrorHandler((status) => {
      if (!active) return;
      setSession(null);
      if (status === 401) {
        logout();
        setMessage('登录已失效，请重新登录');
      } else {
        check.current?.abort();
        setState('forbidden');
        setMessage('当前账号无后台权限，请联系管理员授权后重试');
      }
    });
    try {
      const client = getAuthClient();
      auth.current = client;
      subscription = client.auth.onAuthStateChange((event, next) => {
        if (!active) return;
        if (!next) {
          clearSession();
          verifiedUser.current = undefined;
          setSession(null);
          setState('login');
          return;
        }
        // Keep this callback synchronous: Supabase holds its auth lock while notifying.
        if (event !== 'TOKEN_REFRESHED' || verifiedUser.current !== next.user.id) {
          clearSession();
          setSession(null);
          setState('checking');
          verifiedUser.current = next.user.id;
          setAccessToken(next.access_token);
          verify();
        } else {
          setAccessToken(next.access_token);
        }
      }).data.subscription;
    } catch (error) {
      setConfigurationError(error instanceof Error ? error.message : '认证配置不可用');
    }
    return () => {
      active = false;
      version.current += 1;
      subscription?.unsubscribe();
      check.current?.abort();
      clearSession();
      setAccessErrorHandler(undefined);
    };
  }, [logout, verify]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!auth.current || submitting || configurationError) return;
    const attempt = ++version.current;
    setSubmitting(true);
    setMessage('');
    try {
      const { error } = await auth.current.auth.signInWithPassword({ email: email.trim(), password });
      if (attempt !== version.current) return;
      setPassword('');
      if (error) setMessage('登录失败，请检查邮箱和密码或稍后重试');
    } catch {
      if (attempt === version.current) setMessage('无法连接认证服务，请稍后重试');
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
        {configurationError ? <p role="alert" className="text-[13px] leading-6 text-amber-200">{configurationError}</p> : state === 'login' ? (
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
