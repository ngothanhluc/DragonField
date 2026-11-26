# GDD — M16: Vietnamese Localization, Pixel Font & Explosion FX Fix

**Status:** `designed` · **Milestone:** [M16](../milestones/m16-m21.md#m16--tiếng-việt-mặc-định-font-pixel-vi--sửa-lỗi-nổ-vuông) · **ADR:** [ADR-024](../tech-decisions.md#adr-024--client-side-i18n-vietnamese-default--vietnamese-pixel-font-m16)

---

## 1. Explosion FX Slicing Fix

### Root cause
- `game/assets/resources/art/fx/explosion/SpriteSheet.png` is `360×40 px` containing **9 square frames of `40×40 px`**.
- `game/assets/resources/data/animations.json` declared `"frameWidth": 24, "frameHeight": 40, "frames": 15`, slicing each round explosion frame vertically in half into boxy rectangular artifacts.

### Design rules
1. Update `fx.explosion` in `animations.json` to `frameWidth: 40, frameHeight: 40, frames: 9, fps: 14` (and `STYLES['fx.explosion'].frameMaxPx = 40` in `effect-pool.ts`, tuning `lifetimeMs` so all 9 frames complete cleanly before despawn).
2. Audit **every** `fx.*` strip/grid entry in `animations.json` (`fx.smoke`, `fx.smoke-circular`, `fx.impact`, `fx.spark`, `fx.boost`, `fx.ice`, `fx.poison`, `fx.shield`, `fx.cut`, `fx.slash-arc`) against its real PNG dimensions and visible frame boundaries so no other FX has off-frame slicing.
3. Add a unit/asset check ensuring `fx.explosion` has 9 frames of `40×40` and no FX frame slices across non-transparent inter-frame art.

---

## 2. Localization (`core/i18n/`)

### Supported locales
- `'vi'` (**default**) — Tiếng Việt.
- `'en'` — English (selectable in Settings).

### Persistence
- Add `settings.locale: 'vi' | 'en'` (default `'vi'`).
- Bump Profile Save schema (or migrate cleanly in `save-data.ts` per `save-systems` rules: existing v5 saves without `settings.locale` default to `'vi'`).
- Changing language in Settings applies immediately to open screens and persists across reloads.

### Coverage
All player-facing copy must go through typed translation keys (`t(key, params)`):
- Menus: Title, Chapter Select, Character Select, Meta Shop, Pause, Settings, Credits, Results/Death screen (including cause of death and unlock notifications).
- Gameplay HUD: Room counter, enemies remaining, Boss banners (`GIAI ĐOẠN 2`, `CUỒNG NỘ`), Dash/Active badges, Level-up modal (rarity badges, skill names, descriptions, Evolution pairing hints, Reroll button), mid-run Shop panel, portal labels.
- Data labels: 4 playable characters (names, subtitles, passives, signatures), all base skills & Evolutions, chapter titles, Ascension modifiers.

### Layout safety (`game-ui-ux`)
- Vietnamese copy with diacritics can be taller (accent marks above `Â, Ắ, Ộ`) and up to ~20–30% wider than short English labels.
- Add generous `lineHeight` padding (`>= fontSize + 4..6 px`) and verify **0 clipped / overflowing labels** (`uiText()`) across `1920×1080`, `1280×720`, `1280×800`, and `1024×768` in both `vi` and `en`.

---

## 3. Vietnamese Pixel Font

### Problem
- The pack's `NormalFont.ttf` is missing **36 / 43** Vietnamese diacritic glyphs (`ả, ạ, ă, ắ..ặ, â, ấ..ậ, đ, ế..ệ, ố..ộ, ơ, ớ..ợ, ư, ứ..ự`), causing browser fallback or missing glyphs.

### Replacement requirements
- Bundle an open-source pixel/retro TTF font with **100% Vietnamese Latin Extended-A/B & Vietnamese glyph coverage** (e.g., `VT323`, `Pixelify Sans`, or `Fusion Pixel` / `Press Start 2P` Vietnamese-complete equivalent — verified programmatically with `fontTools` against all 134 Vietnamese upper+lower accented characters before committing).
- Keep crisp legibility at HUD & menu sizes (`9–30 px` in 512×288 design coordinates) and preserve proper space width (no `Clearthechapter` collapse).
- Verify font license compatibility (SIL OFL / Apache 2.0 / CC0) and credit it in Credits screen + `README.md`.
