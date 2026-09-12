import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tokenizer } from 'acorn';
import twemoji from '@twemoji/api';
import { svgNames } from '../scripts/emoji-assets.mjs';
import { messages } from '../web/lib/messages.mjs';
import { t, setLanguage } from '../web/lib/i18n.mjs';

test('every bundled Emoji Mart 15.0 variant has a local SVG, including newly added emoji', () => {
  const data = JSON.parse(fs.readFileSync('node_modules/@emoji-mart/data/sets/15/native.json', 'utf8'));
  const names = new Set(svgNames().map(n => n.slice(0, -4))); let variants = 0;
  for (const emoji of Object.values(data.emojis)) for (const skin of emoji.skins) {
    variants++;
    const native = skin.native.includes('\u200d') ? skin.native : skin.native.replaceAll('\ufe0f', '');
    const code = twemoji.convert.toCodePoint(native);
    assert.ok(names.has(code) || names.has(code.replaceAll('-fe0f', '')), `${emoji.id}: ${code}`);
  }
  assert.equal(names.size, 3720); assert.equal(Object.keys(data.emojis).length, 1870); assert.equal(variants, 3395);
  assert.ok(names.has('1fa77')); assert.ok(names.has('1fae8'));
});
test('all app Russian string literals have Ukrainian and English translations', () => {
  const exceptions = new Set(['Л', 'запрос', 'сжатия', 'пользователь_libo']);
  for (const path of ['web/app.js', 'web/lib/core.mjs']) {
    for (const token of tokenizer(fs.readFileSync(path, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })) {
      if (token.type.label !== 'string' || !/[А-Яа-яЁё]/.test(token.value) || exceptions.has(token.value)) continue;
      assert.ok(messages[token.value], `${path}: ${token.value}`);
    }
  }
  for (const [key, value] of Object.entries(messages)) { assert.ok([2, 3].includes(value.length), key); value.forEach(text => assert.equal(typeof text, 'string')); }
  setLanguage('uk'); assert.equal(t('Ник'), 'Нік'); setLanguage('en'); assert.equal(t('Ник'), 'Nickname'); assert.equal(t('Контактов: {count}', { count: 7 }), 'Contacts: 7');
  setLanguage('ru');
});
test('notices and private distribution guard are packaged without source promotions', () => {
  assert.equal(fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8'), fs.readFileSync('web/public/third-party-notices.txt', 'utf8'));
  const html = fs.readFileSync('web/index.html', 'utf8'); assert.doesNotMatch(html, /github-link|download-apk|invite-dialog|contact-code/);
  assert.match(fs.readFileSync('ci/android.yml', 'utf8'), /github\.event\.repository\.private == true/);
  assert.doesNotMatch(fs.readFileSync('ci/android.yml', 'utf8'), /gh release create/);
});
