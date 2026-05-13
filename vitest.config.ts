import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
    exclude: ['node_modules', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: {
        // Global thresholds tracking our progress to 95% target
        statements: 80,
        branches: 60,
        functions: 85,
        lines: 80,
        // Strict thresholds for core business logic
        'src/lib/**/*.ts': {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
      },
      include: ['src/lib/**/*.ts', 'src/app/api/**/*.ts'],
      exclude: [
        'node_modules/**',
        '**/*.config.*',
        '**/*.d.ts',
        '**/types/**',
        'prisma/**',
        'e2e/**',
        'src/lib/prisma.ts',        // Client initialization — not unit testable
        'src/lib/types.ts',         // Type-only — no runtime logic
        'src/lib/utils.ts',         // Trivial cn() utility
        'src/lib/schemas/**',       // Zod schemas — type definitions, no runtime logic
        'src/app/api/auth/**',      // NextAuth config — not unit testable
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
