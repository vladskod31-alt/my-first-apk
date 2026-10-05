import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateIdentity, serializeIdentity, deserializeIdentity, makeHello, verifyHello, Session,
  fingerprint, safetyNumber, makePairToken, parseInvite, formatInvite, encodeText, decodeText, wipeIdentity, b64,
} from '../web/lib/e2ee.mjs';
import { normalizePeerCode } from '../web/lib/core.mjs';

const A = 'libo-0123456789abcdef0123456789abcdef';
const B = 'libo-fedcba9876543210fedcba9876543210';

function pair(identityA = generateIdentity(), identityB = generateIdentity()) {
  const helloA = makeHello(identityA, A, B);
  const helloB = makeHello(identityB, B, A);
  const remoteForA = verifyHello(helloB.packet, B, A);
  const remoteForB = verifyHello(helloA.packet, A, B);
  assert.ok(remoteForA && remoteForB, 'signed hellos verify');
  const alice = Session.establish({ identity: identityA, ephemeral: helloA.ephemeral, remote: remoteForA, myId: A, peerId: B, initiator: true });
  const bob = Session.establish({ identity: identityB, ephemeral: helloB.ephemeral, remote: remoteForB, myId: B, peerId: A, initiator: false });
  return { alice, bob, identityA, identityB };
}
const send = (from, to, text) => decodeText(to.decrypt(from.encrypt(encodeText(text))));

test('identity round-trips through serialisation and rejects tampering', () => {
  const identity = generateIdentity();
  const stored = serializeIdentity(identity);
  assert.ok(deserializeIdentity(stored));
  assert.equal(deserializeIdentity({ ...stored, signPk: stored.dhPk }), null);
  assert.equal(deserializeIdentity(null), null);
  wipeIdentity(identity);
  assert.ok(identity.signSk.every(byte => byte === 0));
});

test('hello signatures bind both peer codes and both public keys', () => {
  const identity = generateIdentity();
  const { packet } = makeHello(identity, A, B);
  assert.ok(verifyHello(packet, A, B));
  assert.equal(verifyHello(packet, B, A), null, 'swapped direction');
  assert.equal(verifyHello({ ...packet, ek: packet.ik }, A, B), null, 'replaced ephemeral');
  assert.equal(verifyHello({ ...packet, sk: b64(generateIdentity().signPk) }, A, B), null, 'foreign identity');
  assert.equal(packet.tok, undefined);
  assert.equal(Object.keys(packet).some(key => /sk$|secret|priv/i.test(key) && key !== 'sk'), false);
});

test('double ratchet: both directions, fingerprints agree, keys rotate', () => {
  const { alice, bob } = pair();
  assert.equal(alice.fingerprint, bob.fingerprint);
  assert.ok(alice.canSend && !bob.canSend, 'responder waits for the first ratchet step');
  assert.equal(send(alice, bob, 'привет'), 'привет');
  assert.ok(bob.canSend);
  const first = b64(alice.dhsPk);
  assert.equal(send(bob, alice, 'и тебе'), 'и тебе');
  assert.notEqual(b64(alice.dhsPk), first, 'DH ratchet advanced on the reply');
  assert.equal(send(alice, bob, 'ещё'), 'ещё');
  for (let i = 0; i < 50; i++) { assert.equal(send(alice, bob, `a${i}`), `a${i}`); assert.equal(send(bob, alice, `b${i}`), `b${i}`); }
});

test('out-of-order delivery works, replay and tampering are rejected', () => {
  const { alice, bob } = pair();
  const one = alice.encrypt(encodeText('1'));
  const two = alice.encrypt(encodeText('2'));
  const three = alice.encrypt(encodeText('3'));
  assert.equal(decodeText(bob.decrypt(three)), '3');
  assert.equal(decodeText(bob.decrypt(one)), '1');
  assert.equal(bob.decrypt(one), null, 'replay of a consumed skipped key');
  assert.equal(bob.decrypt(three), null, 'replay of the newest message');
  const forged = { ...two, c: two.c.slice(0, -4) + (two.c.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
  assert.equal(bob.decrypt(forged), null, 'ciphertext tamper');
  assert.equal(decodeText(bob.decrypt(two)), '2', 'state survived the failed attempt');
  assert.equal(bob.decrypt({ v: 1, type: 'e2', h: 'short', c: two.c }), null);
});

test('messages never decrypt under another pair or a MITM identity', () => {
  const { alice } = pair();
  const { bob: stranger } = pair();
  assert.equal(stranger.decrypt(alice.encrypt(encodeText('secret'))), null);
  const identityA = generateIdentity();
  const identityB = generateIdentity();
  const mallory = generateIdentity();
  const helloA = makeHello(identityA, A, B);
  const forgedPacket = { ...helloA.packet, ik: b64(mallory.dhPk) };
  assert.equal(verifyHello(forgedPacket, A, B), null);
  assert.ok(verifyHello(makeHello(identityB, B, A).packet, B, A));
});

test('nonces are unique per message under the same session', () => {
  const { alice } = pair();
  const headers = new Set();
  for (let i = 0; i < 300; i++) headers.add(alice.encrypt(encodeText('x')).h);
  assert.equal(headers.size, 300);
});

test('too many skipped messages are refused without breaking the session', () => {
  const { alice, bob } = pair();
  for (let i = 0; i < 250; i++) alice.encrypt(encodeText('lost'));
  const late = alice.encrypt(encodeText('late'));
  assert.equal(bob.decrypt(late), null);
  const { alice: a2, bob: b2 } = pair();
  for (let i = 0; i < 150; i++) a2.encrypt(encodeText('lost'));
  assert.equal(decodeText(b2.decrypt(a2.encrypt(encodeText('ok')))), 'ok');
});

test('close wipes key material', () => {
  const { alice, bob } = pair();
  send(alice, bob, 'x');
  const rk = alice.rk;
  alice.close();
  assert.ok(rk.every(byte => byte === 0));
  assert.throws(() => alice.encrypt(encodeText('y')));
  assert.equal(alice.decrypt(bob.encrypt(encodeText('z'))), null);
});

test('fingerprints, safety numbers and invitations carry public data only', () => {
  const identity = generateIdentity();
  const pub = b64(identity.signPk);
  assert.match(fingerprint(pub), /^([0-9a-f]{4} ){7}[0-9a-f]{4}$/);
  const other = b64(generateIdentity().signPk);
  const number = safetyNumber(A, pub, B, other);
  assert.equal(number, safetyNumber(B, other, A, pub));
  assert.match(number, /^(\d{5} ){11}\d{5}$/);
  const { token } = makePairToken();
  const invite = formatInvite(A, identity, token);
  assert.ok(!invite.includes(b64(identity.signSk)) && !invite.includes(b64(identity.dhSk)));
  const parsed = parseInvite(invite, normalizePeerCode);
  assert.deepEqual(parsed, { id: A, signPk: pub, token });
  assert.deepEqual(parseInvite(`LIBO:${A}`, normalizePeerCode), { id: A, signPk: null, token: null });
  assert.equal(parseInvite(`LIBO:${A}#k=notbase64!!`, normalizePeerCode), null);
  assert.equal(parseInvite(`LIBO:${A}#t=<script>`, normalizePeerCode), null);
});
