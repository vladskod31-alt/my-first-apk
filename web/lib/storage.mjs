const DB_NAME = 'libo-messenger-v2';
const DB_VERSION = 3;

// Chats contain only message metadata. Attachment bytes live in their own stores so
// a 100 MB upload never serialises an entire chat or blocks the message UI.
export class Store {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('chats')) db.createObjectStore('chats', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('attachments')) db.createObjectStore('attachments', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('attachmentChunks')) {
          const chunks = db.createObjectStore('attachmentChunks', { keyPath: ['fileId', 'index'] });
          chunks.createIndex('byFile', 'fileId', { unique: false });
        } else {
          const chunks = request.transaction.objectStore('attachmentChunks');
          if (!chunks.indexNames.contains('byFile')) chunks.createIndex('byFile', 'fileId', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Закройте другие вкладки LIBO и обновите страницу.'));
    });
    this.db.onversionchange = () => this.db.close();
    return this;
  }

  run(names, mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(names, mode);
      let request;
      try { request = operation(tx, Array.isArray(names) ? null : tx.objectStore(names)); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error || request?.error || new Error('Не удалось сохранить данные.'));
      tx.onabort = () => reject(tx.error || new Error('Не удалось сохранить данные.'));
    });
  }

  getMeta(key) { return this.run('meta', 'readonly', (_tx, store) => store.get(key)); }
  setMeta(key, value) { return this.run('meta', 'readwrite', (_tx, store) => store.put(value, key)); }
  getChats() { return this.run('chats', 'readonly', (_tx, store) => store.getAll()); }
  putChat(chat) { return this.run('chats', 'readwrite', (_tx, store) => store.put(chat)); }
  deleteChat(id) { return this.run('chats', 'readwrite', (_tx, store) => store.delete(id)); }

  getAttachment(id) { return this.run('attachments', 'readonly', (_tx, store) => store.get(id)); }
  getAttachments() { return this.run('attachments', 'readonly', (_tx, store) => store.getAll()); }
  putAttachment(attachment) { return this.run('attachments', 'readwrite', (_tx, store) => store.put(attachment)); }
  deleteAttachment(id) { return this.run('attachments', 'readwrite', (_tx, store) => store.delete(id)); }

  async updateAttachment(id, patch) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('attachments', 'readwrite');
      const store = tx.objectStore('attachments');
      const get = store.get(id);
      let next;
      get.onsuccess = () => {
        if (!get.result) { tx.abort(); return; }
        next = { ...get.result, ...(typeof patch === 'function' ? patch(get.result) : patch), id };
        store.put(next);
      };
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => resolve(next);
      tx.onerror = () => reject(tx.error || get.error || new Error('Не удалось обновить вложение.'));
      tx.onabort = () => reject(tx.error || new Error('Вложение не найдено.'));
    });
  }

  // Returns true only when this is a new chunk. A receipt is sent after this
  // transaction commits, so it is safe for the sender to discard/retry that part.
  async putAttachmentChunk(fileId, index, blob) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('attachmentChunks', 'readwrite');
      const store = tx.objectStore('attachmentChunks');
      const get = store.get([fileId, index]);
      let inserted = false;
      get.onsuccess = () => {
        if (!get.result) {
          inserted = true;
          store.put({ fileId, index, blob, size: blob.size });
        }
      };
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => resolve(inserted);
      tx.onerror = () => reject(tx.error || get.error || new Error('Не удалось сохранить часть файла.'));
      tx.onabort = () => reject(tx.error || new Error('Не удалось сохранить часть файла.'));
    });
  }

  getAttachmentChunks(fileId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('attachmentChunks', 'readonly');
      const index = tx.objectStore('attachmentChunks').index('byFile');
      const request = index.getAll(IDBKeyRange.only(fileId));
      request.onsuccess = () => resolve((request.result || []).sort((a, b) => a.index - b.index));
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error || request.error);
    });
  }

  async getContiguousChunkCount(fileId) {
    const chunks = await this.getAttachmentChunks(fileId);
    let next = 0;
    for (const chunk of chunks) {
      if (chunk.index !== next) break;
      next++;
    }
    return next;
  }

  deleteAttachmentChunks(fileId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('attachmentChunks', 'readwrite');
      const index = tx.objectStore('attachmentChunks').index('byFile');
      const request = index.openCursor(IDBKeyRange.only(fileId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || request.error || new Error('Не удалось очистить части файла.'));
    });
  }

  async clearAttachment(id) {
    await Promise.all([this.deleteAttachment(id), this.deleteAttachmentChunks(id)]);
  }
}
