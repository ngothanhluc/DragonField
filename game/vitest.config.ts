import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Logic trong core/ không phụ thuộc engine, nên không cần jsdom.
    globals: false,
  },
});
