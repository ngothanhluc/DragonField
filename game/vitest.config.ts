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
    // M9 rooms are 128×72 and bosses/roles grew: whole-chapter sims take 5–12 s on the CI runner,
    // over vitest's 5 s default. A slow test is not a broken one; a hang still fails at 60 s.
    testTimeout: 60_000,
  },
});
