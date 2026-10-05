import {test,expect} from '@playwright/test';
async function orbit(page){await page.locator('#profile-button').click();await page.locator('#open-orbit').click();await expect(page.locator('#orbit-dialog')).toBeVisible();}
async function ready(page){await page.goto('/');await expect(page.locator('#shell')).toBeVisible();await expect(page.locator('#profile-button')).toBeVisible();}
test('wallet is atomic across tabs, persists and purchases only virtual goods',async({page,context})=>{
 await ready(page);const other=await context.newPage();await ready(other);await orbit(page);await orbit(other);
 await Promise.all([page.evaluate(()=>document.querySelector('#orbit-claim').click()),other.evaluate(()=>document.querySelector('#orbit-claim').click())]);
 await expect(page.locator('#orbit-coins')).toHaveText('100');await expect(other.locator('#orbit-coins')).toHaveText('100');
 await page.locator('#orbit-exchange').click();await expect(page.locator('#orbit-stars')).toHaveText('10');await expect(page.locator('#orbit-coins')).toHaveText('50');
 await page.locator('[data-orbit-item=moon]').click();await expect(page.locator('#orbit-stars')).toHaveText('0');await expect(page.locator('#orbit-collection')).toContainText('Місяць');
 await page.reload();await orbit(page);await expect(page.locator('#orbit-coins')).toHaveText('50');await expect(page.locator('#orbit-claim')).toBeDisabled();await expect(page.locator('#orbit-buy')).toBeDisabled();await other.close();
});
test('Premium purchase, accent and no automatic renewal: local seeded test wallet',async({page})=>{
 await ready(page);
 await page.evaluate(async()=>{const {OrbitStore}=await import('/lib/orbit.mjs');const db=new OrbitStore();await db.open();await db.update(s=>({...s,coins:300}));db.db.close();});
 await orbit(page);await page.locator('#orbit-buy').click();await expect(page.locator('#orbit-coins')).toHaveText('0');await expect(page.locator('#orbit-status')).toContainText('Orbit активний');
 await page.locator('#orbit-accent').selectOption('ocean');await expect(page.locator('html')).toHaveAttribute('data-orbit','ocean');
 await page.reload();await orbit(page);await expect(page.locator('#orbit-accent')).toHaveValue('ocean');await expect(page.locator('#orbit-buy')).toBeDisabled();
 await page.evaluate(async()=>{const {OrbitStore}=await import('/lib/orbit.mjs');const db=new OrbitStore();await db.open();await db.update(s=>({...s,premiumUntil:1}));db.db.close();});
 await page.reload();await orbit(page);await expect(page.locator('#orbit-status')).toHaveText('Безкоштовний профіль');await expect(page.locator('html')).toHaveAttribute('data-orbit','violet');await expect(page.locator('#orbit-coins')).toHaveText('0');
});
test('ad studio: explicit opt-in, literal content, local campaign, cap and pause',async({page})=>{
 await ready(page);await orbit(page);await page.locator('#open-ad-studio').click();
 await expect(page.locator('#orbit-ads-enabled')).not.toBeChecked();await expect(page.locator('#orbit-analytics')).not.toBeChecked();
 await page.locator('#ad-title').fill('<b>Local offer</b>');await page.locator('#ad-text').fill('No trackers.');await page.locator('#ad-sponsor').fill('My shop');await page.locator('#ad-url').fill('https://example.com');await page.locator('#ad-cap').fill('1');
 await page.locator('#ad-editor button[type=submit]').click();await expect(page.locator('#ad-campaigns')).toContainText('<b>Local offer</b>');
 await expect(page.locator('#orbit-sponsor')).toBeHidden();
 await page.locator('#orbit-ads-enabled').check();await page.locator('#ad-preferences button[type=submit]').click();await page.locator('#ad-studio-dialog [data-close]').click();
 await expect(page.locator('#orbit-sponsor')).toBeVisible();await expect(page.locator('#sponsor-title')).toHaveText('<b>Local offer</b>');await expect(page.locator('#sponsor-title b')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(async()=>{const {OrbitStore}=await import('/lib/orbit.mjs');const db=new OrbitStore();const s=await db.open();db.db.close();return Object.values(s.exposures).reduce((sum,e)=>sum+e.count,0);})).toBe(1);
 await page.reload();await expect(page.locator('#orbit-sponsor')).toBeHidden();
 await orbit(page);await page.locator('#open-ad-studio').click();await page.locator('#ad-campaigns button').filter({hasText:'Пауза'}).click();await expect(page.locator('#ad-campaigns small')).toContainText('Пауза');
});
test('API calls require opt-in; invalid remote images are not loaded',async({page})=>{
 let requests=0;await page.route('https://ads.example/api/ads/v1/campaigns',route=>{requests++;return route.fulfill({json:{version:1,campaigns:[{id:'evil',title:'Demo',text:'Demo',sponsor:'Demo',url:'https://example.com',image:'https://tracker.example/pixel',enabled:true,start:0,end:4102444800000,dailyCap:1,cooldownMinutes:1,weight:1}]}});});
 await ready(page);await orbit(page);await page.locator('#open-ad-studio').click();await page.locator('#orbit-endpoint').fill('https://ads.example/api/ads/v1');await page.locator('#ad-preferences button[type=submit]').click();expect(requests).toBe(0);
 await page.locator('#orbit-ads-enabled').check();await page.locator('#ad-preferences button[type=submit]').click();await expect(page.locator('#ad-api-status')).toContainText('формат некоректний');expect(requests).toBe(1);await expect(page.locator('#orbit-sponsor')).toBeHidden();
});
