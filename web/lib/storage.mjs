const DB_NAME = 'libo-messenger-v2';
const DB_VERSION = 1;

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

  getMeta(key) { return this.run('meta', 'readonly', store => store.get(key)); }
  setMeta(key, value) { return this.run('meta', 'readwrite', store => store.put(value, key)); }
  getChats() { return this.run('chats', 'readonly', store => store.getAll()); }
  putChat(chat) { return this.run('chats', 'readwrite', store => store.put(chat)); }
  deleteChat(id) { return this.run('chats', 'readwrite', store => store.delete(id)); }
}
