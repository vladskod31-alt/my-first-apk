import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

export async function browserOptions() {
  if (process.env.CHROMIUM_PATH) return { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'], headless: true };
  const require = createRequire(import.meta.url);
  const packageRoot = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../..');
  const deps = path.join(os.tmpdir(), 'libo-chromium-libs-143');
  if (!fs.existsSync(path.join(deps, 'lib/libnspr4.so'))) {
    fs.mkdirSync(deps, { recursive: true });
    const compressed = fs.readFileSync(path.join(packageRoot, 'bin/al2023.tar.br'));
    execFileSync('tar', ['-xf', '-', '-C', deps], { input: zlib.brotliDecompressSync(compressed) });
  }
  const unsafeArgs = ['--single-process', '--disable-web-security', '--allow-running-insecure-content', '--disable-site-isolation-trials'];
  return {
    executablePath: await chromium.executablePath(),
    args: chromium.args.filter(arg => !unsafeArgs.includes(arg)),
    headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(deps, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  };
}
