export interface ErrorEvent {
  trace_id: string;
  fingerprint: string;
  path: string;
  method: string;
  status: number | null;
  error_code: string | null;
  error_message: string;
  error_stack: string | null;
  context: Record<string, unknown>;
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

export async function fetchAnalytics(params: { limit?: number; offset?: number } = {}): Promise<{ events: AnalyticsEvent[]; hasMore: boolean }> {
  const q = new URLSearchParams();
  if (params.limit) q.set('limit', String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));
  const suffix = q.toString() ? '?' + q.toString() : '';
  return getJson(BASE + '/analytics' + suffix);
}

export async function fetchAnalyticsEvents(): Promise<{ events: EventAggregation[] }> {
  return getJson(BASE + '/analytics/events');
}

export async function fetchQuery(params: { source?: 'errors' | 'analytics'; groupBy?: string; range?: number; limit?: number } = {}): Promise<{ rows: ChartDatum[] }> {
  const q = new URLSearchParams();
  if (params.source) q.set('source', params.source);
  if (params.groupBy) q.set('groupBy', params.groupBy);
  if (params.range) q.set('range', String(params.range));
  if (params.limit) q.set('limit', String(params.limit));
  const suffix = q.toString() ? '?' + q.toString() : '';
  return getJson(BASE + '/query' + suffix);
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
}

export interface DashboardPage {
  id: string;
  name: string;
  slug: string;
}

export async function fetchDaySeries(params: { source: 'errors' | 'analytics'; dimension?: 'event_name' | 'fingerprint'; range?: number; topN?: number }): Promise<{ rows: TrendSeriesPoint[] }> {
  const q = new URLSearchParams();
  q.set('groupBy', 'day_series');
  q.set('source', params.source);
  q.set('dimension', params.dimension ?? 'event_name');
  if (params.range) q.set('range', String(params.range));
  if (params.topN) q.set('topN', String(params.topN));
  return getJson(BASE + '/query?' + q.toString());
}

export async function fetchPages(): Promise<{ pages: DashboardPage[] }> {
  return getJson(BASE + '/pages');
}

export async function fetchPage(id: string): Promise<{ page: DashboardPage | undefined; charts: ChartConfig[] }> {
  return getJson(BASE + '/pages/' + id);
}

export interface ChartConfig {
  id: string;
  page_id: string;
  chart_type: string;
  title: string;
  data_query: Record<string, unknown>;
  position: number;
}

export async function fetchTrackingRequirements(status?: string): Promise<{ requirements: TrackingRequirement[] }> {
  const suffix = status ? '?status=' + status : '';
  return getJson(BASE + '/tracking/requirements' + suffix);
}

export async function createTrackingRequirement(input: { eventName: string; params?: string[]; page: string; description: string }): Promise<{ requirement: TrackingRequirement }> {
  const res = await fetch(BASE + '/tracking/requirements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('请求失败: ' + res.status);
  const body = await res.json();
  return body.data as { requirement: TrackingRequirement };
}

export async function updateTrackingRequirementStatus(id: string, status: 'pending' | 'implemented'): Promise<void> {
  const res = await fetch(BASE + '/tracking/requirements/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error('请求失败: ' + res.status);
}
