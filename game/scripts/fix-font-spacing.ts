/** Run: `bun run scripts/fix-font-spacing.ts` (idempotent). */
import { fixFontSpacing } from './lib/font-spacing';

const result = fixFontSpacing();
console.log(
  `NormalFont.ttf: space gid ${result.glyph}, advance ${result.oldAdvance} → ${result.newAdvance}/${result.unitsPerEm} em`,
);
