import { test, expect } from '@playwright/test';

const contexts = [];
test.afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });
const name = prefix => prefix + '_' + crypto.randomUUID().slice(0, 7);
const validPixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6q1EAAAAASUVORK5CYII=', 'base64');
async function ready(page, nick = name('new')) {
  await page.goto('/'); await page.locator('#onboarding-name').fill(nick); await page.locator('#onboarding-submit').click();
  await expect(page.locator('#chat-list .chat-row')).toHaveCount(1); return nick;
}
async function second(browser) { const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' }); contexts.push(context); return context; }
async function cloud(page, capture = false) {
  await page.locator('#cloud-entry').click(); await page.locator('#cloud-enabled').check(); await page.locator('#cloud-save').click();
  await expect(page.locator('#recovery-dialog')).toBeVisible();
  let recovery;
  if (capture) {
    const download = page.waitForEvent('download'); await page.locator('#recovery-download').click();
    const stream = await (await download).createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    recovery = Buffer.concat(chunks);
  }
  await page.locator('#recovery-confirmed').check(); await page.locator('#recovery-done').click();
  await expect(page.locator('#recovery-dialog')).not.toBeVisible(); await expect(page.locator('#network-status')).toContainText('Хранилище подключено');
  return recovery;
}
async function add(page, nick) {
  await page.locator('.new-chat-button').click(); await page.locator('#contact-nick').fill('@' + nick); await page.locator('#contact-save').click();
  await expect(page.locator('#new-dialog')).not.toBeVisible();
}
async function send(page, text) {
  await page.locator('#message-input').fill(text); await page.locator('#send-button').click();
  await expect(page.locator('.outgoing .message-text').last()).toContainText(text);
}
async function readCloud(page) {
  return page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open('libo-messenger-v2', 2); request.onsuccess = () => { const db = request.result, query = db.transaction('meta').objectStore('meta').get('cloudConfig'); query.onsuccess = () => { resolve(query.result); db.close(); }; };
  }));
}

test('2.3 capsule appearance, palette, text size and individual chat background survive reload', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); await ready(page);
  await page.locator('#profile-button').click(); await page.locator('#global-appearance').click(); await page.locator('[data-palette="midnight"]').click();
  await page.locator('#appearance-font').evaluate(el => { el.value = '18'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#appearance-save').click(); await expect(page.locator('#appearance-dialog')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe('#c3ff39');
  await page.locator('#nav-saved').click(); await send(page, 'Мой новый интерфейс');
  await expect(page.locator('.message-text')).toHaveCSS('font-size', '18px');
  await page.locator('#chat-more').click(); await page.locator('#chat-appearance').click();
  await page.locator('#appearance-chat').evaluate(el => { el.value = '#123456'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#appearance-save').click(); await expect(page.locator('#appearance-dialog')).not.toBeVisible();
  await expect(page.locator('#messages')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await page.reload(); await page.locator('#nav-saved').click();
  await expect(page.locator('#messages')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await expect(page.locator('.message-text')).toHaveCSS('font-size', '18px');
  await expect(page.locator('#send-button')).toHaveCSS('border-radius', '50%'); expect(errors).toEqual([]);
});

test('custom wallpaper is local, is cleared from locked DOM, and restores after unlock', async ({ page }) => {
  await ready(page); await page.locator('#nav-saved').click();
  await page.locator('#chat-more').click(); await page.locator('#chat-appearance').click();
  await page.locator('#appearance-image-input').setInputFiles({ name: 'background.png', mimeType: 'image/png', buffer: validPixel });
  await expect(page.locator('#appearance-remove-photo')).toBeEnabled();
  await page.locator('#appearance-save').click(); await expect(page.locator('#appearance-dialog')).not.toBeVisible();
  await expect.poll(() => page.locator('#messages').evaluate(el => el.style.backgroundImage.includes('data:image/jpeg'))).toBe(true);
  await page.locator('#profile-button').click(); await page.locator('#vault-enable').click();
  await page.locator('#vault-new').fill('wallpaper-password-123'); await page.locator('#vault-repeat').fill('wallpaper-password-123'); await page.locator('#vault-apply').click();
  await expect(page.locator('#vault-password-dialog')).not.toBeVisible();
  await page.evaluate(() => window.Libo.onBackground()); await expect(page.locator('#lock-screen')).toBeVisible();
  expect(await page.locator('#messages').evaluate(el => el.style.backgroundImage)).toBe('');
  await page.evaluate(() => window.Libo.onForeground()); await expect(page.locator('#unlock-password')).toBeEnabled();
  await page.locator('#unlock-password').fill('wallpaper-password-123'); await page.locator('#unlock-submit').click();
  await expect.poll(() => page.locator('#messages').evaluate(el => el.style.backgroundImage.includes('data:image/jpeg'))).toBe(true);
});

test('cloud queues an encrypted message while recipient is closed, emits a private notice and delivers on return', async ({ page: alice, browser, request }) => {
  const errors = []; alice.on('pageerror', e => errors.push(e.message));
  const context = await second(browser); let bob = await context.newPage(); bob.on('pageerror', e => errors.push(e.message));
  const an = await ready(alice, name('alice')), bn = await ready(bob, name('bob')); await cloud(alice); await cloud(bob);
  const bobCloud = await readCloud(bob); await add(alice, bn); await expect(alice.locator('#chat-presence')).toContainText('Облачная доставка');
  await bob.close(); await send(alice, 'Доставить, пока экран получателя закрыт');
  await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'stored');
  const notice = await request.get('/api/cloud/notifications?after=' + bobCloud.notificationCursor + '&wait=0', { headers: { Authorization: 'Bearer ' + bobCloud.notificationToken } });
  expect(notice.ok()).toBe(true); const value = await notice.json(); expect(value.count).toBe(1); expect(JSON.stringify(value)).not.toContain('Доставить');
  const forbidden = await request.get('/api/cloud/history?after=0', { headers: { Authorization: 'Bearer ' + bobCloud.notificationToken } }); expect(forbidden.status()).toBe(401);
  await alice.reload(); await alice.locator('.chat-row').filter({ hasText: bn }).click(); await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'stored');
  bob = await context.newPage(); bob.on('pageerror', e => errors.push(e.message)); await bob.goto('/');
  await bob.locator('.chat-row').filter({ hasText: an }).click(); await expect(bob.locator('.message-text')).toHaveText('Доставить, пока экран получателя закрыт');
  await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'delivered');
  await bob.locator('#accept-request').click(); await bob.bringToFront(); await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'read');
  expect(errors).toEqual([]);
});

test('a new installation restores cloud keys and history from the recovery file without a plaintext cloud copy', async ({ page: alice, browser }) => {
  const context = await second(browser), bob = await context.newPage();
  const an = await ready(alice, name('sender')), bn = await ready(bob, name('restored')); await cloud(alice); const recovery = await cloud(bob, true);
  await add(alice, bn); await send(alice, 'Восстановить на новом устройстве'); await expect(alice.locator('.message-status')).toHaveAttribute('data-status', /stored|delivered/);
  await context.close();
  const fresh = await second(browser), restored = await fresh.newPage(); await restored.goto('/'); await expect(restored.locator('#onboarding')).toBeVisible();
  await restored.locator('#cloud-recovery-input').setInputFiles({ name: 'LIBO-Recovery-Key.json', mimeType: 'application/json', buffer: recovery });
  await expect(restored.locator('#onboarding')).not.toBeVisible(); await expect(restored.locator('#network-status')).toContainText('Хранилище подключено');
  await restored.locator('.chat-row').filter({ hasText: an }).click(); await expect(restored.locator('.message-text')).toHaveText('Восстановить на новом устройстве');
  await restored.locator('#profile-button').click(); await expect(restored.locator('#profile-name')).toHaveValue(bn); await expect(restored.locator('#profile-name')).toBeDisabled();
});

test('cloud configuration without a host does not pretend that delivery is enabled', async ({ page }) => {
  await ready(page); await page.locator('#cloud-entry').click(); await page.locator('#cloud-url').fill(''); await page.locator('#cloud-enabled').check(); await page.locator('#cloud-save').click();
  await expect(page.locator('#cloud-error')).toContainText('HTTPS-сервера'); await expect(page.locator('#cloud-state-title')).toHaveText('Хранилище не подключено');
});

test('Android notification consent gates background configuration; the bridge receives no message decryption keys', async ({ page }) => {
  await page.addInitScript(() => {
    window.bgConfigs = []; let permission = 'denied';
    window.LiboAndroid = { setDarkTheme() {}, setSecureWindow() {}, setLanguage() {}, copyText() {},
      notificationStatus: () => JSON.stringify({ available: true, permission, running: !!window.bgConfigs.at(-1)?.enabled }),
      requestNotifications: () => { permission = 'granted'; window.Libo?.onNotificationPermission(); },
      configureBackground: text => window.bgConfigs.push(JSON.parse(text)), openBatterySettings() {} };
  });
  await ready(page); await cloud(page);
  await page.locator('#profile-button').click(); await expect(page.locator('#background-messages')).toBeDisabled();
  await page.locator('#notification-permission').click(); await expect(page.locator('#background-messages')).toBeEnabled();
  await page.locator('#background-messages').check(); await page.locator('#settings-save').click();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.bgConfigs.some(c => c.enabled))).toBe(true);
  const config = await page.evaluate(() => window.bgConfigs.findLast(c => c.enabled));
  expect(Object.keys(config).sort()).toEqual(['cursor', 'enabled', 'owner', 'server', 'token']); expect(config.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await page.evaluate(() => window.Libo.onBackground()); expect(await page.evaluate(() => window.bgConfigs.at(-1).enabled)).toBe(true);
});
