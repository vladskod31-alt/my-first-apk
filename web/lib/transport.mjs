import Peer from 'peerjs';
import { parseSignalingUrl, makeIceServers, validatePacket } from './core.mjs';
import { MtSession } from './mtproto.mjs';
import { makeHello, verifyHello, Session, encodeText, decodeText, b64 } from './e2ee.mjs';

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

  updateSettings(settings) { this.settings = settings; }

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
      if (error.type === 'peer-unavailable') {
        // PeerJS reports this at the peer level; expired connections are removed by their timer.
        return;
      }
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
    let count = 0;
    let startedAt = Date.now();
    // Packets are processed strictly in arrival order: the E2EE handshake persists
    // identity state asynchronously, and a ratchet message must never overtake it.
    let queue = Promise.resolve();
    connection.on('data', raw => {
      if (Date.now() - startedAt > 10_000) { count = 0; startedAt = Date.now(); }
      if (++count > 160) { connection.close(); return; }
      const data = validatePacket(raw);
      if (!data) { connection.close(); return; }
      queue = queue.then(() => handle(data)).catch(() => {});
    });
    const handle = async data => {
      if (data.type === 'hello') {
        if (data.id !== id) { connection.close(); return; }
        clearTimeout(timeout);
        this.timers.delete(timeout);
        connection.liboHello = true;
        this.attempts.delete(id);
        this.connections.set(id, connection);
        // Do not process messages until the contact record has been persisted.
        connection.liboReady = Promise.resolve(this.events.onHello(id, data.name, data));
        try {
          await connection.liboReady;
          if (this.connections.get(id) !== connection || !connection.open) return;
          this.events.onContactState(id, 'online');
          this.events.onConnected(id);
          this.startE2(connection);
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
    };
    const close = () => {
      connection.e2Session?.close();
      connection.e2Hello?.ephemeral?.sk?.fill(0);
      clearTimeout(timeout);
      this.timers.delete(timeout);
      if (this.attempts.get(id) === connection) this.attempts.delete(id);
      if (this.connections.get(id) === connection) this.connections.delete(id);
      if (!this.isOpen(id) && !this.attempts.has(id)) this.events.onContactState(id, 'offline');
    };
    connection.on('close', close);
    connection.on('error', () => { connection.close(); close(); });
  }

  isOpen(id) { const conn = this.connections.get(id); return !!(conn?.open && conn.liboHello); }

  // MTProto-inspired layer: each side announces an ephemeral ECDH key once the chat is
  // hello-ready; older peers simply never answer, and the channel stays DTLS-only.
  // The MT session belongs to the peer, not to a single connection: WebRTC links can
  // be replaced while the chat lives on, and a per-connection key would desynchronise
  // the pair. A new public key from the peer starts a new generation for both sides.
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

  helloPacket() {
    const packet = { v: 1, type: 'hello', id: this.profile.id, name: this.profile.name };
    if (this.profile.bio) packet.bio = this.profile.bio;
    if (this.settings?.privacy?.lastSeen === false) packet.hideSeen = true;
    return packet;
  }

  // 2.8.2 E2EE: one Double Ratchet session per WebRTC connection. Both sides send a
  // signed hello with a fresh X25519 ephemeral key; the identity keys are pinned by
  // the app (trust on first use, QR pinning when the contact came from an invitation).
  startE2(connection) {
    const id = connection.peer;
    const identity = this.events.identity?.();
    if (!identity || connection.e2Hello) return;
    try {
      const hello = makeHello(identity, this.profile.id, id, this.events.pairTokenFor?.(id) || null);
      connection.e2Hello = hello;
      connection.send(hello.packet);
      void this.finishE2(connection);
    } catch { connection.e2Hello = null; }
  }

  async finishE2(connection) {
    if (!connection.e2Hello || !connection.e2Remote || connection.e2Session) return;
    const id = connection.peer;
    const identity = this.events.identity?.();
    try {
      const allowed = await this.events.onIdentity?.(id, { signPk: b64(connection.e2Remote.sk), dhPk: b64(connection.e2Remote.ik), token: connection.e2Token || null });
      if (allowed === false) { connection.e2Rejected = true; connection.close(); return; }
      const session = Session.establish({
        identity, ephemeral: connection.e2Hello.ephemeral, remote: connection.e2Remote,
        myId: this.profile.id, peerId: id, initiator: this.profile.id < id,
      });
      connection.e2Session = session;
      connection.e2Hello.ephemeral.sk.fill(0);
      if (session.initiator) connection.send(session.encrypt(encodeText(JSON.stringify({ v: 1, type: 'ping' }))));
      this.events.onSecurity?.(id);
      this.events.onE2Ready?.(id);
    } catch { connection.e2Session = null; }
  }

  e2Status(id) {
    const connection = this.connections.get(id);
    const session = connection?.e2Session;
    if (!session?.ready) return null;
    return { fingerprint: session.fingerprint, signPk: session.remoteSignPk, canSend: session.canSend, createdAt: session.createdAt, sent: session.sentSinceRatchet, hardware: false };
  }

  async dispatch(id, data, connection, decrypted = false) {
    if (data.type === 'e2-hello') {
      if (connection.e2Remote) return;                      // one handshake per connection
      const remote = verifyHello(data, id, this.profile.id);
      if (!remote) { connection.close(); return; }          // unsigned or mis-bound identity
      connection.e2Remote = remote;
      connection.e2Token = data.tok || null;
      connection.e2Seen = true;
      this.startE2(connection);
      await this.finishE2(connection);
      return;
    }
    if (data.type === 'e2') {
      const session = connection.e2Session;
      if (!session?.ready) return;
      const plain = session.decrypt(data);
      if (!plain) { this.events.onMtDrop?.(id); return; }
      let inner;
      try { inner = JSON.parse(decodeText(plain)); } catch { return; }
      plain.fill(0);
      const packet = validatePacket(inner);
      if (!packet || ['e2', 'e2-hello', 'mt', 'mt-hello', 'hello'].includes(packet.type)) return;
      if (packet.type === 'ping') { this.events.onSecurity?.(id); this.events.onE2Ready?.(id); return; }
      await this.dispatch(id, packet, connection, true);
      return;
    }
    // Downgrade protection: once the peer proved E2EE support, plaintext application
    // packets from that connection are ignored.
    if (connection.e2Seen && !decrypted && !['mt', 'mt-hello', 'ping'].includes(data.type)) return;
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
      if (!inner) {
        this.events.onMtDrop?.(id);
        return;
      }
      const packet = validatePacket(inner);
      if (!packet) return;
      if (packet.type !== 'mt' && packet.type !== 'mt-hello' && packet.type !== 'hello') {
        await this.dispatch(id, packet, connection);
      }
      return;
    }
    if (data.type === 'profile') await this.events.onHello(id, data.name, data);
    if (data.type === 'message') await this.events.onMessage(id, data);
    if (data.type === 'ack') await this.events.onAck(id, data.id);
    if (data.type === 'typing') this.events.onTyping(id, data.active);
    if (data.type === 'edit') await this.events.onEdit(id, data);
    if (data.type === 'delete') await this.events.onDelete(id, data.ids);
    if (data.type === 'pin') await this.events.onPin(id, data.id, data.pinned);
    if (data.type === 'react') await this.events.onReact(id, data.id, data.key, data.on);
    if (data.type === 'read') await this.events.onRead?.(id, data.upTo);
    if (data.type === 'pollvote') await this.events.onPollVote?.(id, data.pid, data.opt);
  }

  async send(id, data) {
    if (!this.isOpen(id)) return false;
    const connection = this.connections.get(id);
    try {
      if (data.type === 'e2-hello' || data.type === 'hello') { connection.send(data); return true; }
      const session = connection.e2Session;
      if (session?.ready) {
        if (!session.canSend) return false;                 // responder waits for the first ratchet step
        connection.send(session.encrypt(encodeText(JSON.stringify(data))));
        return true;
      }
      if (connection.e2Seen) return false;                  // never fall back to plaintext after E2EE was offered
      if (connection.mt && connection.mtSession?.ready && data.type !== 'mt-hello') {
        connection.send(await connection.mtSession.seal(data));
      } else connection.send(data);
      return true;
    }
    catch { return false; }
  }

  updateProfile(profile) {
    this.profile = profile;
    for (const id of this.connections.keys()) this.send(id, { ...this.helloPacket(), type: 'profile' });
  }

  // Session revocation: drop the live channel and its keys; the next connection runs a
  // fresh handshake (new ephemeral keys, new ratchet).
  revoke(id) { this.closeContact(id); }

  closeContact(id) {
    this.mtSessions.delete(id);
    this.connections.get(id)?.e2Session?.close();
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
