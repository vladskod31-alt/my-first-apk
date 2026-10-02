// LIBO 2.8.7 — Bluetooth P2P transport (web half).
//
// The Android shell (BluetoothP2P.java) owns the sockets; this module turns its JSON
// events into a PeerJS-shaped connection so the existing Transport/MT layer works over
// Bluetooth without changes. Pure helpers are exported for unit tests.

export const BT_FRAME_MAX = 8_000_000;
export const BT_NAME_PREFIX = 'LIBO-';

const ADDRESS = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

export function normalizeBtAddress(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return ADDRESS.test(text) ? text.toUpperCase() : null;
}

/** 0-3 bars for the device list; missing RSSI (classic discovery) reports -1. */
export function rssiLevel(rssi) {
  if (!Number.isFinite(rssi) || rssi >= 0) return -1;
  if (rssi >= -60) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -88) return 1;
  return 0;
}

/** Short human label for a found device: LIBO short id, Bluetooth name or address tail. */
export function peerLabel(peer) {
  if (!peer) return 'Невідомий пристрій';
  if (peer.shortId) return `${BT_NAME_PREFIX}${peer.shortId}`;
  if (peer.name) return peer.name;
  return peer.address ? `…${peer.address.slice(-8)}` : 'Невідомий пристрій';
}

export function shortIdFromCode(peerId) {
  return String(peerId || '').replace(/^libo-/, '').slice(0, 8);
}

/**
 * Thin wrapper over the `LiboAndroid` bridge. In a browser without the bridge every
 * call degrades to "unsupported", and the UI explains that Bluetooth P2P lives in the
 * Android build.
 */
export class BluetoothLink {
  constructor(bridge = typeof window === 'undefined' ? null : window.LiboAndroid) {
    this.bridge = bridge && typeof bridge.btState === 'function' ? bridge : null;
    this.handlers = {};
    this.peers = new Map();
    this.links = new Map();
    this.state = { supported: false, enabled: false, permissions: false, listening: false, scanning: false, shortId: '' };
    if (this.bridge && typeof window !== 'undefined') window.LiboBluetooth = this;
  }

  get supported() { return !!this.bridge; }

  on(name, handler) { this.handlers[name] = handler; return this; }
  fire(name, ...args) { this.handlers[name]?.(...args); }

  /** Called from Java with already-parsed JSON events. */
  onEvent(event) {
    if (!event || typeof event !== 'object') return;
    switch (event.type) {
      case 'state':
        this.state = { ...this.state, ...event };
        this.peers = new Map((event.peers || []).map(peer => [peer.address, peer]));
        this.links = new Map((event.links || []).map(link => [link.address, link]));
        this.fire('state', this.state);
        break;
      case 'peer': {
        const known = this.peers.get(event.address);
        const peer = { ...known, ...event };
        delete peer.type;
        this.peers.set(event.address, peer);
        this.fire('peer', peer, !known);
        break;
      }
      case 'connected':
        this.links.set(event.socket ?? event.address, {
          address: event.address, socket: event.socket ?? null, name: event.name,
          connected: true, incoming: !!event.incoming,
        });
        this.fire('connected', event);
        break;
      case 'disconnected': {
        const key = event.socket ?? event.address;
        const link = this.links.get(key);
        this.links.delete(key);
        this.fire('disconnected', event, link);
        break;
      }
      case 'data': {
        let packet = null;
        try { packet = JSON.parse(event.text); } catch { packet = null; }
        if (packet) this.fire('data', event, packet);
        break;
      }
      case 'error':
        this.fire('error', event.text);
        break;
      default:
        break;
    }
  }

  refresh() {
    if (!this.bridge) return this.state;
    try {
      const raw = JSON.parse(this.bridge.btState());
      this.state = { ...this.state, ...raw };
      this.peers = new Map((raw.peers || []).map(peer => [peer.address, peer]));
      this.links = new Map((raw.links || []).map(link => [link.address, link]));
    } catch { /* bridge busy */ }
    return this.state;
  }

  enable() { this.bridge?.btEnable(); }
  requestPermissions() { this.bridge?.btRequestPermissions(); }
  listen(shortId) { this.bridge?.btListen(shortId || ''); }
  stopListen() { this.bridge?.btStopListen(); }
  discover() { this.bridge?.btDiscover(); }
  stopDiscover() { this.bridge?.btStopDiscover(); }
  connect(address) { return !!this.bridge && !!normalizeBtAddress(address) && (this.bridge.btConnect(address), true); }
  disconnect(address) { this.bridge?.btDisconnect(address); }
  stopAll() { this.bridge?.btStopAll(); this.links.clear(); }

  /** Serialises one protocol packet into a Bluetooth frame of one socket. */
  send(address, packet, socket = null) {
    if (!this.bridge) return false;
    const text = JSON.stringify(packet);
    if (text.length > BT_FRAME_MAX) return false;
    if (socket != null && typeof this.bridge.btSendTo === 'function') return this.bridge.btSendTo(socket, text);
    return this.bridge.btSend(address, text);
  }

  closeConnection({ address, socket }) {
    if (socket != null && typeof this.bridge?.btDisconnectToken === 'function') this.bridge.btDisconnectToken(socket);
    else this.bridge?.btDisconnect(address);
  }
}

/**
 * PeerJS-DataConnection-shaped socket over one Bluetooth link. `peer` is filled in
 * after the remote hello reveals the personal code; until then the Transport keeps the
 * socket in its Bluetooth handshake queue.
 */
export class BtConnection {
  constructor(link, address, incoming, socket = null) {
    this.link = link;
    this.kind = 'bt';
    this.address = address;
    this.socket = socket;
    this.incoming = incoming;
    this.peer = null;
    this.label = 'libo-v2';
    this.open = true;
    this.liboHello = false;
    this.listeners = {};
  }

  on(name, handler) { (this.listeners[name] ||= []).push(handler); return this; }
  emit(name, ...args) { for (const handler of this.listeners[name] || []) handler(...args); }

  send(packet) {
    if (!this.open) return false;
    return this.link.send(this.address, packet, this.socket);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.link.closeConnection(this);
    this.emit('close');
  }
}
