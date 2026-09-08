import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { readBuildInfo } from './scripts/build-info.ts';

export default defineConfig({
    define: { __TUNEFREE_BUILD_INFO__: JSON.stringify(readBuildInfo()) },
    test: {
        environment: 'happy-dom',
        globals: true,
        setupFiles: ['./src/core/__tests__/domEnvironment.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'json-summary'],
            reportsDirectory: './coverage',
            reportOnFailure: true,
            thresholds: { lines: 100 },
            include: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
            exclude: [
                '**/__tests__/**',
                '**/*.test.{ts,tsx}',
                '**/*.d.ts',
            ],
        },
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
});
