import { CloudApi } from './cloud-api.mjs';
import { fingerprint, hashHex, publicKeyText } from './crypto.mjs';
import { makeBundle, makeRecoveryBackup, verifyBundle, verifyEnvelope, sealEnvelope, openEnvelope } from './cloud-crypto.mjs';
import { validatePacket, normalizePeerId } from './core.mjs';

export class CloudTransport {
  constructor(events) { this.events = events; this.peers = new Map(); this.attempts = new Map(); this.cursor = 0; this.stopped = true; this.generation = 0; }
  start(profile, settings, identity, cloud) {
    this.stop(); this.profile = profile; this.identity = identity; this.cloud = cloud; this.settings = settings;
    this.stopped = false; this.ready = false; this.cursor = Number.isSafeInteger(cloud?.cursor) ? cloud.cursor : 0;
    this.controller = new AbortController(); const generation = this.generation;
    this.events.onState('connecting');
    this.boot = this.connectServer(generation).catch(error => {
      if (this.stopped || generation !== this.generation) return;
      this.ready = false; this.events.onState('offline', error.message);
      this.retry = setTimeout(() => { if (!this.stopped) this.events.onRestart(); }, 10000);
    });
  }
  async connectServer(generation) {
    if (!this.cloud?.mailbox || !this.cloud?.recoverySecret || !this.settings.cloudUrl) throw new Error('CLOUD_NOT_CONFIGURED');
    const api = new CloudApi(this.settings.cloudUrl); this.api = api;
    const features = await api.features(); if (features.protocol !== 1 || !features.offlineDelivery) throw new Error('CLOUD_INVALID');
    this.bundle = await makeBundle(this.profile, this.identity, this.cloud.mailbox);
    const backup = await makeRecoveryBackup(this.cloud.recoverySecret, this.profile, this.identity, this.cloud.mailbox);
    const session = await api.signIn(this.bundle, this.identity, this.cloud.deviceId, backup, { signal: this.controller.signal, notificationToken: this.cloud.server === api.base ? this.cloud.notificationToken || '' : '' });
    if (this.stopped || generation !== this.generation) return;
    if (!/^[A-Za-z0-9_-]{43}$/.test(session.token || '') || !/^[A-Za-z0-9_-]{43}$/.test(session.notificationToken || '') || publicKeyText(session.bundle?.identity) !== publicKeyText(this.identity.publicKey)) throw new Error('CLOUD_INVALID');
    api.token = session.token;
    await this.events.onCloudAuthorized({ token: session.token, notificationToken: session.notificationToken, notificationCursor: session.notificationCursor, expiresAt: session.expiresAt, server: api.base });
    if (this.stopped || generation !== this.generation) return;
    await api.setBlocked(this.events.blockedIds(), this.controller.signal);
    this.ready = true; this.events.onState('ready'); this.events.onReady();
    await this.sync();
    if (!this.stopped && generation === this.generation) this.timer = setInterval(() => { void this.sync(); }, 2500);
  }
  async connect(id) {
    if (this.stopped || !this.ready || !this.events.isAllowed(id)) return false;
    try { await this.ensurePeer(id); return true; }
    catch (error) { if (!this.stopped) { this.events.onContactState(id, 'offline'); this.events.onCryptoError(id, error.message); } return false; }
  }
  async ensurePeer(id) {
    if (this.peers.has(id)) return this.peers.get(id);
    if (this.attempts.has(id)) return this.attempts.get(id);
    const generation = this.generation;
    const task = (async () => {
      this.events.onContactState(id, 'connecting');
      const bundle = await verifyBundle((await this.api.directory(id, this.controller.signal)).bundle);
      if (bundle.id !== id || this.stopped || generation !== this.generation) throw new Error('CLOUD_STOPPED');
      await this.events.onIdentity(id, bundle.name, await fingerprint(bundle.identity), bundle.identity);
      await this.events.onHello(id, bundle.name);
      if (this.stopped || generation !== this.generation) throw new Error('CLOUD_STOPPED');
      this.peers.set(id, bundle); this.events.onContactState(id, 'cloud'); this.events.onConnected(id);
      return bundle;
    })();
    this.attempts.set(id, task);
    try { return await task; } finally { if (this.attempts.get(id) === task) this.attempts.delete(id); }
  }
  isOpen(id) { return !!(this.ready && !this.stopped && this.peers.has(id)); }
  async send(id, value) {
    const packet = validatePacket(value);
    if (!packet || packet.type === 'typing' || this.stopped || !this.ready || !this.events.isAllowed(id)) return false;
    const generation = this.generation;
    try {
      const peer = await this.ensurePeer(id);
      if (this.stopped || generation !== this.generation) return false;
      if (packet.type === 'message') {
        const incoming = await sealEnvelope(this.profile, this.identity, peer, packet);
        const outgoing = await sealEnvelope(this.profile, this.identity, this.bundle, packet, { peer: id, peerName: peer.name, peerKey: peer.identity });
        if (this.stopped || generation !== this.generation) return false;
        await this.api.sendMessage(id, incoming, outgoing, this.controller.signal);
      } else {
        // Stable IDs make control retries idempotent, even if the HTTP response was lost.
        const eventId = await hashHex(`LIBO-CONTROL-2.3:${this.profile.id}>${id}:` + JSON.stringify(packet));
        const envelope = await sealEnvelope(this.profile, this.identity, peer, packet, { id: eventId });
        if (this.stopped || generation !== this.generation) return false;
        await this.api.sendControl(envelope, this.controller.signal);
        if (packet.type === 'read' && !this.stopped && generation === this.generation) await this.events.onReadAck(id, packet.ids);
      }
      return !this.stopped && generation === this.generation;
    } catch (error) {
      if (!this.stopped && generation === this.generation) this.events.onCryptoError(id, error.message);
      return false;
    }
  }
  async sync() {
    if (this.stopped || !this.ready || this.syncing) return;
    this.syncing = true; const generation = this.generation;
    try {
      let more = true, pages = 0;
      while (more && !this.stopped && generation === this.generation && pages++ < 20) {
        const response = await this.api.history(this.cursor, this.controller.signal);
        if (this.stopped || generation !== this.generation) return;
        if (!Array.isArray(response.items) || response.items.length > 10) throw new Error('CLOUD_INVALID');
        for (const item of response.items) {
          if (this.stopped || generation !== this.generation) return;
          if (!Number.isSafeInteger(item.seq) || item.seq <= this.cursor) throw new Error('CLOUD_INVALID');
          try {
            const envelope = await verifyEnvelope(item.envelope);
            if (envelope.to !== this.profile.id) throw new Error('CLOUD_INVALID');
            if (this.stopped || generation !== this.generation) return;
            const archived = envelope.from === this.profile.id;
            if (!archived && (envelope.peer !== envelope.from || envelope.peerName !== envelope.name || publicKeyText(envelope.peerKey) !== publicKeyText(envelope.senderKey))) throw new Error('CLOUD_INVALID');
            const peerId = archived ? envelope.peer : envelope.from;
            this.syncPeer = peerId;
            if (envelope.kind === 'message' && this.events.hasCloudMessage(peerId, envelope.id)) { await this.advance(item.seq, generation); continue; }
            if (envelope.kind !== 'message' && !this.events.hasContact(peerId)) { await this.advance(item.seq, generation); continue; }
            if (!this.events.isAllowed(peerId)) { await this.advance(item.seq, generation); continue; }
            if (archived && publicKeyText(envelope.senderKey) !== publicKeyText(this.identity.publicKey)) throw new Error('CRYPTO_KEY_CHANGED');
            await this.events.onIdentity(peerId, envelope.peerName, await fingerprint(envelope.peerKey), envelope.peerKey);
            const { packet } = await openEnvelope(this.cloud.mailbox, this.profile.id, envelope, archived ? this.identity.publicKey : envelope.peerKey);
            if (this.stopped || generation !== this.generation) return;
            await this.events.onHello(peerId, envelope.peerName);
            if (archived) {
              if (packet.type !== 'message') throw new Error('CLOUD_INVALID');
              await this.events.onCloudSent(peerId, packet);
            } else {
              if (packet.type === 'message') await this.events.onMessage(peerId, packet);
              if (packet.type === 'ack') await this.events.onAck(peerId, packet.id);
              if (packet.type === 'read') await this.events.onRead(peerId, packet.ids);
              if (packet.type === 'read-ack') await this.events.onReadAck(peerId, packet.ids);
            }
            if (this.stopped || generation !== this.generation) return;
            await this.advance(item.seq, generation);
          } catch (error) {
            const code = error.message;
            const invalid = ['CLOUD_INVALID', 'CRYPTO_INVALID', 'CRYPTO_SIGNATURE', 'CRYPTO_KEY_CHANGED', 'CLOUD_REQUEST_PENDING'].includes(code) || error.name === 'OperationError';
            if (!invalid) throw error;
            if (this.stopped || generation !== this.generation) return;
            const peerId = normalizePeerId(item.envelope?.from === this.profile.id ? item.envelope.peer : item.envelope?.from);
            const reason = ['CRYPTO_KEY_CHANGED', 'CLOUD_REQUEST_PENDING'].includes(code) ? code : 'CLOUD_INVALID';
            await this.events.onCloudDeferred({ seq: item.seq, peer: peerId || '', reason });
            if (peerId) this.events.onCryptoError(peerId, reason);
            // No delivery ACK. Ciphertext remains on the server for explicit retry;
            // one corrupt/changed-key item must not block unrelated conversations.
            await this.advance(item.seq, generation, false);
          }
        }
        more = !!response.hasMore && !!response.items.length;
      }
      if (!this.stopped) this.events.onCloudSync(Date.now());
    } catch (error) {
      if (!this.stopped && generation === this.generation) {
        this.events.onCloudError(error.message);
        if (error.message === 'CRYPTO_KEY_CHANGED' && this.syncPeer) this.events.onCryptoError(this.syncPeer, error.message);
        if (error.message === 'CLOUD_AUTH_REQUIRED') { this.ready = false; this.events.onState('offline', error.message); this.retry = setTimeout(() => { if (!this.stopped) this.events.onRestart(); }, 8000); }
      }
    } finally { if (generation === this.generation) this.syncing = false; }
  }
  async advance(cursor, generation, processed = true) {
    await this.events.onCloudCursor(cursor, processed);
    if (!this.stopped && generation === this.generation) this.cursor = cursor;
  }
  async updateBlocked() { if (this.ready && !this.stopped) await this.api.setBlocked(this.events.blockedIds(), this.controller.signal); }
  updateProfile(profile) { this.profile = profile; }
  closeContact(id) { this.peers.delete(id); }
  stop() {
    this.stopped = true; this.ready = false; this.generation++; this.syncing = false;
    clearInterval(this.timer); clearTimeout(this.retry); this.controller?.abort();
    this.peers.clear(); this.attempts.clear();
    this.identity = null; this.profile = null; this.cloud = null; this.settings = null; this.bundle = null;
    if (this.api) this.api.token = ''; this.api = null;
  }
}

export class DeliveryTransport {
  constructor(events, DirectTransport) { this.events = events; this.DirectTransport = DirectTransport; this.isCloud = false; }
  start(profile, settings, identity, cloud) {
    this.stop(); this.isCloud = !!settings.cloudEnabled;
    this.impl = this.isCloud ? new CloudTransport(this.events) : new this.DirectTransport(this.events);
    this.impl.start(profile, settings, identity, cloud);
  }
  stop() { this.impl?.stop(); this.impl = null; }
  connect(id) { return this.impl?.connect(id) || false; }
  isOpen(id) { return this.impl?.isOpen(id) || false; }
  send(id, packet) { return this.impl?.send(id, packet) || Promise.resolve(false); }
  closeContact(id) { this.impl?.closeContact(id); }
  updateProfile(profile) { this.impl?.updateProfile(profile); }
  updateBlocked() { return this.isCloud ? this.impl?.updateBlocked() : Promise.resolve(); }
  sync() { return this.isCloud ? this.impl?.sync() : Promise.resolve(); }
}
