import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createCloudApi } from '../server/cloud.mjs';
import { CloudApi } from '../web/lib/cloud-api.mjs';
import { createIdentity, random64, hashHex } from '../web/lib/crypto.mjs';
import { peerIdForNickname } from '../web/lib/core.mjs';
import { createMailbox, makeBundle, verifyBundle, sealEnvelope, openEnvelope, verifyEnvelope, recoveryId, makeRecoveryBackup, openRecoveryBackup } from '../web/lib/cloud-crypto.mjs';

async function person(name) {
  const profile = { name, id: await peerIdForNickname(name), phone: '+380501234567' };
  const identity = await createIdentity(), mailbox = await createMailbox(), secret = random64(32), device = crypto.randomUUID();
  const bundle = await makeBundle(profile, identity, mailbox), backup = await makeRecoveryBackup(secret, profile, identity, mailbox);
  return { profile, identity, mailbox, secret, device, bundle, backup };
}
async function service(t, options = {}) {
  const cloud = createCloudApi({ filename: ':memory:', pollTimeout: 100, ...options }), app = express(); app.use('/api/cloud', cloud.router);
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, base = origin + '/api/cloud';
  t.after(async () => { await new Promise(resolve => server.close(resolve)); cloud.close(); });
  return { base, api: token => new CloudApi(base, token || '', origin) };
}
async function login(api, p, previous = '') {
  const session = await api.signIn(p.bundle, p.identity, p.device, p.backup, { notificationToken: previous }); api.token = session.token; return session;
}
async function message(from, to, text = 'CLOUD-PRIVATE-TEXT-1234') {
  const packet = { v: 2, type: 'message', id: crypto.randomUUID(), at: Date.now(), text };
  return { packet, incoming: await sealEnvelope(from.profile, from.identity, to.bundle, packet), outgoing: await sealEnvelope(from.profile, from.identity, from.bundle, packet, { peer: to.profile.id, peerName: to.profile.name, peerKey: to.identity.publicKey }) };
}

test('offline envelopes encrypt to an absent recipient and retain an independently encrypted sender archive', async () => {
  const a = await person('cloud_alice'), b = await person('cloud_bob'), boxes = await message(a, b);
  assert.equal((await openEnvelope(b.mailbox, b.profile.id, boxes.incoming, a.identity.publicKey)).packet.text, boxes.packet.text);
  assert.equal((await openEnvelope(a.mailbox, a.profile.id, boxes.outgoing, a.identity.publicKey)).packet.text, boxes.packet.text);
  for (const box of [boxes.incoming, boxes.outgoing]) {
    const serialized = JSON.stringify(box); assert.equal(serialized.includes(boxes.packet.text), false); assert.equal(serialized.includes(a.profile.phone), false); assert.equal(serialized.includes(a.identity.privateKey.d), false);
  }
  await assert.rejects(openEnvelope(a.mailbox, a.profile.id, boxes.incoming));
  await assert.rejects(verifyEnvelope({ ...boxes.incoming, data: 'AAAA' }));
  await assert.rejects(verifyEnvelope({ ...boxes.incoming, peerName: 'someone_else' }));
  await assert.rejects(verifyBundle({ ...a.bundle, encryption: b.mailbox.publicKey }));
});

test('cloud recovery contains only an encrypted key bundle and needs the exact secret', async () => {
  const a = await person('recover_alice');
  const value = await openRecoveryBackup(a.secret, a.backup);
  assert.deepEqual(value.identity, a.identity); assert.deepEqual(value.mailbox, a.mailbox);
  assert.equal(JSON.stringify(a.backup).includes(a.secret), false); assert.equal(JSON.stringify(a.backup).includes(a.identity.privateKey.d), false);
  await assert.rejects(openRecoveryBackup(random64(32), a.backup));
});

test('durable server inbox works without recipient session or browser; ciphertext restores from recovery', async t => {
  const host = await service(t), a = await person('alice'), b = await person('bob');
  const alice = host.api(), bob = host.api(); await login(alice, a); const bSession = await login(bob, b);
  // No Bob connection or page is active when Alice posts.
  const boxes = await message(a, b); assert.deepEqual(await alice.sendMessage(b.profile.id, boxes.incoming, boxes.outgoing), { stored: true, duplicate: false });
  const notifications = host.api(bSession.notificationToken);
  const notice = await notifications.request('/notifications?after=0&wait=0'); assert.equal(notice.count, 1); assert.equal(JSON.stringify(notice).includes(boxes.packet.text), false);
  const recovery = await host.api().recover(await recoveryId(b.secret));
  const restored = await openRecoveryBackup(b.secret, recovery.backup);
  const rebuilt = { ...b, ...restored, device: crypto.randomUUID() }; rebuilt.bundle = await makeBundle(restored.profile, restored.identity, restored.mailbox);
  const restoredApi = host.api(); await login(restoredApi, rebuilt);
  const history = await restoredApi.history(0); assert.equal(history.items.length, 1);
  assert.equal((await openEnvelope(restored.mailbox, restored.profile.id, history.items[0].envelope, a.identity.publicKey)).packet.text, boxes.packet.text);
  assert.equal((await alice.history(0)).items.length, 1);
});

test('full history and directory are inaccessible to notification-only tokens; HTTP retry is idempotent', async t => {
  const host = await service(t), a = await person('alice'), b = await person('bob');
  const alice = host.api(), bob = host.api(); await login(alice, a); const session = await login(bob, b);
  const limited = host.api(session.notificationToken); await assert.rejects(limited.history(0), /CLOUD_AUTH_REQUIRED/); await assert.rejects(limited.directory(a.profile.id), /CLOUD_AUTH_REQUIRED/);
  await assert.rejects(host.api().history(0), /CLOUD_AUTH_REQUIRED/);
  const boxes = await message(a, b); await alice.sendMessage(b.profile.id, boxes.incoming, boxes.outgoing);
  const result = await alice.sendMessage(b.profile.id, boxes.incoming, boxes.outgoing); assert.equal(result.duplicate, true);
  assert.equal((await bob.history(0)).items.length, 1);
  const ack = { v: 2, type: 'ack', id: boxes.packet.id };
  const envelope = await sealEnvelope(b.profile, b.identity, a.bundle, ack, { id: await hashHex('stable-ack') });
  await bob.sendControl(envelope); await bob.sendControl(envelope);
  assert.equal((await alice.history(0)).items.length, 2);
  const resumed = await alice.history((await alice.history(0)).cursor); assert.equal(resumed.items.length, 0);
});

test('registration prevents nickname/key takeover and keeps the notification token stable across unlocks', async t => {
  const host = await service(t), a = await person('alice'), impostor = await person('alice');
  const api = host.api(), session = await login(api, a);
  await assert.rejects(login(host.api(), impostor), /CLOUD_NICK_OWNED/);
  const next = await login(api, a, session.notificationToken); assert.equal(next.notificationToken, session.notificationToken);
  assert.equal((await host.api(session.notificationToken).request('/notifications?wait=0')).count, 0);
  await assert.rejects(host.api(session.token).history(0), /CLOUD_AUTH_REQUIRED/);
});

test('blocking is enforced on the relay and account removal revokes sessions without erasing the other user’s copy', async t => {
  const host = await service(t), a = await person('alice'), b = await person('bob');
  const alice = host.api(), bob = host.api(); await login(alice, a); const session = await login(bob, b);
  await bob.setBlocked([a.profile.id]); const boxes = await message(a, b);
  await assert.rejects(alice.sendMessage(b.profile.id, boxes.incoming, boxes.outgoing), /CONTACT_BLOCKED/);
  await bob.setBlocked([]); await alice.sendMessage(b.profile.id, boxes.incoming, boxes.outgoing);
  await bob.removeAccount(); await assert.rejects(bob.history(0), /CLOUD_AUTH_REQUIRED/);
  await assert.rejects(host.api(session.notificationToken).request('/notifications?wait=0'), /CLOUD_AUTH_REQUIRED/);
  assert.equal((await alice.history(0)).items.length, 1);
  await assert.rejects(host.api().recover(b.backup.id), /RECOVERY_NOT_FOUND/);
});

test('long polling announces new inbox events and wrong owner routing is rejected', async t => {
  const host = await service(t, { pollTimeout: 1000 }), a = await person('alice'), b = await person('bob');
  const alice = host.api(), bob = host.api(); await login(alice, a); const session = await login(bob, b);
  const pending = host.api(session.notificationToken).request('/notifications?after=0');
  const boxes = await message(a, b);
  await assert.rejects(alice.sendMessage(b.profile.id, boxes.outgoing, boxes.incoming), /CLOUD_INVALID/);
  await alice.sendMessage(b.profile.id, boxes.incoming, boxes.outgoing);
  assert.equal((await pending).count, 1);
});
