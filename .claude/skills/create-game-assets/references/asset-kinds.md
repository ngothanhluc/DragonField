# What each kind of asset needs from the generator

Load this before writing a prompt. The style brief gives the numbers (canvas, frame size,
palette, backdrop colour) and the spec field names for this project; this file says what
the **generator** has to be asked for so the staging pipeline can use the result.

Two questions decide the shape of almost every prompt:

1. **One image or an animation sheet?** An animation is a grid of cells: one row per frame,
   one column per facing (in the order the style brief names). A still image (a panel, an
   icon) is a single picture at the exact target size.
2. **What must not touch the cell edge?** A body or a weapon needs a margin around it so a
   swing or a cape is not cut; a tile or a nine-slice panel is drawn deliberately edge to
   edge.

Always state in the prompt: exact canvas and grid math, column order, flat backdrop colour
(or "fully opaque" for a tileset), palette restriction, hard pixels, no text/labels/grid
lines/watermark, and that the subject keeps the same proportions on every frame.

## Kinds

### Playable character

- **Sheet:** columns = facings, rows = animation frames.
- **Unarmed.** Ask for the body only: no weapon, staff, bow, shield or projectile in any
  frame. Weapons are separate attachments or projectiles, so a run can change or hide them.
- Feet on the floor of each cell, same outfit colours on every row.
- Margin at the left/right/top of each cell; a weapon crossing a cell border is the most
  common failure.

### Monster

- **Sheet:** columns = facings, rows = frames. Its weapon (if any) is **baked into the
  sheet** — part of the silhouette, not a separate asset.
- Same margin and consistency rules as a character.

### Boss

- **Sheet:** one row of frames (no facings).
- Much larger canvas than a monster; keep every part inside its cell, including a charge
  or a slam pose that reaches sideways.

### Attachment (held or worn weapon/prop)

- **Sheet:** columns = facings, **one** frame each. Draw the weapon alone on the backdrop,
  facing the same way as the body would.
- It must be small relative to the body: the style brief's fit box caps how much of the
  attachment frame it may fill.
- One point per facing is the grip (where the hand/wrist holds it); the pipeline records
  it, the game aligns it to the body's hand or back point.
- Held items and worn items are the same kind of asset; the spec says which slot it goes
  on and which facings draw it behind the body.

### Prop / interactive object

- **Sheet:** one row, e.g. a chest closed → opening → open. No facings.
- Frames differ in **state**, not just motion; the quality gate must not treat that as
  colour drift.

### VFX

- **Sheet:** one row, motion between frames, usually a one-shot (no loop).
- The effect may fill its frame; keep cells square and consistent so positions line up
  between frames.

### Particle

- **Sheet:** one row, few frames, one-shot. Often the same shape at different sizes or
  opacities — keep the colour the same across frames.

### Icon set

- **Sheet:** a grid of **separate objects**, one per cell, in row-major order. Each icon is
  its own thing (a sword, a shield, a face), so colours legitimately differ between cells.
- Leave a margin around each icon; the pipeline then fits each one to fill its own frame.
- Ask for the objects at a similar visual weight so they read together.

### UI image

- **One** picture, drawn at the exact target size — do not draw big and downscale.
- A stretchable panel needs a **nine-slice**: repeatable flat centre, detailed corners and
  edges, and nothing important in the middle of a border that stretching would smear.
- Opaque across the whole panel; if the panel has a transparent outside, ask for the flat
  backdrop colour and the pipeline keys it out.

### Tileset

- **Sheet:** a grid of whole tiles, all **fully opaque** — no backdrop key.
- Tiles must be seamless: neighbouring tiles match across their shared edge, and the edges
  of the sheet tile into each other (a floor repeats without a visible seam).
- No margin and no crop: every pixel of every cell is the tile.

## Rooms and other authored data

A room map is data, not art: a grid of characters plus a legend of tiles and objects,
built by a command when the style brief names one. Do not send it to the image model and
do not check it in by hand — the build command validates it with the game's own parser.
