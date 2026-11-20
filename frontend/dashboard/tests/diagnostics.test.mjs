import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardClient, DashboardRequestError } from '../src/services/dashboard.ts';
import { rootCauseClassLabel, confidenceLabel, durationMsLabel, tokenLabel } from '../src/components/diagnostics-format.ts';

const origin = 'https://api.example.test';
const token = 'fake-access-token-for-test';
const owner = { userId: 'user-owner', role: 'owner', permissions: { canRead: true, canViewDetails: true, canWrite: true }, environment: 'local' };
const viewer = { userId: 'user-viewer', role: 'viewer', permissions: { canRead: true, canViewDetails: true, canWrite: false }, environment: 'prod' };
const json = (data, status = 200) => Response.json({ success: true, data }, { status });
const isDenied = (status, code) => (error) => error instanceof DashboardRequestError && error.status === status && (!code || error.code === code);

function fixture(session = owner) {
  const calls = [];
  let respond = () => json({ runs: [], hasMore: false });
  const client = createDashboardClient({ apiOrigin: origin, fetcher: async (url, options) => {
    calls.push({ url, options });
    return new URL(url).pathname.endsWith('/session') ? json(session) : respond(url, options);
  } });
  return { client, calls, respond: (next) => { respond = next; } };
}

async function authorize(client) {
  client.setAccessToken(token);
  return client.fetchDashboardSession();
}

const summary = {
  days: 7,
  windowStart: '2026-11-13T00:00:00.000Z',
  failedRuns: 12,
  failedJobs: 3,
  providerAttempts: 500,
  providerFailures: 25,
  failureRatePercent: 5,
  topErrorCodes: [{ code: 'V5_PROVIDER_TEMPORARY_FAILURE', count: 18 }],
  topFailureClasses: [{ class: 'provider_http', count: 18 }],
  topModels: [{ model: 'deepseek-v4-pro', count: 9 }],
};

const runItem = {
  runId: 'run-1',
  failedAt: '2026-11-20T03:10:00.000Z',
  reason: 'provider unavailable',
  status: 'failed',
  eventCount: 42,
  failedCalls: 3,
  attempts: 5,
  maxLatencyMs: 21300,
  lastCallAt: '2026-11-20T03:09:58.000Z',
  models: ['deepseek-v4-pro'],
  errorCodes: ['V5_PROVIDER_TEMPORARY_FAILURE'],
  failureClasses: ['provider_http'],
  jobId: 'job-9',
  jobStage: 'resume_generation',
  jobErrorCode: 'AGENT_FAILED',
  jobError: 'agent exhausted retries',
  retryable: true,
};

const detail = {
  runId: 'run-1',
  failureSample: { reason: 'provider unavailable', status: 'failed', eventCount: 42, createdAt: '2026-11-20T03:10:00.000Z' },
  job: {
    id: 'job-9',
    status: 'failed',
    stage: 'resume_generation',
    error: 'agent exhausted retries',
    failure: { code: 'AGENT_FAILED', stage: 'resume_generation', retryable: true, action: '手动重跑任务', occurredAt: '2026-11-20T03:10:01.000Z', issueCodes: ['P01', 'P02'] },
    createdAt: '2026-11-20T03:05:00.000Z',
    updatedAt: '2026-11-20T03:10:01.000Z',
  },
  events: [
    { id: 'ev-1', type: 'step.started', stepRunId: 'step-1', attemptId: 'attempt-1', occurredAt: '2026-11-20T03:09:00.000Z', payload: { stepName: '简历生成', retry: 0 } },
    { id: 'ev-2', type: 'call.failed', stepRunId: 'step-1', attemptId: 'attempt-1', occurredAt: '2026-11-20T03:09:58.000Z', payload: { stepName: '简历生成', errorCode: 'V5_PROVIDER_TEMPORARY_FAILURE', retry: 4 } },
  ],
  providerCalls: [
    { id: 'call-1', callId: 'req-1', eventKind: 'provider.call.success', provider: 'deepseek', model: 'deepseek-v4-pro', stage: 'analyze', retryIndex: 0, callReason: '解析 JD', occurredAt: '2026-11-20T03:09:01.000Z', latencyMs: 1200, inputTokens: 1234, outputTokens: 567, reasoningTokens: null, providerRequestId: 'req-1', errorCode: null, failureClass: null, providerStatus: 200 },
    { id: 'call-2', callId: 'req-2', eventKind: 'provider.call.failed', provider: 'deepseek', model: 'deepseek-v4-pro', stage: 'generate', retryIndex: 4, callReason: '生成简历', occurredAt: '2026-11-20T03:09:58.000Z', latencyMs: 43599, inputTokens: null, outputTokens: null, reasoningTokens: null, providerRequestId: 'req-2', errorCode: 'V5_PROVIDER_TEMPORARY_FAILURE', failureClass: 'provider_http', providerStatus: 503 },
  ],
};

const analysisResult = {
  runId: 'run-1',
  model: 'deepseek-v4-pro',
  analyzedAt: '2026-11-20T03:11:00.000Z',
  events: [{ id: 'ev-1', type: 'step.failed', stepRunId: null, attemptId: null, occurredAt: '2026-11-20T03:09:00.000Z', payload: {} }],
  providerCalls: [{ id: 'call-1', callId: 'c1', eventKind: 'failed', provider: 'deepseek', model: 'deepseek-v4-pro', stage: null, retryIndex: 0, callReason: null, occurredAt: '2026-11-20T03:09:58.000Z', latencyMs: 120, inputTokens: null, outputTokens: null, reasoningTokens: null, providerRequestId: null, errorCode: 'HTTP_503', failureClass: 'provider_http', providerStatus: 503 }],
  analysis: {
    conclusion: 'Provider 在重试多次后仍返回 503 临时故障，任务未能完成。',
    confidence: 'high',
    rootCauseClass: 'provider_http',
    confirmedEvidence: ['5 次尝试全部失败', '503 状态码'],
    uncertainFactors: ['是否上游发布导致'],
    recommendedActions: ['检查 provider 状态页', '稍后手动重跑任务'],
    followUpQuestions: ['是否开启了自动降级？'],
  },
};

test('diagnostics summary parses data and forwards the days filter', async () => {
  const { client, calls, respond } = fixture();
  await authorize(client);
  respond(() => json(summary));
  const data = await client.fetchDiagnosticSummary(14);
  assert.deepEqual(data, summary);
  const last = calls.at(-1);
  assert.equal(new URL(last.url).pathname, '/api/v1/dashboard/diagnostics/summary');
  assert.equal(new URL(last.url).searchParams.get('days'), '14');
  assert.equal(last.options.method, 'GET');
  assert.equal(last.options.headers.Authorization, 'Bearer ' + token);
});

test('diagnostics runs forward filters and bounded pagination and keep hasMore', async () => {
  const { client, calls, respond } = fixture(viewer);
  await authorize(client);
  respond(() => json({ runs: [runItem], hasMore: true }));
  const data = await client.fetchDiagnosticRuns({ days: 7, limit: 20, offset: 20, model: 'deepseek/? &', error: 'V5_%' });
  assert.equal(data.hasMore, true);
  assert.deepEqual(data.runs, [runItem]);
  const query = new URL(calls.at(-1).url).searchParams;
  assert.equal(new URL(calls.at(-1).url).pathname, '/api/v1/dashboard/diagnostics/runs');
  assert.equal(query.get('days'), '7');
  assert.equal(query.get('limit'), '20');
  assert.equal(query.get('offset'), '20');
  assert.equal(query.get('model'), 'deepseek/? &');
  assert.equal(query.get('error'), 'V5_%');
  respond(() => json({ runs: [], hasMore: false }));
  await client.fetchDiagnosticRuns({ days: 7 });
  const defaults = new URL(calls.at(-1).url).searchParams;
  assert.deepEqual(Object.fromEntries(defaults), { days: '7', limit: '20', offset: '0' });
});

test('diagnostics run detail encodes the run id and parses nested data', async () => {
  const { client, calls, respond } = fixture();
  await authorize(client);
  respond(() => json(detail));
  const data = await client.fetchDiagnosticRun('run/with?slashes');
  assert.deepEqual(data, detail);
  assert.equal(data.job.failure.retryable, true);
  assert.equal(data.providerCalls[1].latencyMs, 43599);
  const last = calls.at(-1);
  assert.equal(new URL(last.url).pathname, '/api/v1/dashboard/diagnostics/runs/run%2Fwith%3Fslashes');
});

test('diagnostics endpoints require login and verified dashboard session before any fetch', async () => {
  const { client, calls } = fixture();
  await assert.rejects(client.fetchDiagnosticSummary(7), isDenied(401, 'AUTH_REQUIRED'));
  await assert.rejects(client.fetchDiagnosticRun('run-1'), isDenied(401, 'AUTH_REQUIRED'));
  await assert.rejects(client.requestDiagnosticAnalysis('run-1'), isDenied(401, 'AUTH_REQUIRED'));
  client.setAccessToken(token);
  await assert.rejects(client.fetchDiagnosticRuns({ days: 7 }), isDenied(403, 'SESSION_REQUIRED'));
  await assert.rejects(client.requestDiagnosticAnalysis('run-1'), isDenied(403, 'SESSION_REQUIRED'));
  assert.equal(calls.length, 0);
});

test('viewer analysis is rejected on the client without any network request', async () => {
  const { client, calls } = fixture(viewer);
  await authorize(client);
  await assert.rejects(client.requestDiagnosticAnalysis('run-1'), isDenied(403, 'READ_ONLY'));
  assert.equal(calls.length, 1, 'only the session verification may hit the network');
});

test('owner can request AI analysis and receives the parsed result', async () => {
  const { client, calls, respond } = fixture();
  await authorize(client);
  respond(() => json(analysisResult));
  const data = await client.requestDiagnosticAnalysis('run-1');
  assert.deepEqual(data, analysisResult);
  assert.equal(data.analysis.confidence, 'high');
  const last = calls.at(-1);
  assert.equal(new URL(last.url).pathname, '/api/v1/dashboard/diagnostics/runs/run-1/analysis');
  assert.equal(last.options.method, 'POST');
  assert.equal(last.options.body, '{}');
  assert.equal(last.options.headers['Content-Type'], 'application/json');
});

test('502 analysis failure maps to a retryable friendly message', async () => {
  const { client, respond } = fixture();
  await authorize(client);
  respond(() => Response.json({ success: false, error: { code: 'AI_ANALYSIS_FAILED', message: 'upstream model backend down' } }, { status: 502 }));
  await assert.rejects(client.requestDiagnosticAnalysis('run-1'), (error) => {
    assert.ok(error instanceof DashboardRequestError);
    assert.equal(error.status, 502);
    assert.equal(error.message, 'AI 分析暂不可用，请稍后重试');
    return true;
  });
});

test('429 analysis rate limit surfaces the server message', async () => {
  const { client, respond } = fixture();
  await authorize(client);
  respond(() => Response.json({ success: false, error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } }, { status: 429 }));
  await assert.rejects(client.requestDiagnosticAnalysis('run-1'), (error) => {
    assert.ok(error instanceof DashboardRequestError);
    assert.equal(error.status, 429);
    assert.equal(error.message, '请求过于频繁，请稍后再试');
    return true;
  });
});

test('server 403 on analysis keeps the default permission message', async () => {
  const { client, respond } = fixture();
  await authorize(client);
  respond(() => new Response('', { status: 403 }));
  await assert.rejects(client.requestDiagnosticAnalysis('run-1'), (error) => {
    assert.ok(error instanceof DashboardRequestError);
    assert.equal(error.status, 403);
    assert.equal(error.message, '当前账号无后台权限');
    return true;
  });
});

test('diagnostics format helpers cover known and fallback branches', () => {
  assert.equal(rootCauseClassLabel('provider_http'), '模型供应商HTTP错误');
  assert.equal(rootCauseClassLabel('timeout'), '请求超时');
  assert.equal(rootCauseClassLabel('network'), '网络连接失败');
  assert.equal(rootCauseClassLabel('stream_incomplete'), '模型流提前中断');
  assert.equal(rootCauseClassLabel('rate_limit'), '模型限流');
  assert.equal(rootCauseClassLabel('output_validation'), '输出校验失败');
  assert.equal(rootCauseClassLabel('unknown'), '未知原因');
  assert.equal(rootCauseClassLabel('brand_new_class'), 'brand_new_class');
  assert.equal(confidenceLabel('high'), '高置信');
  assert.equal(confidenceLabel('medium'), '中置信');
  assert.equal(confidenceLabel('low'), '低置信');
  assert.equal(durationMsLabel(null), '—');
  assert.equal(durationMsLabel(1200), '1.2s');
  assert.equal(durationMsLabel(43599), '43.6s');
  assert.equal(durationMsLabel(0), '0.0s');
  assert.equal(tokenLabel(null), '—');
  assert.equal(tokenLabel(0), '0');
  assert.equal(tokenLabel(1234), '1,234');
  assert.equal(tokenLabel(1234567), '1,234,567');
});
