import Peer from 'peerjs';
import { parseSignalingUrl, makeIceServers, validatePacket } from './core.mjs';
import { SecureSession, SessionState, SecureLogger } from './security.mjs';

export class Transport {
  constructor(events) {
    this.events = events;
    this.connections = new Map();
    this.attempts = new Map();
    this.secureSessions = new Map();
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
          void this.startSecure(connection);
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

  // E2EE v3: каждая сторона объявляет эфемерный ключ X25519 и свою идентичность
  // Ed25519 в подписанном приглашении. Сессия принадлежит собеседнику, а не отдельному
  // WebRTC-соединению: ссылка может быть заменена, а ключи чата — нет.
  async startSecure(connection) {
    const id = connection.peer;
    try {
      const session = await this.secureSession(id, connection);
      if (!session) return;
      connection.secureSession = session;
      const hello = await session.hello();
      if (connection.helloPub === hello.kxPub) return;
      connection.helloPub = hello.kxPub;
      connection.send({ ...hello, v: 1, type: 'sec-hello' });
    } catch (error) {
      SecureLogger.debug('transport: приглашение E2EE не отправлено', { reason: String(error && error.message) });
      connection.secureSession = null;
    }
  }

  // Сессия создаётся по требованию: идентичность берётся из vault, доверенный ключ
  // собеседника — из карточки чата (закрепление TOFU из app.js).
  async secureSession(id, connection) {
    let session = this.secureSessions.get(id);
    if (!session) {
      if (!this.events.identity) return null;
      session = new SecureSession({
        identity: this.events.identity(),
        conversationId: id,
        selfId: this.profile?.id ?? null,
        trusted: this.events.trustedKey?.(id) ?? null,
      });
      this.secureSessions.set(id, session);
    }
    if (!session.identity) session.identity = this.events.identity();
    return session;
  }

  // Сброс E2EE-сессии: старые ключи стираются, следующее соединение начинает новое
  // рукопожатие. Используется кнопкой «Сбросить сессию» и при отзыве устройств.
  dropSession(id) {
    const session = this.secureSessions.get(id);
    if (!session) return false;
    session.state.transition('REVOKED');
    session.ratchet = null;
    session.state = new SessionState('CONNECTING');
    this.secureSessions.delete(id);
    const connection = this.connections.get(id);
    if (connection) { connection.secureSession = null; connection.secure = false; connection.helloPub = ''; }
    return true;
  }

  secureStatus(id) {
    const session = this.secureSessions.get(id);
    return session ? session.describe() : null;
  }

  async dispatch(id, data, connection) {
    if (data.type === 'sec-hello') {
      try {
        const session = await this.secureSession(id, connection);
        if (!session) return;
        connection.secureSession = session;
        const identity = await session.acceptHello(data, { trusted: this.events.trustedKey?.(id) ?? null });
        connection.secure = session.established;
        void this.startSecure(connection);
        this.events.onSecurity?.(id, identity);
      } catch (error) {
        connection.secureSession = null;
        connection.secure = false;
        if (error && error.code === 'IDENTITY_CHANGED') this.events.onIdentityChange?.(id, error.identity);
        else this.events.onSecureDrop?.(id, String(error && error.message));
      }
      return;
    }
    if (data.type === 'envelope') {
      const session = connection.secureSession ?? this.secureSessions.get(id);
      if (!session?.established) return;
      const opened = await session.open(data);
      if (!opened.ok) {
        this.events.onSecureDrop?.(id, opened.reason);
        return;
      }
      const packet = validatePacket(opened.packet);
      if (!packet) return;
      if (!['envelope', 'sec-hello', 'hello'].includes(packet.type)) await this.dispatch(id, packet, connection);
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

  // Ни один пользовательский пакет не уходит открытым текстом: пока E2EE-сессия не
  // установлена, send() возвращает false, а сообщение остаётся в очереди устройства.
  async send(id, data) {
    if (!this.isOpen(id)) return false;
    const connection = this.connections.get(id);
    if (!connection) return false;
    if (data?.type === 'sec-hello') { connection.send(data); return true; }
    const session = connection.secureSession ?? this.secureSessions.get(id);
    if (!session?.established) return false;
    try {
      connection.send(await session.seal(data));
      return true;
    }
    catch (error) {
      SecureLogger.debug('transport: отправка не удалась', { reason: String(error && error.message) });
      return false;
    }
  }
  updateProfile(profile) {
    this.profile = profile;
    for (const id of this.connections.keys()) {
      this.send(id, { v: 1, type: 'hello', id: profile.id, name: profile.name });
    }
  }

  closeContact(id) {
    this.secureSessions.delete(id);
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
    this.secureSessions.clear();
  }
}
