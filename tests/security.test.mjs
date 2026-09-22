// Автоматические тесты безопасности LIBO 2.8.3.
// Покрывают требования: шифрование/дешифрование, обмен ключами, аутентификация,
// ротация сессии, отзыв, шифрование базы, неверный шифротекст, повтор, nonce reuse,
// MITM, перебор, повреждённые и чрезмерные сообщения, отозванное устройство/сессия,
// истёкший токен и смена ключа идентичности.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Identity, SecureSession, Ratchet, ReplayGuard, RateLimiter, SessionState, PairingToken,
  Password, SecureLogger, sanitizeError, hkdf, sha256, randomBytes, toB64, fromB64,
  constantTimeEqual, fingerprintOf, keyLabel, LIMITS, SEC_VERSION, ALGORITHMS, SESSION_STATES,
} from '../web/lib/security.mjs';

const peerId = 'libo-0123456789abcdef0123456789abcdef';
const peerId2 = 'libo-fedcba9876543210fedcba9876543210';

async function pair(conversationId = peerId) {
  const a = Identity.create();
  const b = Identity.create();
  const sa = new SecureSession({ identity: a, conversationId });
  const sb = new SecureSession({ identity: b, conversationId });
  await sb.acceptHello(await sa.hello());
  await sa.acceptHello(await sb.hello());
  return { a, b, sa, sb };
}

// У каждого сообщения свой messageId — так же, как в приложении (проверка повторов).
const packet = (text, id = crypto.randomUUID()) => ({
  v: 1, type: 'message', id, text, at: Date.now(), image: null, reply: null,
});

test('security: primitives use OS CSPRNG and never repeat random output', () => {
  const chunks = Array.from({ length: 64 }, () => toB64(randomBytes(32)));
  assert.equal(new Set(chunks).size, chunks.length);
  assert.equal(randomBytes(32).length, 32);
  // Документированный набор алгоритмов не содержит самодельных конструкций.
  assert.deepEqual(ALGORITHMS.keyExchange, 'X25519');
  assert.deepEqual(ALGORITHMS.signature, 'Ed25519');
  assert.equal(ALGORITHMS.aead, 'ChaCha20-Poly1305');
  assert.equal(SEC_VERSION, 3);
});

test('security: encryption and decryption roundtrip in both directions', async () => {
  const { sa, sb } = await pair();
  const first = await sa.seal(packet('привет'));
  const openedByB = await sb.open(first);
  assert.equal(openedByB.ok, true);
  assert.equal(openedByB.packet.text, 'привет');
  const second = await sb.seal(packet('ответ'));
  const openedByA = await sa.open(second);
  assert.equal(openedByA.packet.text, 'ответ');
});

test('security: key exchange derives the same root without extra packets', async () => {
  const { sa, sb } = await pair();
  assert.equal(sa.established, true);
  assert.equal(sb.established, true);
  // Роли различаются, поэтому отправляющие цепочки сторон никогда не совпадают.
  assert.notEqual(sa.ratchet.role, sb.ratchet.role);
  assert.equal(sa.ratchet.rootKey.length, 32);
  assert.equal(constantTimeEqual(sa.ratchet.rootKey, sb.ratchet.rootKey), true);
});

test('security: a third identity cannot join the conversation (MITM)', async () => {
  const { sa, sb } = await pair();
  // Мэллори подделывает подпись рукопожатия — проверка не проходит.
  const malloryIdentity = Identity.create();
  const mallory = new SecureSession({ identity: malloryIdentity, conversationId: peerId });
  const hello = await mallory.hello();
  const victim = new SecureSession({ identity: Identity.create(), conversationId: peerId });
  await assert.rejects(() => victim.acceptHello({ ...hello, sig: toB64(fromB64(hello.sig).fill(0)) }), /подпись/);
  assert.equal(victim.state.state, 'COMPROMISED');
  // Мэллори договаривается с другим устройством и шлёт конверт в чужую сессию:
  // подпись верна его ключу, но ключ не совпадает с закреплённым — конверт отклонён.
  const other = new SecureSession({ identity: Identity.create(), conversationId: peerId });
  await other.acceptHello(await mallory.hello());
  await mallory.acceptHello(await other.hello());
  const forged = await mallory.seal(packet('подмена'));
  assert.equal((await sb.open(forged)).ok, false);          // чужой получатель
  const targeted = await sb.open({ ...forged, messageId: crypto.randomUUID(), recipientKeyId: sb.localKeyId });
  assert.equal(targeted.ok, false);
  assert.equal(targeted.reason, 'identity');                 // подмена отправителя
  // Подмена отправителя переводит сессию в COMPROMISED: дальше трафик не принимается,
  // пока пользователь не подтвердит ключ заново.
  assert.equal(sb.state.state, 'COMPROMISED');
  const good = await sa.seal(packet('настоящее'));
  assert.equal((await sb.open(good)).reason, 'session');
  const reconnected = await pair();
  assert.equal((await reconnected.sb.open(await reconnected.sa.seal(packet('заново')))).ok, true);
});

test('security: invalid ciphertext and tags are rejected', async () => {
  const { sa, sb } = await pair();
  const env = await sa.seal(packet('данные'));
  const flip = text => `${text.slice(0, -4)}AAAA`;
  assert.equal((await sb.open({ ...env, messageId: crypto.randomUUID(), ciphertext: flip(env.ciphertext) })).reason, 'signature');
  const replayed = await sb.open(env);
  assert.equal(replayed.ok, true);
  const env2 = await sa.seal(packet('данные-2'));
  assert.equal((await sb.open({ ...env2, nonce: flip(env2.nonce) })).reason, 'signature');
  const env3 = await sa.seal(packet('данные-3'));
  assert.equal((await sb.open({ ...env3, authenticationTag: toB64(randomBytes(16)) })).reason, 'signature');
});

test('security: replay of a delivered envelope is refused', async () => {
  const { sa, sb } = await pair();
  const env = await sa.seal(packet('один раз'));
  assert.equal((await sb.open(env)).ok, true);
  assert.equal((await sb.open(env)).reason, 'replay');
  assert.equal((await sb.open({ ...env, timestamp: Date.now() })).reason, 'signature');
});

test('security: stale and future timestamps are refused', async () => {
  const guard = new ReplayGuard();
  assert.equal(guard.accept('abcdefgh-1', Date.now()), true);
  assert.equal(guard.accept('abcdefgh-2', Date.now() - LIMITS.CLOCK_SKEW_MS - 60_000), false);
  assert.equal(guard.accept('abcdefgh-3', Date.now() + LIMITS.CLOCK_SKEW_MS + 60_000), false);
  const { sa, sb } = await pair();
  const env = await sa.seal(packet('старое'));
  assert.equal((await sb.open({ ...env, timestamp: Date.now() - LIMITS.CLOCK_SKEW_MS - 1 })).reason, 'signature');
});

test('security: message keys are single use (no nonce or key reuse)', async () => {
  const { sa, sb } = await pair();
  const first = await sa.seal(packet('раз'));
  const second = await sa.seal(packet('два'));
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal((await sb.open(first)).ok, true);
  assert.equal((await sb.open(second)).ok, true);
  // Повторная доставка уже принятого конверта невозможна даже с новым messageId:
  // ключ сообщения и счётчик цепочки удалены после использования.
  const again = await sb.open({ ...first, messageId: crypto.randomUUID() });
  assert.equal(again.ok, false);
  // Ключ сообщения после использования не восстанавливается из цепочки.
  const { messageKey } = await sa.ratchet.nextMessageKey();
  assert.equal(constantTimeEqual(messageKey, sa.ratchet.sendChain), false);
});

test('security: out-of-order delivery works, excess skips are refused', async () => {
  const { sa, sb } = await pair();
  const one = await sa.seal(packet('1'));
  const two = await sa.seal(packet('2'));
  const three = await sa.seal(packet('3'));
  assert.equal((await sb.open(three)).ok, true);
  assert.equal((await sb.open(one)).ok, true);
  assert.equal((await sb.open(two)).ok, true);
  const many = [];
  for (let index = 0; index < LIMITS.MAX_SKIP + 4; index++) many.push(await sa.seal(packet(`s${index}`)));
  assert.equal((await sb.open(many.at(-1))).ok, false);   // пропуск больше разрешённого
  assert.equal((await sb.open(many[0])).ok, true);
});

test('security: ratchet rotates the chain after the limit and keeps both sides in sync', async () => {
  const { sa, sb } = await pair();
  for (let index = 0; index < LIMITS.MAX_CHAIN; index++) {
    const env = await sa.seal(packet(`msg-${index}`));
    assert.equal((await sb.open(env)).ok, true);
  }
  const beforeRekey = sa.ratchet.sendChain.slice();
  const beforeAge = sa.ratchet.createdAt;
  const env = await sa.seal(packet('после лимита цепочки'));
  const afterLimit = await sb.open(env);
  assert.equal(afterLimit.ok, true, `reason=${afterLimit.reason}`);
  assert.equal(constantTimeEqual(beforeRekey, sa.ratchet.sendChain), false, 'chain key must change');
  assert.equal(sa.ratchet.createdAt > beforeAge, true, 'key lifetime restarts');
  assert.equal(constantTimeEqual(sa.ratchet.sendChain, sb.ratchet.recvChain), true, 'цепи остаются зеркальными');
  assert.equal(sa.ratchet.messages, 1, 'counter resets after rekey');
  assert.equal(env.ratchet.gen, 1, 'envelope announces the new chain generation');
  assert.equal(sb.ratchet.gen, 1, 'receiver advanced to the same generation');
  assert.equal(env.ratchet.n, 0, 'message counter restarts in the new chain');
  // Обратное направление работает в новой генерации: собеседник тоже шлёт и ротирует.
  const reply = await sb.seal(packet('ответ'));
  assert.equal((await sa.open(reply)).ok, true, 'ответ собеседника в новой генерации');
  const second = await sb.seal(packet('ответ-2'));
  assert.equal((await sa.open(second)).ok, true);
});

// Ротация не должна давать возможности «прыгнуть» вперёд: завышенное поколение
// в подписанном заголовке отвергается, устаревшее — тоже.
test('security: chain generation outside the allowed range is rejected', async () => {
  const { sa, sb } = await pair();
  // Подмена поколения в конверте ломает подпись: заголовок покрыт Ed25519 и AAD.
  const env = await sa.seal(packet('сообщение'));
  const forged = { ...env, ratchet: { ...env.ratchet, gen: 1 } };
  assert.equal((await sb.open(forged)).reason, 'signature');
  assert.equal(sb.ratchet.gen, 0);
  // Легитимный отправитель не может «прыгнуть» на много поколений вперёд.
  const jumping = new SecureSession({ identity: sa.identity, conversationId: peerId });
  jumping.peerIdentity = sa.peerIdentity;
  jumping.ratchet = Object.assign(Object.create(Object.getPrototypeOf(sa.ratchet)), sa.ratchet);
  jumping.ratchet.gen = LIMITS.MAX_GEN_AHEAD + 2;
  const far = await jumping.seal(packet('далеко'));
  assert.equal((await sb.open(far)).reason, 'ratchet');
  assert.equal(sb.ratchet.gen, 0, 'отклонённый конверт не двигает поколение');
  // Ротация синхронна: получатель сам выводит ту же цепочку из подписанного заголовка.
  const oldGeneration = await sa.seal(packet('старая цепочка'));
  assert.equal((await sb.open(oldGeneration)).ok, true);
  await sa.ratchet.rotateForSend();
  const fresh = await sa.seal(packet('новая цепочка'));
  assert.equal(fresh.ratchet.gen, 1);
  assert.equal((await sb.open(fresh)).ok, true);
  assert.equal(sb.ratchet.gen, 1, 'получатель перешёл в новую генерацию');
  // Повтор старого конверта отвергается защитой от повторов (messageId уже принят).
  assert.equal((await sb.open(oldGeneration)).reason, 'replay');
});

test('security: forward secrecy — old keys cannot decrypt new messages', async () => {
  const { sa, sb } = await pair();
  const env = await sa.seal(packet('старое сообщение'));
  assert.equal((await sb.open(env)).ok, true);
  const staleRoot = sb.ratchet.rootKey.slice();
  const staleChain = sb.ratchet.sendChain ? sb.ratchet.sendChain.slice() : null;
  const fresh = await sa.seal(packet('новое сообщение'));
  assert.equal((await sb.open(fresh)).ok, true);
  // Скомпрометированный старый корневой ключ не даёт расшифровать новое сообщение.
  const stale = new SecureSession({ identity: sb.identity, conversationId: peerId });
  stale.peerIdentity = sb.peerIdentity;
  stale.ratchet = Object.assign(new Ratchet({ rootKey: staleRoot, selfPair: sb.ratchet.selfPair, remotePublic: sb.ratchet.remotePublic }), {});
  const attempt = await stale.open(fresh);
  assert.equal(attempt.ok, false);
  if (staleChain) assert.equal(constantTimeEqual(staleChain, sb.ratchet.sendChain ?? staleChain), false);
});

test('security: identity change stops the session and reports the new key', async () => {
  const { a, b, sa, sb } = await pair();
  const pinned = { keyId: b.keyId };
  const reinstall = new SecureSession({ identity: Identity.create(), conversationId: peerId });
  const attackerHello = await reinstall.hello();
  await assert.rejects(
    () => new SecureSession({ identity: a, conversationId: peerId }).acceptHello(attackerHello, { trusted: pinned }),
    error => error.code === 'IDENTITY_CHANGED' && error.identity.keyId !== pinned.keyId,
  );
  // Тот же ключ, что и раньше, принимается без предупреждения.
  const again = new SecureSession({ identity: a, conversationId: peerId });
  const identity = await again.acceptHello(await sb.hello(), { trusted: pinned });
  assert.equal(identity.keyId, b.keyId);
  assert.equal(sb.peerKeyId, a.keyId);
});

test('security: session states follow the documented transitions and revocation wins', async () => {
  const state = new SessionState('CONNECTING');
  assert.equal(state.transition('CONNECTED'), 'CONNECTED');
  assert.equal(state.transition('RECONNECTING'), 'RECONNECTING');
  assert.equal(state.transition('CONNECTED'), 'CONNECTED');
  assert.equal(state.transition('REVOKED'), 'REVOKED');
  // Из REVOKED нельзя «вернуться» в рабочее состояние.
  assert.equal(state.transition('CONNECTED'), 'REVOKED');
  assert.equal(state.revoked, true);
  const { sa, sb } = await pair();
  const env = await sa.seal(packet('до отзыва'));
  sb.state.transition('REVOKED');
  const after = await sb.open(env);
  assert.equal(after.ok, false);
  assert.equal(after.reason, 'session');
  assert.equal(SESSION_STATES.includes('COMPROMISED'), true);
});

test('security: brute force protection limits attempts per key', () => {
  let now = 1_000_000;
  const limiter = new RateLimiter({ capacity: 3, refillMs: 60_000, now: () => now });
  assert.equal(limiter.allow('lock').allowed, true);
  assert.equal(limiter.allow('lock').allowed, true);
  assert.equal(limiter.allow('lock').allowed, true);
  const blocked = limiter.allow('lock');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryInMs > 0);
  // Серия неудач ужесточает режим (экспоненциальная задержка), ключ остаётся заблокированным.
  for (let index = 0; index < 5; index++) limiter.failure('lock');
  assert.equal(limiter.state('lock').tokens, 0);
  assert.equal(limiter.failure('lock').locked, true);
  assert.equal(limiter.allow('другой-ключ').allowed, true, 'other keys stay usable');
  now += 5 * 60_000;
  assert.equal(limiter.allow('lock').allowed, true, 'bucket refills over time');
  limiter.reset('lock');
  assert.equal(limiter.state('lock').failures, 0);
});

test('security: malformed and oversized envelopes are refused', async () => {
  const { sa, sb } = await pair();
  const env = await sa.seal(packet('ok'));
  assert.equal((await sb.open(null)).reason, 'version');
  const revoked = await pair(peerId2);
  revoked.sb.state.transition('REVOKED');
  assert.equal((await revoked.sb.open(await revoked.sa.seal(packet('после отзыва')))).reason, 'session');
  assert.equal((await sb.open({ ...env, version: 2, messageId: crypto.randomUUID() })).reason, 'version');
  assert.equal((await sb.open({ ...env, messageId: crypto.randomUUID(), conversationId: peerId2 })).reason, 'conversation');
  assert.equal((await sb.open({ ...env, messageId: crypto.randomUUID(), recipientKeyId: 'abcdef' })).reason, 'recipient');
  assert.equal((await sb.open({ ...env, messageId: crypto.randomUUID(), ratchet: { dh: 'x' } })).reason, 'header');
  // Подмена отправителя — самая серьёзная проверка, поэтому она последняя: сессия
  // переходит в COMPROMISED и перестаёт принимать что-либо до подтверждения ключа.
  assert.equal((await sb.open({ ...env, messageId: crypto.randomUUID(), senderKeyId: 'deadbeef' })).reason, 'identity');
  await assert.rejects(() => sa.seal({ v: 1, type: 'message', id: 'x'.repeat(16), text: 'A'.repeat(LIMITS.MAX_PAYLOAD) }), /большое/);
});

test('security: password storage uses PBKDF2 with per-record salt, never plaintext', async () => {
  const record = await Password.hash('секретный-пароль', { iterations: 100_000 });
  assert.match(record, /^pbkdf2-sha256\$\d{6,}\$/);
  assert.equal(record.includes('секретный-пароль'), false);
  assert.equal(await Password.verify('секретный-пароль', record), true);
  assert.equal(await Password.verify('другой-пароль', record), false);
  const other = await Password.hash('секретный-пароль', { iterations: 100_000 });
  assert.notEqual(other, record, 'salt must be unique per record');
  assert.equal(await Password.verify('x', 'pbkdf2-sha256$1$aa$bb'), false, 'weak iteration count rejected');
  await assert.rejects(() => Password.hash('аб'), /длина/);
});

test('security: pairing tokens are single use, expire and keep secrets out of the QR', async () => {
  const now = 5_000_000;
  const token = await PairingToken.prepare(PairingToken.create({ ttlMs: 60_000, peerId, now }));
  const payload = PairingToken.qrPayload(token);
  assert.equal(payload.startsWith(`LIBO:pair=${peerId}#`), true);
  for (const forbidden of ['password', 'private', 'masterKey', 'refresh']) {
    assert.equal(payload.includes(forbidden), false);
  }
  assert.equal((await PairingToken.consume(token, 'подделка', now + 1)).ok, false);
  assert.equal((await PairingToken.consume(token, token.token, now + 1)).ok, true);
  // Токен одноразовый: повторное использование записи отклоняется.
  assert.equal((await PairingToken.consume(token, token.token, now + 2)).reason, 'used');
  assert.equal(PairingToken.expired(token, now + 60_001), true);
  assert.equal((await PairingToken.consume(token, token.token, now + 60_001)).reason, 'expired');
  // Хеш токена лежит в записи, сам токен в записи не хранится в открытом виде.
  assert.equal(token.hash.length, 64);
  assert.equal(JSON.stringify({ ...token, token: '' }).includes(token.token), false);
});

test('security: secure logger redacts secrets and stays quiet in release', () => {
  const lines = [];
  SecureLogger.setSink((level, message, details) => lines.push([level, message, details]));
  SecureLogger.setRelease(true);
  SecureLogger.debug('должно исчезнуть', { token: 'abc' });
  SecureLogger.info('событие', { privateKey: 'p', password: 'q', nonce: 'n', message: 'видно' });
  assert.equal(lines.length, 1);
  const [, , details] = lines[0];
  assert.equal(details.privateKey, '[redacted]');
  assert.equal(details.password, '[redacted]');
  assert.equal(details.nonce, '[redacted]');
  assert.equal(details.message, 'видно');
  SecureLogger.setRelease(false);
  SecureLogger.debug('видно в разработке');
  assert.equal(lines.length, 2);
  SecureLogger.setSink(null);
  SecureLogger.setRelease(true);
});

test('security: user-facing errors never leak internals', () => {
  const error = new Error('SQLITE_ERROR: no such table: users at /data/app/libo.db');
  error.code = 'RATE_LIMITED';
  assert.equal(sanitizeError(error), 'Слишком много попыток. Подождите и попробуйте снова.');
  const generic = sanitizeError(new Error('stack: /home/user/secret/path.js line 42'));
  assert.equal(generic.includes('/home/user'), false);
  assert.equal(generic.includes('stack'), false);
  assert.equal(sanitizeError(new Error('boom')), 'Не удалось выполнить действие. Попробуйте ещё раз.');
});

test('security: fingerprints and key labels are stable and do not reveal the key', async () => {
  const identity = Identity.create();
  const label = keyLabel(fromB64(toB64(identity.ed25519Public)));
  assert.equal(label, identity.keyId);
  const fingerprint = await fingerprintOf(identity.ed25519Public);
  assert.match(fingerprint, /^([0-9A-F]{4} ){11}[0-9A-F]{4}$/);
  assert.equal(fingerprint.includes(toB64(identity.ed25519Public)), false);
  assert.equal(identity.exportSecret().ed25519Secret.length > 0, true);
});

test('security: KDF is deterministic per input and domain-separated', async () => {
  const ikm = new TextEncoder().encode('материал');
  const salt = new TextEncoder().encode('соль');
  const one = await hkdf(ikm, salt, 'libo/v3/root', 32);
  const two = await hkdf(ikm, salt, 'libo/v3/root', 32);
  const other = await hkdf(ikm, salt, 'libo/v3/ratchet', 32);
  assert.equal(constantTimeEqual(one, two), true);
  assert.equal(constantTimeEqual(one, other), false);
  assert.equal(one.length, 32);
  assert.equal((await sha256(ikm)).length, 32);
});

test('security: identity persists through the vault encoding', async () => {
  const identity = Identity.create();
  const secret = identity.exportSecret();
  const restored = Identity.fromSecret({ ed25519Secret: secret.ed25519Secret, x25519Secret: secret.x25519Secret });
  assert.equal(restored.keyId, identity.keyId);
  assert.equal(restored.securityCode, identity.securityCode);
  const signature = restored.sign(new TextEncoder().encode('проверка'));
  assert.equal(constantTimeEqual(signature.slice(0, 8), identity.sign(new TextEncoder().encode('проверка')).slice(0, 8)), true);
});

// Регрессия: параллельные отправки обязаны получать разные ключи сообщений.
// До сериализации две одновременные операции читали одну и ту же цепочку ratchet
// и повторяли ключ — это классический nonce/key reuse.
test('security: concurrent sends never reuse a message key or nonce', async () => {
  const { sa, sb } = await pair();
  const envelopes = await Promise.all([
    sa.seal(packet('раз')), sa.seal(packet('два')), sa.seal(packet('три')),
    sa.seal(packet('четыре')), sa.seal(packet('пять')),
  ]);
  const nonces = new Set(envelopes.map(env => env.nonce));
  const tags = new Set(envelopes.map(env => env.authenticationTag));
  assert.equal(nonces.size, 5, 'nonce повторён');
  assert.equal(tags.size, 5, 'шифротекст повторён');
  assert.deepEqual(envelopes.map(env => env.ratchet.n), [0, 1, 2, 3, 4]);
  const opened = [];
  for (const env of envelopes) opened.push(await sb.open(env));
  assert.equal(opened.every(item => item.ok), true, JSON.stringify(opened));
  assert.deepEqual(opened.map(item => item.packet.text), ['раз', 'два', 'три', 'четыре', 'пять']);
});

// Регрессия: конверт несёт канонический идентификатор пары, одинаковый у обеих сторон
// (иначе подпись рукопожатия и AAD не совпадают при разных кодах собеседников).
test('security: canonical pair id makes asymmetric chat ids interoperable', async () => {
  const a = 'libo-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const b = 'libo-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const sa = new SecureSession({ identity: Identity.create(), conversationId: b, selfId: a });
  const sb = new SecureSession({ identity: Identity.create(), conversationId: a, selfId: b });
  await sb.acceptHello(await sa.hello());
  await sa.acceptHello(await sb.hello());
  const env = await sa.seal(packet('через разные коды'));
  assert.equal(env.conversationId, [a, b].sort().join('|'));
  const opened = await sb.open(env);
  assert.equal(opened.ok, true);
  const back = await sb.seal(packet('ответ'));
  assert.deepEqual((await sa.open(back)).packet.text, 'ответ');
});
