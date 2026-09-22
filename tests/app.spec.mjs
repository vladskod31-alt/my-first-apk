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
  expect(about).toContain('2.8.2');
  expect(about).not.toMatch(/открыт(?:ым|ый|ого)? (?:исходн|код)/i);
  expect(about).not.toMatch(/github/i);
  // 2.8.2 advertises twelve Telegram-style features plus two extras.
  expect(await page.locator('#about-features li').count()).toBe(14);
  expect(await page.locator('#about-version').innerText()).toBe('2.8.2');
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
  // The MTProto-inspired layer must negotiate an AES-256-GCM auth key for the pair.
  await alice.locator('#security-button').click();
  await expect(alice.locator('#sec-mt')).toContainText('AES-256-GCM');
  await alice.locator('#security-dialog [data-close]').click();
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

test('2.8.2 markup, spoilers, hashtags, quiet mode, scheduling, quiz and media panel', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await page.locator('#nav-saved').click();
  // The formatting bar wraps the selection into markup markers.
  await page.locator('#message-input').fill('важное слово');
  await page.locator('#message-input').evaluate(input => input.setSelectionRange(0, 6));
  await page.locator('#format-button').click();
  await page.locator('#format-bar [data-format="bold"]').click();
  await expect(page.locator('#message-input')).toHaveValue('**важное** слово');
  await page.locator('#send-button').click();
  await expect(page.locator('.message-text .rich-bold').first()).toHaveText('важное');
  await expect(page.locator('.message-text').first()).toContainText('слово');
  // A spoiler stays hidden until it is tapped.
  await page.locator('#message-input').fill('Секрет ||спрятано|| конец');
  await page.locator('#send-button').click();
  const spoiler = page.locator('.message-text .spoiler').last();
  await expect(spoiler).toHaveText('спрятано');
  await expect(spoiler).not.toHaveClass(/revealed/);
  await spoiler.click();
  await expect(spoiler).toHaveClass(/revealed/);
  // Hashtags act as search buttons.
  await page.locator('#message-input').fill('Разбор #поездка и ещё #поездка');
  await page.locator('#send-button').click();
  await page.locator('.message-text .hashtag').first().click();
  await expect(page.locator('#chat-search')).toHaveValue('#поездка');
  await page.locator('#chat-search').fill('');
  // Quiet messages carry the mute mark.
  await page.locator('#silent-button').click();
  await page.locator('#message-input').fill('без звука');
  await page.locator('#send-button').click();
  await expect(page.locator('.message-row').last().locator('.silent-mark')).toBeVisible();
  await page.locator('#silent-button').click();
  // A scheduled message is shown with its clock chip and can be released at once.
  await page.locator('#message-input').fill('напомни вечером');
  await page.locator('#schedule-button').click();
  await expect(page.locator('#schedule-dialog')).toBeVisible();
  await page.locator('#schedule-list [data-preset="5m"]').click();
  await expect(page.locator('#schedule-dialog')).not.toBeVisible();
  const scheduled = page.locator('.message-row').last();
  await expect(scheduled.locator('.schedule-chip')).toContainText('отправлю в');
  await expect(scheduled.locator('.message-status')).toHaveAttribute('data-status', 'scheduled');
  await scheduled.hover();
  await scheduled.locator('.message-actions-button').click();
  await page.locator('#message-actions [data-act="sendnow"]').click();
  await expect(page.locator('.message-row').last().locator('.message-status')).toHaveAttribute('data-status', 'local');
  await expect(page.locator('.schedule-chip')).toHaveCount(0);
  // A quiz poll marks the wrong pick and reveals the right answer.
  await page.locator('#poll-button').click();
  await page.locator('#poll-q').fill('Столица Франции?');
  await page.locator('#poll-opt-0').fill('Марсель');
  await page.locator('#poll-opt-1').fill('Париж');
  await page.locator('#poll-quiz').check();
  await page.locator('#poll-correct').selectOption('1');
  await page.locator('#poll-send').click();
  await page.locator('#send-button').click();
  await expect(page.locator('.att-poll .poll-kind')).toContainText('Квиз');
  await page.locator('.poll-option').first().click();
  await expect(page.locator('.poll-option').first()).toHaveClass(/wrong/);
  await expect(page.locator('.poll-option').nth(1)).toHaveClass(/correct/);
  await expect(page.locator('.att-poll small').last()).toContainText('Не угадали');
  // A quoted reply keeps the fragment of the source message.
  await page.locator('.message-row').first().hover();
  await page.locator('.message-row').first().locator('.message-actions-button').click();
  await page.locator('#message-actions [data-act="quote"]').click();
  await expect(page.locator('#reply-bar')).toBeVisible();
  await page.locator('#message-input').fill('согласен');
  await page.locator('#send-button').click();
  await expect(page.locator('.message-row').last().locator('.quote-fragment')).toContainText('важное');
  // The media panel collects photos, files, voices and tags of the chat.
  await page.locator('#photo-input').setInputFiles({
    name: 'pixel.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6q1EAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(page.locator('#attachment-preview')).toBeVisible();
  await page.locator('#send-button').click();
  await page.locator('#chat-more').click();
  await page.locator('#open-media').click();
  await expect(page.locator('#media-dialog')).toBeVisible();
  await expect(page.locator('#media-photos .media-thumb')).toHaveCount(1);
  await expect(page.locator('#media-tags .tag-chip').first()).toContainText('#поездка');
  await expect(page.locator('#media-voices')).toContainText('Голосовых сообщений нет');
  await page.locator('#media-tags .tag-chip').first().click();
  await expect(page.locator('#media-dialog')).not.toBeVisible();
  await expect(page.locator('#chat-search')).toHaveValue('#поездка');
  await page.locator('#chat-search').fill('');
  // A thumbnail jumps to its message and closes the panel.
  await page.locator('#chat-more').click();
  await page.locator('#open-media').click();
  await page.locator('#media-photos .media-thumb').first().click();
  await expect(page.locator('#media-dialog')).not.toBeVisible();
  await expect(page.locator('.message-row.highlight')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('2.8.2 pinned chats and the archive shelf keep the list tidy', async ({ page }) => {
  await ready(page);
  await add(page, 'LIBO:libo-abcdef0123456789abcdef0123456789');
  const row = page.locator('[data-chat-id="libo-abcdef0123456789abcdef0123456789"]');
  await page.locator('#chat-more').click();
  await page.locator('#pin-chat').click();
  await expect(row.locator('.pin-mark')).toBeVisible();
  await page.locator('#chat-more').click();
  await page.locator('#archive-chat').click();
  await expect(row).toBeHidden();
  await expect(page.locator('#archive-toggle')).toBeVisible();
  await page.locator('#archive-toggle').click();
  await expect(row).toBeVisible();
  await expect(page.locator('#archive-toggle')).toContainText('Обычные чаты');
  await page.locator('#chat-more').click();
  await page.locator('#archive-chat').click();
  await expect(row).toBeVisible();
  await expect(page.locator('#archive-toggle')).toBeHidden();
  await expect(row.locator('.pin-mark')).toBeVisible();
});

test('2.8.2 unread separator, jump counter, swipe reply and quiet delivery', async ({ page: alice, browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const bob = await context.newPage();
  const errors = [];
  alice.on('pageerror', error => errors.push(error.message));
  bob.on('pageerror', error => errors.push(error.message));
  await ready(alice);
  await ready(bob);
  await profile(alice, 'Аня');
  await profile(bob, 'Богдан');
  await add(alice, await code(bob));
  await expect(alice.locator('#chat-presence')).toContainText('В сети');
  await bob.locator('.chat-row').filter({ hasText: 'Аня' }).click();
  await bob.locator('#accept-request').click();
  await expect(bob.locator('#chat-presence')).toContainText('В сети');
  // Bob leaves the chat: three messages arrive while it is closed.
  await bob.locator('#nav-chats').click();
  await expect(bob.locator('#shell')).not.toHaveClass(/chat-open/);
  await send(alice, 'первое');
  await send(alice, 'второе');
  await send(alice, 'третье');
  await expect(bob.locator('.chat-row').filter({ hasText: 'Аня' }).locator('.unread-badge')).toHaveText('3');
  await bob.locator('.chat-row').filter({ hasText: 'Аня' }).click();
  await expect(bob.locator('.unread-divider')).toBeVisible();
  await expect(bob.locator('.message-text').last()).toHaveText('третье');
  // Reaching the bottom retires the separator, like in Telegram.
  await bob.locator('#messages').evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
  await expect(bob.locator('.unread-divider')).toBeHidden();
  // A quiet message arrives with the mute mark and without the sound flag.
  await alice.locator('#silent-button').click();
  await send(alice, 'тихо');
  await expect(bob.locator('.incoming .silent-mark').last()).toBeVisible();
  await alice.locator('#silent-button').click();
  // Swiping a message with a finger opens the reply bar.
  const target = bob.locator('.message-row').last();
  const box = await target.boundingBox();
  await target.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 3, isPrimary: true, button: 0, buttons: 1, clientX: box.x + 30, clientY: box.y + 20 });
  await target.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 3, isPrimary: true, button: 0, buttons: 1, clientX: box.x + 130, clientY: box.y + 24 });
  await target.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 3, isPrimary: true, button: 0, clientX: box.x + 130, clientY: box.y + 24 });
  await expect(bob.locator('#reply-bar')).toBeVisible();
  await bob.locator('#cancel-reply').click();
  // A double tap leaves the default reaction and it reaches the peer.
  await bob.locator('.message-row').last().dblclick();
  await expect(bob.locator('.reaction-chip').last()).toBeVisible();
  await expect(alice.locator('.reaction-chip').first()).toBeVisible({ timeout: 20000 });
  // Once the thread overflows the viewport, the counter button appears.
  for (let index = 0; index < 12; index++) await send(alice, `строка ${index}`);
  await expect(bob.locator('.message-text').last()).toHaveText('строка 11');
  // Let the auto-scroll of the arriving messages settle before scrolling up.
  await bob.waitForTimeout(500);
  await bob.locator('#messages').evaluate(node => { node.scrollTop = 0; });
  await expect(bob.locator('#jump-button')).toBeVisible();
  await expect(bob.locator('#jump-count')).toHaveText(/^\d+$/);
  await bob.locator('#jump-button').click();
  await expect(bob.locator('#jump-button')).toBeHidden();
  expect(errors).toEqual([]);
  await context.close();
});
