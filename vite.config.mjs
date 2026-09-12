import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { emojiPlugin } from './scripts/emoji-assets.mjs';

export default defineConfig({
  root: 'web',
  plugins: [emojiPlugin()],
  base: './',
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'], fs: { strict: true, allow: [resolve('web'), resolve('node_modules')], deny: ['.env', '.env.*', '**/*.{crt,pem,key,keystore,jks}', '**/.git/**', '**/.local/**'] } },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'] },
  build: { outDir: '../dist', emptyOutDir: true, target: 'chrome90', sourcemap: false },
});
