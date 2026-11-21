# Generated art style brief

`create-game-assets` reads this file before writing a prompt or running staging. It is the single source of truth for generated art; the pack's own files keep their byte-for-byte staging rules in `import-checklist.md`.

## Reference set

The pack files are tiny (the palette is 10×9 px, a monster strip 64×64), and Gemini's
vision encoder resamples uploads before it reads them — at native size the colours and
silhouettes are gone. Upscale every reference with nearest-neighbour first:

```bash
cd game
bun run prep:refs --out ../art-source/gemini/refs --min 768 \
  ../art-source/ninja-adventure/Palette.png \
  assets/resources/art/characters/ninja-green/Idle.png \
  assets/resources/art/monsters/spider-red/SpriteSheet.png \
  assets/resources/art/fx/shuriken/SpriteSheet.png
```

Upload these four upscaled copies with every prompt so the output inherits the project's
palette, shading and proportions:

| Role | File (after `prep:refs`) |
|---|---|
| Palette (53 colours) | `art-source/gemini/refs/ninja-adventure-Palette.png` |
| Player proportions | `art-source/gemini/refs/ninja-green-Idle.png` |
| Monster proportions | `art-source/gemini/refs/spider-red-SpriteSheet.png` |
| FX / outline language | `art-source/gemini/refs/shuriken-SpriteSheet.png` |

`prep:refs` prefixes the parent folder so `SpriteSheet.png` copies do not overwrite
each other. If a source file is absent, stop and pick another from the same pack rather
than prompting without a reference.

## Hard constraints

- 16×16 px tiles; 1 texture px = 1/16 world unit. Never normalise by frame width.
- Top-down 3/4 view, four directions ordered down, up, left, right for grid sheets.
- Player frames 32×32, monster frames 16×16, boss frames at least 60 px on a strip.
- Player and monster sheets carry all four directions, even when only one direction is used by a prompt.
- Alpha is binary: transparent or opaque. No anti-aliased edges, no drop shadows baked into the sheet.
- Every opaque colour must map onto the 53-colour `Palette.png` by nearest colour; the staging command does this.
- Anchors sit at the feet; the lowest solid pixel of a frame defines `footPx`.
- Player projectiles are pointed and enemy projectiles are round with a dark outline.
- One logical key per animation: `<actor>.<animation>[.<direction>]`, lowercase kebab segments.

## Prompt skeleton

Gemini ignores "transparent", draws small and draws far too much detail: each 16 px cell
comes back as a ~50–60 px illustration, and the downscale keeps about one source pixel in
four. What carries quality:

- the **exact colour list** (the swatch image alone is 10×9 px and gets resampled away);
- the **fill ratio** (otherwise the character lands at 8–10 px inside a 16 px cell);
- **low detail**: big flat shapes, 4–5 colours plus the outline, one bright accent (eyes,
  gem) — the pack's monsters read at 16 px because they are that simple;
- **mid/light values**: a body made of the palette's darkest colours collapses into the
  outline at 16 px and disappears on dark grass; keep the darkest colour for the outline;
- **margin**: nothing (weapon, cape, tail) may touch the left, right or top of its cell —
  staging rejects a sprite that crosses into its neighbour;
- **one identical design in every cell**: same outfit colours on every row; idle frames
  differ by 1–2 sprite pixels (breathing, cloth), not by a new pose.

```text
Create ONE pixel-art sprite sheet for a top-down 3/4 view action game.
The attached images are STYLE references only.

Canvas: 1024x1024. Grid: 4 columns (facing down, up, left, right) x 4 rows (idle
frames 1-4), every cell 256x256 px = one 16x16 sprite scaled 16x with nearest-neighbour.

The character must FILL its cell: 14-15 of the 16 pixels tall, feet on the cell floor,
but keep at least 1 sprite pixel of empty margin on the left, right and top of every cell:
no weapon, cape or tail may cross into the next cell. Draw it as a real 16x16 sprite: big
flat shapes, at most 5 colours plus a 1 px #141b1b outline, one bright accent colour for
the eyes, two-tone shading per material, no gradients, no fine texture. Use mid and light
values for the body so it reads on dark grass; the darkest colour is only the outline.

Every cell shows the SAME character with the SAME colours. Idle frames differ by only
1-2 sprite pixels (breathing, cloth sway); the pose and the held item do not move.

Use ONLY these exact colours, no invented shades:
#d78b4a #ffad5d #ffbc75 #d2b37d #f1c471 #ffcb8d #eecf9b #ffe18d #fce2ca #ffffff
#965340 #9c6546 #a3754e #bd7959 #d3865f #c8966b #f2ad7d #ffcba9 #d14b34 #e46d3a
#ef914f #ff9554 #e0394c #cf736d #ef9597 #4a5270 #2d697b #548789 #79b8ce #71ddee
#8feff1 #b8dce5 #f2eaf1 #56864c #74a334 #a8a129 #adbc3a #3b3643 #543c52 #8f3e56
#a5608b #d3a2c0 #345a52 #5f7160 #8d977f #abc2bc #141b1b #4e484a #695953 #816855
#90775e #8e7c73 #b3957f

Background: flat solid #FF00FF everywhere, one uniform colour, never used in the sprite.
No anti-aliasing, blur, shadow, ground, grid lines, text or watermark.
```

## Directories

| Purpose | Path | Committed? |
|---|---|---|
| Raw download + spec | `art-source/gemini/` | No (gitignored via `art-source/`) |
| Generated art after validation | `game/assets/resources/art/generated/` | Yes, with `.meta` |
| Generated actor allowlist | `game/config/generated-art.json` | Yes |

Download the full-size image (1K free, 2K on a Pro account) and let staging reduce it to the target frame size.

## Spec format

Write `art-source/gemini/spec.json` before staging:

```json
{
  "assets": [
    {
      "key": "sniper.idle",
      "source": "art-source/gemini/sniper-idle.clean.png",
      "sheet": "generated/sniper/idle.png",
      "frameWidth": 16,
      "frameHeight": 16,
      "layout": "grid",
      "directions": ["down", "up", "left", "right"],
      "frames": 4,
      "fps": 8,
      "loop": true,
      "anchor": "feet",
      "kind": "monster",
      "background": "#ff00ff",
      "maxColors": 8,
      "mirror": { "right": "left" }
    }
  ]
}
```

`sheet` is relative to `assets/resources/art/` (a **directory** for `icon`). The file stem must start with the animation name so the manifest test's filename rule holds. `kind` defaults to the legacy `role` (`actor`/`monster`/`boss`), and to `character` when neither is given; see [Kinds](#kinds) for each kind's fields.

A key that ends in a direction owns exactly that direction: `sniper.idle.down` pairs with `directions: ["down"]`, which is a one-column grid (`16×64`). A key without a trailing direction must use `directions: []`.

A four-direction sheet is the normal case for players and monsters: give the spec **one** asset whose key has no direction and whose `directions` lists all four, e.g. `{"key": "sniper.idle", "directions": ["down","up","left","right"]}`. Staging writes **one** file and expands it into four manifest keys (`sniper.idle.down` …) that all point at that sheet; the runtime picks the column with `directions.indexOf(direction)`. Do not split a four-column sheet into four files — the manifest test requires player/monster keys to declare all four directions.

### Background key

Gemini usually ignores "transparent background" and paints an opaque one. Add `"background": "#ff00ff"` to the spec and prompt for a flat magenta backdrop: staging chroma-keys that colour to alpha 0 at full resolution before the downscale. `"background": "auto"` keys whatever colour sits in the top-left pixel (fine for a clean white backdrop, but white also appears inside sprites, so magenta is safer). Omit the field to keep the background as drawn. The 53-colour palette has no magenta or pure green, so the key cannot collide with art colours.

### Frame fit

`"fit": "cell"` (default for grid layouts) crops each direction to its opaque bbox — unioned across that column's frames so the scale stays constant — resamples the crop to the frame height and puts each frame's feet on the cell floor. Without it, a character Gemini drew at 8–10 px stays tiny inside the 16 px frame. Shrinking uses the dominant colour of each source block, not a single nearest sample, which keeps edges from turning into noise. `"fit": "none"` keeps the raw cell mapping.

### Colours and mirroring

Staging maps the image onto the palette **at full resolution** and **per colour cluster**:
it groups the sheet's colours (k-means over the whole sheet) and maps each group to one
palette colour, so a shade halfway between two entries cannot turn tan on one frame and
green on the next. It then keeps the sheet's
`maxColors` most used colours (default 10) so every frame shares one colour set; a rare
colour far from all of them (eyes, a gem) is kept as an accent. The downscale then votes
per block with rare colours weighted up (×3 at most), so a 2-pixel eye is not outvoted
by the cloak. Isolated single pixels are dropped after the downscale.

`"mirror": { "right": "left" }` builds the right column by flipping the left one, which
guarantees the two sides match. Use it whenever the design is symmetric (most monsters);
the right column of the download is then ignored.

### Quality gate

Before fitting, staging inspects every cell of the palette-mapped download and **aborts**
on:

| Issue | Meaning | Fix |
|---|---|---|
| `edge` | opaque pixels within 4 px of a cell's left, right or top edge | regenerate with the margin sentence; a weapon crossing cells gets cut |
| `drift` | a frame's colours differ from its column's typical frame by more than 0.2 | regenerate; Gemini recoloured a row |
| `empty` | nothing left after the chroma key | wrong background colour or empty cell |

Small blobs spilled across a cell boundary (feet one row too low) are cleared first, so
they do not trip the gate. `bun run stage:gen --force` stages despite issues and only
prints them — use it for a comparison, never for an asset you commit.

## Kinds

Every spec asset declares a `kind`. It decides how the download is split, fitted, gated,
registered and whether a manifest entry is written. The old `role` field still works
(`actor` → `character`, `monster` → `monster`, `boss` → `boss`); no kind and no role means
`character`.

| Kind | Ask Gemini for | Frame in this project | Anchor | Background | Register |
|---|---|---|---|---|---|
| `character` | 4 columns D/U/L/R × N frames, **unarmed**, feet on the floor | 32×32 | feet | magenta | manifest, 4 keys |
| `monster` | 4 columns D/U/L/R × N frames, same outfit on every row | 16×16 | feet | magenta | manifest, 4 keys |
| `boss` | one row of N frames | 96×96 | feet | magenta | manifest, 1 key |
| `attachment` | 4 columns D/U/L/R × **1** frame, weapon alone | 16×16 | centre | magenta | manifest, 4 keys + `attachments.json` |
| `prop` | one row, e.g. chest closed → open | 16×16 | feet | magenta | manifest, 1 key |
| `vfx` | one row, motion between frames, loop off | 16×16 (32 for a big burst) | centre | magenta | manifest, 1 key |
| `particle` | one row, 4–8 frames, loop off | 8×8 | centre | magenta | manifest, 1 key |
| `icon` | a row of separate objects, margins around each | 24×24 | centre | magenta | one manifest key per name |
| `ui` | **one** image, drawn edge to edge at the exact size | e.g. 48×32 | centre (stretched) | omit for a rectangular panel | manifest, 1 key |
| `tileset` | an opaque grid of tiles, seamless edges | 16×16 per tile | — | none (opaque) | PNG + optional `.tsx`, no manifest |

The whole canvas is always stored at the grid the prompt asked for (cells × frame size);
a character canvas is `4 × frameWidth` wide and `frames × frameHeight` tall. Only
`icon` and `tileset` read a source grid that is **not** the output grid: icons are fitted
per cell and split into one file per name, tiles are sliced whole, edge to edge.

**Character — unarmed, separate weapons.** Ask for the body only: no sword, bow, staff or
shuriken in any frame. Weapons are separate `attachment` assets (held `hand` or worn
`back`) or plain projectiles, so a run can switch or hide them (GDD §14). Record the attach
points in the same spec:

```json
{
  "key": "cultivator.idle",
  "kind": "character",
  "source": "art-source/gemini/cultivator-idle.clean.png",
  "sheet": "generated/cultivator/idle.png",
  "frameWidth": 32, "frameHeight": 32,
  "layout": "grid", "directions": ["down", "up", "left", "right"],
  "frames": 4, "fps": 8, "loop": true,
  "background": "#ff00ff",
  "attach": {
    "hand": { "down": [22, 20], "up": [10, 20], "left": [12, 20], "right": [20, 20] },
    "back": { "down": [16, 12], "up": [16, 12], "left": [18, 12], "right": [14, 12] }
  }
}
```

Staging writes/merges `characters[<actor>]` in `attachments.json` with the frame size, the
points and the per-frame bob it measured from the staged sheet. Stage each animation
(`.idle`, `.walk`, `.attack`) separately; the bob merges.

**Attachment — one weapon, four facings.** Draw the weapon alone on the backdrop, facing
the same directions as the body, and keep it small in its cell: an attachment frame is not
the body frame, the game places it. `fitBox` caps how much of the 16×16 frame the fitted
weapon may fill, so a back sword stays shorter than the body. `grip` is the point the hand
or back holds, in the item frame; `behind` overrides the slot's default draw order.

```json
{
  "key": "attachment.sword-back",
  "kind": "attachment",
  "source": "art-source/gemini/sword-back.clean.png",
  "sheet": "generated/attachments/sword-back.png",
  "frameWidth": 16, "frameHeight": 16,
  "layout": "grid", "directions": ["down", "up", "left", "right"], "frames": 1,
  "slot": "back",
  "grip": { "down": [8, 10], "up": [8, 10], "left": [8, 10], "right": [8, 10] },
  "fitBox": [14, 14],
  "background": "#ff00ff"
}
```

**Prop / VFX / particle — one strip.** One row of frames, one `key`. Effects keep their
motion because staging fits the **whole strip** with one crop window, not each frame.
Particles and props are gated for size; vfx/particle skip the edge gate (a burst fills its
cell). Set `"loop": false` for one-shot effects.

**Icon — a sheet of separate objects.** `sheet` is a **directory**; each name becomes
`<actor>.<set>-<name>` (key `icon.skills`, name `swords` → `icon.skills-swords`, file
`generated/icons/skills/skills-swords.png`). Leave margins so the edge gate passes; staging
then fits every icon to fill its own 24×24 cell. Use it for items, skills and small
character portraits.

```json
{
  "key": "icon.skills",
  "kind": "icon",
  "source": "art-source/gemini/skill-icons.clean.png",
  "sheet": "generated/icons/skills",
  "frameWidth": 24, "frameHeight": 24,
  "names": ["swords", "shield", "dash"],
  "columns": 3,
  "background": "#ff00ff"
}
```

**UI — one image, exact size.** `frameWidth × frameHeight` **is** the output size (do not
ask for a bigger canvas and downscale). `nineSlice` writes the insets into the sprite
frame's `.meta` borders, so the game can stretch the middle: keep the borders free of
detail that repeating would smear.

```json
{
  "key": "ui.panel",
  "kind": "ui",
  "source": "art-source/gemini/panel.clean.png",
  "sheet": "generated/ui/panel.png",
  "frameWidth": 48, "frameHeight": 32,
  "nineSlice": { "left": 8, "right": 8, "top": 8, "bottom": 8 }
}
```

**Tileset — opaque and seamless.** Ask for a grid of tiles with **no** background key:
every pixel is drawn, neighbouring tiles match across their shared edge, and the edges of
the sheet tile into each other. Staging slices each whole cell to `frameWidth` (no crop,
no gate, no manifest entry). With `tsx` it also writes the tileset file next to the rooms:

```json
{
  "key": "tileset.ruins",
  "kind": "tileset",
  "source": "art-source/gemini/ruins-tiles.clean.png",
  "sheet": "generated/tilesets/ruins.png",
  "frameWidth": 16, "frameHeight": 16,
  "columns": 4, "rows": 3,
  "tsx": "data/levels/chapter-1/ruins.tsx"
}
```

## Rooms from text layouts

Room maps are **not** generated by the image model: a room is data, authored as 18 rows of
32 characters plus a legend. Each character is a floor tile and may also place an object
(`obstacle`, `playerStart`, `spawn`, `door`). `bun run build:room` writes the `.tmx` (and
its `.tmx.meta`) and validates it with the game's own parser before saving, so a broken
layout fails at build time.

```json
{
  "chapter": 1,
  "room": 7,
  "tilesets": [{ "source": "field.tsx", "firstgid": 1 }],
  "legend": {
    ".": { "tile": 37 },
    "#": { "tile": 12, "obstacle": "wall" },
    "o": { "tile": 37, "obstacle": "pillar" },
    "P": { "tile": 37, "playerStart": true },
    "c": { "tile": 37, "spawn": { "role": "chaser", "wave": 1 } },
    "D": { "tile": 37, "door": { "toRoom": 8 } }
  },
  "rows": [
    "################################",
    "#..............................#",
    "… 18 rows of 32 characters …"
  ]
}
```

Object coordinates are the **cell centre** (`col × 16 + 8`, `row × 16 + 8`); adjacent
obstacle cells of the same kind are merged into rectangles, so a wall is one object, not
one per tile. Waves must be contiguous from 1, and a door without `toRoom` is the chapter
exit. Objects must not overlap the player start or each other; the parser reports every
problem at once.


## Watermark removal

Gemini stamps a faint logo into the bottom-right corner of each generated image. It survives the downscale to 64×64 as a tinted patch, so clean the raw download before staging:

```bash
cd game
bun run remove:watermark -- ../art-source/gemini/sniper-idle.png --output ../art-source/gemini/sniper-idle.clean.png
```

Write a new `.clean.png`, leave the raw download untouched, and point the spec's `source` at the cleaned file. The tool is a vendored MIT build of [GargantuaX/gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover) (`@pilio/gemini-watermark-remover` + `sharp` as dev dependencies). `--json` reports `meta.applied` and `meta.qualityStatus`. `possible-content-damage` fires on the magenta backdrop's channel clipping even for a clean result, so compare the raw and cleaned bottom-right corner scaled up: keep the cleaned file when the corner is intact, stage the raw download only when sprite pixels are visibly damaged (a logo over a sprite survives the downscale). A Pro account downloads 2K (`2048×2048`), which staging downscales like the free 1K output.

## Commands

```bash
cd game
bun run remove:watermark -- <input> --output <file>   # strip Gemini's corner logo (new file)
bun run stage:gen    # process raw downloads, quality gate, write .meta, merge manifest, update allowlist
bun run build:room <layout.json> <out.tmx>   # text layout → validated .tmx + .tmx.meta (no image model)
bun run check        # required gate after every generation
```

The staging command is idempotent: re-running it keeps existing `.meta` uuids and leaves unrelated manifest entries untouched.

## Human checkpoint

The skill stops after submitting the prompt and waits for approval in the browser. Download and staging happen only after that approval. If staging rejects an image, regenerate once, then ask the human.
