// Converts a supplied JPG/PNG/WebP locally; no image is uploaded to a service.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { browserOptions } from './browser.mjs';

const input = process.argv[2];
if (!input || !fs.existsSync(input)) throw new Error('Usage: node scripts/apply-icon.mjs path/to/icon.jpg — JPG is supported; PNG is not required.');
const bytes = fs.readFileSync(input);
if (bytes.length > 12 * 1024 * 1024) throw new Error('Choose an image no larger than 12 MB.');
const ext = path.extname(input).toLowerCase();
const mime = ['.jpg', '.jpeg'].includes(ext) ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : null;
if (!mime) throw new Error('Supported formats: JPG, PNG, WebP.');
fs.mkdirSync('branding', { recursive: true });
const original = 'branding/libo-icon-original' + (ext === '.jpeg' ? '.jpg' : ext);
if (path.resolve(input) !== path.resolve(original)) fs.copyFileSync(input, original);
const browser = await chromium.launch(await browserOptions());
try {
  const page = await browser.newPage();
  const results = await page.evaluate(async ({ data, mime }) => {
    const image = new Image(); image.src = `data:${mime};base64,${data}`; await image.decode();
    if (image.naturalWidth < 48 || image.naturalHeight < 48 || image.naturalWidth > 8000 || image.naturalHeight > 8000) throw new Error('Unsupported image dimensions.');
    const render = (size, padded = false) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      const side = Math.min(image.naturalWidth, image.naturalHeight), x = (image.naturalWidth - side) / 2, y = (image.naturalHeight - side) / 2;
      if (!padded) { ctx.drawImage(image, x, y, side, side, 0, 0, size, size); }
      else {
        // Keep the complete square artwork inside the adaptive-icon safe region.
        const inner = Math.round(size * .66), inset = (size - inner) / 2;
        ctx.drawImage(image, x, y, side, side, inset, inset, inner, inner);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    };
    return { web: render(512), adaptive: render(432, true), legacy: Object.fromEntries([48, 72, 96, 144, 192].map(size => [size, render(size)])) };
  }, { data: bytes.toString('base64'), mime });
  fs.mkdirSync('web/public', { recursive: true }); fs.writeFileSync('web/public/icon.png', Buffer.from(results.web, 'base64'));
  const directory = 'app/src/main/res/drawable-nodpi'; fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(directory + '/libo_icon_foreground.png', Buffer.from(results.adaptive, 'base64'));
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    const dir = `app/src/main/res/mipmap-${density}`; fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dir + '/ic_launcher.png', Buffer.from(results.legacy[size], 'base64'));
  }
  fs.writeFileSync('app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@drawable/ic_launcher_background"/><foreground android:drawable="@drawable/libo_icon_foreground"/></adaptive-icon>\n');
  fs.writeFileSync('app/src/main/res/drawable/ic_launcher_background.xml', '<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#972EDE"/></shape>\n');
  const index = fs.readFileSync('web/index.html', 'utf8').replace('href="./icon.svg"', 'href="./icon.png"').replace('type="image/svg+xml"', 'type="image/png"').replaceAll('<span class="brand-glyph">l<span>ı</span></span>', '<img class="brand-image" src="./icon.png" alt="LIBO"/>'); fs.writeFileSync('web/index.html', index);
  fs.writeFileSync('branding/icon-installed.json', JSON.stringify({ source: original, sourceSha256: createHash('sha256').update(bytes).digest('hex'), webSha256: createHash('sha256').update(Buffer.from(results.web, 'base64')).digest('hex'), convertedLocally: true }, null, 2) + '\n');
  console.log('Supplied image installed as Android adaptive/raster icons and web icon. Rebuild the APK.');
} finally { await browser.close(); }
