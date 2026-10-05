import { test, expect } from '@playwright/test';

test('2.8.8 nearby explains Android-only features without fake device results', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#shell')).toBeVisible();
  await page.locator('#profile-button').click();
  await page.locator('#open-nearby').click();
  await expect(page.locator('#nearby-status')).toContainText('Android APK');
  await expect(page.locator('#nearby-native')).toBeHidden();
  await expect(page.locator('#nfc-read')).toBeDisabled();
  await expect(page.locator('#nfc-write')).toBeDisabled();
});

test('2.8.8 real WebRTC audio between two contexts: accept, RTP bytes, mute, hangup, reject', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const context of contexts) await context.addInitScript(() => {
      // Deterministic audio source, no physical microphone in CI. Everything after
      // capture uses production signaling, encryption and actual WebRTC transport.
      navigator.mediaDevices.getUserMedia = async () => {
        const ac = new AudioContext(); const osc = ac.createOscillator(); const dst = ac.createMediaStreamDestination();
        osc.connect(dst); osc.start(); await ac.resume(); window.testStream = dst.stream;
        dst.stream.getTracks()[0].addEventListener('ended', () => ac.close());
        return dst.stream;
      };
      const Native = window.RTCPeerConnection;
      window.testPCs = [];
      window.RTCPeerConnection = class extends Native { constructor(config) { super(config); window.testPCs.push(this); } };
    });
    const [a, b] = await Promise.all(contexts.map(c => c.newPage()));
    const errors=[]; for(const p of [a,b])p.on('pageerror', e=>errors.push(e.message));
    for (const [p, name] of [[a,'Alice288'],[b,'Bob288']]) {
      await p.goto('/'); await expect(p.locator('#network-status')).toContainText('Вы в сети');
      await p.locator('#profile-button').click(); await p.locator('#profile-name').fill(name);
      await p.locator('#settings-form button[type=submit]').click();
    }
    await b.locator('.invite-card').click(); const code=await b.locator('#my-code').innerText(); await b.locator('#invite-dialog [data-close]').click();
    await a.locator('.new-chat-button').click(); await a.locator('#contact-code').fill(code); await a.locator('#add-contact-form button[type=submit]').click();
    await b.locator('.chat-row').filter({ hasText:'Alice288' }).click(); await b.locator('#accept-request').click();
    for(const p of [a,b])await expect(p.locator('#e2-badge')).toBeVisible();
    await a.locator('#call-start').click(); await expect(b.locator('#call-accept')).toBeVisible();
    // Incoming ring must never silently capture audio.
    expect(await b.evaluate(()=>!!window.testStream)).toBe(false);
    await b.locator('#call-accept').click();
    for(const p of [a,b])await expect(p.locator('#call-phase')).toHaveText('На зв’язку', { timeout: 35000 });
    await expect.poll(() => b.evaluate(async () => {
      let bytes=0;
      for(const pc of window.testPCs)for(const stat of (await pc.getStats()).values())if(stat.type==='inbound-rtp' && stat.kind==='audio')bytes+=stat.bytesReceived || 0;
      return bytes;
    })).toBeGreaterThan(0);
    await a.locator('#call-mute').click(); expect(await a.evaluate(()=>window.testStream.getAudioTracks()[0].enabled)).toBe(false);
    await a.locator('#call-end').click();
    for(const p of [a,b]) { await expect(p.locator('#call-dialog')).not.toBeVisible(); expect(await p.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='ended'))).toBe(true); }
    await a.locator('#call-start').click(); await expect(b.locator('#call-accept')).toBeVisible(); await b.locator('#call-end').click();
    await expect(a.locator('#call-dialog')).not.toBeVisible(); expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(c=>c.close())); }
});
