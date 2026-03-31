import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: path.resolve(rootDir, 'public'),
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'public/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3100',
    },
  },
  build: {
    outDir: path.resolve(rootDir, 'dist/public'),
    emptyOutDir: false,
  },
});
