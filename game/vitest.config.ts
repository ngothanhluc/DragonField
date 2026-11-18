import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `tsconfig.json` extends `./temp/tsconfig.cocos.json` do editor Cocos sinh (gitignored),
  // so on CI/a fresh worktree Vite cannot read it and every test file dies with TSConfckParseError.
  // A **string** tsconfigRaw makes Vite skip reading tsconfig; keep exactly the options
  // tsconfig.cocos.json sets and esbuild cares about (target, decorators).
  esbuild: {
    tsconfigRaw: JSON.stringify({
      compilerOptions: { target: 'ES2015', experimentalDecorators: true },
    }),
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Logic in core/ does not depend on the engine, so jsdom is not needed.
    globals: false,
  },
});
