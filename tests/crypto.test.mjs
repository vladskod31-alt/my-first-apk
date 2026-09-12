import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, fingerprint, cleanPublicKey, makeHello, verifyHello, createSession, bytes64, from64, random64, passwordKey, passwordIndexKey, opaqueRecordId, sealRecord, openRecord } from '../web/lib/crypto.mjs';
import { peerIdForNickname } from '../web/lib/core.mjs';

async function pair() {
  const identities = await Promise.all([createIdentity(), createIdentity()]);
  const a = await makeHello({ id: await peerIdForNickname('alice'), name: 'alice', phone: '+380501234567' }, identities[0]);
  const b = await makeHello({ id: await peerIdForNickname('bob'), name: 'bob' }, identities[1]);
  await verifyHello(a.hello, a.hello.id); await verifyHello(b.hello, b.hello.id);
  return { a, b, identities, alice: await createSession(a, b.hello), bob: await createSession(b, a.hello) };
}

test('hello signs nickname, address and ephemeral keys, never a phone or private key', async () => {
  const { a, b, identities } = await pair();
  assert.equal(JSON.stringify(a.hello).includes('+380501234567'), false);
  assert.equal(JSON.stringify(a.hello).includes(identities[0].privateKey.d), false);
  assert.throws(() => cleanPublicKey(identities[0].privateKey));
  assert.match(await fingerprint(a.hello.identity), /^[a-f0-9]{64}$/);
  await assert.rejects(verifyHello({ ...a.hello, name: 'someone_else' }, a.hello.id), /CRYPTO_SIGNATURE/);
  await assert.rejects(verifyHello({ ...a.hello, ephemeral: b.hello.ephemeral }, a.hello.id), /CRYPTO_SIGNATURE/);
  await assert.rejects(verifyHello(a.hello, b.hello.id));
  await assert.rejects(verifyHello({ ...a.hello, v: 1 }, a.hello.id));
});
test('directional AES-256-GCM sessions exchange all packet types without plaintext', async () => {
  const { alice, bob } = await pair();
  for (const type of ['message', 'ack', 'read', 'read-ack', 'typing']) {
    const value = { v: 2, type, text: 'PRIVATE-Привіт 👋🏽', ids: ['some-message'] };
    const outbound = await alice.seal(value), inbound = await bob.seal(value);
    assert.notEqual(outbound.data, inbound.data);
    assert.equal(JSON.stringify(outbound).includes(value.text), false);
    assert.deepEqual(await bob.open(outbound), value);
    assert.deepEqual(await alice.open(inbound), value);
  }
});
test('tampering, direction reflection, replay and plaintext downgrade are rejected', async () => {
  const { alice, bob } = await pair();
  const box = await alice.seal({ v: 2, type: 'message', text: 'secret' });
  const bytes = from64(box.data); bytes[3] ^= 1;
  await assert.rejects(bob.open({ ...box, data: bytes64(bytes) }));
  await assert.rejects(bob.open({ ...box, counter: box.counter + 1 }));
  await assert.rejects(alice.open(box));
  await assert.rejects(bob.open({ v: 1, type: 'message', text: 'plaintext' }));
  assert.equal((await bob.open(box)).text, 'secret');
  await assert.rejects(bob.open(box), /CRYPTO_REPLAY/);
});
test('reconnection uses fresh ephemeral secrets and rejects old ciphertext', async () => {
  const { a, b, alice, identities } = await pair();
  const old = await alice.seal({ text: 'old session' });
  const a2 = await makeHello(a.hello, identities[0]), b2 = await makeHello(b.hello, identities[1]);
  assert.notDeepEqual(a2.hello.ephemeral, a.hello.ephemeral);
  const next = await createSession(b2, a2.hello);
  await assert.rejects(next.open(old));
  await assert.rejects(createSession(a, a.hello), /CRYPTO_INVALID/);
});
test('password vault records authenticate location, key, IV and ciphertext', async () => {
  const salt = random64(32), key = await passwordKey('a good long password', salt);
  assert.equal(key.algorithm.length, 256); assert.equal(key.extractable, false);
  const value = { phone: '+380501234567', text: 'PRIVATE HISTORY' };
  const box = await sealRecord(key, value, 'meta:profile');
  assert.deepEqual(await openRecord(key, box, 'meta:profile'), value);
  assert.notEqual((await sealRecord(key, value, 'meta:profile')).iv, box.iv);
  await assert.rejects(openRecord(key, box, 'meta:settings'));
  const other = await passwordKey('another long password', salt);
  await assert.rejects(openRecord(other, box, 'meta:profile'));
  await assert.rejects(passwordKey('short', salt));
  await assert.rejects(passwordKey('a good long password', salt, 1));
  const bytes = from64(box.data); bytes[0] ^= 1;
  await assert.rejects(openRecord(key, { ...box, data: bytes64(bytes) }, 'meta:profile'));
});
test('vault record IDs hide deterministic nickname addresses with a separate secret', async () => {
  const id = await peerIdForNickname('alice'), salt = random64(32);
  const key = await passwordIndexKey('a good long password', salt);
  const same = await passwordIndexKey('a good long password', salt);
  const other = await passwordIndexKey('another long password', salt);
  const opaque = await opaqueRecordId(key, id);
  assert.match(opaque, /^r-[a-f0-9]{64}$/);
  assert.equal(opaque, await opaqueRecordId(same, id));
  assert.notEqual(opaque, await opaqueRecordId(other, id));
  assert.notEqual(opaque, id);
});
