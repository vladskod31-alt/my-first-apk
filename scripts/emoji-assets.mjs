import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const svgRoot = path.join(root, 'node_modules/@twemoji/svg');
export const emojiCache = path.join(root, '.cache/emoji');
export function svgNames() { return fs.readdirSync(svgRoot).filter(n => /^[a-f0-9-]+\.svg$/.test(n)).sort(); }
export function prepareEmojiPack() {
  fs.mkdirSync(emojiCache, { recursive: true });
  const archive = path.join(emojiCache, 'libo-emoji-svg.zip');
  const names = svgNames();
  const notice = 'LIBO Emoji — Twemoji SVG 15.0\nGraphics by Twitter, Inc. and other contributors, including community maintainers Jason Sofonia and Justine De Caires.\nLicensed under Creative Commons Attribution 4.0 International.\nhttps://creativecommons.org/licenses/by/4.0/\nhttps://github.com/jdecked/twemoji\n\nThis archive contains the unmodified SVG artwork from @twemoji/svg 15.0.0.\n';
  const stamp = new Date('2000-01-01T00:00:00Z');
  const licenseText = fs.readFileSync(path.join(root, 'licenses/CC-BY-4.0.txt'), 'utf8');
  const cacheKey = createHash('sha256').update(notice + licenseText + names.join(',')).digest('hex');
  const marker = path.join(emojiCache, 'manifest.sha256');
  if (!fs.existsSync(archive) || !fs.existsSync(marker) || fs.readFileSync(marker, 'utf8') !== cacheKey) {
    const files = Object.fromEntries(names.map(name => [`svg/${name}`, [new Uint8Array(fs.readFileSync(path.join(svgRoot, name))), { mtime: stamp }]]));
    files['ATTRIBUTION.txt'] = [strToU8(notice), { mtime: stamp }];
    const license = fs.readdirSync(svgRoot).find(name => /^license/i.test(name));
    if (license) files['PACKAGING-MIT.txt'] = [new Uint8Array(fs.readFileSync(path.join(svgRoot, license))), { mtime: stamp }];
    files['GRAPHICS-CC-BY-4.0.txt'] = [strToU8(licenseText), { mtime: stamp }];
    fs.writeFileSync(archive, zipSync(files, { level: 6 }));
    fs.writeFileSync(marker, cacheKey);
  }
  return archive;
}
export function emojiPlugin() {
  return {
    name: 'libo-offline-emoji',
    resolveId(id) { if (id === 'virtual:emoji-assets') return '\0virtual:emoji-assets'; },
    load(id) { if (id === '\0virtual:emoji-assets') return `export default ${JSON.stringify(svgNames().map(n => n.slice(0, -4)))}`; },
    closeBundle() {
      const destination = path.join(root, 'dist/emoji');
      fs.mkdirSync(path.join(destination, 'svg'), { recursive: true });
      for (const name of svgNames()) fs.copyFileSync(path.join(svgRoot, name), path.join(destination, 'svg', name));
      fs.copyFileSync(prepareEmojiPack(), path.join(destination, 'libo-emoji-svg.zip'));
    },
  };
}
