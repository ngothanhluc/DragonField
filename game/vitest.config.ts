import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `tsconfig.json` extends `./temp/tsconfig.cocos.json` do editor Cocos sinh (gitignored),
  // nên trên CI/worktree mới Vite không đọc được nó và mọi file test chết với TSConfckParseError.
  // tsconfigRaw dạng **chuỗi** làm Vite bỏ qua việc đọc tsconfig; giữ đúng các option mà
  // tsconfig.cocos.json đặt ra và esbuild quan tâm (target, decorators).
  esbuild: {
    tsconfigRaw: JSON.stringify({
      compilerOptions: { target: 'ES2015', experimentalDecorators: true },
    }),
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Logic trong core/ không phụ thuộc engine, nên không cần jsdom.
    globals: false,
  },
});
