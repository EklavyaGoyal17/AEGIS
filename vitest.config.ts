import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['services/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
