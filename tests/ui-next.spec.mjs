import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#chat-list .chat-row')).toHaveCount(1);
  await expect(page.locator('#network-status')).toContainText('Сигнал доступен');
  await expect(page.locator('#storage-status')).toContainText('История локально');
  await expect(page.locator('#boot-loader')).toBeHidden();
}

async function openSaved(page) {
  await page.locator('#nav-saved').click();
  await expect(page.locator('#messages')).toBeVisible();
}

async function send(page, text) {
  await page.locator('#message-input').fill(text);
  await page.locator('#send-button').click();
  await expect(page.locator('#messages .message-text').filter({ hasText: text })).toBeVisible();
}

async function touchSwipe(page, row, dx) {
  const box = await row.boundingBox();
  const y = box.y + Math.min(24, box.height / 2);
  await row.dispatchEvent('pointerdown', { pointerId: 91, pointerType: 'touch', clientX: box.x + 60, clientY: y, button: 0, isPrimary: true });
  await row.dispatchEvent('pointermove', { pointerId: 91, pointerType: 'touch', clientX: box.x + 60 + dx / 2, clientY: y + 2, button: 0, isPrimary: true });
  await row.dispatchEvent('pointermove', { pointerId: 91, pointerType: 'touch', clientX: box.x + 60 + dx, clientY: y + 2, button: 0, isPrimary: true });
  await row.dispatchEvent('pointerup', { pointerId: 91, pointerType: 'touch', clientX: box.x + 60 + dx, clientY: y + 2, button: 0, isPrimary: true });
}

test('mobile navigation shows clear labels and selected section', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await expect(page.locator('#nav-chats .rail-label')).toBeVisible();
  await expect(page.locator('#nav-saved .rail-label')).toBeVisible();
  await expect(page.locator('.rail-bottom [data-dialog="settings-dialog"] .rail-label')).toBeVisible();
  await page.locator('#nav-saved').click();
  await expect(page.locator('#nav-saved')).toHaveClass(/active/);
  await expect(page.locator('#messages')).toBeVisible();
});

test('1 — ⌘K palette finds chats, actions and messages', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await openSaved(page);
  await send(page, 'Сообщение для командной панели');
  await page.locator('#nav-chats').click();

  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeVisible();
  await expect(page.locator('#palette-results .palette-item').first()).toBeVisible();

  // actions
  await page.locator('#palette-input').fill('тема');
  await expect(page.locator('#palette-results .palette-item')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // messages from the local history
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('командной');
  await expect(page.locator('#palette-results .palette-group', { hasText: 'Сообщения' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();
  expect(errors).toEqual([]);
});

test('2 — draft preview in the chat list and restored composer', async ({ page }) => {
  await ready(page);
  await openSaved(page);
  await page.locator('#message-input').fill('Черновик, который видно в списке');
  await expect(page.locator('#chat-list .draft-label')).toHaveText('Черновик: ');
  await expect(page.locator('#chat-list .has-draft')).toContainText('Черновик, который видно в списке');
  await page.locator('#nav-chats').click();
  await expect(page.locator('#chat-list .draft-label')).toBeVisible();
  await openSaved(page);
  await expect(page.locator('#message-input')).toHaveValue('Черновик, который видно в списке');
});

test('3 — emoji panel 2.0: categories, search, insert and recents', async ({ page }) => {
  await ready(page);
  await openSaved(page);
  await page.locator('#emoji-button').click();
  await expect(page.locator('#emoji-picker')).toBeVisible();
  await expect(page.locator('.emoji-cats button')).toHaveCount(5);
  await page.locator('.emoji-cats button').nth(3).click();
  await expect(page.locator('.emoji-grid button').first()).toBeVisible();
  const picked = await page.locator('.emoji-grid button').first().innerText();
  await page.locator('.emoji-grid button').first().click();
  await expect(page.locator('#message-input')).toHaveValue(picked);
  await page.locator('.emoji-search input').fill('серд');
  expect(await page.locator('.emoji-grid button').count()).toBeGreaterThan(10);
  await page.locator('.emoji-search input').fill('zzzz');
  await expect(page.locator('.emoji-empty')).toBeVisible();
  await page.locator('.emoji-search input').fill('');
  await page.locator('.emoji-cats button').first().click();
  await expect(page.locator('.emoji-grid button').first()).toHaveText(picked);
});

test('4 — appearance: accents, density and text size persist', async ({ page }) => {
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  await page.locator('#profile-button').click();
  await page.locator('.accent-swatches [data-accent="mint"]').click();
  await page.locator('#density-select').selectOption('compact');
  await page.locator('#font-select').selectOption('l');
  await page.locator('#settings-dialog [data-close]').click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'mint');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('html')).toHaveAttribute('data-font', 'l');
  await page.reload();
  await expect(page.locator('#chat-list .chat-row')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'mint');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await page.locator('#profile-button').click();
  await expect(page.locator('.accent-swatches [data-accent="mint"]')).toHaveAttribute('aria-pressed', 'true');
});

test('5 — double tap reacts, long press opens the menu, swipe replies', async ({ page }) => {
  await ready(page);
  await openSaved(page);
  await send(page, 'Сообщение для жестов');
  const row = page.locator('.message-row').last();

  await page.dblclick('.message-row:last-child .message-bubble');
  await expect(row.locator('.reaction-chip')).toHaveCount(1);
  await expect(row.locator('.reaction-chip')).toContainText('❤');

  await row.dispatchEvent('pointerdown', { pointerId: 41, pointerType: 'mouse', clientX: 400, clientY: 400, button: 0, isPrimary: true });
  await page.waitForTimeout(620);
  await expect(page.locator('#message-actions')).toBeVisible();
  await page.locator('#message-actions [data-act="pin"]').isVisible().catch(() => {});
  await page.evaluate(() => { document.getElementById('message-actions').hidden = true; });

  await touchSwipe(page, row, 90);
  await expect(page.locator('#reply-bar')).toBeVisible();
  await expect(page.locator('#reply-text')).toContainText('Сообщение для жестов');
  await page.locator('#cancel-reply').click();
  await expect(page.locator('#reply-bar')).toBeHidden();
});

test('6 — long press on a chat opens the context sheet and applies state', async ({ page }) => {
  await ready(page);
  const row = page.locator('.chat-row').first();
  await row.dispatchEvent('pointerdown', { pointerId: 51, pointerType: 'touch', clientX: 120, clientY: 400, button: 0, isPrimary: true });
  await expect(page.locator('#action-sheet')).toBeVisible();
  await expect(page.locator('#sheet-title')).toHaveText('Избранное');
  await expect(page.locator('.sheet-item')).not.toHaveCount(0);
  await page.locator('#action-sheet').getByText('Отметить непрочитанным').click();
  await expect(page.locator('#action-sheet')).toBeHidden();
  await expect(page.locator('#chat-row-unread, .chat-row .unread-badge').first()).toBeVisible();
});

test('7 — scroll capsule returns to the newest message', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 });
  await ready(page);
  await openSaved(page);
  for (let index = 0; index < 14; index++) await send(page, `Строка ${index}`);
  expect(await page.locator('#messages').evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(160);
  await page.locator('#messages').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  const capsule = page.locator('#scroll-down');
  await expect(capsule).toBeVisible();
  await capsule.click();
  await expect(capsule).toBeHidden();
  const scrolled = await page.locator('#messages').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight);
  expect(scrolled).toBeLessThan(40);
});

test('8 — right click opens the message menu on desktop', async ({ page }) => {
  await ready(page);
  await openSaved(page);
  await send(page, 'Контекстное меню');
  await page.locator('.message-row:last-child .message-bubble').click({ button: 'right' });
  await expect(page.locator('#message-actions')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('9 — composer tray exposes attachments on touch widths', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await openSaved(page);
  await expect(page.locator('#composer-more')).toBeVisible();
  await page.locator('#composer-more').click();
  await expect(page.locator('#action-sheet')).toBeVisible();
  await expect(page.locator('.sheet-item')).toHaveCount(4);
  await expect(page.locator('#action-sheet')).toContainText('Файл, аудио или видео');
  await page.locator('#sheet-close').click();
  await expect(page.locator('#action-sheet')).toBeHidden();
});

test('10 — mobile left-column vertical navigation (А/Б/В/Г/Д), 4-layer 3D loader and zero overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await ready(page);
  await expect(page.locator('#boot-loader .orb-layer')).toHaveCount(4);

  const railBox = await page.locator('.rail').boundingBox();
  expect(railBox.x).toBe(0);
  expect(railBox.width).toBeLessThanOrEqual(60);

  const yChats = (await page.locator('#nav-chats').boundingBox()).y;
  const ySaved = (await page.locator('#nav-saved').boundingBox()).y;
  const yContacts = (await page.locator('#nav-contacts').boundingBox()).y;
  const yWalls = (await page.locator('#nav-walls').boundingBox()).y;
  const yLang = (await page.locator('#lang-quick').boundingBox()).y;
  expect(yChats).toBeLessThan(ySaved);
  expect(ySaved).toBeLessThan(yContacts);
  expect(yContacts).toBeLessThan(yWalls);
  expect(yWalls).toBeLessThan(yLang);

  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBe(360);
});

test('11 — 3D & 9:16 wallpaper gallery, Ukrainian localization, rich spoilers, send FX and sketchpad', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);

  await expect(page.locator('html')).toHaveAttribute('data-wall', 'orb-3d');
  await page.locator('#nav-walls').click();
  await expect(page.locator('#wall-dialog')).toBeVisible();
  await expect(page.locator('#wall-gallery-grid .wall-card')).toHaveCount(23);

  await page.locator('.wall-card[data-wall-id="gen-leaves"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-wall', 'gen-leaves');
  await page.locator('#wall-dialog [data-close]').click();

  await page.locator('#lang-quick').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  await expect(page.locator('.sidebar-heading h1')).toContainText('Повідомлення');

  await openSaved(page);
  const bgImg = await page.locator('#chat-bg-stage').evaluate(el => el.style.backgroundImage);
  expect(bgImg).toContain('wp-leaves.jpg');

  await page.locator('#fx-button').click();
  await page.locator('#fx-picker [data-fx="hearts"]').click();
  await page.locator('#message-input').fill('**Жирний** *курсив* `код` ||секрет||');
  await page.locator('#send-button').click();

  const last = page.locator('.message-row:last-child');
  await expect(last.locator('strong')).toHaveText('Жирний');
  await expect(last.locator('em')).toHaveText('курсив');
  await expect(last.locator('code.msg-code')).toHaveText('код');
  const spoiler = last.locator('.msg-spoiler');
  await expect(spoiler).toHaveText('секрет');
  await expect(spoiler).not.toHaveClass(/revealed/);
  await spoiler.click();
  await expect(spoiler).toHaveClass(/revealed/);
  await expect(last.locator('.msg-fx-badge')).toHaveText('💜');

  await page.locator('#draw-button').click();
  await expect(page.locator('#draw-dialog')).toBeVisible();
  const canvas = page.locator('#draw-canvas');
  const canvasBox = await canvas.boundingBox();
  await canvas.dispatchEvent('pointerdown', { pointerId: 77, pointerType: 'touch', clientX: canvasBox.x + 50, clientY: canvasBox.y + 50, button: 0, isPrimary: true });
  await canvas.dispatchEvent('pointermove', { pointerId: 77, pointerType: 'touch', clientX: canvasBox.x + 160, clientY: canvasBox.y + 140, button: 0, isPrimary: true });
  await canvas.dispatchEvent('pointerup', { pointerId: 77, pointerType: 'touch', clientX: canvasBox.x + 160, clientY: canvasBox.y + 140, button: 0, isPrimary: true });
  await page.locator('#draw-send').click();
  await expect(page.locator('#attachment-preview')).toBeVisible();
  await page.locator('#send-button').click();
  await expect(page.locator('.message-row')).toHaveCount(2);
});
