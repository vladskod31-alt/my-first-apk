// Tests assets extracted from the actual APK at the native HTTPS origin in Chromium.
// This deliberately does not pretend to test an Android device or the Java bridge.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { browserOptions } from './browser.mjs';

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const apk = path.resolve(process.argv[2] || `artifacts/LIBO-${version}-preview.apk`);
const root = path.resolve('.cache/packaged-apk-assets');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
execFileSync('python3', ['-c', `
from zipfile import ZipFile
from pathlib import Path
import sys
root=Path(sys.argv[2]).resolve()
with ZipFile(sys.argv[1]) as archive:
    for item in archive.infolist():
        if not item.filename.startswith('assets/') or item.is_dir(): continue
        target=(root / item.filename[7:]).resolve()
        target.relative_to(root)
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(archive.read(item))
`, apk, root]);
const java = fs.readFileSync('app/src/main/java/app/libo/messenger/MainActivity.java', 'utf8');
const expression = java.match(/private static final String CSP = ([\s\S]*?);\s*\n/)[1];
const csp = [...expression.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(m => JSON.parse('"' + m[1] + '"')).join('');
expect(csp).toContain("default-src 'self'");
expect(csp).toContain("frame-ancestors 'none'");
const origin = 'https://appassets.androidplatform.net';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.zip': 'application/zip', '.json': 'application/json' };
const browser = await chromium.launch(await browserOptions());
try {
  const context = await browser.newContext({ viewport: { width: 1240, height: 900 } });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'Not found' });
    await route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' } });
  });
  await context.routeWebSocket(/.*/, socket => socket.close());
  await context.addInitScript(() => {
    window.bridgeCalls = [];
    window.LiboAndroid = {
      setDarkTheme: value => window.bridgeCalls.push(['theme', value]),
      setSecureWindow: value => window.bridgeCalls.push(['secure', value]),
      setLanguage: value => window.bridgeCalls.push(['language', value]),
      copyText: value => window.bridgeCalls.push(['copy', value]),
      saveText: (name, value) => window.bridgeCalls.push(['export', name, value]),
      saveEmojiPack: () => window.bridgeCalls.push(['emoji-pack']),
      notificationStatus: () => JSON.stringify({ available: true, permission: 'denied', running: false }),
      configureBackground: value => window.bridgeCalls.push(['background', JSON.parse(value)]),
      requestNotifications: () => window.bridgeCalls.push(['request-notifications']),
      openBatterySettings: () => window.bridgeCalls.push(['battery-settings']),
    };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/index.html');
  await expect(page.locator('#onboarding-name')).toBeVisible();
  await page.locator('#onboarding-name').fill('packaged_tester'); await page.locator('#onboarding-submit').click();
  await page.locator('#nav-saved').click(); await page.locator('#message-input').fill('APK-only note 🩷 👋🏽'); await page.locator('#send-button').click();
  await expect(page.locator('.message-text')).toContainText('APK-only note');
  await expect(page.locator('.message-text img.emoji')).toHaveCount(2);
  await expect.poll(() => page.locator('.message-text img.emoji').first().evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.locator('#profile-button').click(); await page.locator('#app-language').selectOption('uk'); await expect(page.locator('#settings-dialog h2')).toHaveText('Налаштування');
  await expect(page.locator('#app-version')).toHaveText(version);
  await page.locator('#global-appearance').click(); await page.locator('[data-palette=midnight]').click(); await page.locator('#appearance-save').click();
  await expect(page.locator('#appearance-dialog')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe('#c3ff39');
  await page.locator('#cloud-entry').click(); await expect(page.locator('#cloud-url')).toHaveValue('');
  await page.locator('#cloud-dialog [data-close]').click();
  await page.locator('#profile-button').click(); await page.locator('#vault-enable').click(); await page.locator('#vault-new').fill('packaged-password-123'); await page.locator('#vault-repeat').fill('packaged-password-123'); await page.locator('#vault-apply').click();
  await expect(page.locator('#vault-password-dialog')).not.toBeVisible();
  await page.evaluate(() => window.Libo.onBackground()); await expect(page.locator('#lock-screen')).toBeVisible(); await expect(page.locator('#messages')).toBeEmpty();
  await page.evaluate(() => window.Libo.onForeground()); await expect(page.locator('#unlock-password')).toBeEnabled();
  await page.locator('#unlock-password').fill('packaged-password-123'); await page.locator('#unlock-submit').click();
  await expect(page.locator('.message-text')).toContainText('APK-only note');
  await page.locator('#nav-emoji').click(); await page.locator('#channel-picker input[type=search]').fill('серце');
  await expect(page.locator('#channel-picker').getByRole('button', { name: '🩷', exact: true })).toBeVisible();
  await page.locator('#download-emoji-pack').click();
  expect(await page.evaluate(() => window.bridgeCalls.some(c => c[0] === 'emoji-pack'))).toBe(true);
  expect(await page.evaluate(() => window.bridgeCalls.some(c => c[0] === 'secure' && c[1] === true))).toBe(true);
  await page.locator('#emoji-channel [data-close]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#composer')).toBeInViewport(); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.reload(); await expect(page.locator('#lock-screen')).toBeVisible();
  await page.locator('#unlock-password').fill('packaged-password-123'); await page.locator('#unlock-submit').click();
  await expect(page.locator('.message-text')).toContainText('APK-only note');
  expect(errors).toEqual([]);
  console.log('PASS: actual APK assets, native HTTPS origin/CSP, external HTTP/WS blocked, offline notes/SVG/localization/appearance/no-host setup/vault/reload/mobile; Java bridge stubbed.');
} finally { await browser.close(); }
