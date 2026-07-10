import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3101,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 3101,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  build: {
    outDir: 'out',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: path.resolve(rootDir, 'index.html'),
        desktopLyric: path.resolve(rootDir, 'desktop-lyric/index.html'),
      },
    },
  },
});
