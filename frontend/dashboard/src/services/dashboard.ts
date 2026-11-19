import { secureOrigin } from './secure-url.ts';

export interface ErrorEvent {
  id: string;
  trace_id: string;
  fingerprint: string;
  path: string;
  method: string;
  status: number | null;
  error_code: string | null;
  error_message: string;
  created_at: string;
}

export interface ErrorDetail extends ErrorEvent {
  error_stack: string | null;
  context: Record<string, unknown>;
}

export interface Issue {
  fingerprint: string;
  count: number;
  latestMessage: string;
  latestPath: string;
  latestAt: string;
}

export interface TrendPoint {
  date: string;
  count: number;
}

export interface AnalyticsEvent {
  session_id: string;
  trace_id: string | null;
  event_name: string;
  properties: Record<string, unknown>;
  created_at: string;
}

export interface EventAggregation {
  event_name: string;
  count: number;
  latestAt: string;
}

export interface ChartDatum {
  key: string;
  value: number;
}

export interface TrendSeriesPoint {
  key: string;
  value: number;
  series: Array<{ key: string; value: number }>;
}


export interface DashboardSession {
  userId: string;
  role: 'owner' | 'viewer';
  permissions: { canRead: true; canViewDetails: true; canWrite: boolean };
  environment: 'local' | 'nonprod' | 'prod';
}

export interface TrackingRequirement {
  id: string;
  event_name: string;
  params: string[];
  page: string;
  description: string;
  status: 'pending' | 'implemented';
  created_at: string;
  updated_at: string;
  received_count?: number;
}

export interface TrackingRequirementQuery {
  status?: 'pending' | 'implemented';
  eventName?: string;
  page?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DashboardPage {
  id: string;
  name: string;
  slug: string;
}

export interface ChartConfig {
  id: string;
  page_id: string;
  chart_type: string;
  title: string;
  data_query: Record<string, unknown>;
  position: number;
}

export interface ErrorTrace {
  traceId: string;
  errors: ErrorDetail[];
  relatedEvents: AnalyticsEvent[];
}

export class DashboardRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'DashboardRequestError';
    this.status = status;
    this.code = code;
  }
}

export function requestMessage(error: unknown): string {
  return error instanceof DashboardRequestError ? error.message : '请求未能完成，请重试';
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDashboardSession(value: unknown): value is DashboardSession {
  if (!isRecord(value) || !isRecord(value.permissions)) return false;
  return typeof value.userId === 'string' && value.userId.length > 0 &&
    (value.role === 'owner' || value.role === 'viewer') &&
    value.permissions.canRead === true && value.permissions.canViewDetails === true &&
    typeof value.permissions.canWrite === 'boolean' &&
    (value.role !== 'viewer' || value.permissions.canWrite === false) &&
    (value.environment === 'local' || value.environment === 'nonprod' || value.environment === 'prod');
}

type RequestOptions = { method?: 'POST' | 'PATCH'; body?: unknown; signal?: AbortSignal; sessionCheck?: boolean; retried?: boolean };
type Query = Record<string, string | number | undefined>;
const BASE = '/api/v1/dashboard';
const AUTH_MESSAGES = { 401: '登录已失效，请重新登录', 403: '当前账号无后台权限' };

/** One in-memory credential owner for every dashboard request, including mutations. */
export function createDashboardClient(options: { apiOrigin?: string; fetcher?: typeof fetch } = {}) {
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let accessToken: string | null = null;
  let session: DashboardSession | null = null;
  let generation = 0;
  let onAccessError: ((status: 401 | 403) => void) | undefined;
  const pending = new Set<AbortController>();

  function abortPending() {
    for (const controller of pending) controller.abort();
    pending.clear();
  }

  function clearSession() {
    generation += 1;
    accessToken = null;
    session = null;
    abortPending();
  }

  function setAccessToken(token: string | null) {
    if (token === accessToken) return;
    if (!token) { clearSession(); return; }
    accessToken = token;
  }

  function deny(status: 401 | 403) {
    if (status === 401) clearSession();
    else {
      generation += 1;
      session = null;
      abortPending();
    }
    onAccessError?.(status);
  }

  async function request<T>(path: string, query: Query = {}, init: RequestOptions = {}): Promise<T> {
    const token = accessToken;
    if (!token) throw new DashboardRequestError('请先登录后台', 401, 'AUTH_REQUIRED');
    if (!init.sessionCheck && !session) throw new DashboardRequestError('请先验证后台权限', 403, 'SESSION_REQUIRED');
    if (init.method && (session?.role !== 'owner' || !session.permissions.canWrite)) {
      throw new DashboardRequestError('当前账号仅可查看后台数据', 403, 'READ_ONLY');
    }
    // Resolve lazily so a missing/invalid build setting is visible on the login screen.
    let origin: string;
    try { origin = secureOrigin(options.apiOrigin ?? window.location.origin, 'VITE_API_BASE_URL'); } catch {
      throw new DashboardRequestError('VITE_API_BASE_URL 必须为 HTTPS origin（本地允许 loopback HTTP），不要包含 /api/v1 或查询参数', 0, 'INVALID_ORIGIN');
    }
    const url = new URL(origin + BASE + path);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init.signal?.aborted) controller.abort();
    init.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort(); }, 20_000);
    const startedGeneration = generation;
    pending.add(controller);
    try {
      controller.signal.throwIfAborted();
      const res = await fetcher(url.toString(), {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token,
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (startedGeneration !== generation) throw new DOMException('请求已取消', 'AbortError');
      // Retry a read once if auto-refresh replaced its token; never replay a write.
      if (res.status === 401 || res.status === 403) {
        if (token !== accessToken) {
          if (!init.method && !init.retried) return request<T>(path, query, { ...init, retried: true });
          throw new DashboardRequestError('登录凭据已更新，请重试请求', 0, 'TOKEN_CHANGED');
        }
        deny(res.status);
        throw new DashboardRequestError(AUTH_MESSAGES[res.status], res.status, 'ACCESS_DENIED');
      }
      let body: unknown;
      try { body = await res.json(); } catch {
        controller.signal.throwIfAborted();
        throw new DashboardRequestError(res.ok ? '后台返回的数据格式异常，请重试' : '后台请求失败（HTTP ' + res.status + '），请重试', res.status, 'INVALID_JSON');
      }
      controller.signal.throwIfAborted();
      if (startedGeneration !== generation) throw new DOMException('请求已取消', 'AbortError');
      if (!res.ok) throw new DashboardRequestError('后台请求失败（HTTP ' + res.status + '），请重试', res.status, 'HTTP_ERROR');
      if (isRecord(body) && body.success === false) throw new DashboardRequestError('后台未能完成请求，请重试', res.status, 'API_ERROR');
      if (!isRecord(body) || body.success !== true || !('data' in body) || body.data == null) {
        throw new DashboardRequestError('后台返回的数据格式异常，请重试', res.status, 'INVALID_RESPONSE');
      }
      return body.data as T;
    } catch (error) {
      if (timedOut) throw new DashboardRequestError('请求超时，请重试', 0, 'TIMEOUT');
      if (isAbortError(error) || error instanceof DashboardRequestError) throw error;
      throw new DashboardRequestError('无法连接后台，请检查网络后重试', 0, 'NETWORK_ERROR');
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', abort);
      pending.delete(controller);
    }
  }

  return {
    setAccessToken,
    clearSession,
    setAccessErrorHandler(handler: ((status: 401 | 403) => void) | undefined) { onAccessError = handler; },
    async fetchDashboardSession(signal?: AbortSignal): Promise<DashboardSession> {
      // Permission rechecks revoke the old result until the new response is verified.
      session = null;
      generation += 1;
      abortPending();
      const verificationGeneration = generation;
      const data = await request<unknown>('/session', {}, { signal, sessionCheck: true });
      signal?.throwIfAborted();
      if (verificationGeneration !== generation || !accessToken) throw new DOMException('请求已取消', 'AbortError');
      if (!isDashboardSession(data)) throw new DashboardRequestError('后台权限响应格式异常，请重试', 200, 'INVALID_SESSION');
      session = data;
      return data;
    },
    fetchErrors(params: { limit?: number; offset?: number; traceId?: string } = {}, signal?: AbortSignal) {
      return request<{ errors: ErrorEvent[]; hasMore: boolean }>('/errors', params, { signal });
    },
    fetchIssues(signal?: AbortSignal) { return request<{ issues: Issue[] }>('/issues', {}, { signal }); },
    fetchTrend(days = 7, signal?: AbortSignal) { return request<{ trend: TrendPoint[] }>('/trend', { days }, { signal }); },
    fetchErrorByTraceId(traceId: string, signal?: AbortSignal, id?: string) { return request<ErrorTrace>('/error/' + encodeURIComponent(traceId), {id}, { signal }); },
    fetchAnalytics(params: { limit?: number; offset?: number } = {}, signal?: AbortSignal) { return request<{ events: AnalyticsEvent[]; hasMore: boolean }>('/analytics', params, { signal }); },
    fetchAnalyticsEvents(signal?: AbortSignal) { return request<{ events: EventAggregation[] }>('/analytics/events', {}, { signal }); },
    fetchQuery(params: { source?: 'errors' | 'analytics'; groupBy?: string; range?: number; limit?: number } = {}, signal?: AbortSignal) { return request<{ rows: ChartDatum[] }>('/query', params, { signal }); },
    fetchDaySeries(params: { source: 'errors' | 'analytics'; dimension?: 'event_name' | 'fingerprint'; range?: number; topN?: number }, signal?: AbortSignal) {
      return request<{ rows: TrendSeriesPoint[] }>('/query', { ...params, groupBy: 'day_series', dimension: params.dimension ?? 'event_name' }, { signal });
    },
    fetchPages(signal?: AbortSignal) { return request<{ pages: DashboardPage[] }>('/pages', {}, { signal }); },
    fetchPage(id: string, signal?: AbortSignal) { return request<{ page: DashboardPage | undefined; charts: ChartConfig[] }>('/pages/' + encodeURIComponent(id), {}, { signal }); },
    fetchTrackingPages(signal?: AbortSignal) { return request<{ pages: string[] }>('/tracking/pages', {}, { signal }); },
    fetchTrackingRequirements(params: TrackingRequirementQuery = {}, signal?: AbortSignal) {
      return request<{ requirements: TrackingRequirement[]; hasMore: boolean }>('/tracking/requirements', { ...params, limit: params.limit ?? 20, offset: params.offset ?? 0 }, { signal });
    },
    createTrackingRequirement(input: { eventName: string; params?: string[]; page: string; description: string }, signal?: AbortSignal) {
      return request<{ requirement: TrackingRequirement }>('/tracking/requirements', {}, { method: 'POST', body: input, signal });
    },
    updateTrackingRequirementStatus(id: string, status: 'pending' | 'implemented', signal?: AbortSignal) {
      return request<unknown>('/tracking/requirements/' + encodeURIComponent(id), {}, { method: 'PATCH', body: { status }, signal });
    },
  };
}

const client = createDashboardClient({ apiOrigin: import.meta.env?.VITE_API_BASE_URL?.trim() || undefined });
export const {
  setAccessToken, clearSession, setAccessErrorHandler, fetchDashboardSession, fetchErrors,
  fetchIssues, fetchTrend, fetchErrorByTraceId, fetchAnalytics, fetchAnalyticsEvents,
  fetchQuery, fetchDaySeries, fetchPages, fetchPage, fetchTrackingPages, fetchTrackingRequirements,
  createTrackingRequirement, updateTrackingRequirementStatus,
} = client;
