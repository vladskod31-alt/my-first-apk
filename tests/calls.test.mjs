import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Transport } from '../web/lib/transport.mjs';

const peerId = 'libo-0123456789abcdef0123456789abcdef';

class FakeMediaCall extends EventEmitter {
  constructor(kind = 'audio') {
    super();
    this.peer = peerId;
    this.metadata = { protocol: 'libo-call-v1', kind };
    this.answeredWith = null;
    this.closed = false;
  }

  answer(stream) { this.answeredWith = stream; }
  close() { this.closed = true; this.emit('close'); }
}

function stream() { return { getTracks: () => [] }; }

function setup() {
  const events = { states: [], ended: [], incoming: [] };
  const transport = new Transport({
    isAllowed: id => id === peerId,
    onCallState: (id, status, detail) => events.states.push({ id, status, detail }),
    onCallEnded: (id, status, detail) => events.ended.push({ id, status, detail }),
    onIncomingCall: payload => events.incoming.push(payload),
  });
  transport.connections.set(peerId, { open: true, liboHello: true, caps: new Set(['calls-v1']) });
  return { transport, events };
}

test('outgoing call becomes connected only after a real remote media stream', () => {
  const { transport, events } = setup();
  const call = new FakeMediaCall('video');
  transport.peer = { call: () => call };
  assert.equal(transport.startCall(peerId, stream(), 'video'), true);
  assert.deepEqual(events.states.map(event => event.status), ['calling']);
  assert.equal(transport.calls.get(peerId).remoteStream, null);

  const remote = stream();
  call.emit('stream', remote);
  assert.equal(transport.calls.get(peerId).remoteStream, remote);
  assert.equal(events.states.at(-1).status, 'connected');

  assert.equal(transport.endCall(peerId), true);
  assert.equal(call.closed, true);
  assert.equal(events.ended.at(-1).status, 'ended');
});

test('incoming call rings until the user accepts and passes a capture stream', () => {
  const { transport, events } = setup();
  const call = new FakeMediaCall('audio');
  transport.receiveCall(call);
  assert.deepEqual(events.incoming, [{ id: peerId, kind: 'audio' }]);
  assert.equal(events.states.at(-1).status, 'ringing');
  assert.equal(transport.pendingCalls.has(peerId), true);

  const local = stream();
  assert.equal(transport.answerCall(peerId, local), true);
  assert.equal(call.answeredWith, local);
  assert.equal(events.states.at(-1).status, 'connecting');
  call.emit('stream', stream());
  assert.equal(events.states.at(-1).status, 'connected');
  transport.endCall(peerId);
});

test('media calls from an unsupported protocol are closed without a UI event', () => {
  const { transport, events } = setup();
  const call = new FakeMediaCall();
  call.metadata = { protocol: 'untrusted', kind: 'audio' };
  transport.receiveCall(call);
  assert.equal(call.closed, true);
  assert.deepEqual(events.incoming, []);
  assert.deepEqual(events.states, []);
});
