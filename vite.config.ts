import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { readBuildInfo } from './scripts/build-info.ts';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __TUNEFREE_BUILD_INFO__: JSON.stringify(readBuildInfo()) },
  server: {
    host: '127.0.0.1',
    port: 3101,
    strictPort: true,
    watch: {
      ignored: ['**/coverage/**', '**/.playwright-mcp/**', '**/src-tauri/target/**'],
    },
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
