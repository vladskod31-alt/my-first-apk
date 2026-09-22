import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('required game artwork exists', () => {
  for (const file of ['web/public/swamp-attack-icon.png', 'web/public/swamp-attack-splash.png']) {
    assert.ok(fs.statSync(file).size > 100_000, `${file} should contain production artwork`);
  }
});

test('game declares all three weapons and enemy classes', () => {
  const source = fs.readFileSync('web/app.js', 'utf8');
  for (const item of ['shotgun', 'rifle', 'bomb', 'gator', 'frog', 'brute']) assert.match(source, new RegExp(`\\b${item}\\b`));
});
