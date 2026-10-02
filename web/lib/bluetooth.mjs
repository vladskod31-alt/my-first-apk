// 2.8.7 Bluetooth P2P: adapts native RFCOMM sockets (Android bridge `LiboAndroid.bt*`)
// to the same connection interface PeerJS gives the Transport. The radio carries only
// opaque JSON frames; the Transport runs its usual signed E2EE hello + Double Ratchet
// over it, so Bluetooth chats are protected exactly like WebRTC chats and no new
// cryptography is introduced here.
import { validatePacket } from './core.mjs';

const MAX_FRAME = 2 * 1024 * 1024;

class BluetoothConnection {
  constructor(manager, link, peer, meta) {
    this.manager = manager;
    this.link = link;
    this.peer = peer;
    this.label = 'libo-v2';
    this.bluetooth = true;
    this.meta = meta;
    this.open = false;
    this.handlers = new Map();
  }
  on(event, handler) { this.handlers.set(event, handler); return this; }
  emit(event, payload) { try { this.handlers.get(event)?.(payload); } catch { /* handler errors must not kill the socket */ } }
  send(data) {
    if (!this.open) return;
    let json;
    try { json = JSON.stringify(data); } catch { return; }
    if (json.length > MAX_FRAME) return;
    if (!this.manager.bridge.btSend(this.link, json)) this.close();
  }
  close() {
    if (!this.open && this.closed) return;
    this.closed = true;
    const wasOpen = this.open;
    this.open = false;
    this.manager.links.delete(this.link);
    try { this.manager.bridge.btClose(this.link); } catch { /* native side may already be gone */ }
    if (wasOpen) this.emit('close');
    this.manager.onChange?.();
  }
}

export class BluetoothManager {
  constructor({ transport, onChange, onDevices, onToast }) {
    this.transport = transport;
    this.onChange = onChange;
    this.onDevices = onDevices;
    this.onToast = onToast;
    this.links = new Map();
    this.devices = new Map();
    this.scanning = false;
    this.bridge = window.LiboAndroid;
  }

  get supported() { return !!(this.bridge?.btStatus); }

  status() {
    if (!this.supported) return { available: false };
    try { return JSON.parse(this.bridge.btStatus()); } catch { return { available: false }; }
  }

  hasPermissions() { return this.supported && this.bridge.btHasPermissions(); }
  requestPermissions() { if (this.supported) this.bridge.btRequestPermissions(); }

  start(myId) {
    this.myId = myId;
    if (!this.supported) return false;
    if (!this.hasPermissions()) { this.requestPermissions(); return false; }
    return this.bridge.btStart(myId);
  }

  discoverable() { if (this.supported) this.bridge.btDiscoverable(); }

  scan() {
    if (!this.supported) return false;
    if (!this.hasPermissions()) { this.requestPermissions(); return false; }
    this.devices.clear();
    this.scanning = true;
    this.onDevices?.();
    const ok = this.bridge.btScan();
    if (!ok) { this.scanning = false; this.onDevices?.(); }
    return ok;
  }

  stopScan() { if (this.supported) this.bridge.btStopScan(); this.scanning = false; }

  connect(address) {
    if (!this.supported || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(address)) return false;
    return this.bridge.btConnect(address);
  }

  stop() {
    for (const connection of [...this.links.values()]) connection.close();
    if (this.supported) this.bridge.btStop();
  }

  connections() { return [...this.links.values()].filter(c => c.open); }

  // Called from native code on the UI thread via window.LiboBT.onEvent.
  onEvent(event) {
    if (!event || typeof event !== 'object') return;
    switch (event.ev) {
      case 'open': {
        if (this.links.has(event.link) || typeof event.peer !== 'string') return;
        const connection = new BluetoothConnection(this, event.link, event.peer, { address: event.address, name: event.name, incoming: !!event.incoming });
        this.links.set(event.link, connection);
        connection.open = true;
        this.transport.bind(connection, !!event.incoming);
        connection.emit('open');
        this.onToast?.(`Bluetooth: канал с ${event.name || 'устройством'} открыт`);
        this.onChange?.();
        break;
      }
      case 'data': {
        const connection = this.links.get(event.link);
        if (!connection?.open || typeof event.json !== 'string' || event.json.length > MAX_FRAME) return;
        let packet;
        try { packet = JSON.parse(event.json); } catch { connection.close(); return; }
        if (!validatePacket(packet)) { connection.close(); return; }
        connection.emit('data', packet);
        break;
      }
      case 'close': {
        const connection = this.links.get(event.link);
        if (!connection) return;
        this.links.delete(event.link);
        if (connection.open) { connection.open = false; connection.emit('close'); }
        this.onChange?.();
        break;
      }
      case 'devices': {
        for (const device of event.devices || []) {
          if (typeof device.address !== 'string') continue;
          this.devices.set(device.address, { address: device.address, name: device.name || '', bonded: !!device.bonded });
        }
        this.onDevices?.();
        break;
      }
      case 'scan': this.scanning = !!event.active; this.onDevices?.(); break;
      case 'connect-failed': this.onToast?.(`Не удалось подключиться к ${event.name || event.address}. Откройте LIBO и Bluetooth на обоих устройствах.`, true); break;
      case 'perm': if (event.granted && this.myId) this.start(this.myId); else if (!event.granted) this.onToast?.('Без разрешения Bluetooth подключение невозможно.', true); this.onChange?.(); break;
      case 'resumed': if (this.myId) this.start(this.myId); this.onChange?.(); break;
      case 'status': this.onChange?.(); break;
      case 'error': this.onToast?.(event.message || 'Ошибка Bluetooth', true); break;
      default: break;
    }
  }
}
