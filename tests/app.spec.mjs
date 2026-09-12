import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { peerIdForNickname } from '../web/lib/core.mjs';

const extraContexts = [];
test.afterEach(async () => { for (const c of extraContexts.splice(0)) await c.close(); });
const nickname = prefix => prefix + '_' + crypto.randomUUID().slice(0, 7);
async function ready(page, name = nickname('user'), phone = '') {
  await page.goto('/');
  await expect(page.locator('#onboarding')).toBeVisible();
  await page.locator('#onboarding-name').fill(name);
  if (phone) await page.locator('#onboarding-phone').fill(phone);
  await page.locator('#onboarding-submit').click();
  await expect(page.locator('#chat-list .chat-row')).toHaveCount(1);
  await expect(page.locator('#network-status')).toContainText('Вы в сети');
  return name;
}
async function second(browser) {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  extraContexts.push(context); return context.newPage();
}
async function add(page, name, alias = '', close = false) {
  await page.locator('.new-chat-button').click();
  await page.locator('#contact-nick').fill('@' + name);
  if (alias) await page.locator('#contact-label').fill(alias);
  if (close) await page.locator('#contact-close').check();
  await page.locator('#contact-save').click();
  await expect(page.locator('#new-dialog')).not.toBeVisible();
}
async function send(page, text) {
  const before = await page.locator('.outgoing').count();
  await page.locator('#message-input').fill(text); await page.locator('#send-button').click();
  await expect(page.locator('.outgoing')).toHaveCount(before + 1);
}
async function connect(alice, bob, aliceName, bobName, accept = true) {
  await add(alice, bobName);
  await expect(alice.locator('#chat-presence')).toContainText('В сети · AES');
  await expect(bob.locator('.chat-row').filter({ hasText: aliceName })).toBeVisible();
  if (accept) { await bob.locator('.chat-row').filter({ hasText: aliceName }).click(); await bob.locator('#accept-request').click(); await expect(bob.locator('#request-bar')).not.toBeVisible(); }
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('libo-messenger-v2', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const result = {};
    for (const name of ['meta', 'chats', 'vault']) result[name] = await new Promise((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close(); return result;
  });
}
async function enableVault(page, password = 'my-test-password-123') {
  await page.locator('#profile-button').click(); await page.locator('#vault-enable').click();
  await page.locator('#vault-new').fill(password); await page.locator('#vault-repeat').fill(password); await page.locator('#vault-apply').click();
  await expect(page.locator('#vault-password-dialog')).not.toBeVisible();
}
async function installWireCapture(page) {
  await page.addInitScript(() => {
    window.testWire = [];
    const original = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (data) {
      if (data instanceof ArrayBuffer) window.testWire.push(new TextDecoder().decode(data));
      else if (ArrayBuffer.isView(data)) window.testWire.push(new TextDecoder().decode(data));
      else if (typeof data === 'string') window.testWire.push(data);
      return original.call(this, data);
    };
  });
}

test('mandatory nickname, no invented contacts, no invitation codes or public-source links', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#onboarding')).toBeVisible();
  await expect(page.locator('#onboarding-name')).toHaveValue('');
  await expect(page.locator('#onboarding-name')).toHaveAttribute('placeholder', 'Введите ник');
  await page.locator('#onboarding-submit').click(); await expect(page.locator('#onboarding')).toBeVisible();
  await page.locator('#onboarding-name').fill('bad name'); await page.locator('#onboarding-submit').click();
  await expect(page.locator('#onboarding-error')).toContainText('Без пробелов');
  await page.locator('#onboarding-name').fill(nickname('alice')); await page.locator('#onboarding-submit').click();
  await expect(page.locator('#chat-list .chat-row')).toHaveCount(1);
  await expect(page.locator('#invite-dialog,#my-code,#contact-code,.github-link,#download-apk')).toHaveCount(0);
  await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('saved notes, SVG emoji, literal HTML, durable drafts, search and theme', async ({ page }) => {
  await ready(page); await page.locator('#nav-saved').click();
  await expect(page.locator('#send-button')).toBeDisabled();
  await send(page, '<img src=x onerror="window.injected=true"> Привет 👋🏽 🩷');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await expect(page.locator('.message-status')).toHaveAttribute('data-status', 'local');
  await expect(page.locator('#messages img.emoji')).toHaveCount(2);
  await expect.poll(() => page.locator('#messages img.emoji').first().evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.locator('#message-input').fill('Незаконченная мысль'); await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload(); await page.locator('#nav-saved').click();
  await expect(page.locator('.message-text')).toContainText('Привет');
  await expect(page.locator('#message-input')).toHaveValue('Незаконченная мысль');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#message-search-toggle').click(); await page.locator('#message-search').fill('not-found');
  await expect(page.locator('.conversation-empty')).toContainText('Ничего не найдено');
  await page.locator('#message-search').fill('Привет'); await expect(page.locator('.message-text')).toHaveCount(1);
});

test('contacts, aliases, close friends and phone profile persist on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const own = await ready(page, nickname('olya'), '+380 50 123 45 67');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.locator('.new-chat-button').click(); await page.locator('#contact-nick').fill('@' + own); await page.locator('#contact-save').click();
  await expect(page.locator('#contact-error')).toContainText('Это ваш ник');
  await page.locator('#new-dialog [data-close]').click(); await add(page, nickname('sasha'), 'Саша с работы', true);
  await expect(page.locator('#chat-title')).toHaveText('Саша с работы');
  await expect(page.locator('#chat-favorite')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#chat-back').click(); await page.locator('#filter-close').click(); await expect(page.locator('.chat-row')).toHaveCount(1);
  await page.locator('#nav-contacts').click(); await expect(page.locator('#contacts-list')).toContainText('Саша с работы');
  await page.locator('#contacts-dialog [data-close]').click(); await page.reload();
  await page.locator('#profile-button').click(); await expect(page.locator('#profile-phone')).toHaveValue('+380501234567');
  await expect(page.locator('#phone-status')).toHaveText('Не подтверждён');
  await expect(page.locator('#phone-discoverable')).toBeDisabled();
  await page.locator('#settings-dialog [data-close]').click(); await page.locator('#nav-saved').click(); await send(page, 'На небольшом экране');
  await expect(page.locator('#composer')).toBeInViewport(); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});

test('RU, UK and EN switch chrome and placeholders, never user content; full Emoji 15 SVG pack is offline', async ({ page }) => {
  await ready(page); await page.locator('#nav-saved').click(); await send(page, 'Сегодня — это мой текст');
  await page.locator('#profile-button').click(); await page.locator('#app-language').selectOption('uk');
  await expect(page.locator('#settings-dialog h2')).toHaveText('Налаштування'); await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  await page.locator('#app-language').selectOption('en'); await expect(page.locator('#settings-dialog h2')).toHaveText('Settings');
  await page.locator('#settings-dialog [data-close]').click();
  await expect(page.locator('#message-input')).toHaveAttribute('placeholder', 'Write a message…');
  await expect(page.locator('.message-text')).toHaveText('Сегодня — это мой текст');
  await page.locator('#emoji-button').click(); await page.locator('#emoji-picker input[type=search]').fill('pink heart');
  await page.locator('#emoji-picker').getByRole('button', { name: '🩷', exact: true }).click();
  await expect(page.locator('#message-input')).toHaveValue('🩷');
  await page.locator('#emoji-button').click(); await page.locator('#send-button').click();
  await expect(page.locator('.outgoing').last().locator('img.emoji')).toHaveAttribute('alt', '🩷');
  await page.locator('#nav-emoji').click(); await expect(page.locator('#emoji-channel')).toBeVisible();
  const pending = page.waitForEvent('download'); await page.locator('#download-emoji-pack').click(); const download = await pending;
  const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const files = unzipSync(new Uint8Array(Buffer.concat(chunks)));
  expect(Object.keys(files).filter(name => name.endsWith('.svg'))).toHaveLength(3720); expect(files['ATTRIBUTION.txt']).toBeTruthy(); expect(files['svg/1fa77.svg']).toBeTruthy();
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('unconfigured SMS never marks a number verified or invents a code', async ({ page }) => {
  await ready(page, nickname('phone'), '+12025550123'); await page.locator('#profile-button').click(); await page.locator('#phone-verify').click();
  await expect(page.locator('#phone-dialog')).toBeVisible(); await page.locator('#sms-consent').check(); await page.locator('#sms-send').click();
  await expect(page.locator('#sms-error')).toContainText('SMS-сервис не настроен');
  await expect(page.locator('#sms-code-form')).not.toBeVisible();
  await page.locator('#phone-dialog [data-close]').click(); await page.locator('#profile-button').click();
  await expect(page.locator('#phone-status')).toHaveText('Не подтверждён');
});

test('actual P2P text, replies and photos use ciphertext; delivery is not read until accepted and shown', async ({ page: alice, browser }) => {
  const bob = await second(browser), errors = [];
  for (const p of [alice, bob]) { p.on('pageerror', e => errors.push(e.message)); await installWireCapture(p); }
  const an = await ready(alice, nickname('alice'), '+380501234567'), bn = await ready(bob);
  await connect(alice, bob, an, bn, false);
  const secret = 'PRIVATE-WIRE-TEST-Привіт-123456'; await send(alice, secret);
  await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'delivered');
  await bob.locator('.chat-row').filter({ hasText: an }).click(); await expect(bob.locator('#request-bar')).toBeVisible();
  await bob.bringToFront(); await bob.waitForTimeout(1000);
  await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'delivered');
  await bob.locator('#accept-request').click(); await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'read');
  await bob.locator('.reply-message').click(); await send(bob, 'Получено!');
  await expect(alice.locator('.incoming .message-quote')).toContainText(secret);
  await alice.locator('#photo-input').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6q1EAAAAASUVORK5CYII=', 'base64') });
  await expect(alice.locator('#attachment-preview')).toBeVisible(); await alice.locator('#send-button').click();
  await expect(bob.locator('.message-photo img')).toHaveCount(1);
  await expect.poll(() => bob.locator('.message-photo img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  const wire = await alice.evaluate(() => window.testWire.join('\n'));
  expect(wire.length).toBeGreaterThan(100); expect(wire).toContain('box'); expect(wire).not.toContain(secret); expect(wire).not.toContain('+380501234567'); expect(wire).not.toContain('data:image');
  expect(errors).toEqual([]);
});

test('offscreen messages stay delivered until their own viewport dwell; read status survives a late delivery ACK', async ({ page: alice, browser }) => {
  const bob = await second(browser), an = await ready(alice), bn = await ready(bob); await connect(alice, bob, an, bn);
  for (let i = 0; i < 7; i++) await send(alice, `Сообщение ${i}. ` + 'Длинный текст для проверки экрана. '.repeat(35));
  await expect(bob.locator('.incoming')).toHaveCount(7);
  await bob.bringToFront(); await bob.locator('#messages').evaluate(el => { el.scrollTop = 0; });
  await expect.poll(() => bob.locator('#messages').evaluate(el => el.scrollTop)).toBe(0);
  await send(alice, 'Последнее невидимое сообщение'); await bob.bringToFront();
  await expect(alice.locator('.outgoing .message-status').last()).toHaveAttribute('data-status', 'delivered');
  await bob.waitForTimeout(1100); await expect(alice.locator('.outgoing .message-status').last()).toHaveAttribute('data-status', 'delivered');
  await bob.locator('#messages').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(alice.locator('.outgoing .message-status').last()).toHaveAttribute('data-status', 'read');
  const readId = await alice.locator('.outgoing').last().getAttribute('data-message-id');
  // Inject a delayed ACK through the real receiver transport without exposing a testing API in the app.
  await bob.evaluate(async id => {
    const source = await (await fetch('/app.js')).text();
    const specifier = source.match(/import \{ Transport \} from "([^"]+)"/)[1];
    const { Transport } = await import(specifier); const original = Transport.prototype.send;
    Transport.prototype.send = function(peer, packet) { if (packet.type === 'typing') void original.call(this, peer, { v: 2, type: 'ack', id }); return original.call(this, peer, packet); };
  }, readId);
  await bob.locator('#message-input').fill('Typing generates the late ACK');
  await expect(alice.locator('.outgoing .message-status').last()).toHaveAttribute('data-status', 'read');
  await alice.reload(); await alice.locator('.chat-row').filter({ hasText: bn }).click(); await expect(alice.locator('.outgoing .message-status').last()).toHaveAttribute('data-status', 'read');
});

test('persisted read receipts retry after reload and the user can disable future receipts', async ({ page: alice, browser }) => {
  const bob = await second(browser), an = await ready(alice), bn = await ready(bob); await connect(alice, bob, an, bn);
  await bob.evaluate(async () => {
    const source = await (await fetch('/app.js')).text();
    const specifier = source.match(/import \{ Transport \} from "([^"]+)"/)[1];
    const { Transport } = await import(specifier); const original = Transport.prototype.send;
    Transport.prototype.send = function(id, packet) { return packet.type === 'read' ? Promise.resolve(false) : original.call(this, id, packet); };
  });
  await send(alice, 'Receipt needs a retry'); await bob.bringToFront();
  await expect.poll(async () => (await snapshot(bob)).chats.some(c => c.pendingRead?.length)).toBe(true);
  await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'delivered');
  await bob.reload(); await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'read');
  await expect.poll(async () => (await snapshot(bob)).chats.some(c => c.pendingRead?.length)).toBe(false);
  await bob.locator('#profile-button').click(); await bob.locator('#read-receipts').uncheck(); await bob.locator('#settings-save').click();
  await bob.locator('.chat-row').filter({ hasText: an }).click(); await send(alice, 'Read receipts are now off'); await bob.bringToFront();
  await expect(bob.locator('.message-text').last()).toHaveText('Read receipts are now off');
  await bob.waitForTimeout(1200); await expect(alice.locator('.message-status').last()).toHaveAttribute('data-status', 'delivered');
});

test('changed identity keys block delivery instead of silently trusting a replacement', async ({ page: alice, browser }) => {
  const bob = await second(browser), an = await ready(alice), bn = await ready(bob); await connect(alice, bob, an, bn);
  await send(alice, 'Original identity'); await expect(alice.locator('.message-status')).toHaveAttribute('data-status', /delivered|read/);
  await bob.evaluate(async () => {
    const { createIdentity } = await import('/lib/crypto.mjs'); const identity = await createIdentity();
    const db = await new Promise(resolve => { const r = indexedDB.open('libo-messenger-v2', 2); r.onsuccess = () => resolve(r.result); });
    await new Promise((resolve, reject) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(identity, 'identity'); tx.oncomplete = resolve; tx.onerror = reject; }); db.close();
  });
  await bob.reload(); await alice.locator('#reconnect').click();
  await expect(alice.locator('#chat-presence')).toContainText('Ключ собеседника изменился');
  await send(alice, 'Must not reach a changed key'); await expect(alice.locator('.message-status').last()).toHaveAttribute('data-status', 'queued');
  expect((await snapshot(bob)).chats.flatMap(c => c.messages).some(m => m.text === 'Must not reach a changed key')).toBe(false);
});

test('password vault encrypts private storage, clears the UI on background, unlocks and rotates passwords', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const name = await ready(page, nickname('secret'), '+380501234567'); await page.locator('#nav-saved').click();
  await send(page, 'SECRET-HISTORY-456'); await page.locator('#message-input').fill('SECRET-DRAFT-789'); await enableVault(page);
  const raw = JSON.stringify(await snapshot(page)); for (const value of [name, '+380501234567', 'SECRET-HISTORY-456', 'SECRET-DRAFT-789', 'my-test-password-123']) expect(raw).not.toContain(value);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('SECRET-');
  await page.evaluate(() => window.Libo.onBackground()); await expect(page.locator('#lock-screen')).toBeVisible();
  await expect(page.locator('#messages')).toBeEmpty(); await expect(page.locator('#profile-phone')).toHaveValue('');
  await page.evaluate(() => window.Libo.onForeground()); await expect(page.locator('#unlock-password')).toBeEnabled();
  await page.locator('#unlock-password').fill('wrong-long-password'); await page.locator('#unlock-submit').click(); await expect(page.locator('#unlock-error')).toContainText('Неверный пароль');
  await page.locator('#unlock-password').fill('my-test-password-123'); await page.locator('#unlock-submit').click(); await page.locator('#nav-saved').click();
  await expect(page.locator('.message-text')).toHaveText('SECRET-HISTORY-456'); await expect(page.locator('#message-input')).toHaveValue('SECRET-DRAFT-789');
  await page.locator('#profile-button').click(); await page.locator('#vault-change').click(); await page.locator('#vault-current').fill('my-test-password-123');
  await page.locator('#vault-new').fill('replacement-password-987'); await page.locator('#vault-repeat').fill('replacement-password-987'); await page.locator('#vault-apply').click();
  await expect(page.locator('#vault-password-dialog')).not.toBeVisible(); await page.reload(); await expect(page.locator('#lock-screen')).toBeVisible();
  await page.locator('#unlock-password').fill('my-test-password-123'); await page.locator('#unlock-submit').click(); await expect(page.locator('#unlock-error')).toBeVisible();
  await page.locator('#unlock-password').fill('replacement-password-987'); await page.locator('#unlock-submit').click(); await page.locator('#nav-saved').click();
  await expect(page.locator('.message-text')).toHaveText('SECRET-HISTORY-456'); expect(errors).toEqual([]);
});

test('plaintext export requires confirmation and excludes phones, identity keys and connection secrets', async ({ page }) => {
  await ready(page, nickname('export'), '+380501234567'); await page.locator('#nav-saved').click(); await send(page, 'Заметка для экспорта');
  await page.locator('#chat-more').click(); await page.locator('#export-chat').click(); await expect(page.locator('#confirm-text')).toContainText('незашифрованный');
  const pending = page.waitForEvent('download'); await page.locator('#confirm-action').click(); const download = await pending; const stream = await download.createReadStream();
  let text = ''; for await (const chunk of stream) text += chunk.toString();
  expect(JSON.parse(text).chats[0].messages[0].text).toBe('Заметка для экспорта');
  for (const value of ['+380501234567', 'privateKey', 'turnPassword', 'libo-']) expect(text).not.toContain(value);
});

test('one profile window holds an exclusive lease during vault writes', async ({ page, context }) => {
  await ready(page); const other = await context.newPage(); await other.goto('/');
  await expect(other.locator('#boot-error')).toContainText('уже открыт в другом окне'); await expect(other.locator('#shell')).not.toBeVisible(); await other.close();
});

for (const order of ['lower', 'higher']) test(`offline outgoing queue survives reload and reconnect without duplicates (${order} address)`, async ({ page: alice, browser }) => {
  let bob = await second(browser); const ctx = bob.context();
  let first = nickname('queue_a'), next = nickname('queue_b');
  if ((await peerIdForNickname(first) < await peerIdForNickname(next)) !== (order === 'lower')) [first, next] = [next, first];
  const an = await ready(alice, first), bn = await ready(bob, next); await connect(alice, bob, an, bn);
  await bob.close(); await alice.locator('#reconnect').click(); await send(alice, 'Deliver when you return'); await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'queued');
  await alice.reload(); await alice.locator('.chat-row').filter({ hasText: bn }).click();
  bob = await ctx.newPage(); await bob.goto('/'); await bob.locator('.chat-row').filter({ hasText: an }).click();
  await expect(bob.locator('.message-text')).toHaveText('Deliver when you return');
  await expect(alice.locator('.message-status')).toHaveAttribute('data-status', /delivered|read/);
  await alice.locator('#reconnect').click(); await expect(alice.locator('#chat-presence')).toContainText('В сети'); await expect(bob.locator('.message-text')).toHaveCount(1);
});

test('leaving during password derivation cannot reopen a vault in the background', async ({ page }) => {
  await ready(page); await page.locator('#nav-saved').click(); await send(page, 'SECRET-UNLOCK-RACE'); await enableVault(page);
  await page.locator('#profile-button').click(); await page.locator('#vault-lock').click(); await expect(page.locator('#unlock-password')).toBeEnabled();
  await page.locator('#unlock-password').fill('my-test-password-123'); await page.locator('#unlock-submit').click();
  await page.evaluate(() => window.Libo.onBackground()); await page.waitForTimeout(650);
  await expect(page.locator('#lock-screen')).toBeVisible(); await expect(page.locator('#shell')).not.toBeVisible(); await expect(page.locator('#messages')).toBeEmpty();
  await page.evaluate(() => window.Libo.onForeground());
});

test('a photo selected while the vault is locked is only displayed after unlocking', async ({ page }) => {
  await ready(page); await page.locator('#nav-saved').click(); await enableVault(page);
  await page.evaluate(() => window.Libo.onBackground()); await expect(page.locator('#unlock-password')).toBeEnabled();
  await page.locator('#photo-input').setInputFiles({ name: 'selected.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6q1EAAAAASUVORK5CYII=', 'base64') });
  await expect(page.locator('#attachment-preview')).not.toBeVisible();
  await page.evaluate(() => window.Libo.onForeground()); await page.locator('#unlock-password').fill('my-test-password-123'); await page.locator('#unlock-submit').click();
  await expect(page.locator('#attachment-preview')).toBeVisible(); await expect.poll(() => page.locator('#attachment-image').evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
});

test('dev preview does not expose the account database or private repository files', async ({ request }) => {
  for (const path of ['/home/user/my-first-apk/.local/accounts.sqlite', '/home/user/my-first-apk/server/accounts.mjs', '/home/user/my-first-apk/.git/config']) {
    const response = await request.get('/@fs' + path); expect(response.status()).toBe(403);
  }
});
