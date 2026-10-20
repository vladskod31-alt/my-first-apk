import {
  FILE_CHUNK_SIZE, makeFileAckPacket, makeFileCancelPacket, makeFileChunkPacket,
  makeFileCompletePacket, makeFileMissingPacket, makeFileReceiptPacket,
  makeFileResumePacket, makeFileStatePacket,
} from './core.mjs';

const WAIT_RESUME_MS = 1600;
const WAIT_RECEIPT_MS = 15_000;
const WAIT_VERIFY_MS = 45_000;
const MAX_CHUNK_RETRIES = 4;

export function bytesToBase64(bytes) {
  let binary = '';
  // Avoid spreading a large typed array into String.fromCharCode: Android WebView
  // has a small argument stack. Chunks are intentionally small, but this is cheap.
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function sha256Blob(blob) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

class OfflineTransferError extends Error {
  constructor() { super('Peer connection is not open.'); this.code = 'offline'; }
}

// A narrow, acknowledged file protocol on top of the existing reliable PeerJS data
// channel. It deliberately serialises one file per chat connection: text packets are
// still sent through the normal path, while a large upload gets bounded memory and a
// durable receipt for every stored chunk.
export class AttachmentTransferManager {
  constructor({ store, transport, onProgress = () => {}, onOutgoingComplete = () => {}, onIncomingComplete = () => {}, onError = () => {} }) {
    this.store = store;
    this.transport = transport;
    this.onProgress = onProgress;
    this.onOutgoingComplete = onOutgoingComplete;
    this.onIncomingComplete = onIncomingComplete;
    this.onError = onError;
    this.outgoing = new Map();
    this.incomingLocks = new Map();
  }

  async start(peerId, chatId, messageId, att) {
    if (!att?.fileId || !att.totalChunks) return;
    let transfer = this.outgoing.get(att.fileId);
    if (!transfer) {
      transfer = {
        fileId: att.fileId, peerId, chatId, messageId, att, running: false,
        cancelled: false, next: 0, signals: new Map(), waiters: new Map(),
      };
      this.outgoing.set(att.fileId, transfer);
    } else {
      transfer.peerId = peerId;
      transfer.chatId = chatId;
      transfer.messageId = messageId;
      transfer.att = att;
      transfer.cancelled = false;
    }
    if (!transfer.running) void this.run(transfer);
  }

  async resumeForPeer(peerId, items) {
    for (const item of items || []) {
      if (item?.att?.fileId && item.att.totalChunks && item.status !== 'delivered' && item.status !== 'local') {
        await this.start(peerId, item.chatId, item.messageId, item.att);
      }
    }
  }

  async cancel(fileId, reason = 'Отменено отправителем') {
    const transfer = this.outgoing.get(fileId);
    if (transfer) {
      transfer.cancelled = true;
      this.resolveSignal(transfer, 'cancel', reason);
      await this.safeSend(transfer.peerId, makeFileCancelPacket(fileId, reason));
      await this.setStoredState(fileId, { state: 'cancelled', error: reason });
      this.onProgress(fileId, { state: 'cancelled', error: reason });
      return;
    }
    const incoming = await this.store.getAttachment(fileId);
    if (incoming?.peerId) {
      await this.safeSend(incoming.peerId, makeFileCancelPacket(fileId, reason));
      await this.setStoredState(fileId, { state: 'cancelled', error: reason });
      this.onProgress(fileId, { state: 'cancelled', error: reason });
    }
  }

  async run(transfer) {
    if (transfer.running) return;
    transfer.running = true;
    try {
      const record = await this.store.getAttachment(transfer.fileId);
      if (!record?.blob) throw new Error('Исходный файл не найден в локальном хранилище.');
      if (!this.transport.isOpen(transfer.peerId)) throw new OfflineTransferError();
      await this.setStoredState(transfer.fileId, { state: 'uploading', error: '', peerId: transfer.peerId });
      this.onProgress(transfer.fileId, { state: 'uploading', sentBytes: transfer.next * transfer.att.chunkSize, size: transfer.att.size });

      // A receiver persists its contiguous next index, so a reconnect continues from
      // exactly that chunk rather than resending the whole file.
      this.clearSignal(transfer, 'state');
      if (!await this.safeSend(transfer.peerId, makeFileResumePacket(transfer.fileId))) throw new OfflineTransferError();
      const remoteNext = await this.waitFor(transfer, 'state', WAIT_RESUME_MS, null);
      transfer.next = Number.isInteger(remoteNext) ? Math.min(Math.max(remoteNext, 0), transfer.att.totalChunks) : 0;

      while (transfer.next < transfer.att.totalChunks) {
        if (transfer.cancelled) return;
        const index = transfer.next;
        const start = index * transfer.att.chunkSize;
        const end = Math.min(transfer.att.size, start + transfer.att.chunkSize);
        const bytes = new Uint8Array(await record.blob.slice(start, end).arrayBuffer());
        if (bytes.length !== end - start) throw new Error('Не удалось прочитать часть исходного файла.');
        const packet = makeFileChunkPacket(transfer.fileId, index, bytesToBase64(bytes));
        let received = false;
        for (let attempt = 0; attempt < MAX_CHUNK_RETRIES && !received; attempt++) {
          if (transfer.cancelled) return;
          this.clearSignal(transfer, `receipt:${index}`);
          if (!await this.safeSend(transfer.peerId, packet)) throw new OfflineTransferError();
          received = await this.waitFor(transfer, `receipt:${index}`, WAIT_RECEIPT_MS, false);
        }
        if (!received) throw new Error(`Не получено подтверждение части ${index + 1}.`);
        transfer.next = index + 1;
        const sentBytes = Math.min(transfer.att.size, transfer.next * transfer.att.chunkSize);
        this.onProgress(transfer.fileId, { state: 'uploading', sentBytes, size: transfer.att.size, totalChunks: transfer.att.totalChunks, nextChunk: transfer.next });
        // Persist coarse progress only; thousands of IDB writes for a large file are
        // needlessly expensive on a low-end WebView.
        if (transfer.next === transfer.att.totalChunks || transfer.next % 8 === 0) {
          void this.setStoredState(transfer.fileId, { state: 'uploading', sentBytes, nextChunk: transfer.next, error: '' });
        }
      }

      this.clearSignal(transfer, 'ack');
      this.clearSignal(transfer, 'missing');
      if (!await this.safeSend(transfer.peerId, makeFileCompletePacket(transfer.fileId))) throw new OfflineTransferError();
      const final = await this.waitForAny(transfer, ['ack', 'missing', 'cancel'], WAIT_VERIFY_MS);
      if (final?.key === 'missing') {
        transfer.next = final.value;
        transfer.running = false;
        void this.run(transfer);
        return;
      }
      if (final?.key === 'cancel') return;
      if (!final?.value?.ok) throw new Error(final?.value?.reason || 'Получатель не подтвердил файл.');
      await this.setStoredState(transfer.fileId, { state: 'delivered', sentBytes: transfer.att.size, nextChunk: transfer.att.totalChunks, error: '' });
      this.onProgress(transfer.fileId, { state: 'delivered', sentBytes: transfer.att.size, size: transfer.att.size, totalChunks: transfer.att.totalChunks, nextChunk: transfer.att.totalChunks });
      await this.onOutgoingComplete(transfer);
    } catch (error) {
      if (error?.code === 'offline') {
        await this.setStoredState(transfer.fileId, { state: 'queued', error: '' }).catch(() => {});
        this.onProgress(transfer.fileId, { state: 'queued', sentBytes: transfer.next * transfer.att.chunkSize, size: transfer.att.size, nextChunk: transfer.next });
      } else if (!transfer.cancelled) {
        const message = error?.message || 'Не удалось передать файл.';
        await this.setStoredState(transfer.fileId, { state: 'failed', error: message }).catch(() => {});
        this.onProgress(transfer.fileId, { state: 'failed', error: message, sentBytes: transfer.next * transfer.att.chunkSize, size: transfer.att.size, nextChunk: transfer.next });
        this.onError(transfer.fileId, message);
      }
    } finally {
      transfer.running = false;
    }
  }

  async onFileReceipt(peerId, packet) {
    const transfer = this.outgoing.get(packet.fileId);
    if (transfer && transfer.peerId === peerId) this.resolveSignal(transfer, `receipt:${packet.index}`, true);
  }

  async onFileState(peerId, packet) {
    const transfer = this.outgoing.get(packet.fileId);
    if (transfer && transfer.peerId === peerId) this.resolveSignal(transfer, 'state', packet.next);
  }

  async onFileMissing(peerId, packet) {
    const transfer = this.outgoing.get(packet.fileId);
    if (transfer && transfer.peerId === peerId) this.resolveSignal(transfer, 'missing', packet.next);
  }

  async onFileAck(peerId, packet) {
    const transfer = this.outgoing.get(packet.fileId);
    if (transfer && transfer.peerId === peerId) {
      this.resolveSignal(transfer, 'ack', packet);
      return;
    }
    // The sender may have refreshed while the receiver was verifying; status must
    // still become Delivered only on a real SHA-256-verified acknowledgement.
    if (packet.ok) await this.onOutgoingComplete({ fileId: packet.fileId, peerId });
  }

  async onFileCancel(peerId, packet) {
    const transfer = this.outgoing.get(packet.fileId);
    if (transfer && transfer.peerId === peerId) {
      transfer.cancelled = true;
      this.resolveSignal(transfer, 'cancel', packet.reason || 'Отменено собеседником.');
    }
    const record = await this.store.getAttachment(packet.fileId);
    if (record?.peerId === peerId) {
      await this.setStoredState(packet.fileId, { state: 'cancelled', error: packet.reason || 'Отменено собеседником.' }).catch(() => {});
      this.onProgress(packet.fileId, { state: 'cancelled', error: packet.reason || 'Отменено собеседником.' });
    }
  }

  async onFileResume(peerId, packet) {
    const record = await this.store.getAttachment(packet.fileId);
    if (!record || record.direction !== 'in' || record.peerId !== peerId || record.state === 'cancelled') {
      await this.safeSend(peerId, makeFileCancelPacket(packet.fileId, 'Файл не ожидается этим устройством.'));
      return;
    }
    const next = Number.isInteger(record.nextChunk) ? record.nextChunk : await this.store.getContiguousChunkCount(packet.fileId);
    await this.safeSend(peerId, makeFileStatePacket(packet.fileId, Math.min(next, record.totalChunks)));
  }

  async onFileChunk(peerId, packet) {
    const previous = this.incomingLocks.get(packet.fileId) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => this.storeIncomingChunk(peerId, packet));
    this.incomingLocks.set(packet.fileId, task);
    try { await task; }
    finally { if (this.incomingLocks.get(packet.fileId) === task) this.incomingLocks.delete(packet.fileId); }
  }

  async storeIncomingChunk(peerId, packet) {
    const record = await this.store.getAttachment(packet.fileId);
    if (!record || record.direction !== 'in' || record.peerId !== peerId || record.state === 'cancelled') {
      await this.safeSend(peerId, makeFileCancelPacket(packet.fileId, 'Вложение не ожидается.'));
      return;
    }
    if (packet.index >= record.totalChunks) {
      await this.safeSend(peerId, makeFileCancelPacket(packet.fileId, 'Некорректный номер части файла.'));
      return;
    }
    let bytes;
    try { bytes = base64ToBytes(packet.data); }
    catch { await this.safeSend(peerId, makeFileCancelPacket(packet.fileId, 'Повреждённая часть файла.')); return; }
    const expected = packet.index === record.totalChunks - 1
      ? record.size - packet.index * record.chunkSize
      : record.chunkSize;
    if (bytes.byteLength !== expected) {
      await this.safeSend(peerId, makeFileCancelPacket(packet.fileId, 'Неверный размер части файла.'));
      return;
    }
    const inserted = await this.store.putAttachmentChunk(packet.fileId, packet.index, new Blob([bytes], { type: record.mime }));
    let next = Number.isInteger(record.nextChunk) ? record.nextChunk : 0;
    if (inserted && packet.index === next) next++;
    const receivedBytes = Math.min(record.size, next * record.chunkSize);
    if (inserted || next !== record.nextChunk) {
      await this.setStoredState(packet.fileId, { state: 'receiving', nextChunk: next, receivedBytes, error: '' });
      this.onProgress(packet.fileId, { state: 'receiving', receivedBytes, size: record.size, totalChunks: record.totalChunks, nextChunk: next });
    }
    // Receipt follows the IndexedDB commit, never merely arrival in WebRTC memory.
    await this.safeSend(peerId, makeFileReceiptPacket(packet.fileId, packet.index));
  }

  async onFileComplete(peerId, packet) {
    const previous = this.incomingLocks.get(packet.fileId) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => this.finishIncoming(peerId, packet.fileId));
    this.incomingLocks.set(packet.fileId, task);
    try { await task; }
    finally { if (this.incomingLocks.get(packet.fileId) === task) this.incomingLocks.delete(packet.fileId); }
  }

  async finishIncoming(peerId, fileId) {
    const record = await this.store.getAttachment(fileId);
    if (!record || record.direction !== 'in' || record.peerId !== peerId) {
      await this.safeSend(peerId, makeFileAckPacket(fileId, false, 'Вложение не найдено.'));
      return;
    }
    const chunks = await this.store.getAttachmentChunks(fileId);
    let next = 0;
    for (const chunk of chunks) {
      if (chunk.index !== next) break;
      next++;
    }
    if (next !== record.totalChunks) {
      await this.setStoredState(fileId, { state: 'receiving', nextChunk: next, receivedBytes: Math.min(record.size, next * record.chunkSize) });
      await this.safeSend(peerId, makeFileMissingPacket(fileId, next));
      return;
    }
    const bytes = chunks.reduce((sum, chunk) => sum + (chunk.blob?.size || 0), 0);
    if (bytes !== record.size) {
      await this.setStoredState(fileId, { state: 'failed', error: 'Размер собранного файла не совпал.' });
      await this.safeSend(peerId, makeFileAckPacket(fileId, false, 'Размер файла не совпал.'));
      return;
    }
    const blob = new Blob(chunks.map(chunk => chunk.blob), { type: record.mime });
    const checksum = await sha256Blob(blob);
    if (checksum !== record.sha256) {
      await this.setStoredState(fileId, { state: 'failed', error: 'Контрольная сумма SHA-256 не совпала.' });
      await this.store.deleteAttachmentChunks(fileId);
      await this.safeSend(peerId, makeFileAckPacket(fileId, false, 'SHA-256 файла не совпал.'));
      return;
    }
    await this.setStoredState(fileId, {
      state: 'received', blob, nextChunk: record.totalChunks, receivedBytes: record.size, error: '', verifiedAt: Date.now(),
    });
    await this.store.deleteAttachmentChunks(fileId);
    this.onProgress(fileId, { state: 'received', receivedBytes: record.size, size: record.size, totalChunks: record.totalChunks, nextChunk: record.totalChunks });
    await this.safeSend(peerId, makeFileAckPacket(fileId, true));
    await this.onIncomingComplete({ ...record, blob, state: 'received' });
  }

  async setStoredState(fileId, patch) {
    return this.store.updateAttachment(fileId, patch);
  }

  async safeSend(peerId, packet) {
    try { return await this.transport.send(peerId, packet); }
    catch { return false; }
  }

  clearSignal(transfer, key) { transfer.signals.delete(key); }

  resolveSignal(transfer, key, value) {
    const waiters = transfer.waiters.get(key);
    if (waiters?.length) {
      transfer.waiters.delete(key);
      for (const resolve of waiters) resolve(value);
    } else transfer.signals.set(key, value);
  }

  waitFor(transfer, key, timeout, fallback) {
    if (transfer.signals.has(key)) {
      const value = transfer.signals.get(key);
      transfer.signals.delete(key);
      return Promise.resolve(value);
    }
    return new Promise(resolve => {
      const done = value => { clearTimeout(timer); resolve(value); };
      const list = transfer.waiters.get(key) || [];
      list.push(done);
      transfer.waiters.set(key, list);
      const timer = setTimeout(() => {
        const current = transfer.waiters.get(key) || [];
        const position = current.indexOf(done);
        if (position >= 0) current.splice(position, 1);
        if (current.length) transfer.waiters.set(key, current); else transfer.waiters.delete(key);
        resolve(fallback);
      }, timeout);
    });
  }

  async waitForAny(transfer, keys, timeout) {
    for (const key of keys) {
      if (transfer.signals.has(key)) {
        const value = transfer.signals.get(key);
        transfer.signals.delete(key);
        return { key, value };
      }
    }
    return new Promise(resolve => {
      const cleanups = [];
      const finish = (key, value) => {
        clearTimeout(timer);
        for (const cleanup of cleanups) cleanup();
        resolve({ key, value });
      };
      for (const key of keys) {
        const done = value => finish(key, value);
        const list = transfer.waiters.get(key) || [];
        list.push(done);
        transfer.waiters.set(key, list);
        cleanups.push(() => {
          const current = transfer.waiters.get(key) || [];
          const position = current.indexOf(done);
          if (position >= 0) current.splice(position, 1);
          if (current.length) transfer.waiters.set(key, current); else transfer.waiters.delete(key);
        });
      }
      const timer = setTimeout(() => finish(null, null), timeout);
    });
  }
}
