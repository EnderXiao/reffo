export interface ErrorEvent {
  trace_id: string;
  fingerprint: string;
  path: string;
  method: string;
  status: number | null;
  error_code: string | null;
  error_message: string;
  created_at: string;
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

const BASE = '/api/v1/dashboard';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`请求失败: ${res.status}`);
  const body = await res.json();
  return body.data as T;
}

export async function fetchErrors(params: { limit?: number; offset?: number; traceId?: string } = {}): Promise<{ errors: ErrorEvent[]; hasMore: boolean }> {
  const q = new URLSearchParams();
  if (params.limit) q.set('limit', String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));
  if (params.traceId) q.set('traceId', params.traceId);
  const suffix = q.toString() ? '?' + q.toString() : '';
  return getJson(BASE + '/errors' + suffix);
}

export async function fetchIssues(): Promise<{ issues: Issue[] }> {
  return getJson(BASE + '/issues');
}

export async function fetchTrend(days = 7): Promise<{ trend: TrendPoint[] }> {
  return getJson(BASE + '/trend?days=' + days);
}

export async function fetchErrorByTraceId(traceId: string): Promise<{ traceId: string; errors: ErrorEvent[]; relatedEvents: unknown[] }> {
  return getJson(BASE + '/error/' + encodeURIComponent(traceId));
}
