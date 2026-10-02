const DB_NAME = 'libo-messenger-v2';
const DB_VERSION = 1;
const VAULT_META = 'vault';

const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

// 2.8.7: chat records and the device identity are stored encrypted (AES-256-GCM).
// The vault key never exists in plaintext inside IndexedDB:
//   * in the Android app the raw key is wrapped by an AES key that lives in Android
//     Keystore (hardware-backed where the device supports it) via the native bridge;
//   * in a browser a non-extractable WebCrypto key object is stored instead — the
//     browser hands out only encrypt/decrypt operations, never the key bytes.
export class Store {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('meta');
        request.result.createObjectStore('chats', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Закройте другие вкладки LIBO и обновите страницу.'));
    });
    this.db.onversionchange = () => this.db.close();
    await this.openVault();
    return this;
  }

  run(name, mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(name, mode);
      let request;
      try { request = operation(tx.objectStore(name)); } catch (error) { reject(error); return; }
      // Resolve on transaction commit, not request success: delivery ACKs mean durably stored.
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error || request.error);
      tx.onabort = () => reject(tx.error || new Error('Не удалось сохранить данные.'));
    });
  }

  // ------------------------------------------------------------------ vault ----
  async openVault() {
    const bridge = globalThis.LiboAndroid;
    const native = !!(bridge && typeof bridge.keystoreWrap === 'function' && typeof bridge.keystoreUnwrap === 'function');
    const stored = await this.getMeta(VAULT_META);
    this.vaultKind = 'browser';
    if (native) {
      try {
        let raw;
        if (stored?.kind === 'keystore' && typeof stored.wrapped === 'string') {
          const unwrapped = bridge.keystoreUnwrap(stored.wrapped);
          if (!unwrapped) throw new Error('keystore unwrap failed');
          raw = unb64(unwrapped);
        } else {
          raw = crypto.getRandomValues(new Uint8Array(32));
          const wrapped = bridge.keystoreWrap(b64(raw));
          if (!wrapped) throw new Error('keystore wrap failed');
          await this.setMeta(VAULT_META, { kind: 'keystore', wrapped, createdAt: Date.now() });
        }
        this.key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        raw.fill(0);
        this.vaultKind = typeof bridge.keystoreHardwareBacked === 'function' && bridge.keystoreHardwareBacked() ? 'hardware' : 'keystore';
      } catch (error) {
        console.warn('LIBO vault: Android Keystore unavailable, using browser key', error);
        this.key = null;
      }
    }
    if (!this.key) {
      if (stored?.kind === 'browser' && stored.key) this.key = stored.key;
      else {
        this.key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await this.setMeta(VAULT_META, { kind: 'browser', key: this.key, createdAt: Date.now() });
      }
    }
  }

  async seal(value, label) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(value));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(label) }, this.key, plain);
    return { iv, ct: new Uint8Array(ct) };
  }

  async openSealed(box, label) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv, additionalData: new TextEncoder().encode(label) }, this.key, box.ct);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ------------------------------------------------------------------- meta ----
  getMeta(key) { return this.run('meta', 'readonly', store => store.get(key)); }
  setMeta(key, value) { return this.run('meta', 'readwrite', store => store.put(value, key)); }
  deleteMeta(key) { return this.run('meta', 'readwrite', store => store.delete(key)); }

  async getSecret(key) {
    const box = await this.getMeta(key);
    if (!box || !box.sealed) return null;
    try { return await this.openSealed(box, `meta:${key}`); } catch { return null; }
  }
  async setSecret(key, value) {
    return this.setMeta(key, { sealed: true, ...(await this.seal(value, `meta:${key}`)) });
  }

  // ------------------------------------------------------------------ chats ----
  async getChats() {
    const records = await this.run('chats', 'readonly', store => store.getAll());
    const chats = [];
    const legacy = [];
    for (const record of records) {
      if (record.sealed) {
        try { chats.push(await this.openSealed(record, `chat:${record.id}`)); }
        catch { console.warn('LIBO vault: cannot open chat record', record.id); }
      } else { chats.push(record); legacy.push(record); }
    }
    // One-time migration: plaintext records written by 2.8.1 and earlier are re-encrypted.
    for (const chat of legacy) { try { await this.putChat(chat); } catch { /* keep plaintext record until storage recovers */ } }
    return chats;
  }
  async putChat(chat) {
    const box = await this.seal(chat, `chat:${chat.id}`);
    return this.run('chats', 'readwrite', store => store.put({ id: chat.id, sealed: true, ...box }));
  }
  deleteChat(id) { return this.run('chats', 'readwrite', store => store.delete(id)); }
}
