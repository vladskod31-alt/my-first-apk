import Peer from 'peerjs';
import { CAPABILITIES, parseSignalingUrl, makeIceServers, validatePacket } from './core.mjs';
import { MtSession } from './mtproto.mjs';

export class Transport {
  constructor(events) {
    this.events = events;
    this.connections = new Map();
    this.attempts = new Map();
    this.mtSessions = new Map();
    this.timers = new Set();
    this.retryCount = 0;
  }

  later(callback, delay) {
    const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, delay);
    this.timers.add(timer);
    return timer;
  }

  start(profile, settings) {
    this.stop();
    this.profile = profile;
    this.settings = settings;
    this.stopped = false;
    this.events.onState('connecting');
    try {
      this.peer = new Peer(profile.id, {
        ...parseSignalingUrl(settings.signalUrl, location.origin),
        debug: 0,
        config: { iceServers: makeIceServers(settings) },
      });
    } catch (error) {
      this.events.onState('error', error.message);
      return;
    }
    const peer = this.peer;
    peer.on('open', () => {
      if (peer !== this.peer) return;
      this.retryCount = 0;
      this.events.onState('ready');
      this.events.onReady();
    });
    peer.on('connection', conn => this.bind(conn, true));
    peer.on('disconnected', () => {
      if (peer !== this.peer || this.stopped) return;
      this.events.onState('offline');
      this.scheduleReconnect(peer);
    });
    peer.on('close', () => {
      if (peer === this.peer && !this.stopped) this.events.onState('offline');
    });
    peer.on('error', error => {
      if (peer !== this.peer || this.stopped) return;
      if (error.type === 'peer-unavailable') return;
      if (error.type === 'unavailable-id') {
        this.events.onState('error', 'Этот личный код уже открыт на другом экране. Закройте другую вкладку и подключитесь снова.');
        return;
      }
      if (['webrtc', 'browser-incompatible', 'invalid-id', 'invalid-key', 'ssl-unavailable'].includes(error.type)) {
        this.events.onState('error', 'WebRTC недоступен. Обновите Android System WebView или браузер; проверьте настройки сервера.');
        return;
      }
      this.events.onState('offline');
      this.scheduleReconnect(peer);
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
    if (!this.peer?.open || this.isOpen(id) || this.attempts.has(id)) return false;
    if (!this.events.isAllowed(id)) return false;
    const connection = this.peer.connect(id, { reliable: true, serialization: 'binary', label: 'libo-v2' });
    this.bind(connection, false);
    return true;
  }

  helloPacket() {
    const profile = {
      username: this.profile.username || '', bio: this.profile.bio || '',
      status: this.profile.status || 'online', avatar: this.profile.avatar || '',
    };
    return { v: 1, type: 'hello', id: this.profile.id, name: this.profile.name, caps: CAPABILITIES, profile };
  }

  bind(connection, incoming) {
    const id = connection.peer;
    if (!this.events.isAllowed(id) || connection.label !== 'libo-v2' || this.connections.size + this.attempts.size > 24) {
      connection.close(); return;
    }
    // Both clients may dial simultaneously. Keep the connection initiated by the smaller ID.
    const existing = this.connections.get(id) || this.attempts.get(id);
    if (existing) {
      if (existing.open && existing.liboHello) { connection.close(); return; }
      const keepIncoming = this.profile.id > id;
      if (incoming !== keepIncoming) { connection.close(); return; }
      this.attempts.delete(id);
      this.connections.delete(id);
      existing.close();
    }
    this.attempts.set(id, connection);
    this.events.onContactState(id, 'connecting');
    const timeout = this.later(() => {
      if (!connection.liboHello) {
        if (this.attempts.get(id) === connection) this.attempts.delete(id);
        connection.close();
        if (!this.isOpen(id)) this.events.onContactState(id, 'offline');
      }
    }, 15_000);
    connection.on('open', () => {
      if (this.stopped) { connection.close(); return; }
      connection.send(this.helloPacket());
    });

    // PeerJS emits data callbacks without waiting for an async handler. File metadata
    // must commit before chunk 0 is accepted, so each data connection has one queue.
    connection.liboQueue = Promise.resolve();
    connection.rate = { at: Date.now(), controls: 0, chunks: 0 };
    connection.on('data', raw => {
      connection.liboQueue = connection.liboQueue
        .then(() => this.receive(connection, id, raw, timeout))
        .catch(() => { connection.close(); });
    });
    const close = () => {
      clearTimeout(timeout);
      this.timers.delete(timeout);
      if (this.attempts.get(id) === connection) this.attempts.delete(id);
      if (this.connections.get(id) === connection) this.connections.delete(id);
      if (!this.isOpen(id) && !this.attempts.has(id)) this.events.onContactState(id, 'offline');
    };
    connection.on('close', close);
    connection.on('error', () => { connection.close(); close(); });
  }

  async receive(connection, id, raw, timeout) {
    const data = validatePacket(raw);
    if (!data) { connection.close(); return; }
    const rate = connection.rate;
    if (Date.now() - rate.at > 10_000) { rate.at = Date.now(); rate.controls = 0; rate.chunks = 0; }
    if (data.type === 'file-chunk') {
      // 1,000 x 24 KiB in ten seconds is a strict 2.4 MiB/s anti-flood ceiling,
      // while remaining practical for a real 100 MB transfer over WebRTC.
      if (++rate.chunks > 1000) { connection.close(); return; }
    } else if (++rate.controls > 160) { connection.close(); return; }

    if (data.type === 'hello') {
      if (data.id !== id) { connection.close(); return; }
      clearTimeout(timeout);
      this.timers.delete(timeout);
      connection.liboHello = true;
      connection.caps = new Set(data.caps || []);
      this.attempts.delete(id);
      this.connections.set(id, connection);
      // Do not process messages until the contact record has been persisted.
      connection.liboReady = Promise.resolve(this.events.onHello(id, data.name, data.caps || [], data.profile || null));
      try {
        await connection.liboReady;
        if (this.connections.get(id) !== connection || !connection.open) return;
        this.events.onContactState(id, 'online');
        this.events.onConnected(id);
        void this.startMt(connection);
      } catch {
        connection.close();
        this.events.onStorageError();
      }
      return;
    }
    if (!connection.liboHello) { connection.close(); return; }
    try { await connection.liboReady; } catch { return; }
    await this.dispatch(id, data, connection);
  }

  isOpen(id) { const conn = this.connections.get(id); return !!(conn?.open && conn.liboHello); }
  supports(id, capability) { return this.connections.get(id)?.caps?.has(capability) || false; }

  // MTProto-inspired layer: each side announces an ephemeral ECDH key once the chat is
  // hello-ready; older peers simply never answer, and the channel stays DTLS-only.
  async startMt(connection) {
    const id = connection.peer;
    try {
      let session = this.mtSessions.get(id);
      if (!session) {
        session = await MtSession.create();
        this.mtSessions.set(id, session);
      }
      connection.mtSession = session;
      if (connection.mtPubSent === session.pubB64) return;
      connection.mtPubSent = session.pubB64;
      connection.send({ v: 1, type: 'mt-hello', pub: session.pubB64 });
    } catch { connection.mtSession = null; }
  }

  mtStatus(id) {
    const session = this.connections.get(id)?.mtSession;
    return session?.ready ? session.fingerprint : '';
  }

  async dispatch(id, data, connection) {
    if (data.type === 'mt-hello') {
      try {
        let session = this.mtSessions.get(id);
        if (!session) {
          session = await MtSession.create();
          this.mtSessions.set(id, session);
        }
        if (session.remotePub !== data.pub) await session.rekey(data.pub);
        connection.mtSession = session;
        connection.mt = session.ready;
        void this.startMt(connection);
        this.events.onSecurity?.(id);
      } catch { connection.mtSession = null; }
      return;
    }
    if (data.type === 'mt') {
      const session = connection.mtSession;
      if (!session?.ready) return;
      const inner = await session.open(data);
      if (!inner) { this.events.onMtDrop?.(id); return; }
      const packet = validatePacket(inner);
      if (!packet) return;
      if (packet.type !== 'mt' && packet.type !== 'mt-hello' && packet.type !== 'hello') await this.dispatch(id, packet, connection);
      return;
    }
    if (data.type === 'message') await this.events.onMessage(id, data);
    else if (data.type === 'ack') await this.events.onAck(id, data.id, data);
    else if (data.type === 'typing') this.events.onTyping(id, data.active);
    else if (data.type === 'edit') await this.events.onEdit(id, data);
    else if (data.type === 'delete') await this.events.onDelete(id, data.ids);
    else if (data.type === 'pin') await this.events.onPin(id, data.id, data.pinned);
    else if (data.type === 'react') await this.events.onReact(id, data.id, data.key, data.on);
    else if (data.type === 'read') await this.events.onRead?.(id, data.upTo, data.readAt);
    else if (data.type === 'pollvote') await this.events.onPollVote?.(id, data.pid, data.opt);
    else if (data.type === 'file-chunk') await this.events.onFileChunk?.(id, data);
    else if (data.type === 'file-receipt') await this.events.onFileReceipt?.(id, data);
    else if (data.type === 'file-resume') await this.events.onFileResume?.(id, data);
    else if (data.type === 'file-state') await this.events.onFileState?.(id, data);
    else if (data.type === 'file-complete') await this.events.onFileComplete?.(id, data);
    else if (data.type === 'file-missing') await this.events.onFileMissing?.(id, data);
    else if (data.type === 'file-ack') await this.events.onFileAck?.(id, data);
    else if (data.type === 'file-cancel') await this.events.onFileCancel?.(id, data);
  }

  async send(id, data) {
    if (!this.isOpen(id)) return false;
    const connection = this.connections.get(id);
    try {
      if (connection.mt && connection.mtSession?.ready && data.type !== 'mt-hello') connection.send(await connection.mtSession.seal(data));
      else connection.send(data);
      return true;
    } catch { return false; }
  }

  updateProfile(profile) {
    this.profile = profile;
    for (const id of this.connections.keys()) this.send(id, this.helloPacket());
  }

  closeContact(id) {
    this.mtSessions.delete(id);
    this.connections.get(id)?.close();
    this.attempts.get(id)?.close();
    this.connections.delete(id);
    this.attempts.delete(id);
  }

  stop() {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.reconnectTimer = null;
    this.retryCount = 0;
    this.peer?.destroy();
    this.peer = null;
    this.connections.clear();
    this.attempts.clear();
    this.mtSessions.clear();
  }
}
