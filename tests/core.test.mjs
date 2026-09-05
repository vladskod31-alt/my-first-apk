import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePeerCode, makePeerId, normalizeName, validatePacket, parseSignalingUrl,
  makeIceServers, textExport, MAX_TEXT, MAX_IMAGE_DATA, safeFilename, initials, toPacket,
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
