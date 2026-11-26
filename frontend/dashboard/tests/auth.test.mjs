import test from 'node:test';
import assert from 'node:assert/strict';
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { createAuthClient, AuthRequestError } from '../src/services/auth.ts';

const keyPair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const cryptoKey = (id = 'test-key') => ({
  version: 1,
  key_id: id,
  algorithm: 'RSA-OAEP-256+A256GCM',
  public_key: keyPair.publicKey,
});

const tokenPayload = (overrides = {}) => ({
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 3600,
  expires_at: 1_900_000_000,
  token_type: 'bearer',
  user: { id: 'user-owner', email: 'owner@example.test' },
  ...overrides,
});

function decryptEnvelope(envelope) {
  const aesKey = privateDecrypt(
    { key: keyPair.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(envelope.encrypted_key, 'base64url'),
  );
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', aesKey, Buffer.from(envelope.iv, 'base64url'));
  decipher.setAAD(Buffer.from(`${envelope.key_id}.${envelope.timestamp}.${envelope.nonce}`));
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

function fixture(routes) {
  const calls = [];
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ url, init, path });
    const handler = routes[path];
    if (!handler) throw new Error('unexpected request ' + url);
    return handler(init, calls.length);
  };
  const client = createAuthClient({ apiOrigin: 'https://api.example.test', fetcher, now: () => 1_800_000_000_000 });

  return { client, calls };
}

test('sign-in encrypts the password and only talks to the dashboard API origin', async () => {
  const f = fixture({
    '/api/v1/auth/crypto-key': () => Response.json({ success: true, data: cryptoKey() }),
    '/api/v1/auth/sign-in': () => Response.json({ success: true, data: tokenPayload() }),
  });

  const session = await f.client.signIn(' owner@example.test ', 'xgy8291034');

  assert.deepEqual(f.calls.map(({ path }) => path), ['/api/v1/auth/crypto-key', '/api/v1/auth/sign-in']);
  assert.ok(f.calls.every(({ url }) => new URL(url).host === 'api.example.test'), 'never contacts supabase.co');
  assert.equal(f.calls[1].init.credentials, 'omit');
  assert.equal(f.calls[1].init.headers.Authorization, undefined);

  const body = JSON.parse(f.calls[1].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['ciphertext', 'encrypted_key', 'iv', 'key_id', 'nonce', 'timestamp', 'version']);
  assert.equal(body.version, 1);
  assert.equal(body.key_id, 'test-key');
  assert.ok(!f.calls[1].init.body.includes('xgy8291034'), 'plaintext password never leaves the page');
  assert.deepEqual(decryptEnvelope(body), { email: 'owner@example.test', password: 'xgy8291034' });

  assert.deepEqual(session, {
    user: { id: 'user-owner', email: 'owner@example.test' },
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_at: 1_900_000_000,
  });
});

test('a rejected envelope refreshes the public key and retries sign-in exactly once', async () => {
  let keys = 0;
  let attempts = 0;
  const f = fixture({
    '/api/v1/auth/crypto-key': () => {
      keys += 1;
      return Response.json({ success: true, data: cryptoKey(keys === 1 ? 'rotated-old' : 'rotated-new') });
    },
    '/api/v1/auth/sign-in': () => {
      attempts += 1;
      if (attempts === 1) {
        return Response.json({ success: false, error: { code: 'AUTH_ENCRYPTION_INVALID', message: '认证密钥已更新，请重试' } }, { status: 400 });
      }
      return Response.json({ success: true, data: tokenPayload() });
    },
  });

  const session = await f.client.signIn('owner@example.test', 'secret');

  assert.equal(session.access_token, 'access-token');
  assert.equal(keys, 2);
  assert.equal(attempts, 2);
  assert.equal(JSON.parse(f.calls[3].init.body).key_id, 'rotated-new');
});

test('refresh exchanges the refresh token through the API proxy', async () => {
  const f = fixture({
    '/api/v1/auth/refresh': () => Response.json({ success: true, data: tokenPayload({ access_token: 'next-access', refresh_token: 'next-refresh' }) }),
  });

  const session = await f.client.refresh('refresh-token');

  assert.equal(f.calls[0].url, 'https://api.example.test/api/v1/auth/refresh');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { refresh_token: 'refresh-token' });
  assert.equal(session.access_token, 'next-access');
});

test('invalid credentials surface the backend message instead of a generic failure', async () => {
  const f = fixture({
    '/api/v1/auth/crypto-key': () => Response.json({ success: true, data: cryptoKey() }),
    '/api/v1/auth/sign-in': () => Response.json(
      { success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', message: '邮箱或密码不正确' } },
      { status: 400 },
    ),
  });

  await assert.rejects(f.client.signIn('owner@example.test', 'wrong'), (error) => {
    assert.ok(error instanceof AuthRequestError);
    assert.equal(error.code, 'AUTH_INVALID_CREDENTIALS');
    assert.equal(error.status, 400);
    assert.equal(error.message, '邮箱或密码不正确');
    return true;
  });
});

test('a token response without a refresh token is rejected instead of mounting the dashboard', async () => {
  const f = fixture({
    '/api/v1/auth/crypto-key': () => Response.json({ success: true, data: cryptoKey() }),
    '/api/v1/auth/sign-in': () => Response.json({ success: true, data: tokenPayload({ refresh_token: undefined }) }),
  });

  await assert.rejects(f.client.signIn('owner@example.test', 'secret'), { code: 'AUTH_TOKEN_MISSING' });
});

test('an invalid API origin fails before any network request', async () => {
  const client = createAuthClient({ apiOrigin: 'http://api.example.test', fetcher: async () => Response.json({}) });
  await assert.rejects(client.refresh('refresh-token'), { code: 'INVALID_ORIGIN' });
});
