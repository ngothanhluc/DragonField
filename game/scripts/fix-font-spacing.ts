/** Chạy: `bun run scripts/fix-font-spacing.ts` (idempotent). */
import { fixFontSpacing } from './lib/font-spacing';

const result = fixFontSpacing();
console.log(
  `NormalFont.ttf: space gid ${result.glyph}, advance ${result.oldAdvance} → 682/2048 (1/3 em)`,
);
