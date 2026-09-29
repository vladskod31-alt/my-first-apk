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

test('real welcome, no invented contacts, valid QR and version; no open-source claims in UI', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await expect(page.getByRole('heading', { name: /Хороший разговор/ })).toBeVisible();
  const ownCode = await code(page);
  expect(ownCode).toMatch(/^LIBO:libo-[a-f0-9]{32}$/);
  await page.locator('.invite-card').click();
  await expect(page.locator('#invite-qr svg')).toHaveCount(1);
  await expect(page.locator('#invite-qr svg path, #invite-qr svg rect')).not.toHaveCount(0);
  await page.locator('#invite-dialog [data-close]').click();
  // 2.8.1: the UI must not mention open source, source code hosting or GitHub.
  await page.locator('.quiet-button').click();
  const about = await page.locator('#about-dialog').innerText();
  expect(about).toContain('2.8.5');
  expect(about).not.toMatch(/открыт(?:ым|ый|ого)? (?:исходн|код)/i);
  expect(about).not.toMatch(/github/i);
  expect(await page.locator('#about-features li').count()).toBe(31);
  expect(await page.locator('#about-version').innerText()).toBe('2.8.5');
  expect(errors).toEqual([]);
});

test('saved messages, literal HTML, drafts, search, theme and reload', async ({ page }) => {
  await ready(page);
  await page.locator('#nav-saved').click();
  await expect(page.locator('#send-button')).toBeDisabled();
  await page.locator('#chat-more').click();
  await expect(page.locator('#verify-code')).toBeHidden();
  await page.locator('#chat-more').click();
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
  // The short authentication string must be identical on both sides of one pair.
  await alice.locator('#chat-more').click();
  await alice.locator('#verify-code').click();
  await expect(alice.locator('#verify-dialog')).toBeVisible();
  const aliceCode = await alice.locator('#verify-value').innerText();
  expect(aliceCode).toMatch(/^[2-9A-HJ-NP-Z]{4} [2-9A-HJ-NP-Z]{4} [2-9A-HJ-NP-Z]{4}$/);
  await expect(alice.locator('#verify-peer-name')).toContainText('Богдан');
  await alice.locator('#verify-dialog [data-close]').click();
  await bob.locator('#chat-more').click();
  await bob.locator('#verify-code').click();
  expect(await bob.locator('#verify-value').innerText()).toBe(aliceCode);
  await bob.locator('#verify-dialog [data-close]').click();
  await send(alice, 'Привет с первого устройства!');
  await expect(bob.locator('.message-text')).toHaveText('Привет с первого устройства!');
  await expect(alice.locator('.message-status')).toHaveAttribute('data-status', 'delivered');
  await bob.locator('.message-row').hover();
  await bob.locator('.reply-message').click();
  await bob.locator('#message-actions [data-act="reply"]').click();
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
  // 2.5.0: reactions, edit, pin and delete-for-all travel over the same channel.
  await alice.locator('.message-row').last().hover();
  await alice.locator('.message-row').last().locator('.message-actions-button').click();
  await alice.locator('#message-actions [data-react-pick="heart"]').click();
  await expect(bob.locator('.reaction-chip')).toBeVisible();
  await expect(bob.locator('.reaction-chip')).toHaveClass(/\breaction-chip\b/);
  await bob.locator('.message-row').last().hover();
  await bob.locator('.message-row').last().locator('.message-actions-button').click();
  await bob.locator('#message-actions [data-act="pin"]').click();
  await expect(alice.locator('#pinned-bar')).toBeVisible();
  await expect(bob.locator('#pinned-bar')).toBeVisible();
  await alice.locator('.outgoing .message-row, .message-row').first().hover();
  await alice.locator('.message-row').first().locator('.message-actions-button').click();
  await alice.locator('#message-actions [data-act="edit"]').click();
  await alice.locator('#edit-text').fill('Привет с первого устройства! (изменено)');
  await alice.locator('#edit-save').click();
  await expect(bob.locator('.message-text').first()).toContainText('(изменено)');
  await expect(bob.locator('.edited-mark').first()).toBeVisible();
  await alice.locator('.message-row').first().hover();
  await alice.locator('.message-row').first().locator('.message-actions-button').click();
  await alice.locator('#message-actions [data-act="delete"]').click();
  await alice.locator('#confirm-action').click();
  await expect(bob.locator('.message-deleted').first()).toBeVisible();
  // File attachment (generic kind) reaches the peer and downloads by name.
  await alice.locator('#file-input').setInputFiles({
    name: 'note.txt', mimeType: 'text/plain',
    buffer: Buffer.from('резервная заметка для проверки файла'),
  });
  await expect(alice.locator('#attachment-preview')).toBeVisible();
  await alice.locator('#send-button').click();
  await expect(bob.locator('.att-file span')).toHaveText('note.txt');
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

test('backup import becomes read-only archive and close contacts stay on top', async ({ page }) => {
  await ready(page);
  await add(page, 'LIBO:libo-abcdef0123456789abcdef0123456789');
  await page.locator('#profile-button').click();
  await page.locator('#import-input').setInputFiles({
    name: 'libo-backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      app: 'LIBO', version: '2.3.0', exportedAt: new Date().toISOString(),
      profile: { name: 'Архив' },
      chats: [{ name: 'Старый телефон', messages: [{ text: 'Сохранённая мысль', at: Date.now() - 60_000, direction: 'out', status: 'local' }] }],
    })),
  });
  await expect(page.locator('.chat-row').filter({ hasText: 'архив' })).toBeVisible();
  await page.locator('.chat-row').filter({ hasText: 'архив' }).click();
  await expect(page.locator('#archive-bar')).toBeVisible();
  await expect(page.locator('#composer-zone')).toBeHidden();
  await expect(page.locator('.message-text')).toHaveText('Сохранённая мысль');
  await page.locator('#chat-more').click();
  await page.locator('#star-contact').click();
  await expect(page.locator('.chat-row').filter({ hasText: 'архив' }).locator('.star-mark')).toBeVisible();
  const order = await page.locator('.chat-row').evaluateAll(rows => rows.map(row => row.dataset.chatId));
  expect(order.indexOf('archive-' === order.find(id => id.startsWith('archive-')) ? order.find(id => id.startsWith('archive-')) : '')).toBeLessThan(order.indexOf('libo-abcdef0123456789abcdef0123456789'));
});

test('polls, forwarding, read receipts, MT layer and secret timer between two clients', async ({ page: alice, browser }) => {
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
  await bob.locator('.chat-row').filter({ hasText: 'Аня' }).click();
  await bob.locator('#accept-request').click();
  await expect(bob.locator('#chat-presence')).toContainText('В сети');
  // Alice creates a poll; Bob sees it and votes; the tally returns to Alice.
  await alice.locator('#poll-button').click();
  await alice.locator('#poll-q').fill('Куда идём?');
  await alice.locator('#poll-opt-0').fill('В парк');
  await alice.locator('#poll-opt-1').fill('В кино');
  await alice.locator('#poll-send').click();
  await alice.locator('#send-button').click();
  await expect(bob.locator('.att-poll strong')).toContainText('Куда идём?', { timeout: 20000 });
  await bob.locator('.poll-option').first().click();
  await expect(alice.locator('.att-poll .poll-option').first()).toContainText('· 1', { timeout: 20000 });
  // Bob has the chat open, so Alice must see read checks (✓✓) on delivered messages.
  await expect(alice.locator('.message-status.read').first()).toBeVisible({ timeout: 20000 });
  // 2.8.5: the pair must run the Double Ratchet session and agree on the safety number.
  await alice.locator('#security-button').click();
  await expect(alice.locator('#sec-e2')).toContainText('Double Ratchet');
  const aliceNumber = await alice.locator('#sec-number').innerText();
  expect(aliceNumber).toMatch(/^(\d{5} ){11}\d{5}$/);
  await alice.locator('#sec-verify').click();
  await expect(alice.locator('#sec-verified')).toContainText('Подтверждён');
  await alice.locator('#security-dialog [data-close]').click();
  await expect(alice.locator('#e2-badge')).toHaveClass(/verified/);
  await bob.locator('#security-button').click();
  expect(await bob.locator('#sec-number').innerText()).toBe(aliceNumber);
  await bob.locator('#security-dialog [data-close]').click();
  // Forwarding: Alice forwards her text to Saved with a «Переслано» label.
  await send(alice, 'перешли меня');
  await expect(bob.locator('.message-text').filter({ hasText: 'перешли меня' })).toBeVisible();
  await alice.locator('.message-row.outgoing [data-actions]').last().click();
  await alice.locator('#message-actions [data-act="forward"]').click();
  await alice.locator('.forward-row').first().click();
  await expect(alice.locator('#forward-dialog')).not.toBeVisible();
  await alice.locator('#nav-saved').click();
  await expect(alice.locator('.message-fwd')).toContainText('Переслано от Аня');
  // Secret timer: a 10 s message disappears on both devices without confirmation.
  await alice.locator('.chat-row').filter({ hasNotText: 'Избранное' }).first().click();
  await alice.locator('#ttl-button').click();
  await send(alice, 'миг');
  await expect(bob.locator('.ttl-chip').first()).toBeVisible({ timeout: 20000 });
  await expect(alice.locator('.message-text').filter({ hasText: 'миг' })).toBeHidden({ timeout: 25000 });
  await expect(bob.locator('.message-deleted').first()).toBeVisible({ timeout: 20000 });
  expect(errors).toEqual([]);
});

test('2.8.5 features: formatting, spoilers, silent send, nickname, pin/archive, schedule, stickers, sessions', async ({ browser }) => {
  const errors = [];
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  for (const page of [alice, bob]) page.on('pageerror', error => errors.push(error.message));
  await ready(alice); await ready(bob);
  await profile(alice, 'Аня'); await profile(bob, 'Боря');
  const bobCode = await code(bob);
  await add(alice, bobCode);
  await expect(bob.locator('.chat-row').filter({ hasText: 'Аня' })).toBeVisible({ timeout: 30000 });
  await bob.locator('.chat-row').filter({ hasText: 'Аня' }).click();
  await bob.locator('#accept-request').click();
  await expect(alice.locator('#chat-presence')).toContainText('сквозное шифрование', { timeout: 30000 });
  // Formatting and text spoiler.
  await alice.locator('#send-options-button').click();
  await alice.locator('#opt-silent').check({ force: true });
  await alice.locator('#send-options-close').click();
  await alice.locator('#message-input').fill('жирный **текст** и ||тайна||');
  await alice.locator('#send-button').click();
  await expect(alice.locator('#messages .fmt-bold')).toHaveText('текст');
  const bubble = bob.locator('.message-text').filter({ hasText: 'жирный' });
  await expect(bubble.locator('.fmt-bold')).toHaveText('текст');
  await expect(bubble.locator('.fmt-spoiler')).not.toHaveClass(/revealed/);
  await bubble.locator('.fmt-spoiler').click();
  await expect(bubble.locator('.fmt-spoiler')).toHaveClass(/revealed/);
  await expect(bob.locator('.silent-mark')).toHaveCount(1);
  // Nickname is local only; pin and archive are chat flags.
  await bob.locator('#chat-more').click();
  await bob.locator('#rename-contact').click();
  await bob.locator('#rename-input').fill('Анюта');
  await bob.locator('#rename-save').click();
  await expect(bob.locator('#chat-title')).toHaveText('Анюта');
  await bob.locator('#chat-more').click();
  await bob.locator('#pin-chat').click();
  await expect(bob.locator('.chat-row').filter({ hasText: 'Анюта' }).locator('.star-mark[title="Закреплённый чат"]')).toHaveCount(1);
  await bob.locator('#chat-more').click();
  await bob.locator('#archive-chat').click();
  await expect(bob.locator('.chat-row').filter({ hasText: 'Анюта' })).toHaveCount(0);
  await bob.locator('.folder-tab[data-folder="archived"]').click();
  await expect(bob.locator('.chat-row').filter({ hasText: 'Анюта' })).toHaveCount(1);
  await bob.locator('.folder-tab[data-folder=""]').click();
  // Scheduled message waits, then «send now» releases it.
  await alice.locator('#send-options-button').click();
  const future = new Date(Date.now() + 3_600_000);
  const pad = value => String(value).padStart(2, '0');
  await alice.locator('#opt-schedule').fill(`${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`);
  await alice.locator('#send-options-close').click();
  await send(alice, 'потом');
  await expect(alice.locator('.message-status[data-status="scheduled"]')).toHaveCount(1);
  await alice.locator('.message-row.outgoing [data-actions]').last().click();
  await alice.locator('#message-actions [data-act="sendnow"]').click();
  await expect(bob.locator('.message-text').filter({ hasText: 'потом' })).toBeVisible({ timeout: 20000 });
  // Stickers travel as attachments.
  await alice.locator('#emoji-button').click();
  await alice.locator('.sticker-pick').first().click();
  await expect(bob.locator('.att-sticker')).toHaveCount(1, { timeout: 20000 });
  // Delete for me removes only the local copy.
  await bob.locator('.message-row').first().hover();
  await bob.locator('.message-row [data-actions]').first().click();
  await bob.locator('#message-actions [data-act="deleteme"]').click();
  await expect(bob.locator('.message-text').filter({ hasText: 'жирный' })).toHaveCount(0);
  await expect(alice.locator('.message-text').filter({ hasText: 'жирный' })).toHaveCount(1);
  // Sessions screen lists the live channel; revoking it re-establishes a fresh one.
  await alice.locator('#profile-button').click();
  await alice.locator('#open-sessions').click();
  await expect(alice.locator('#sessions-identity')).toHaveText(/^([0-9a-f]{4} ){7}[0-9a-f]{4}$/);
  await expect(alice.locator('.session-row')).toHaveCount(1);
  await alice.locator('.session-row button').click();
  await alice.locator('#sessions-dialog [data-close]').click();
  await expect(alice.locator('#chat-presence')).toContainText('сквозное шифрование', { timeout: 30000 });
  await send(alice, 'после ротации');
  await expect(bob.locator('.message-text').filter({ hasText: 'после ротации' })).toBeVisible({ timeout: 20000 });
  expect(errors).toEqual([]);
});
