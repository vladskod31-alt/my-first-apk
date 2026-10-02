import Peer from 'peerjs';
import { parseSignalingUrl, makeIceServers, validatePacket } from './core.mjs';
import { MtSession } from './mtproto.mjs';
import { BtConnection } from './bluetooth.mjs';

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
      connection.send({ v: 1, type: 'hello', id: this.profile.id, name: this.profile.name });
    });
    let count = 0;
    let startedAt = Date.now();
    connection.on('data', async raw => {
      if (Date.now() - startedAt > 10_000) { count = 0; startedAt = Date.now(); }
      if (++count > 160) { connection.close(); return; }
      const data = validatePacket(raw);
      if (!data) { connection.close(); return; }
      if (data.type === 'hello') {
        if (data.id !== id) { connection.close(); return; }
        clearTimeout(timeout);
        this.timers.delete(timeout);
        connection.liboHello = true;
        this.attempts.delete(id);
        this.connections.set(id, connection);
        // Do not process messages until the contact record has been persisted.
        connection.liboReady = Promise.resolve(this.events.onHello(id, data.name));
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

  isOpen(id) { const conn = this.connections.get(id); return !!(conn?.open && conn.liboHello); }

  // ---------------------------------------------------------------- Bluetooth --
  // 2.8.7: Bluetooth P2P sockets join the same connection map as WebRTC links. The
  // native side knows nothing about personal codes, so a fresh socket waits here until
  // the remote hello reveals who is on the other end; from that moment on, messages,
  // the MT layer and delivery acks behave exactly like on WebRTC. Sockets are tracked
  // by their native token: when both devices dial each other, two sockets to the same
  // address exist for a moment and the tie-break below closes the loser.
  attachBluetooth(link) {
    this.bt = link;
    this.btPending = new Map();
    link.on('connected', event => {
      const connection = new BtConnection(link, event.address, !!event.incoming, event.socket ?? null);
      this.btPending.set(connection.socket ?? connection, connection);
      const timeout = this.later(() => {
        if (this.btPending?.get(connection.socket ?? connection) === connection) connection.close();
      }, 15_000);
      connection.on('close', () => {
        clearTimeout(timeout);
        this.timers.delete(timeout);
        this.dropBluetooth(connection.socket, connection.address);
      });
      // Announce ourselves at once: the peer adopts the socket only after a hello.
      link.send(event.address, { v: 1, type: 'hello', id: this.profile.id, name: this.profile.name }, event.socket ?? null);
    });
    link.on('data', (event, packet) => void this.bluetoothData({ ...event, packet }));
    link.on('disconnected', event => this.dropBluetooth(event.socket, event.address));
  }

  dropBluetooth(socket, address) {
    const key = socket ?? address;
    const pending = this.btPending?.get(key);
    if (pending) { this.btPending.delete(key); pending.open = false; }
    for (const [id, connection] of [...this.connections]) {
      const same = socket != null ? connection.socket === socket : connection.address === address;
      if (connection.kind !== 'bt' || !same) continue;
      this.connections.delete(id);
      this.mtSessions.delete(id);
      connection.open = false;
      this.events.onContactState(id, 'offline');
    }
  }

  async bluetoothData(event) {
    const packet = validatePacket(event && event.packet ? event.packet : event);
    const key = event.socket ?? event.address;
    const connection = this.btPending?.get(key) || this.findBluetoothSocket(event.socket);
    if (!connection || !connection.open || !packet) return;
    if (connection.liboHello) {
      await this.dispatch(connection.peer, packet, connection);
      return;
    }
    const hello = packet;
    if (hello.type !== 'hello' || !this.events.isAllowed(hello.id)) { connection.close(); return; }
    const id = hello.id;
    // Both devices may dial each other at the same time: keep the socket opened by
    // the smaller personal code, exactly like the WebRTC tie-break in bind().
    const existing = this.connections.get(id);
    const keepIncoming = this.profile.id > id;
    if (existing && existing.open && existing.liboHello) {
      if (connection.incoming !== keepIncoming) { connection.close(); return; }
      existing.close();
    }
    this.btPending.delete(key);
    connection.peer = id;
    connection.liboHello = true;
    this.connections.set(id, connection);
    this.events.onContactState(id, 'connecting');
    connection.liboReady = Promise.resolve(this.events.onHello(id, hello.name));
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
  }

  findBluetoothSocket(socket) {
    for (const connection of this.connections.values()) {
      if (connection.kind === 'bt' && connection.socket === socket) return connection;
    }
    return null;
  }

  /** Address of the live Bluetooth link for a personal code, for the UI badge. */
  bluetoothAddress(id) {
    const connection = this.connections.get(id);
    return connection?.kind === 'bt' && connection.open ? connection.address : '';
  }


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
      if (connection.mt && connection.mtSession?.ready && data.type !== 'mt-hello') {
        connection.send(await connection.mtSession.seal(data));
      } else connection.send(data);
      return true;
    }
    catch { return false; }
  }

  updateProfile(profile) {
    this.profile = profile;
    for (const id of this.connections.keys()) {
      this.send(id, { v: 1, type: 'hello', id: profile.id, name: profile.name });
    }
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
