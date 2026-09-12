import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppearance, normalizeChatAppearance, appearanceTokens, APPEARANCE_PRESETS, contrast, readableText } from '../web/lib/appearance.mjs';

test('appearance settings allow only bounded colours, dimensions and local raster wallpaper', () => {
  const value = normalizeAppearance({ accent: 'red;position:fixed', background: 'url(https://tracker.example)', wallpaper: 'https://tracker.example/photo', fontSize: 999, dim: -9, privateKey: 'not-a-setting' });
  assert.equal(value.accent, null); assert.equal(value.background, null); assert.equal(value.wallpaper, ''); assert.equal(value.fontSize, 20); assert.equal(value.dim, 0); assert.equal(value.privateKey, undefined);
  assert.equal(normalizeAppearance({ wallpaper: 'data:image/svg+xml;base64,AAAA' }).wallpaper, '');
  assert.equal(normalizeChatAppearance({ wallpaper: 'data:image/png;base64,aGVsbG8=', background: '#ABCDEF' }).background, '#abcdef');
  assert.equal(normalizeChatAppearance({ wallpaper: 'data:image/png;base64,aGVsbG8=' }).wallpaper, 'data:image/png;base64,aGVsbG8=');
});
test('palette and custom button/background colours keep readable foreground contrast', () => {
  for (const preset of Object.keys(APPEARANCE_PRESETS)) for (const dark of [true, false]) {
    const tokens = appearanceTokens({ preset }, dark);
    assert.ok(contrast(tokens['--on-accent'], tokens['--accent']) >= 4.5, preset);
    assert.ok(contrast(tokens['--text'], tokens['--bg']) >= 4.5, preset);
    assert.ok(contrast(tokens['--outgoing-text'], tokens['--outgoing']) >= 4.5, preset);
    assert.ok(contrast(tokens['--accent-text'], tokens['--bg']) >= 4.5, preset);
  }
  for (const color of ['#808080', '#777777', '#000000', '#ffffff', '#aabbcc', '#c3ff39']) assert.ok(contrast(readableText(color), color) >= 4.5, color);
});
test('a per-chat customization does not mutate global appearance', () => {
  const global = normalizeAppearance({ preset: 'midnight', accent: '#c3ff39' });
  const saved = JSON.stringify(global);
  const chat = normalizeChatAppearance({ background: '#234567', outgoing: '#abcdef' });
  assert.equal(chat.background, '#234567'); assert.equal(JSON.stringify(global), saved);
  assert.equal(appearanceTokens(global)['--accent'], '#c3ff39');
});
