import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './',
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'] },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'] },
  build: { outDir: '../dist', emptyOutDir: true, target: 'chrome90', sourcemap: false },
});
