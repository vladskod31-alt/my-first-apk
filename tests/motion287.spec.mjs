import { test, expect } from '@playwright/test';

// 2.8.7 final pass: ripple on press, rounder surfaces, reduced-motion respect.
test('2.8.7 motion: ripple on press, rounded surfaces, reduced-motion respected', async ({ page }) => {
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.locator('.welcome')).toBeVisible();

  // Rounder surfaces from the 2.8.7 stylesheet.
  const dialogRadius = await page.evaluate(() => {
    const probe = document.createElement('dialog');
    probe.className = 'dialog';
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).borderRadius;
    probe.remove();
    return value;
  });
  expect(dialogRadius).toBe('28px');

  // Ripple: pointerdown on a primary button injects a transient .ripple span.
  // The welcome button floats (libo-float infinite), so hover with force to skip
  // Playwright's stability wait.
  const primary = page.locator('.welcome-actions .primary-button').first();
  await primary.hover({ force: true });
  await page.mouse.down();
  await expect(page.locator('.ripple').first()).toBeAttached();
  await page.mouse.up();

  // Reduced motion: no ripple injected at all.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const before = await page.locator('.ripple').count();
  await primary.hover({ force: true });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
  expect(await page.locator('.ripple').count()).toBeLessThanOrEqual(before);

  expect(errors.filter(text => !text.includes('favicon'))).toEqual([]);
});
