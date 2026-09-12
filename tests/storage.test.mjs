import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { Store } from '../web/lib/storage.mjs';
const password = 'local-secret-1234';
const profile = { name: 'private_nickname', phone: '+380501234567' };
const chat = { id: 'libo-0123456789abcdef0123456789abcdef', name: 'private_contact', messages: [{ text: 'private-message-1234' }] };
async function setup() {
  const store = await new Store('test-' + crypto.randomUUID()).open();
  await store.setMeta('profile', profile); await store.setMeta('identity', { privateKey: 'private-identity-key' });
  await store.setMeta('settings', { turnPassword: 'private-TURN-secret' }); await store.setMeta('drafts', { [chat.id]: 'private-draft' });
  await store.putChat(chat); return store;
}
async function rawSnapshot(store) {
  return { meta: await store.raw('meta', 'readonly', s => s.getAll()), chats: await store.raw('chats', 'readonly', s => s.getAll()), vault: await store.raw('vault', 'readonly', s => s.getAll()) };
}
test('an enabled vault encrypts all private records and opaque IDs; locks across reload', async () => {
  const store = await setup(); await store.migrate(password);
  const raw = JSON.stringify(await rawSnapshot(store));
  for (const value of [profile.name, profile.phone, chat.id, chat.name, 'private-message-1234', 'private-identity-key', 'private-TURN-secret', 'private-draft', password]) assert.equal(raw.includes(value), false, value);
  assert.deepEqual(await store.getMeta('profile'), profile); assert.deepEqual(await store.getChats(), [chat]);
  await store.lock(); assert.equal(store.locked, true); assert.equal(store.key, null); assert.equal(store.indexKey, null);
  await assert.rejects(store.getMeta('profile'), /VAULT_LOCKED/);
  await assert.rejects(store.setMeta('profile', {}), /VAULT_LOCKED/);
  store.db.close(); const restored = await new Store(store.name).open();
  assert.equal(restored.locked, true); await assert.rejects(restored.unlock('wrong-but-long-password'), /PASSWORD_WRONG/);
  await restored.unlock(password); assert.deepEqual(await restored.getChats(), [chat]);
  restored.db.close();
});
test('password rotation and vault disable are atomic and preserve content', async () => {
  const store = await setup(); await store.migrate(password);
  const before = await rawSnapshot(store);
  await store.migrate('different-secret-5678'); const after = await rawSnapshot(store);
  assert.notEqual(before.vault[0].salt, after.vault[0].salt); assert.notEqual(before.chats[0].id, after.chats[0].id);
  await store.lock(); await assert.rejects(store.unlock(password)); await store.unlock('different-secret-5678');
  assert.deepEqual(await store.getMeta('profile'), profile);
  await store.disableVault('different-secret-5678'); assert.equal(store.vault, null);
  assert.deepEqual((await rawSnapshot(store)).chats, [chat]); assert.deepEqual(await store.getChats(), [chat]);
  store.db.close();
});
test('aborted migration leaves every record and descriptor in the previous state', async () => {
  const store = await setup(), before = await rawSnapshot(store);
  const transaction = store.db.transaction.bind(store.db);
  store.db.transaction = (names, mode) => { const tx = transaction(names, mode); if (mode === 'readwrite' && Array.isArray(names)) queueMicrotask(() => tx.abort()); return tx; };
  await assert.rejects(store.migrate(password));
  assert.equal(store.vault, null); assert.deepEqual(await rawSnapshot(store), before);
  store.db.transaction = transaction; await store.migrate(password);
  const protectedBefore = await rawSnapshot(store);
  store.db.transaction = (names, mode) => { const tx = transaction(names, mode); if (mode === 'readwrite' && Array.isArray(names)) queueMicrotask(() => tx.abort()); return tx; };
  await assert.rejects(store.migrate('', true)); assert.deepEqual(await rawSnapshot(store), protectedBefore);
  assert.deepEqual(await store.getMeta('profile'), profile); store.db.close();
});
test('concurrent writes are serialized around migration; deletes use opaque IDs', async () => {
  const store = await setup();
  await Promise.all([store.migrate(password), store.setMeta('later', 'private-later'), store.putChat({ ...chat, name: 'private-updated' })]);
  assert.equal(await store.getMeta('later'), 'private-later'); assert.equal((await store.getChats())[0].name, 'private-updated');
  assert.equal(JSON.stringify(await rawSnapshot(store)).includes('private-'), false);
  await store.deleteChat(chat.id); assert.deepEqual(await store.getChats(), []); store.db.close();
});
