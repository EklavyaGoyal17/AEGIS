import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests run against the contracts *sources* so the packages can be tested without a prior build.
const contracts = (p: string) => fileURLToPath(new URL(`../contracts/src/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@aegis\/contracts$/, replacement: contracts('index.ts') },
      { find: /^@aegis\/contracts\/crypto$/, replacement: contracts('crypto/index.ts') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
