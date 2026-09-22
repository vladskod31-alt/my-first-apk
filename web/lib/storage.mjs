// Локальное хранилище LIBO: IndexedDB + шифрование записей «at rest».
//
// Схема защиты локальных данных (ничего из перечисленного не лежит в открытом виде):
//   мастер-ключ AES-256-GCM (неизвлекаемый CryptoKey в хранилище `vault`)
//        ↓
//   шифрование каждой записи чата (собственный случайный nonce, AAD с id записи)
//        ↓
//   записи в IndexedDB
// Приватные ключи идентичности лежат отдельно и шифруются слоем KeyVault
// (Android Keystore, когда мост доступен). Пароли не хранятся вообще — только PBKDF2-хеш.

const DB_NAME = 'libo-messenger-v2';
const DB_VERSION = 2;
const RECORD_AAD = 'libo/db/v3';

const encoder = new TextEncoder();

function randomNonce() {
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  return nonce;
}

const toB64 = bytes => btoa(String.fromCharCode(...bytes));
const fromB64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

// Мастер-ключ базы: неизвлекаемый (extractable=false), поэтому его байты нельзя
// прочитать даже из кода страницы. Живёт в отдельном хранилище IndexedDB `vault`.
export async function loadOrCreateMasterKey(store) {
  const existing = await store.getKey('records');
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await store.putKey('records', key);
  return key;
}

// Шифрование произвольной записи перед записью в БД и расшифровка после чтения.
export class RecordCipher {
  constructor(key) { this.key = key; }

  async seal(value, id = '') {
    const plain = encoder.encode(JSON.stringify(value));
    const nonce = randomNonce();
    const cipher = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(`${RECORD_AAD}|${id}`) }, this.key, plain,
    ));
    return { __libo: 3, id, n: toB64(nonce), c: toB64(cipher) };
  }

  async open(record) {
    // Записи, созданные ранними версиями, читаются как есть и перешифруются при следующем сохранении.
    if (!record || record.__libo !== 3) return record;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(record.n), additionalData: encoder.encode(`${RECORD_AAD}|${record.id ?? ''}`) }, this.key, fromB64(record.c),
      );
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      return null;                       // подмена/сбой ключа: запись не отдаётся наружу
    }
  }
}

export class Store {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('chats')) db.createObjectStore('chats', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('vault')) db.createObjectStore('vault');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Закройте другие вкладки LIBO и обновите страницу.'));
    });
    this.db.onversionchange = () => this.db.close();
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

  // Шифр записей подключается после открытия базы (см. app.js).
  setCipher(cipher) { this.cipher = cipher; }

  getMeta(key) { return this.run('meta', 'readonly', store => store.get(key)); }
  setMeta(key, value) { return this.run('meta', 'readwrite', store => store.put(value, key)); }
  deleteMeta(key) { return this.run('meta', 'readwrite', store => store.delete(key)); }

  getKey(name) { return this.run('vault', 'readonly', store => store.get(name)); }
  putKey(name, value) { return this.run('vault', 'readwrite', store => store.put(value, name)); }
  deleteKey(name) { return this.run('vault', 'readwrite', store => store.delete(name)); }

  async getChats() {
    const rows = await this.run('chats', 'readonly', store => store.getAll());
    if (!this.cipher) return rows;
    const opened = await Promise.all(rows.map(row => this.cipher.open(row)));
    return opened.filter(Boolean);
  }

  async putChat(chat) {
    const record = this.cipher ? await this.cipher.seal(chat, chat.id) : chat;
    return this.run('chats', 'readwrite', store => store.put(record));
  }

  deleteChat(id) { return this.run('chats', 'readwrite', store => store.delete(id)); }

  // Полная очистка секретов на устройстве (выход из аккаунта / отзыв устройства).
  async wipeSecrets() {
    await this.run('vault', 'readwrite', store => store.clear());
    await this.run('meta', 'readwrite', store => store.delete('vault:identity'));
  }
}
