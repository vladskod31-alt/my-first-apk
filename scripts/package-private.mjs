// Local-only packaging. This script never calls git, gh, or a publishing service.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
const root = process.cwd(), version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const source = path.join(root, `artifacts/LIBO-${version}-preview.apk`);
if (!fs.existsSync(source)) throw new Error('Build the APK first.');
const directory = path.join(root, 'deliverables/libo-2.3'); fs.mkdirSync(directory, { recursive: true });
const filename = `LIBO-${version}-preview.apk`, apk = fs.readFileSync(source);
fs.writeFileSync(path.join(directory, filename), apk);
const digest = createHash('sha256').update(apk).digest('hex');
const sums = `${digest}  ${filename}\n`; fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), sums);
const stamp = new Date('2026-09-08T00:00:00Z');
const privateNotice = `LIBO ${version} — приватна тестова збірка\n\n1. Розпакуй ZIP і відкрий APK на Android 8.0+ з актуальним Android System WebView.\n2. Це окремий пакет app.libo.messenger.preview23. Не видаляй стару LIBO з важливим листуванням: перенесення даних між пакетами не автоматичне.\n3. Хмарна історія та доставка потребують власного постійного HTTPS-сервера. Його немає всередині APK. Готовий сервер надано окремим приватним архівом.\n4. Для фонових сповіщень підключи хмару, надай дозвіл Android і ввімкни службу доставки. Вона має постійне системне сповіщення; обмеження батареї та force-stop можуть затримувати роботу.\n5. Ця збірка поки має попередню іконку: файл JPG із чату недоступний у робочій папці. JPG підходить; PNG не потрібен. Передай оригінальний JPG усередині ZIP, щоб встановити саме його.\n\nНовий APK і сервер не публікувати в GitHub. Перевірки фізичного Android та незалежного аудиту не було. Деталі розгортання — server/CLOUD_2.3.md.\n`;
fs.writeFileSync(path.join(directory, 'README.txt'), privateNotice);
fs.writeFileSync(path.join(directory, `LIBO-${version}-APK.zip`), zipSync({
  [filename]: [new Uint8Array(apk), { mtime: stamp }],
  'SHA256SUMS.txt': [strToU8(sums), { mtime: stamp }],
  'README.txt': [strToU8(privateNotice), { mtime: stamp }],
}, { level: 6 }));
const serverFiles = [
  'package.json', 'package-lock.json', '.env.example', '.dockerignore', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  'server/index.mjs', 'server/accounts.mjs', 'server/cloud.mjs', 'server/README.md', 'server/CLOUD_2.3.md', 'server/Dockerfile', 'server/compose.yaml', 'server/Caddyfile',
  'web/lib/core.mjs', 'web/lib/crypto.mjs', 'web/lib/phone-api.mjs', 'web/lib/cloud-crypto.mjs',
  ...fs.readdirSync('licenses').map(name => 'licenses/' + name),
];
const files = Object.fromEntries(serverFiles.filter(name => fs.statSync(name).isFile()).map(name => [name, [new Uint8Array(fs.readFileSync(name)), { mtime: stamp }]]));
files['README.md'] = [strToU8(fs.readFileSync('server/CLOUD_2.3.md', 'utf8')), { mtime: stamp }];
const serverArchive = zipSync(files, { level: 6 });
fs.writeFileSync(path.join(directory, `LIBO-${version}-SERVER-PRIVATE.zip`), serverArchive);
fs.writeFileSync(path.join(directory, `LIBO-${version}-PRIVATE.zip`), zipSync({
  [filename]: [new Uint8Array(apk), { mtime: stamp }],
  [`LIBO-${version}-SERVER-PRIVATE.zip`]: [serverArchive, { mtime: stamp }],
  'SHA256SUMS.txt': [strToU8(sums), { mtime: stamp }],
  'README-UK.txt': [strToU8(privateNotice), { mtime: stamp }],
}, { level: 6 }));
console.log('Local APK, ZIP and private server bundle created in deliverables/libo-2.3/.');
console.log(`SHA-256: ${digest}`);
