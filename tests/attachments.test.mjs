import test from 'node:test';
import assert from 'node:assert/strict';
import { AttachmentTransferManager, bytesToBase64, sha256Blob } from '../web/lib/attachments.mjs';
import { FILE_CHUNK_SIZE } from '../web/lib/core.mjs';

const peerId = 'libo-abcdef0123456789abcdef0123456789';
const fileId = '01234567-89ab-cdef-0123-456789abcdef';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function makeOutgoingStore(record) {
  return {
    async getAttachment(id) { return id === record.id ? record : null; },
    async updateAttachment(id, patch) {
      assert.equal(id, record.id);
      Object.assign(record, patch);
      return record;
    },
  };
}

test('resumed outgoing transfer starts from peer contiguous chunk and only becomes delivered after file ACK', async () => {
  const bytes = new Uint8Array(FILE_CHUNK_SIZE * 2 + 33);
  bytes.fill(17);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const record = {
    id: fileId, blob, direction: 'out', state: 'queued', size: blob.size,
    chunkSize: FILE_CHUNK_SIZE, totalChunks: 3,
  };
  const att = { fileId, name: 'resume.bin', mime: blob.type, size: blob.size, chunkSize: FILE_CHUNK_SIZE, totalChunks: 3, sha256: await sha256Blob(blob) };
  const sent = [];
  const completed = deferred();
  let manager;
  const transport = {
    isOpen: id => id === peerId,
    async send(id, packet) {
      assert.equal(id, peerId);
      sent.push(packet);
      if (packet.type === 'file-resume') queueMicrotask(() => manager.onFileState(peerId, { fileId, next: 1 }));
      if (packet.type === 'file-chunk') queueMicrotask(() => manager.onFileReceipt(peerId, { fileId, index: packet.index }));
      if (packet.type === 'file-complete') queueMicrotask(() => manager.onFileAck(peerId, { fileId, ok: true }));
      return true;
    },
  };
  manager = new AttachmentTransferManager({
    store: makeOutgoingStore(record), transport,
    onOutgoingComplete: transfer => completed.resolve(transfer),
  });
  await manager.start(peerId, peerId, 'message-0000000001', att);
  const transfer = await Promise.race([
    completed.promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('outgoing transfer timed out')), 2000)),
  ]);
  assert.equal(transfer.fileId, fileId);
  assert.deepEqual(sent.filter(packet => packet.type === 'file-chunk').map(packet => packet.index), [1, 2]);
  assert.equal(record.state, 'delivered');
  assert.equal(record.sentBytes, blob.size);
});

test('incoming chunks are persisted, assembled, SHA-256 checked and ACKed only after complete verification', async () => {
  const bytes = new Uint8Array(FILE_CHUNK_SIZE + 19);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const original = new Blob([bytes], { type: 'application/octet-stream' });
  const record = {
    id: fileId, direction: 'in', peerId, state: 'receiving', mime: original.type,
    size: original.size, chunkSize: FILE_CHUNK_SIZE, totalChunks: 2,
    sha256: await sha256Blob(original), nextChunk: 0,
  };
  const chunks = new Map();
  const sent = [];
  const store = {
    async getAttachment(id) { return id === fileId ? record : null; },
    async updateAttachment(id, patch) { assert.equal(id, fileId); Object.assign(record, patch); return record; },
    async putAttachmentChunk(id, index, blob) {
      assert.equal(id, fileId);
      if (chunks.has(index)) return false;
      chunks.set(index, { index, blob });
      return true;
    },
    async getAttachmentChunks(id) { assert.equal(id, fileId); return [...chunks.values()].sort((a, b) => a.index - b.index); },
    async deleteAttachmentChunks(id) { assert.equal(id, fileId); chunks.clear(); },
    async getContiguousChunkCount() { return 0; },
  };
  const manager = new AttachmentTransferManager({
    store,
    transport: { async send(id, packet) { assert.equal(id, peerId); sent.push(packet); return true; } },
  });
  await manager.onFileChunk(peerId, { fileId, index: 0, data: bytesToBase64(bytes.slice(0, FILE_CHUNK_SIZE)) });
  await manager.onFileChunk(peerId, { fileId, index: 1, data: bytesToBase64(bytes.slice(FILE_CHUNK_SIZE)) });
  await manager.onFileComplete(peerId, { fileId });
  assert.equal(record.state, 'received');
  assert.equal(record.verifiedAt > 0, true);
  assert.equal(await record.blob.text(), await original.text());
  assert.deepEqual(sent.filter(packet => packet.type === 'file-receipt').map(packet => packet.index), [0, 1]);
  assert.deepEqual(sent.at(-1), { v: 1, type: 'file-ack', fileId, ok: true });
});

test('bad final SHA-256 is rejected rather than being reported as delivered', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const record = {
    id: fileId, direction: 'in', peerId, state: 'receiving', mime: 'application/octet-stream',
    size: bytes.byteLength, chunkSize: FILE_CHUNK_SIZE, totalChunks: 1,
    sha256: '0'.repeat(64), nextChunk: 0,
  };
  const chunks = new Map();
  const sent = [];
  const store = {
    async getAttachment() { return record; },
    async updateAttachment(_, patch) { Object.assign(record, patch); return record; },
    async putAttachmentChunk(_, index, blob) { chunks.set(index, { index, blob }); return true; },
    async getAttachmentChunks() { return [...chunks.values()]; },
    async deleteAttachmentChunks() { chunks.clear(); },
  };
  const manager = new AttachmentTransferManager({
    store,
    transport: { async send(_, packet) { sent.push(packet); return true; } },
  });
  await manager.onFileChunk(peerId, { fileId, index: 0, data: bytesToBase64(bytes) });
  await manager.onFileComplete(peerId, { fileId });
  assert.equal(record.state, 'failed');
  assert.match(record.error, /SHA-256/);
  assert.deepEqual(sent.at(-1), { v: 1, type: 'file-ack', fileId, ok: false, reason: 'SHA-256 файла не совпал.' });
});
