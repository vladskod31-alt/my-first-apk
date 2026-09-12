import Peer from 'peerjs';
import { parseSignalingUrl, makeIceServers, validatePacket, peerIdForNickname } from './core.mjs';
import { makeHello, verifyHello, fingerprint, createSession } from './crypto.mjs';

export class Transport {
  constructor(events) {
    this.events = events; this.connections = new Map(); this.attempts = new Map(); this.timers = new Set(); this.retryCount = 0;
  }
  later(callback, delay) {
    const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, delay);
    this.timers.add(timer); return timer;
  }
  start(profile, settings, identity = this.identity) {
    this.stop(); this.profile = profile; this.settings = settings; this.identity = identity; this.stopped = false;
    this.events.onState('connecting');
    try {
      this.peer = new Peer(profile.id, { ...parseSignalingUrl(settings.signalUrl, location.origin), debug: 0, config: { iceServers: makeIceServers(settings) } });
    } catch (error) { this.events.onState('error', error.message); return; }
    const peer = this.peer;
    peer.on('open', () => { if (peer !== this.peer) return; this.retryCount = 0; this.events.onState('ready'); this.events.onReady(); });
    peer.on('connection', conn => { if (peer !== this.peer || this.stopped) conn.close(); else this.bind(conn, true); });
    peer.on('disconnected', () => { if (peer === this.peer && !this.stopped) { this.events.onState('offline'); this.scheduleReconnect(peer); } });
    peer.on('close', () => { if (peer === this.peer && !this.stopped) this.events.onState('offline'); });
    peer.on('error', error => {
      if (peer !== this.peer || this.stopped) return;
      if (error.type === 'peer-unavailable') {
        const id = error.message?.match(/libo-[a-f0-9]{32}/)?.[0];
        if (id && !this.isOpen(id)) { this.closeContact(id); this.events.onContactState(id, 'offline'); }
        return;
      }
      if (error.type === 'unavailable-id') { this.events.onState('error', 'NICK_IN_USE'); return; }
      if (['webrtc', 'browser-incompatible', 'invalid-id', 'invalid-key', 'ssl-unavailable'].includes(error.type)) { this.events.onState('error', 'WEBRTC_UNAVAILABLE'); return; }
      this.events.onState('offline'); this.scheduleReconnect(peer);
    });
  }
  scheduleReconnect(peer) {
    if (this.reconnectTimer || this.stopped) return;
    this.reconnectTimer = this.later(() => {
      this.reconnectTimer = null;
      if (peer !== this.peer || this.stopped) return;
      if (peer.destroyed) this.start(this.profile, this.settings);
      else if (peer.disconnected) peer.reconnect();
    }, Math.min(30_000, 2000 * 2 ** Math.min(this.retryCount++, 4)));
  }
  connect(id) {
    if (!this.peer?.open || this.isOpen(id) || this.attempts.has(id) || !this.events.isAllowed(id)) return false;
    this.bind(this.peer.connect(id, { reliable: true, serialization: 'binary', label: 'libo-v2.1-aes' }), false);
    return true;
  }
  bind(connection, incoming) {
    if (this.stopped || !this.profile || !this.identity) { connection.close(); return; }
    const id = connection.peer;
    if (!this.events.isAllowed(id) || connection.label !== 'libo-v2.1-aes') { connection.close(); return; }
    const existing = this.connections.get(id) || this.attempts.get(id);
    if (!existing && this.connections.size + this.attempts.size >= 24) { connection.close(); return; }
    if (existing) {
      if (existing.open && existing.session) { connection.close(); return; }
      if (existing.incoming !== incoming && incoming !== (this.profile.id > id)) { connection.close(); return; }
      this.attempts.delete(id); this.connections.delete(id); existing.close();
    }
    // A broker can deliver multiple queued offers from an earlier app instance.
    // For the same direction keep the newest offer; arbitrate only simultaneous opposite dials.
    connection.incoming = incoming;
    this.attempts.set(id, connection); this.events.onContactState(id, 'connecting');
    const local = makeHello(this.profile, this.identity);
    const timeout = this.later(() => { if (!connection.session) { connection.close(); close(); } }, 15_000);
    connection.outboundTail = Promise.resolve(); connection.inboundTail = Promise.resolve();
    const failure = error => { connection.close(); close(); if (!this.stopped) this.events.onCryptoError(id, /^[A-Z_]{3,60}$/.test(error.message || '') ? error.message : error.name === 'QuotaExceededError' ? 'STORAGE_FAILED' : 'CRYPTO_INVALID'); };
    connection.on('open', () => {
      local.then(value => { if (connection.open && !this.stopped) connection.send(value.hello); }).catch(failure);
    });
    let count = 0, startedAt = Date.now();
    connection.on('data', raw => {
      if (Date.now() - startedAt > 10_000) { count = 0; startedAt = Date.now(); }
      if (++count > 200) { failure(new Error('RATE_LIMITED')); return; }
      connection.inboundTail = connection.inboundTail.then(async () => {
        if (!connection.open || this.stopped) return;
        if (!connection.session) {
          const hello = await verifyHello(raw, id);
          if (await peerIdForNickname(hello.name) !== id) throw new Error('CRYPTO_INVALID');
          const peerFingerprint = await fingerprint(hello.identity);
          if (!connection.open || this.stopped) return;
          await this.events.onIdentity(id, hello.name, peerFingerprint, hello.identity);
          const session = await createSession(await local, hello);
          if (!connection.open || this.stopped) return;
          connection.session = session;
          clearTimeout(timeout); this.timers.delete(timeout);
          this.attempts.delete(id); this.connections.set(id, connection);
          await this.events.onHello(id, hello.name);
          this.events.onContactState(id, 'online');
          this.events.onConnected(id);
          return;
        }
        // No plaintext fallback. ACKs, read receipts, typing and message bodies all use AES-GCM.
        const data = validatePacket(await connection.session.open(raw));
        if (!connection.open || this.stopped) return;
        if (!data) throw new Error('CRYPTO_INVALID');
        if (data.type === 'message') await this.events.onMessage(id, data);
        if (data.type === 'ack') await this.events.onAck(id, data.id);
        if (data.type === 'read') await this.events.onRead(id, data.ids);
        if (data.type === 'read-ack') await this.events.onReadAck(id, data.ids);
        if (data.type === 'typing') this.events.onTyping(id, data.active);
      }).catch(failure);
    });
    const close = () => {
      clearTimeout(timeout); this.timers.delete(timeout);
      connection.session = null;
      if (this.attempts.get(id) === connection) this.attempts.delete(id);
      if (this.connections.get(id) === connection) this.connections.delete(id);
      if (!this.isOpen(id) && !this.attempts.has(id)) this.events.onContactState(id, 'offline');
    };
    connection.on('close', close);
    connection.on('error', () => { connection.close(); close(); });
    local.catch(failure);
  }
  isOpen(id) { const conn = this.connections.get(id); return !!(conn?.open && conn.session); }
  send(id, packet) {
    const conn = this.connections.get(id);
    if (!conn?.open || !conn.session || !validatePacket(packet)) return Promise.resolve(false);
    const task = conn.outboundTail.catch(() => {}).then(async () => {
      if (!conn.open || !conn.session || this.stopped) return false;
      const box = await conn.session.seal(packet);
      if (!conn.open || this.stopped) return false;
      conn.send(box); return true;
    }).catch(() => { this.closeContact(id); return false; });
    conn.outboundTail = task;
    return task;
  }
  updateProfile(profile) { this.profile = profile; }
  closeContact(id) { this.connections.get(id)?.close(); this.attempts.get(id)?.close(); this.connections.delete(id); this.attempts.delete(id); }
  stop() {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear(); this.reconnectTimer = null; this.retryCount = 0;
    for (const conn of [...this.connections.values(), ...this.attempts.values()]) conn.session = null;
    this.peer?.destroy(); this.peer = null; this.connections.clear(); this.attempts.clear();
    this.identity = null; this.profile = null; this.settings = null;
  }
}
