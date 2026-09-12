import { VAULT_ITERATIONS, random64, passwordKey, passwordIndexKey, opaqueRecordId, sealRecord, openRecord } from './crypto.mjs';
const DB_NAME = 'libo-messenger-v2';

export class Store {
  constructor(name = DB_NAME) { this.name = name; this.tail = Promise.resolve(); this.key = null; this.indexKey = null; this.vault = null; }
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('meta')) request.result.createObjectStore('meta');
        if (!request.result.objectStoreNames.contains('chats')) request.result.createObjectStore('chats', { keyPath: 'id' });
        if (!request.result.objectStoreNames.contains('vault')) request.result.createObjectStore('vault');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('STORAGE_BLOCKED'));
    });
    this.db.onversionchange = () => { this.key = null; this.indexKey = null; this.db.close(); };
    this.vault = await this.raw('vault', 'readonly', s => s.get('config')) || null;
    return this;
  }
  get locked() { return !!this.vault && !this.key; }
  queue(fn) {
    const task = this.tail.catch(() => {}).then(fn);
    this.tail = task;
    return task;
  }
  raw(name, mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(name, mode);
      let request;
      try { request = operation(tx.objectStore(name)); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error || request.error);
      tx.onabort = () => reject(tx.error || new Error('STORAGE_FAILED'));
    });
  }
  async decode(value, table, id) {
    if (this.locked) throw new Error('VAULT_LOCKED');
    if (value === undefined) return undefined;
    return this.vault ? openRecord(this.key, value, `${table}:${id}`) : value;
  }
  async encode(value, table, id) {
    if (this.locked) throw new Error('VAULT_LOCKED');
    if (!this.vault) return value;
    const storageId = table === 'chats' ? await opaqueRecordId(this.indexKey, id) : id;
    const record = await sealRecord(this.key, value, `${table}:${storageId}`);
    return table === 'chats' ? { id: storageId, ...record } : record;
  }
  getMeta(id) { return this.queue(async () => this.decode(await this.raw('meta', 'readonly', s => s.get(id)), 'meta', id)); }
  setMeta(id, value) { return this.queue(async () => { const record = await this.encode(value, 'meta', id); return this.raw('meta', 'readwrite', s => s.put(record, id)); }); }
  setManyMeta(entries) {
    return this.queue(async () => {
      const records = await Promise.all(Object.entries(entries).map(async ([id, value]) => [id, await this.encode(value, 'meta', id)]));
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('meta', 'readwrite');
        for (const [id, value] of records) tx.objectStore('meta').put(value, id);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('STORAGE_FAILED'));
      });
    });
  }
  getChats() {
    return this.queue(async () => {
      if (this.locked) throw new Error('VAULT_LOCKED');
      const values = await this.raw('chats', 'readonly', s => s.getAll());
      return Promise.all(values.map(value => this.decode(value, 'chats', value.id)));
    });
  }
  putChat(chat) { return this.queue(async () => { const value = await this.encode(chat, 'chats', chat.id); return this.raw('chats', 'readwrite', s => s.put(value)); }); }
  deleteChat(id) { return this.queue(async () => { if (this.locked) throw new Error('VAULT_LOCKED'); const storageId = this.vault ? await opaqueRecordId(this.indexKey, id) : id; return this.raw('chats', 'readwrite', s => s.delete(storageId)); }); }
  async unlock(password) {
    return this.queue(async () => {
      if (!this.vault) return;
      let key;
      try {
        key = await passwordKey(password, this.vault.salt, this.vault.iterations);
        if (await openRecord(key, this.vault.check, 'verifier') !== 'LIBO-VAULT-OK') throw new Error('VAULT_INVALID');
      } catch { throw new Error('PASSWORD_WRONG'); }
      this.indexKey = await passwordIndexKey(password, this.vault.salt);
      this.key = key;
    });
  }
  lock() { return this.queue(() => { this.key = null; this.indexKey = null; }); }
  async migrate(password, disable = false) {
    return this.queue(async () => {
      if (this.locked) throw new Error('VAULT_LOCKED');
      const metaKeys = await this.raw('meta', 'readonly', s => s.getAllKeys());
      const metaValues = await this.raw('meta', 'readonly', s => s.getAll());
      const chats = await this.raw('chats', 'readonly', s => s.getAll());
      const plainMeta = await Promise.all(metaValues.map((v, i) => this.decode(v, 'meta', metaKeys[i])));
      const plainChats = await Promise.all(chats.map(v => this.decode(v, 'chats', v.id)));
      let key = null, indexKey = null, config = null;
      if (!disable) {
        const salt = random64(32);
        key = await passwordKey(password, salt);
        indexKey = await passwordIndexKey(password, salt);
        config = { version: 1, opaqueIds: true, algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: VAULT_ITERATIONS, salt, check: await sealRecord(key, 'LIBO-VAULT-OK', 'verifier') };
      }
      const newMeta = key ? await Promise.all(plainMeta.map((v, i) => sealRecord(key, v, `meta:${metaKeys[i]}`))) : plainMeta;
      const newChats = key ? await Promise.all(plainChats.map(async v => { const id = await opaqueRecordId(indexKey, v.id); return { id, ...await sealRecord(key, v, `chats:${id}`) }; })) : plainChats;
      // One transaction: a crash cannot leave half the history plaintext and half encrypted.
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(['meta', 'chats', 'vault'], 'readwrite');
        const meta = tx.objectStore('meta'), chatStore = tx.objectStore('chats'), vault = tx.objectStore('vault');
        meta.clear(); chatStore.clear(); vault.clear();
        newMeta.forEach((value, i) => meta.put(value, metaKeys[i]));
        newChats.forEach(value => chatStore.put(value));
        if (config) vault.put(config, 'config');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('STORAGE_FAILED'));
      });
      this.key = key; this.indexKey = indexKey; this.vault = config;
    });
  }
  async disableVault(password) {
    await this.unlock(password);
    return this.migrate('', true);
  }
}
