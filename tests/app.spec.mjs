import { test, expect } from '@playwright/test';

test('menu, instructions and playable game work', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '▶ ГРАТИ' })).toBeVisible();
  await expect(page.locator('.logo')).toContainText('SWAMP');
  await page.getByRole('button', { name: /ЯК ГРАТИ/ }).click();
  await expect(page.getByRole('heading', { name: 'ЯК ГРАТИ' })).toBeVisible();
  await page.getByRole('button', { name: 'ЗРОЗУМІЛО!' }).click();
  await page.getByRole('button', { name: '▶ ГРАТИ' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#wave-value')).toHaveText('1');
  await page.locator('#game-canvas').click({ position: { x: 180, y: 300 } });
  await expect(page.locator('#ammo-shotgun')).toHaveText('7');
  expect(errors).toEqual([]);
});

test('workshop opens and layout has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto('/');
  await page.getByRole('button', { name: /ПОКРАЩЕННЯ/ }).click();
  await expect(page.getByRole('heading', { name: 'МАЙСТЕРНЯ' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
});
