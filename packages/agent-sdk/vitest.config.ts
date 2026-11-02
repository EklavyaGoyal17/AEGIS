import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests run against sibling package *sources* so they do not require a prior build.
const src = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@aegis\/contracts$/, replacement: src('contracts/src/index.ts') },
      { find: /^@aegis\/contracts\/crypto$/, replacement: src('contracts/src/crypto/index.ts') },
      { find: /^@aegis\/policy-engine$/, replacement: src('policy-engine/src/index.ts') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
