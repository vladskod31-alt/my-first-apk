import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#chat-list .chat-row')).toHaveCount(1);
  await expect(page.locator('#network-status')).toContainText('Вы в сети');
}
async function profile(page, name) {
  await page.locator('#profile-button').click();
  await page.locator('#profile-name').fill(name);
  await page.locator('#settings-form').getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
}
async function code(page) {
  await page.locator('.invite-card').click();
  const result = await page.locator('#my-code').innerText();
  await page.locator('#invite-dialog [data-close]').click();
  return result;
}
async function add(page, peerCode) {
  await page.locator('.new-chat-button').click();
  await page.locator('#contact-code').fill(peerCode);
  await page.locator('#add-contact-form').getByRole('button', { name: 'Добавить контакт' }).click();
  await expect(page.locator('#new-dialog')).not.toBeVisible();
}
async function send(page, text) {
  await page.locator('#message-input').fill(text);
  await page.locator('#send-button').click();
  await expect(page.locator('#messages .message-text').filter({ hasText: text })).toBeVisible();
}

test('real welcome, no invented contacts, valid QR and source links', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await expect(page.getByRole('heading', { name: /Хороший разговор/ })).toBeVisible();
  const ownCode = await code(page);
  expect(ownCode).toMatch(/^LIBO:libo-[a-f0-9]{32}$/);
  await page.locator('.invite-card').click();
  await expect(page.locator('#invite-qr svg')).toHaveCount(1);
  await expect(page.locator('#invite-qr svg path, #invite-qr svg rect')).not.toHaveCount(0);
  expect(await page.locator('.github-link').first().getAttribute('href')).toContain('vladskod31-alt/my-first-apk');
  expect(errors).toEqual([]);
});

test('saved messages, literal HTML, drafts, search, theme and reload', async ({ page }) => {
  await ready(page);
  await page.locator('#nav-saved').click();
  await expect(page.locator('#send-button')).toBeDisabled();
  await page.locator('#message-input').fill('   ');
  await expect(page.locator('#send-button')).toBeDisabled();
  const payload = '<img src=x onerror="window.injected=true"> Привет 💜';
  await send(page, payload);
  await expect(page.locator('.message-status')).toHaveAttribute('data-status', 'local');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await expect(page.locator('#messages img')).toHaveCount(0);
  await page.locator('#message-input').fill('Незаконченная мысль');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await page.locator('#nav-saved').click();
  await expect(page.locator('.message-text')).toHaveText(payload);
  await expect(page.locator('#message-input')).toHaveValue('Незаконченная мысль');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#message-search-toggle').click();
  await page.locator('#message-search').fill('нет-совпадений');
  await expect(page.locator('.conversation-empty')).toContainText('Ничего не найдено');
  await page.locator('#message-search').fill('Привет');
  await expect(page.locator('.message-text')).toHaveText(payload);
});

test('mobile navigation, input validation, profile and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await profile(page, 'Оля');
  const ownCode = await code(page);
  await page.locator('.new-chat-button').click();
  await page.locator('#contact-code').fill('wrong');
  await page.locator('#add-contact-form button[type=submit]').click();
  await expect(page.locator('#contact-error')).toBeVisible();
  await page.locator('#contact-code').fill(ownCode);
  await page.locator('#add-contact-form button[type=submit]').click();
  await expect(page.locator('#contact-error')).toContainText('Это ваш код');
  await page.locator('#new-dialog [data-close]').click();
  await page.locator('#nav-saved').click();
  await send(page, 'Проверка на небольшом экране');
  await expect(page.locator('#composer')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.locator('#chat-back').click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('#shell')).not.toHaveClass(/chat-open/);
});

test('text export contains notes but never private contact identity', async ({ page }) => {
  await ready(page);
  const ownCode = await code(page);
  await page.locator('#nav-saved').click();
  await send(page, 'Заметка для экспорта');
  await page.locator('#chat-more').click();
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#export-chat').click();
  const download = await pendingDownload;
  const stream = await download.createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk.toString();
  const backup = JSON.parse(text);
  expect(backup.chats[0].messages[0].text).toBe('Заметка для экспорта');
  expect(text).not.toContain(ownCode.replace('LIBO:', ''));
  expect(text).not.toContain('turnPassword');
});

test('two independent clients exchange text, delivery ACK, reply and real photo', async ({ page: alice, browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const bob = await context.newPage();
  const errors = [];
  alice.on('pageerror', e => errors.push(e.message));
  bob.on('pageerror', e => errors.push(e.message));
  await ready(alice);
  await ready(bob);
  await profile(alice, 'Аня');
  await profile(bob, 'Богдан');
  await add(alice, await code(bob));
  await expect(alice.locator('#chat-presence')).toContainText('В сети');
  await expect(bob.locator('.chat-row').filter({ hasText: 'Аня' })).toBeVisible();
  await bob.locator('.chat-row').filter({ hasText: 'Аня' }).click();
  await expect(bob.locator('#request-bar')).toBeVisible();
  await bob.locator('#accept-request').click();
  await send(alice, 'Привет с первого устройства!');
  await expect(bob.locator('.message-text')).toHaveText('Привет с первого устройства!');
  await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'delivered');
  await bob.locator('.message-row').hover();
  await bob.locator('.reply-message').click();
  await send(bob, 'Привет, Аня! Сообщение пришло.');
  await expect(alice.locator('.incoming .message-text')).toHaveText('Привет, Аня! Сообщение пришло.');
  await expect(alice.locator('.incoming .message-quote')).toContainText('Привет с первого устройства!');
  await expect(bob.locator('.outgoing .message-status')).toHaveAttribute('data-status', 'delivered');
  await alice.locator('#photo-input').setInputFiles({
    name: 'pixel.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6q1EAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(alice.locator('#attachment-preview')).toBeVisible();
  await alice.locator('#send-button').click();
  await expect(bob.locator('.message-photo img')).toHaveCount(1);
  await expect.poll(() => bob.locator('.message-photo img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await expect(alice.locator('.outgoing .message-status').last()).toHaveAttribute('data-status', 'delivered');
  expect(errors).toEqual([]);
  await context.close();
});

test('offline queue survives sender reload and is delivered exactly once after reconnect', async ({ page: alice, browser }) => {
  const bobContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  let bob = await bobContext.newPage();
  await ready(alice); await ready(bob);
  await profile(alice, 'Отправитель'); await profile(bob, 'Получатель');
  const bobCode = await code(bob);
  await add(alice, bobCode);
  await expect(alice.locator('#chat-presence')).toContainText('В сети');
  await bob.locator('.chat-row').filter({ hasText: 'Отправитель' }).click();
  await bob.locator('#accept-request').click();
  await bob.close();
  // Reset the sender connection so this exercises a genuinely offline transport, not a buffered channel.
  await alice.locator('#reconnect').click();
  await send(alice, 'Доставить после возвращения');
  await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'queued');
  await alice.reload();
  await alice.locator('.chat-row').filter({ hasText: 'Получатель' }).click();
  await expect(alice.locator('.message-text')).toHaveText('Доставить после возвращения');
  bob = await bobContext.newPage();
  await bob.goto('/');
  await expect(bob.locator('#network-status')).toContainText('Вы в сети');
  await bob.locator('.chat-row').filter({ hasText: 'Отправитель' }).click();
  await expect(bob.locator('.message-text')).toHaveText('Доставить после возвращения', { timeout: 40_000 });
  await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'delivered');
  await alice.locator('#reconnect').click();
  await expect(alice.locator('#chat-presence')).toContainText('В сети', { timeout: 30_000 });
  await expect(bob.locator('.message-text')).toHaveCount(1);
  await bobContext.close();
});
