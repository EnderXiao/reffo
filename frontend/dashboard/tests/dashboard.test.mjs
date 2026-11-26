import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardClient, DashboardRequestError } from '../src/services/dashboard.ts';
import { secureOrigin } from '../src/services/secure-url.ts';

const origin = 'https://api.example.test';
const token = 'fake-access-token-for-test';
const owner = { userId: 'user-owner', role: 'owner', permissions: { canRead: true, canViewDetails: true, canWrite: true }, environment: 'local' };
const viewer = { userId: 'user-viewer', role: 'viewer', permissions: { canRead: true, canViewDetails: true, canWrite: false }, environment: 'prod' };
const input = { eventName: 'click_save', page: 'result', description: 'save resume' };
const json = (data, status = 200) => Response.json({ success: true, data }, { status });
const errorWith = (status, code) => (error) => error instanceof DashboardRequestError && error.status === status && (!code || error.code === code);

function fixture(session = owner) {
  const calls = [];
  let respond = () => json({ errors: [], hasMore: false });
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

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('no dashboard network request occurs before login AND session verification, even locally', async () => {
  const { client, calls } = fixture();
  await assert.rejects(client.fetchErrors(), errorWith(401, 'AUTH_REQUIRED'));
  await assert.rejects(client.createTrackingRequirement(input), errorWith(401, 'AUTH_REQUIRED'));
  client.setAccessToken(token);
  await assert.rejects(client.fetchErrors(), errorWith(403, 'SESSION_REQUIRED'));
  await assert.rejects(client.updateTrackingRequirementStatus('req', 'implemented'), errorWith(403));
  assert.equal(calls.length, 0);
  await client.fetchDashboardSession();
  await client.fetchErrors();
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), ['/api/v1/dashboard/session', '/api/v1/dashboard/errors']);
});

test('API origin is combined once; all credentials stay in Authorization without cookies or redirects', async () => {
  const { client, calls, respond } = fixture();
  await authorize(client);
  await client.fetchErrors({ limit: 20, offset: 0, traceId: 'trace/? & x' });
  respond(() => json({ requirement: { id: 'req' } }));
  await client.createTrackingRequirement(input);
  await client.updateTrackingRequirementStatus('req/one?', 'implemented');
  for (const { url, options } of calls) {
    assert.equal(new URL(url).origin, origin);
    assert.equal(url.includes(token), false);
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(new URL(calls[1].url).searchParams.get('traceId'), 'trace/? & x');
  assert.equal(new URL(calls[1].url).searchParams.get('offset'), '0');
  assert.equal(calls[2].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].options.body), input);
  assert.equal(calls[2].options.headers['Content-Type'], 'application/json');
  assert.equal(new URL(calls[3].url).pathname, '/api/v1/dashboard/tracking/requirements/req%2Fone%3F');
  assert.deepEqual(JSON.parse(calls[3].options.body), { status: 'implemented' });
});

test('viewer can read sanitized details and analytics properties; direct mutation calls never reach fetch', async () => {
  const { client, calls, respond } = fixture(viewer);
  await authorize(client);
  const trace = 'shared/trace?';
  const detail = { id: 'second', trace_id: trace, error_stack: 'redacted stack', context: { email: '[REDACTED]' } };
  respond(() => json({ traceId: trace, errors: [{ ...detail, id: 'first' }, detail], relatedEvents: [] }));
  const result = await client.fetchErrorByTraceId(trace);
  assert.equal(result.errors.find((row) => row.id === 'second').context.email, '[REDACTED]');
  assert.equal(new URL(calls[1].url).pathname, '/api/v1/dashboard/error/shared%2Ftrace%3F');
  respond(() => json({ events: [{ event_name: 'click_save', properties: { email: '[REDACTED]' } }], hasMore: false }));
  assert.deepEqual((await client.fetchAnalytics()).events[0].properties, { email: '[REDACTED]' });
  const before = calls.length;
  await assert.rejects(client.createTrackingRequirement(input), errorWith(403, 'READ_ONLY'));
  await assert.rejects(client.updateTrackingRequirementStatus('req', 'implemented'), errorWith(403, 'READ_ONLY'));
  assert.equal(calls.length, before);
});

test('403 removes dashboard authorization but keeps login for an explicit permission retry', async () => {
  let allowed = false;
  const calls = [];
  const statuses = [];
  const client = createDashboardClient({ apiOrigin: origin, fetcher: async (url) => {
    calls.push(url);
    if (!allowed) return new Response('forbidden HTML', { status: 403 });
    return new URL(url).pathname.endsWith('/session') ? json(owner) : json({ errors: [], hasMore: false });
  } });
  client.setAccessErrorHandler((status) => statuses.push(status));
  client.setAccessToken(token);
  await assert.rejects(client.fetchDashboardSession(), errorWith(403));
  assert.deepEqual(statuses, [403]);
  await assert.rejects(client.fetchErrors(), errorWith(403, 'SESSION_REQUIRED'));
  assert.equal(calls.length, 1);
  allowed = true;
  await client.fetchDashboardSession();
  await client.fetchErrors();
  assert.equal(calls.length, 3);
});

test('401 clears credentials and aborts concurrent work before parsing any response body', async () => {
  const { client, calls, respond } = fixture();
  await authorize(client);
  const delayed = deferred();
  respond(() => delayed.promise);
  const pending = client.fetchAnalytics();
  respond(() => new Response('<html>unauthorized</html>', { status: 401 }));
  const statuses = [];
  client.setAccessErrorHandler((status) => statuses.push(status));
  await assert.rejects(client.fetchErrors(), errorWith(401));
  assert.deepEqual(statuses, [401]);
  assert.equal(calls[1].options.signal.aborted, true);
  delayed.resolve(json({ events: [], hasMore: false }));
  await assert.rejects(pending, { name: 'AbortError' });
  const count = calls.length;
  await assert.rejects(client.fetchDashboardSession(), errorWith(401, 'AUTH_REQUIRED'));
  await assert.rejects(client.fetchErrors(), errorWith(401, 'AUTH_REQUIRED'));
  assert.equal(calls.length, count);
});

test('403 on an authorized request cancels dashboard reads and blocks further writes until verified again', async () => {
  const { client, calls, respond } = fixture();
  await authorize(client);
  respond(() => new Response('', { status: 403 }));
  await assert.rejects(client.fetchErrors(), errorWith(403));
  const count = calls.length;
  await assert.rejects(client.createTrackingRequirement(input), errorWith(403, 'SESSION_REQUIRED'));
  await assert.rejects(client.fetchAnalytics(), errorWith(403, 'SESSION_REQUIRED'));
  assert.equal(calls.length, count);
  await client.fetchDashboardSession();
  respond(() => json({ requirement: { id: 'req' } }));
  await client.createTrackingRequirement(input);
});

test('refresh tokens update subsequent Authorization; a stale 401 cannot sign out the refreshed session', async () => {
  const { client, calls, respond } = fixture();
  await authorize(client);
  const delayed = deferred();
  respond(() => delayed.promise);
  const pending = client.fetchErrors();
  const statuses = [];
  client.setAccessErrorHandler((status) => statuses.push(status));
  client.setAccessToken('new-fake-token');
  respond(() => json({ errors: [], hasMore: false }));
  delayed.resolve(new Response('', { status: 401 }));
  await pending;
  assert.deepEqual(statuses, []);
  await client.fetchErrors();
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer new-fake-token');
});

test('abort cancels transport and suppresses a late successful response', async () => {
  const { client, calls, respond } = fixture();
  await authorize(client);
  const delayed = deferred();
  respond(() => delayed.promise);
  const controller = new AbortController();
  const pending = client.fetchErrors({}, controller.signal);
  controller.abort();
  assert.equal(calls.at(-1).options.signal.aborted, true);
  delayed.resolve(json({ errors: [{ id: 'stale' }], hasMore: false }));
  await assert.rejects(pending, { name: 'AbortError' });
  const count = calls.length;
  await assert.rejects(client.fetchErrors({}, controller.signal), { name: 'AbortError' });
  assert.equal(calls.length, count);
});

test('logging out while session verification is in flight cannot restore a session', async () => {
  const delayed = deferred();
  const client = createDashboardClient({ apiOrigin: origin, fetcher: async () => delayed.promise });
  client.setAccessToken(token);
  const pending = client.fetchDashboardSession();
  client.clearSession();
  delayed.resolve(json(owner));
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(client.fetchErrors(), errorWith(401, 'AUTH_REQUIRED'));
});

test('rejects malformed session permissions rather than trusting an unknown role', async () => {
  for (const value of [null, {}, { ...viewer, role: 'admin' }, { ...viewer, environment: 'staging' }, { ...viewer, permissions: { ...viewer.permissions, canWrite: true } }, { ...owner, permissions: { canRead: false, canViewDetails: true, canWrite: true } }]) {
    const { client, calls } = fixture(value);
    client.setAccessToken(token);
    await assert.rejects(client.fetchDashboardSession(), (error) => errorWith(200)(error) && ['INVALID_SESSION', 'INVALID_RESPONSE'].includes(error.code));
    await assert.rejects(client.fetchErrors(), errorWith(403, 'SESSION_REQUIRED'));
    assert.equal(calls.length, 1);
  }
});

test('HTTP, JSON, envelope and network failures surface safe errors without server or token content', async () => {
  const { client, respond } = fixture();
  await authorize(client);
  const cases = [
    [() => new Response('upstream ' + token, { status: 502 }), 502, 'INVALID_JSON'],
    [() => Response.json({ success: false, error: { message: token } }, { status: 500 }), 500, 'HTTP_ERROR'],
    [() => Response.json({ success: false, error: { message: token } }), 200, 'API_ERROR'],
    [() => new Response('not JSON'), 200, 'INVALID_JSON'],
    [() => Response.json({ data: [] }), 200, 'INVALID_RESPONSE'],
    [() => Response.json({ success: true, data: null }), 200, 'INVALID_RESPONSE'],
    [() => { throw new Error('fetch failed ' + token); }, 0, 'NETWORK_ERROR'],
  ];
  for (const [response, status, code] of cases) {
    respond(response);
    await assert.rejects(client.fetchErrors(), (error) => {
      assert.equal(error.message.includes(token), false);
      return errorWith(status, code)(error);
    });
  }
  respond(() => new Response('invalid write JSON'));
  await assert.rejects(client.updateTrackingRequirementStatus('req', 'implemented'), errorWith(200, 'INVALID_JSON'));
});


test('tracking pages require verified access and return global filter options independently of the current list page', async () => {
  const { client, calls, respond } = fixture(viewer);
  await assert.rejects(client.fetchTrackingPages(), errorWith(401, 'AUTH_REQUIRED'));
  client.setAccessToken(token);
  await assert.rejects(client.fetchTrackingPages(), errorWith(403, 'SESSION_REQUIRED'));
  assert.equal(calls.length, 0);
  await client.fetchDashboardSession();
  respond(() => json({ pages: ['首页', '创建页', '结果页'] }));
  assert.deepEqual((await client.fetchTrackingPages()).pages, ['首页', '创建页', '结果页']);
  assert.equal(new URL(calls.at(-1).url).pathname, '/api/v1/dashboard/tracking/pages');
  assert.equal(new URL(calls.at(-1).url).search, '');
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer ' + token);
});

test('tracking requirements fetch only one bounded page and preserve server-side filters and hasMore', async () => {
  const { client, calls, respond } = fixture(viewer);
  await authorize(client);
  respond((url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    return json({ requirements: [{ id: 'req-' + offset, event_name: 'click_save', page: '结果页', status: 'implemented' }], hasMore: offset === 0 });
  });
  const filters = { status: 'implemented', page: '结果页', eventName: 'click_save/? &', search: '保存 简历 & /', limit: 20 };
  const first = await client.fetchTrackingRequirements(filters);
  assert.equal(first.hasMore, true);
  assert.equal(first.requirements[0].id, 'req-0');
  assert.equal(calls.length, 2, 'hasMore must not cause eager loading of all later pages');
  const firstQuery = new URL(calls.at(-1).url).searchParams;
  for (const [key, value] of Object.entries(filters)) assert.equal(firstQuery.get(key), String(value));
  assert.equal(firstQuery.get('offset'), '0');
  const second = await client.fetchTrackingRequirements({ ...filters, offset: 20 });
  assert.equal(second.hasMore, false);
  assert.equal(second.requirements[0].id, 'req-20');
  assert.equal(new URL(calls.at(-1).url).searchParams.get('offset'), '20');
  assert.equal(calls.length, 3);
  await client.fetchTrackingRequirements();
  const allQuery = new URL(calls.at(-1).url).searchParams;
  assert.deepEqual(Object.fromEntries(allQuery), { limit: '20', offset: '0' });
});

test('a failed permission recheck cannot retain prior owner access', async () => {
  let checks = 0;
  const client = createDashboardClient({ apiOrigin: origin, fetcher: async () => ++checks === 1 ? json(owner) : json({ ...owner, role: 'unknown' }) });
  await authorize(client);
  await assert.rejects(client.fetchDashboardSession(), errorWith(200, 'INVALID_SESSION'));
  await assert.rejects(client.createTrackingRequirement(input), errorWith(403, 'SESSION_REQUIRED'));
  await assert.rejects(client.fetchErrors(), errorWith(403, 'SESSION_REQUIRED'));
  assert.equal(checks, 2);
});

test('auto-refresh never replays a mutation rejected for an older token', async () => {
  const { client, calls, respond } = fixture();
  await authorize(client);
  const delayed = deferred();
  respond(() => delayed.promise);
  const pending = client.createTrackingRequirement(input);
  client.setAccessToken('new-fake-token');
  delayed.resolve(new Response('', { status: 401 }));
  await assert.rejects(pending, errorWith(0, 'TOKEN_CHANGED'));
  assert.equal(calls.length, 2);
  respond(() => json({ errors: [], hasMore: false }));
  await client.fetchErrors();
});

test('a 20 second request deadline reports a visible retryable timeout', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { client, respond } = fixture();
  await authorize(client);
  respond((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }));
  const pending = client.fetchErrors();
  const assertion = assert.rejects(pending, errorWith(0, 'TIMEOUT'));
  context.mock.timers.tick(20_000);
  await assertion;
});

test('credential destinations require HTTPS or loopback HTTP and forbid URL userinfo, API paths and query strings', async () => {
  for (const value of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', origin + '/']) assert.equal(secureOrigin(value, 'test'), new URL(value).origin);
  const userinfo = new URL(origin);
  userinfo.username = 'test-user';
  userinfo.password = 'fake-password';
  for (const value of ['http:' + '//api.example.test', origin + '/api/v1', userinfo.toString(), origin + '/?token=x', origin + '/#fragment', 'javascript:alert(1)', '/api/v1', 'http://localhost.example.test']) {
    assert.throws(() => secureOrigin(value, 'test'));
    let fetched = false;
    const client = createDashboardClient({ apiOrigin: value, fetcher: async () => { fetched = true; return json(owner); } });
    client.setAccessToken(token);
    await assert.rejects(client.fetchDashboardSession());
    assert.equal(fetched, false);
  }
});
