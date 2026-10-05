import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Calls } from '../web/lib/calls.mjs';
import { validatePacket } from '../web/lib/core.mjs';
const id = '12345678-1234-1234-1234-123456789012';
const offer = { v: 1, type: 'call', id, action: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' };
function setup(extra = {}) {
  const sent = [], audio = { srcObject: null };
  const c = new Calls({ transport: { send: async (peer, p) => { sent.push(p); return true; }, e2Status: () => ({ canSend: true }) }, allowed: () => true, iceServers: () => [], change: () => {}, audio, ...extra });
  return { c, sent, audio };
}
test('call packets are bounded and audio-only, strip unknown fields', () => {
  assert.deepEqual(validatePacket({ ...offer, secret: 1 }), offer);
  for (const p of [{ ...offer, id: 'bad' }, { ...offer, action: 'video' }, { ...offer, sdp: 'v=0' }, { ...offer, sdp: offer.sdp + 'm=video 9 UDP 111' }, { ...offer, sdp: offer.sdp + 'a'.repeat(64000) }]) assert.equal(validatePacket(p), null);
});
test('incoming call does not request microphone until accepted; reject cleans state', async () => {
  let captures = 0;
  const { c, sent } = setup({ media: () => { captures++; throw new Error(); } });
  await c.receive('alice', offer); assert.equal(captures, 0); assert.equal(c.current.incoming, true);
  c.end(); assert.equal(sent[0].action, 'reject'); assert.equal(c.current, null);
});
test('busy call cannot replace current call; mismatched hangup ignored', async () => {
  const { c, sent } = setup();
  await c.receive('alice', offer);
  await c.receive('bob', { ...offer, id: '22345678-1234-1234-1234-123456789012' });
  assert.equal(sent[0].action, 'busy'); assert.equal(c.current.peer, 'alice');
  await c.receive('bob', { ...offer, action: 'end' }); assert.ok(c.current);
  c.end();
});
test('blocked or unknown callers do not ring', async () => {
  const { c } = setup({ allowed: () => false }); await c.receive('unknown', offer); assert.equal(c.current, null);
});
test('permission denial cleans up the pending call', async () => {
  const { c } = setup({ media: async () => { throw new Error('NotAllowedError'); } });
  await c.dial('alice'); assert.equal(c.current, null);
});
test('cancel while permission pending stops late microphone tracks', async () => {
  let resolve, stopped = false;
  const { c } = setup({ media: () => new Promise(r => { resolve = r; }) });
  const pending = c.dial('alice'); c.end(); resolve({ getTracks: () => [{ stop: () => { stopped = true; } }] });
  await pending; assert.equal(stopped, true); assert.equal(c.current, null);
});
