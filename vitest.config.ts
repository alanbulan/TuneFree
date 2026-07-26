import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            reportsDirectory: './coverage',
            include: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
            exclude: [
                '**/__tests__/**',
                '**/*.test.{ts,tsx}',
                '**/*.d.ts',
                'src/main.tsx',
                'src/desktopLyricMain.tsx',
            ],
        },
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
});
