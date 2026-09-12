import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createAccountsApi, TwilioVerify } from '../server/accounts.mjs';
import { createIdentity, signText, fingerprint } from '../web/lib/crypto.mjs';
import { phoneProof, accountUrl } from '../web/lib/phone-api.mjs';

async function service(t, options = {}) {
  const sent = [];
  // Explicit unit-test dependency injection, never enabled by a runtime environment flag.
  const provider = { send: async phone => sent.push(phone), verify: async (_phone, code) => code === '654321' };
  const api = createAccountsApi({ filename: ':memory:', provider, ...options });
  const app = express(); app.use('/api', api.router); const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); api.close(); });
  async function request(route, body, token, method = body ? 'POST' : 'GET') {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }
  return { request, sent };
}
async function signup(request, phone, name, discoverable = false) {
  const identity = await createIdentity();
  const start = await request('/sms/request', { phone }); assert.equal(start.status, 200);
  const { id, nonce } = start.data, publicKey = identity.publicKey;
  const proof = await signText(identity, phoneProof(id, nonce, phone, name, publicKey, discoverable));
  const body = { challengeId: id, name, code: '654321', publicKey, proof, discoverable };
  const verified = await request('/sms/verify', body); assert.equal(verified.status, 200);
  return { ...verified.data, body, identity };
}
test('SMS stays unavailable without a real configured provider; no fake codes', async t => {
  const { request } = await service(t, { provider: null });
  assert.equal((await request('/features')).data.sms, false);
  const result = await request('/sms/request', { phone: '+12025550123' });
  assert.equal(result.status, 503); assert.equal(result.data.error, 'SMS_NOT_CONFIGURED');
  assert.equal((await request('/sms/verify', { code: '000000' })).status, 503);
});
test('SMS binds a verified phone to its signing key; lookup requires authentication and opt-in', async t => {
  const { request, sent } = await service(t);
  const alice = await signup(request, '+12025550123', 'alice');
  const bob = await signup(request, '+12025550124', 'bob');
  assert.deepEqual(sent, ['+12025550123', '+12025550124']);
  assert.equal(alice.account.verified, true); assert.equal(alice.account.discoverable, false);
  assert.equal(alice.account.fingerprint, await fingerprint(alice.identity.publicKey));
  assert.equal((await request('/contacts/find', { phone: bob.account.phone })).status, 401);
  assert.equal((await request('/contacts/find', { phone: bob.account.phone }, alice.token)).status, 404);
  assert.equal((await request('/me', { discoverable: true }, bob.token, 'PATCH')).status, 200);
  const found = await request('/contacts/find', { phone: bob.account.phone }, alice.token);
  assert.equal(found.status, 200); assert.equal(found.data.contact.fingerprint, await fingerprint(bob.identity.publicKey));
  assert.equal((await request('/sms/verify', alice.body)).status, 400);
  assert.equal((await request('/me', undefined, bob.token, 'DELETE')).status, 200);
  assert.equal((await request('/me', undefined, bob.token)).status, 401);
  assert.equal((await request('/contacts/find', { phone: bob.account.phone }, alice.token)).status, 404);
});
test('SMS requests are throttled and wrong codes cannot verify an account', async t => {
  const { request } = await service(t);
  const phone = '+12025550123', name = 'alice', identity = await createIdentity();
  const challenge = (await request('/sms/request', { phone })).data;
  assert.equal((await request('/sms/request', { phone })).status, 429);
  const proof = await signText(identity, phoneProof(challenge.id, challenge.nonce, phone, name, identity.publicKey, false));
  const body = { challengeId: challenge.id, name, code: '000000', publicKey: identity.publicKey, proof, discoverable: false };
  for (let i = 0; i < 5; i++) assert.equal((await request('/sms/verify', body)).data.error, 'SMS_CODE_INVALID');
  assert.equal((await request('/sms/verify', { ...body, code: '654321' })).data.error, 'SMS_CHALLENGE_INVALID');
});
test('verification rejects substituted names/keys and cannot be redeemed concurrently twice', async t => {
  const { request } = await service(t);
  const phone = '+12025550123', name = 'alice', identity = await createIdentity();
  const challenge = (await request('/sms/request', { phone })).data;
  const proof = await signText(identity, phoneProof(challenge.id, challenge.nonce, phone, name, identity.publicKey, false));
  const body = { challengeId: challenge.id, name, code: '654321', publicKey: identity.publicKey, proof, discoverable: false };
  assert.equal((await request('/sms/verify', { ...body, name: 'mallory' })).data.error, 'CRYPTO_SIGNATURE');
  const result = await Promise.all([request('/sms/verify', body), request('/sms/verify', body)]);
  assert.deepEqual(result.map(r => r.status).sort(), [200, 400]);
});
test('challenge expiry and private beta daily cost limits are enforced', async t => {
  let now = 1788600000000;
  const { request } = await service(t, { now: () => now, maxDaily: 1 });
  const challenge = (await request('/sms/request', { phone: '+12025550123' })).data;
  assert.equal((await request('/sms/request', { phone: '+12025550124' })).status, 429);
  now += 301_000;
  assert.equal((await request('/sms/verify', { challengeId: challenge.id })).data.error, 'SMS_CHALLENGE_INVALID');
});
test('account URL policy rejects plaintext, injected credentials and non-HTTPS remote servers', () => {
  assert.equal(accountUrl('https://accounts.example/api/'), 'https://accounts.example/api');
  assert.equal(accountUrl('http://127.0.0.1:5173/api', 'http://127.0.0.1:5173'), 'http://127.0.0.1:5173/api');
  for (const value of ['', 'http://accounts.example', 'https://u:p@accounts.example', 'https://accounts.example?q=x', 'javascript:alert(1)']) assert.throws(() => accountUrl(value));
});
test('Twilio adapter uses the Verify service and only accepts approved checks', async t => {
  const calls = [], original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ status: calls.length === 2 ? 'approved' : 'pending' }) }; };
  const provider = new TwilioVerify({ accountSid: 'AC-test', authToken: 'unit-test-only', serviceSid: 'VA-test' });
  await provider.send('+12025550123'); assert.equal(await provider.verify('+12025550123', '123456'), true);
  assert.equal(await provider.verify('+12025550123', '123456'), false);
  assert.equal(calls[0].url, 'https://verify.twilio.com/v2/Services/VA-test/Verifications');
  assert.equal(calls[1].url, 'https://verify.twilio.com/v2/Services/VA-test/VerificationCheck');
  assert.equal(calls[0].options.body.get('Channel'), 'sms'); assert.match(calls[0].options.headers.Authorization, /^Basic /);
});
