import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardSessionController } from '../src/services/dashboard-session.ts';
import { createDashboardClient, DashboardRequestError } from '../src/services/dashboard.ts';

const owner = { userId: 'user-owner', role: 'owner', permissions: { canRead: true, canViewDetails: true, canWrite: true }, environment: 'local' };
const viewer = { userId: 'user-viewer', role: 'viewer', permissions: { canRead: true, canViewDetails: true, canWrite: false }, environment: 'prod' };
const authSession = (user = owner, token = 'fake-' + user.userId) => ({ user: { id: user.userId }, access_token: token });
const json = (data) => Response.json({ success: true, data });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const isDenied = (status) => (error) => error instanceof DashboardRequestError && error.status === status;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(context) {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const states = [];
  let clears = 0;
  let snapshot = { state: 'login', session: null, message: '' };
  let response = (url) => new URL(url).pathname.endsWith('/session') ? json(owner) : json({ errors: [], hasMore: false });
  const client = createDashboardClient({ apiOrigin: 'https://api.example.test', fetcher: async (url, options) => {
    calls.push({ url, options });
    return response(url, options);
  } });
  const controller = createDashboardSessionController({
    ...client,
    clearSession() { clears += 1; client.clearSession(); },
    onChange(next) { snapshot = next; states.push(next); },
  });
  client.setAccessErrorHandler(controller.accessDenied);
  context.after(() => controller.dispose());
  return {
    client, controller, calls, states,
    get snapshot() { return snapshot; },
    get clears() { return clears; },
    respond(next) { response = next; },
    checks() { return calls.filter(({ url }) => new URL(url).pathname.endsWith('/session')); },
    async run() { context.mock.timers.tick(0); await flush(); },
  };
}

test('first authentication defers verification beyond the synchronous Supabase callback and coalesces pending sign-ins', async (context) => {
  const f = fixture(context);
  const delayed = deferred();
  f.respond(() => delayed.promise);
  assert.equal(f.controller.handleAuthStateChange('INITIAL_SESSION', authSession()), undefined);
  assert.equal(f.snapshot.state, 'checking');
  assert.equal(f.snapshot.session, null);
  assert.equal(f.calls.length, 0, 'no permission request or SDK work runs under the auth callback lock');
  f.controller.handleAuthStateChange('SIGNED_IN', authSession(owner, 'before-start'));
  f.controller.retry();
  await f.run();
  assert.equal(f.checks().length, 1);
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer before-start');
  f.controller.handleAuthStateChange('SIGNED_IN', authSession(owner, 'during-check'));
  f.controller.handleAuthStateChange('TOKEN_REFRESHED', authSession(owner, 'latest-token'));
  f.controller.retry();
  await f.run();
  assert.equal(f.checks().length, 1);
  assert.equal(f.calls[0].options.signal.aborted, false);
  delayed.resolve(json(owner));
  await flush();
  assert.equal(f.snapshot.state, 'ready');
  assert.equal(f.snapshot.session.userId, owner.userId);
  assert.deepEqual(f.states.map(({ state }) => state), ['checking', 'ready']);
});

test('same-user focus/repeated SIGNED_IN and refresh only rotate tokens, retaining the verified object and live reads', async (context) => {
  const f = fixture(context);
  f.controller.handleAuthStateChange('SIGNED_IN', authSession());
  await f.run();
  const verified = f.snapshot.session;
  const updates = f.states.length;
  const clears = f.clears;
  const delayed = deferred();
  f.respond(() => delayed.promise);
  const read = f.client.fetchErrors();
  for (const [event, token] of [['SIGNED_IN', 'focus-1'], ['SIGNED_IN', 'focus-2'], ['TOKEN_REFRESHED', 'refresh-1'], ['SIGNED_IN', 'latest-token']]) {
    f.controller.handleAuthStateChange(event, authSession(owner, token));
  }
  await f.run();
  assert.equal(f.snapshot.state, 'ready');
  assert.equal(f.snapshot.session, verified, 'the previously verified roles/permissions object stays stable');
  assert.equal(f.states.length, updates, 'no auth state update can replace mounted dashboard children');
  assert.equal(f.clears, clears);
  assert.equal(f.checks().length, 1);
  assert.equal(f.calls[1].options.signal.aborted, false);
  delayed.resolve(json({ errors: [], hasMore: false }));
  await read;
  f.respond(() => json({ errors: [], hasMore: false }));
  await f.client.fetchErrors();
  assert.equal(f.calls.at(-1).options.headers.Authorization, 'Bearer latest-token');
});

test('a different identity revokes the old role and reads immediately, and must verify its own permissions', async (context) => {
  const f = fixture(context);
  f.controller.handleAuthStateChange('SIGNED_IN', authSession());
  await f.run();
  const readResponse = deferred();
  f.respond(() => readResponse.promise);
  const read = f.client.fetchErrors();
  const rejectedRead = assert.rejects(read, { name: 'AbortError' });
  const newSession = deferred();
  f.respond(() => newSession.promise);
  f.controller.handleAuthStateChange('TOKEN_REFRESHED', authSession(viewer));
  assert.equal(f.snapshot.state, 'checking');
  assert.equal(f.snapshot.session, null);
  assert.equal(f.calls[1].options.signal.aborted, true);
  await assert.rejects(f.client.fetchErrors(), isDenied(403));
  await f.run();
  assert.equal(f.checks().length, 2);
  assert.equal(f.checks()[1].options.headers.Authorization, 'Bearer fake-user-viewer');
  newSession.resolve(json(viewer));
  await flush();
  assert.equal(f.snapshot.state, 'ready');
  assert.equal(f.snapshot.session.role, 'viewer');
  await assert.rejects(f.client.createTrackingRequirement({ eventName: 'test', page: 'test', description: 'test' }), isDenied(403));
  readResponse.resolve(json({ errors: [{ id: 'stale-owner-read' }], hasMore: false }));
  await rejectedRead;
});

test('switching identities during verification discards the old success before permitting the new identity', async (context) => {
  const f = fixture(context);
  const oldSession = deferred();
  f.respond(() => oldSession.promise);
  f.controller.handleAuthStateChange('SIGNED_IN', authSession());
  await f.run();
  const newSession = deferred();
  f.respond(() => newSession.promise);
  f.controller.handleAuthStateChange('SIGNED_IN', authSession(viewer));
  assert.equal(f.calls[0].options.signal.aborted, true);
  await f.run();
  oldSession.resolve(json(owner));
  await flush();
  assert.equal(f.snapshot.state, 'checking');
  assert.equal(f.snapshot.session, null);
  newSession.resolve(json(viewer));
  await flush();
  assert.equal(f.snapshot.session.userId, viewer.userId);
  assert.deepEqual(f.states.map(({ state }) => state), ['checking', 'checking', 'ready']);
});

test('SIGNED_OUT cancels queued and in-flight checks; the same user must verify again after re-login', async (context) => {
  const f = fixture(context);
  f.controller.handleAuthStateChange('SIGNED_IN', authSession());
  f.controller.handleAuthStateChange('SIGNED_OUT', null);
  await f.run();
  assert.equal(f.calls.length, 0);
  const delayed = deferred();
  f.respond(() => delayed.promise);
  f.controller.handleAuthStateChange('SIGNED_IN', authSession());
  await f.run();
  f.controller.handleAuthStateChange('SIGNED_OUT', null);
  assert.equal(f.snapshot.state, 'login');
  assert.equal(f.snapshot.session, null);
  assert.equal(f.calls[0].options.signal.aborted, true);
  delayed.resolve(json(owner));
  await flush();
  assert.equal(f.snapshot.state, 'login');
  const count = f.calls.length;
  await assert.rejects(f.client.fetchErrors(), isDenied(401));
  f.controller.retry();
  await f.run();
  assert.equal(f.calls.length, count);
  f.respond(() => json(owner));
  f.controller.handleAuthStateChange('SIGNED_IN', authSession());
  await f.run();
  assert.equal(f.snapshot.state, 'ready');
  assert.equal(f.checks().length, 2);
});

test('verification failures can retry with the same user and TOKEN_REFRESHED cannot reuse failed authorization', async (context) => {
  const f = fixture(context);
  f.respond(() => { throw new Error('network unavailable'); });
  f.controller.handleAuthStateChange('SIGNED_IN', authSession());
  await f.run();
  assert.equal(f.snapshot.state, 'error');
  assert.equal(f.snapshot.session, null);
  f.respond(() => json(owner));
  f.controller.handleAuthStateChange('TOKEN_REFRESHED', authSession(owner, 'retry-token'));
  assert.equal(f.snapshot.state, 'checking');
  await f.run();
  assert.equal(f.checks().length, 2);
  assert.equal(f.snapshot.state, 'ready');
  const delayed = deferred();
  f.respond(() => delayed.promise);
  f.controller.retry();
  assert.equal(f.snapshot.session, null);
  await f.run();
  delayed.reject(new Error('network unavailable'));
  await flush();
  assert.equal(f.snapshot.state, 'error');
  await assert.rejects(f.client.fetchErrors(), isDenied(403));
  f.respond(() => json(owner));
  f.controller.retry();
  f.controller.handleAuthStateChange('SIGNED_IN', authSession(owner, 'retry-signin'));
  f.controller.retry();
  await f.run();
  assert.equal(f.checks().length, 4);
  assert.equal(f.snapshot.state, 'ready');
});

test('403 revokes a verified role, keeps authentication for explicit retry, and coalesces focus events while retrying', async (context) => {
  const f = fixture(context);
  f.controller.handleAuthStateChange('SIGNED_IN', authSession());
  await f.run();
  f.respond(() => new Response('', { status: 403 }));
  await assert.rejects(f.client.fetchErrors(), isDenied(403));
  assert.equal(f.snapshot.state, 'forbidden');
  assert.equal(f.snapshot.session, null);
  const count = f.calls.length;
  await assert.rejects(f.client.fetchErrors(), isDenied(403));
  assert.equal(f.calls.length, count);
  f.controller.retry();
  await f.run();
  assert.equal(f.snapshot.state, 'forbidden');
  assert.equal(f.checks().length, 2);
  f.respond(() => json(owner));
  f.controller.handleAuthStateChange('SIGNED_IN', authSession(owner, 'retry-focus'));
  f.controller.retry();
  await f.run();
  assert.equal(f.checks().length, 3);
  assert.equal(f.snapshot.state, 'ready');
});

test('401 returns to login and retry cannot silently restore the prior credential', async (context) => {
  const f = fixture(context);
  f.controller.handleAuthStateChange('SIGNED_IN', authSession());
  await f.run();
  f.respond(() => new Response('', { status: 401 }));
  await assert.rejects(f.client.fetchErrors(), isDenied(401));
  assert.equal(f.snapshot.state, 'login');
  assert.equal(f.snapshot.session, null);
  f.controller.retry();
  await f.run();
  assert.equal(f.checks().length, 1);
  await assert.rejects(f.client.fetchDashboardSession(), isDenied(401));
  f.respond(() => json(owner));
  f.controller.handleAuthStateChange('SIGNED_IN', authSession());
  await f.run();
  assert.equal(f.checks().length, 2);
  assert.equal(f.snapshot.state, 'ready');
});

test('stale verification success and failure cannot publish after sign-out or disposal, even if transport ignores cancellation', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const operation of ['signOut', 'dispose']) {
    for (const outcome of ['resolve', 'reject']) {
      const states = [];
      const delayed = deferred();
      let signal;
      const controller = createDashboardSessionController({
        clearSession() {}, setAccessToken() {},
        fetchDashboardSession(nextSignal) { signal = nextSignal; return delayed.promise; },
        onChange(next) { states.push(next); },
      });
      controller.handleAuthStateChange('SIGNED_IN', authSession());
      context.mock.timers.tick(0);
      controller[operation]();
      assert.equal(signal.aborted, true);
      const count = states.length;
      delayed[outcome](outcome === 'resolve' ? owner : new Error('late failure'));
      await flush();
      assert.equal(states.length, count);
      assert.ok(states.every(({ state }) => state !== 'ready'));
      if (operation === 'dispose') {
        controller.handleAuthStateChange('SIGNED_IN', authSession());
        controller.retry();
        context.mock.timers.tick(0);
        assert.equal(states.length, count);
      }
      controller.dispose();
    }
  }
});

test('a session response for a different identity never authorizes or leaves API reads enabled', async (context) => {
  const f = fixture(context);
  f.respond(() => json(viewer));
  f.controller.handleAuthStateChange('SIGNED_IN', authSession());
  await f.run();
  assert.equal(f.snapshot.state, 'error');
  assert.equal(f.snapshot.session, null);
  await assert.rejects(f.client.fetchErrors(), isDenied(403));
  f.respond(() => json(owner));
  f.controller.retry();
  await f.run();
  assert.equal(f.snapshot.state, 'ready');
});
