import test from 'node:test';
import assert from 'node:assert/strict';
import { MtSession } from '../web/lib/mtproto.mjs';
import {
  normalizePeerCode, makePeerId, normalizeName, validatePacket, parseSignalingUrl,
  makeIceServers, textExport, MAX_TEXT, MAX_IMAGE_DATA, MAX_ATT_DATA, safeFilename, initials, toPacket, verificationCode,
  makeEditPacket, makeDeletePacket, makePinPacket, makeReactPacket,
  mergePollVote, pollTally, REACTIONS,
  // 2.8.2 helpers
  richTokens, plainText, hashtags, previewText, scheduleAt, isNightNow,
  hasVoted, votesOf, FEATURES, VERSION, APK_URL, DEFAULT_REACTION, SCHEDULE_PRESETS,
} from '../web/lib/core.mjs';

const peerId = 'libo-0123456789abcdef0123456789abcdef';
const message = { v: 1, type: 'message', id: '01234567-89ab-cdef-0123-456789abcdef', text: 'Привет! 👋', at: 1788591600000 };

test('random peer identities are valid and distinct', () => {
  const ids = new Set(Array.from({ length: 500 }, makePeerId));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.equal(normalizePeerCode(id), id);
});
test('accepts full contact codes, case and harmless surrounding whitespace', () => {
  assert.equal(normalizePeerCode(`  LIBO:${peerId.toUpperCase()}\n`), peerId);
  assert.equal(normalizePeerCode(peerId), peerId);
});
test('rejects partial, URL, HTML, self-invoking or overlong codes', () => {
  for (const value of [null, {}, 'libo-12', `https://example.com/${peerId}`, `<b>${peerId}</b>`, `${peerId}?x=1`, 'x'.repeat(513)]) assert.equal(normalizePeerCode(value), null);
});
test('names and file names are bounded', () => {
  assert.equal(normalizeName('  Аня\u0000  '), 'Аня');
  assert.equal(normalizeName('а'.repeat(200)).length, 40);
  assert.equal(initials('Анна Мария'), 'АМ');
  assert.equal(safeFilename('a/../b\\x.json'), 'a_.._b_x.json');
  assert.ok(safeFilename('ф'.repeat(200)).length <= 90);
});
test('validates and copies message packets without arbitrary fields', () => {
  const packet = validatePacket({ ...message, admin: true, __private: 'secret' });
  assert.deepEqual(packet, { ...message, image: null, reply: null });
  assert.equal(packet.admin, undefined);
});
test('rejects invalid packet types and protocol versions', () => {
  for (const value of [null, [], 'message', { ...message, v: 2 }, { ...message, type: 'eval' }]) assert.equal(validatePacket(value), null);
});
test('message IDs, text, timestamps and limits are mandatory', () => {
  for (const replacement of [
    { id: '<script>' }, { text: '' }, { text: '  ' }, { text: [] }, { text: 'x'.repeat(MAX_TEXT + 1) },
    { at: NaN }, { at: -1 }, { at: Infinity }, { at: 1.2 }, { at: 8_640_000_000_000_001 },
  ]) assert.equal(validatePacket({ ...message, ...replacement }), null);
  assert.ok(validatePacket({ ...message, text: 'x'.repeat(MAX_TEXT) }));
});
test('allows bounded raster photos; rejects remote images and SVG', () => {
  assert.ok(validatePacket({ ...message, text: '', image: { data: 'data:image/png;base64,aGVsbG8=', name: 'photo.png' } }));
  for (const data of ['https://tracker.example/image.png', 'data:image/svg+xml;base64,YQ==', 'data:text/html;base64,YQ==', `data:image/jpeg;base64,${'a'.repeat(MAX_IMAGE_DATA)}`]) {
    assert.equal(validatePacket({ ...message, image: { data, name: 'a' } }), null);
  }
});
test('replies are copied and bounded', () => {
  const reply = { name: 'Аня', text: 'До встречи!' };
  assert.deepEqual(validatePacket({ ...message, reply }).reply, reply);
  assert.equal(validatePacket({ ...message, reply: { ...reply, text: 'x'.repeat(161) } }), null);
  assert.equal(validatePacket({ ...message, reply: { ...reply, name: 'x'.repeat(41) } }), null);
});
test('ACKs only acknowledge well-formed message IDs', () => {
  assert.deepEqual(validatePacket({ v: 1, type: 'ack', id: message.id }), { v: 1, type: 'ack', id: message.id });
  assert.equal(validatePacket({ v: 1, type: 'ack', id: '' }), null);
});
test('hello must identify a LIBO peer, typing must be boolean', () => {
  assert.ok(validatePacket({ v: 1, type: 'hello', id: peerId, name: 'Аня' }));
  assert.equal(validatePacket({ v: 1, type: 'hello', id: 'fake', name: 'Аня' }), null);
  assert.equal(validatePacket({ v: 1, type: 'hello', id: peerId, name: ' ' }), null);
  assert.equal(validatePacket({ v: 1, type: 'typing', active: 'yes' }), null);
  assert.deepEqual(validatePacket({ v: 1, type: 'typing', active: false }), { v: 1, type: 'typing', active: false });
});
test('outgoing serialization excludes local state', () => {
  const packet = toPacket({ ...message, status: 'local', direction: 'out', secret: 'private' });
  assert.equal(packet.status, undefined);
  assert.equal(packet.secret, undefined);
  assert.ok(validatePacket(packet));
});
test('HTTPS signaling uses the correct host, port and path', () => {
  assert.deepEqual(parseSignalingUrl('https://0.peerjs.com'), { host: '0.peerjs.com', port: 443, path: '/', secure: true });
  assert.deepEqual(parseSignalingUrl('https://chat.example:8443/signal'), { host: 'chat.example', port: 8443, path: '/signal/', secure: true });
});
test('rejects insecure signaling, embedded secrets and URL injection', () => {
  for (const value of ['http://example.com', 'javascript:alert(1)', 'file:///data', 'https://user:pass@example.com', 'https://example.com?secret=x', 'https://example.com#x']) {
    assert.throws(() => parseSignalingUrl(value));
  }
});
test('HTTP only allowed for same-origin local development', () => {
  assert.equal(parseSignalingUrl('http://127.0.0.1:5173/peerjs', 'http://127.0.0.1:5173').secure, false);
  assert.throws(() => parseSignalingUrl('http://127.0.0.1:9000', 'http://127.0.0.1:5173'));
  assert.throws(() => parseSignalingUrl('http://other.example', 'http://other.example'));
});
test('TURN needs a valid URL and credentials', () => {
  assert.equal(makeIceServers({}).length, 2);
  assert.equal(makeIceServers({ turnUrl: 'turn:relay.example:3478?transport=tcp', turnUser: 'u', turnPassword: 'p' }).length, 3);
  assert.throws(() => makeIceServers({ turnUrl: 'https://not-turn.example', turnUser: 'u', turnPassword: 'p' }));
  assert.throws(() => makeIceServers({ turnUrl: 'turn:relay.example:3478' }));
});
test('text exports never leak identity, TURN credentials or photo bytes', () => {
  const json = textExport([{ id: peerId, name: 'Друг', messages: [{ ...message, image: { data: 'private-image', name: 'photo.jpg' }, direction: 'out', status: 'delivered' }] }], { id: peerId, name: 'Аня' });
  assert.ok(!json.includes(peerId));
  assert.ok(!json.includes('private-image'));
  const data = JSON.parse(json);
  assert.equal(data.chats[0].messages[0].photoFilename, 'photo.jpg');
  assert.equal(data.chats[0].messages[0].text, message.text);
});

test('verification code is stable, symmetric and unambiguous', async () => {
  const a = 'libo-0123456789abcdef0123456789abcdef';
  const b = 'libo-ffffffffffffffffffffffffffffffff';
  const first = await verificationCode(a, b);
  assert.match(first, /^[2-9A-HJ-NP-Z]{4} [2-9A-HJ-NP-Z]{4} [2-9A-HJ-NP-Z]{4}$/);
  assert.equal(await verificationCode(b, a), first, 'order must not matter');
  assert.equal(await verificationCode(a, b), first, 'repeated calls must be stable');
  assert.notEqual(await verificationCode(a, 'libo-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'), first);
  assert.notEqual(await verificationCode(a, a.toUpperCase()), undefined);
  assert.ok(!/[01OIL]/.test(first), 'no visually ambiguous characters');
});

test('verification code depends on both identities', async () => {
  const seen = new Set();
  for (let index = 0; index < 40; index++) {
    const other = makePeerId();
    seen.add(await verificationCode(peerId, other));
  }
  assert.equal(seen.size, 40);
});

test('2.5.0 control packets validate and reject malformed input', () => {
  const id = '01234567-89ab-cdef-0123-456789abcdef';
  assert.deepEqual(validatePacket(makeEditPacket(id, 'новый текст', 123)), { v: 1, type: 'edit', id, text: 'новый текст', editedAt: 123 });
  assert.equal(validatePacket(makeEditPacket(id, '   ', 123)), null);
  assert.deepEqual(validatePacket(makeDeletePacket([id, id])), { v: 1, type: 'delete', ids: [id, id] });
  assert.equal(validatePacket(makeDeletePacket([])), null);
  assert.equal(validatePacket({ v: 1, type: 'delete', ids: ['x'] }), null);
  assert.deepEqual(validatePacket(makePinPacket(id, true)), { v: 1, type: 'pin', id, pinned: true });
  assert.equal(validatePacket({ v: 1, type: 'pin', id, pinned: 'yes' }), null);
  assert.deepEqual(validatePacket(makeReactPacket(id, 'heart', true)), { v: 1, type: 'react', id, key: 'heart', on: true });
  assert.equal(validatePacket(makeReactPacket(id, 'not-a-reaction', true)), null);
  assert.equal(REACTIONS.length, 6);
});

test('attachments are bounded and mime-checked', () => {
  const id = '01234567-89ab-cdef-0123-456789abcdef';
  const base = { v: 1, type: 'message', id, text: '', at: 99 };
  const voice = validatePacket({ ...base, att: { kind: 'voice', data: 'data:audio/webm;base64,AAAA', dur: 5000 } });
  assert.equal(voice.att.kind, 'voice');
  assert.equal(voice.att.dur, 5000);
  assert.equal(validatePacket({ ...base, att: { kind: 'voice', data: 'data:video/mp4;base64,AAAA' } }), null);
  assert.equal(validatePacket({ ...base, att: { kind: 'file', data: 'x'.repeat(MAX_ATT_DATA + 10) } }), null);
  const file = validatePacket({ ...base, att: { kind: 'file', data: 'data:application/pdf;base64,AAAA', name: 'док.pdf' } });
  assert.equal(file.att.mime, 'application/pdf');
  const packet = toPacket({ id, text: 'привет', at: 1, att: { kind: 'voice', data: 'data:audio/webm;base64,AAAA', name: 'v.webm', mime: 'audio/webm' }, editedAt: 2 });
  assert.equal(validatePacket(packet).att.kind, 'voice');
  assert.equal(validatePacket(packet).editedAt, 2);
});

test('mt session seals, rejects replays and tampering, shares fingerprint', async () => {
  const a = await MtSession.create();
  const b = await MtSession.create();
  await a.accept(await b.publicKey());
  await b.accept(await a.publicKey());
  assert.equal(a.fingerprint, b.fingerprint);
  assert.match(a.fingerprint, /^[0-9a-f]{8}$/);
  const inner = { v: 1, type: 'message', id: '01234567-89ab-cdef-0123-456789abcdef', text: 'секрет', at: 1, image: null, reply: null };
  const envelope = await a.seal(inner);
  assert.equal(envelope.type, 'mt');
  assert.equal(validatePacket(envelope).type, 'mt');
  const opened = await b.open(envelope);
  assert.equal(opened.text, 'секрет');
  assert.equal(await b.open(envelope), null, 'replay must be rejected');
  const tampered = { ...envelope, ct: envelope.ct.slice(0, -4) + 'AAAA' };
  assert.equal(await b.open(tampered), null, 'tampered ciphertext must be rejected');
  assert.equal(await b.open({ ...envelope, mk: 'AAAA'.repeat(4) }), null);
});

test('poll tally and vote merge are pure and bounded', () => {
  const att = { kind: 'poll', q: 'Куда идём?', opts: ['В парк', 'В кино', 'Домой'], votes: {} };
  assert.deepEqual(pollTally(att), [0, 0, 0]);
  let votes = mergePollVote(att.votes, 'mine', 1);
  votes = mergePollVote(votes, 'theirs', 1);
  assert.deepEqual(pollTally({ ...att, votes }), [0, 2, 0]);
  votes = mergePollVote(votes, 'mine', 0);
  assert.deepEqual(pollTally({ ...att, votes }), [1, 1, 0]);
  votes = mergePollVote(votes, 'theirs', -1);
  assert.deepEqual(pollTally({ ...att, votes }), [1, 0, 0]);
  const packet = validatePacket({ v: 1, type: 'pollvote', pid: '01234567-89ab-cdef-0123-456789abcdef', opt: 2 });
  assert.equal(packet.opt, 2);
  assert.equal(validatePacket({ v: 1, type: 'pollvote', pid: 'x', opt: 2 }), null);
  assert.equal(validatePacket({ v: 1, type: 'pollvote', pid: '01234567-89ab-cdef-0123-456789abcdef', opt: 9 }), null);
});

test('2.8.1 packets: poll message, ttl bounds, forward label, read marker', () => {
  const id = '01234567-89ab-cdef-0123-456789abcdef';
  const poll = validatePacket({ v: 1, type: 'message', id, text: '', at: 5, att: { kind: 'poll', q: 'Чай?', opts: ['Да', 'Нет'] } });
  assert.equal(poll.att.kind, 'poll');
  assert.deepEqual(poll.att.votes, {});
  assert.equal(validatePacket({ v: 1, type: 'message', id, text: '', at: 5, att: { kind: 'poll', q: 'Чай?', opts: ['Один'] } }), null);
  const ttl = validatePacket({ v: 1, type: 'message', id, text: 'миг', at: 5, ttl: 60 });
  assert.equal(ttl.ttl, 60);
  assert.equal(validatePacket({ v: 1, type: 'message', id, text: 'миг', at: 5, ttl: 13 }).ttl, undefined);
  const fwd = validatePacket({ v: 1, type: 'message', id, text: 'привет', at: 5, fwd: { from: 'Аня' } });
  assert.equal(fwd.fwd.from, 'Аня');
  assert.equal(validatePacket({ v: 1, type: 'message', id, text: 'привет', at: 5, fwd: { from: '' } }), null);
  assert.equal(validatePacket({ v: 1, type: 'read', upTo: 123 }).upTo, 123);
  assert.equal(validatePacket({ v: 1, type: 'read', upTo: -1 }), null);
  assert.equal(validatePacket({ v: 1, type: 'mt-hello', pub: 'AAAA' }).pub, 'AAAA');
});

test('2.8.2 markup is tokenized, spoilers hidden and markers stripped from previews', () => {
  const tokens = richTokens('Привет **жирный** _курсив_ ~~зачёркнутый~~ `моно` ||спойлер||');
  assert.deepEqual(
    tokens.filter(token => token.type !== 'text').map(token => [token.type, token.text]),
    [['bold', 'жирный'], ['italic', 'курсив'], ['strike', 'зачёркнутый'], ['mono', 'моно'], ['spoiler', 'спойлер']],
  );
  assert.equal(plainText('**важно** и `код`'), 'важно и код');
  assert.equal(plainText('<b>это не разметка</b>'), '<b>это не разметка</b>');
  assert.equal(plainText('__под ним__ и ~старое~'), 'под ним и старое');
  // Unterminated or empty markup stays literal text.
  assert.deepEqual(richTokens('**без конца'), [{ type: 'text', text: '**без конца' }]);
  const links = richTokens('открой https://example.com/page, там всё');
  assert.deepEqual(links.filter(token => token.type === 'link').map(token => token.text), ['https://example.com/page']);
  assert.deepEqual(hashtags('про #Работа и #работа, ещё #идея_2026'), ['#работа', '#идея_2026']);
  assert.equal(previewText({ direction: 'out', text: '**важно** про ||тайну||' }), 'Вы: важно про тайну');
  assert.equal(previewText({ direction: 'in', text: '', att: { kind: 'voice' } }), '🎤 Голосовое');
  assert.equal(previewText(null), 'Начните с простого «привет»');
});

test('2.8.2 schedule presets resolve to absolute local times', () => {
  const now = new Date(2026, 8, 22, 10, 0, 0).getTime();
  assert.equal(scheduleAt('1m', now), now + 60_000);
  assert.equal(scheduleAt('5m', now), now + 300_000);
  assert.equal(scheduleAt('1h', now), now + 3_600_000);
  assert.equal(scheduleAt('unknown', now), null);
  const evening = new Date(scheduleAt('evening', now));
  assert.equal(evening.getHours(), 19);
  assert.equal(evening.getDate(), 22);
  const afterEvening = new Date(2026, 8, 22, 23, 30).getTime();
  assert.equal(new Date(scheduleAt('evening', afterEvening)).getDate(), 23);
  const morning = new Date(scheduleAt('morning', now));
  assert.equal(morning.getHours(), 9);
  assert.equal(morning.getDate(), 23);
  assert.equal(SCHEDULE_PRESETS.length, 5);
});

test('2.8.2 night theme window crosses midnight and ignores broken input', () => {
  const at = (hours, minutes = 0) => new Date(2026, 8, 22, hours, minutes).getTime();
  assert.equal(isNightNow(at(23), '22:00', '07:00'), true);
  assert.equal(isNightNow(at(3), '22:00', '07:00'), true);
  assert.equal(isNightNow(at(7), '22:00', '07:00'), false);
  assert.equal(isNightNow(at(12), '22:00', '07:00'), false);
  assert.equal(isNightNow(at(12), '09:00', '18:00'), true);
  assert.equal(isNightNow(at(20), '09:00', '18:00'), false);
  assert.equal(isNightNow(at(12), '12:00', '12:00'), false);
  assert.equal(isNightNow(at(12), '25:00', '18:00'), false);
});

test('2.8.2 polls support quiz answers and multiple choices', () => {
  const id = '01234567-89ab-cdef-0123-456789abcdef';
  const quiz = validatePacket({ v: 1, type: 'message', id, text: '', at: 5, att: { kind: 'poll', q: '2+2?', opts: ['3', '4'], quiz: true, correct: 1 } });
  assert.equal(quiz.att.quiz, true);
  assert.equal(quiz.att.correct, 1);
  assert.equal(validatePacket({ v: 1, type: 'message', id, text: '', at: 5, att: { kind: 'poll', q: '2+2?', opts: ['3', '4'], quiz: true, correct: 7 } }), null);
  assert.equal(validatePacket({ v: 1, type: 'message', id, text: '', at: 5, att: { kind: 'poll', q: '2+2?', opts: ['3', '4'], quiz: true } }), null);
  const multi = validatePacket({ v: 1, type: 'message', id, text: '', at: 5, att: { kind: 'poll', q: 'Что взять?', opts: ['Палатку', 'Спальник', 'Термос'], multi: true } });
  assert.equal(multi.att.multi, true);
  const votes = mergePollVote(multi.att.votes, 'mine', [0, 2]);
  assert.deepEqual(votes.mine, [0, 2]);
  assert.deepEqual(pollTally({ ...multi.att, votes }), [1, 0, 1]);
  assert.equal(hasVoted(votes, 'mine', 2), true);
  assert.equal(hasVoted(votes, 'mine', 1), false);
  assert.deepEqual(votesOf(votes, 'mine'), [0, 2]);
  assert.deepEqual(pollTally({ ...multi.att, votes: mergePollVote(votes, 'mine', []) }), [0, 0, 0]);
  assert.deepEqual(validatePacket({ v: 1, type: 'pollvote', pid: id, opt: [2, 0] }).opt, [0, 2]);
  assert.equal(validatePacket({ v: 1, type: 'pollvote', pid: id, opt: [0, 0] }), null);
  assert.equal(validatePacket({ v: 1, type: 'pollvote', pid: id, opt: [9] }), null);
  assert.equal(validatePacket({ v: 1, type: 'pollvote', pid: id, opt: [] }), null);
});

test('2.8.2 silent flag and quoted replies survive validation, schedule stays local', () => {
  const id = '01234567-89ab-cdef-0123-456789abcdef';
  const silent = validatePacket({ v: 1, type: 'message', id, text: 'тсс', at: 5, silent: true, admin: 'x' });
  assert.equal(silent.silent, true);
  assert.equal(silent.admin, undefined);
  assert.equal(validatePacket({ v: 1, type: 'message', id, text: 'обычное', at: 5, silent: 'yes' }).silent, undefined);
  const quoted = validatePacket({ v: 1, type: 'message', id, text: 'ответ', at: 5, reply: { name: 'Аня', text: 'Привет!', quote: '  Привет  ' } });
  assert.equal(quoted.reply.quote, 'Привет');
  assert.equal(validatePacket({ v: 1, type: 'message', id, text: 'ответ', at: 5, reply: { name: 'Аня', text: 'Привет!', quote: 'x'.repeat(401) } }), null);
  const packet = toPacket({ id, text: 'тсс', at: 5, silent: true, scheduledAt: 123, status: 'scheduled' });
  assert.equal(packet.silent, true);
  assert.equal(packet.scheduledAt, undefined);
  assert.ok(validatePacket(packet));
});

test('2.8.2 ships version 2.8.2, its APK link and fourteen advertised features', () => {
  assert.equal(VERSION, '2.8.2');
  assert.match(APK_URL, /refs\/tags\/v2\.8\.2\/downloads\/LIBO-2\.8\.2\.apk$/);
  assert.equal(Object.keys(FEATURES).length, 14);
  assert.equal(DEFAULT_REACTION, 'heart');
  assert.ok(REACTIONS.includes(DEFAULT_REACTION));
  for (const text of Object.values(FEATURES)) assert.ok(text.length > 20 && text.length < 200);
});
