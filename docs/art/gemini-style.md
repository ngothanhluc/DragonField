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
      "role": "monster",
      "background": "#ff00ff",
      "maxColors": 8,
      "mirror": { "right": "left" }
    }
  ]
}
```

`sheet` is relative to `assets/resources/art/`. The file stem must start with the animation name so the manifest test's filename rule holds.

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
bun run check        # required gate after every generation
```

The staging command is idempotent: re-running it keeps existing `.meta` uuids and leaves unrelated manifest entries untouched.

## Human checkpoint

The skill stops after submitting the prompt and waits for approval in the browser. Download and staging happen only after that approval. If staging rejects an image, regenerate once, then ask the human.
