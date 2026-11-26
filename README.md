# Yokai Field

A top-down, one-screen bullet-dodging roguelite for the web. **You always auto-fire**,
so the skill is in movement: clear a room, pick 1 of 3 skills, clear the chapter, beat the boss.
Death ends the run; gold is kept for permanent meta upgrades.

Built with **Cocos Creator 3.8.8** (web-desktop), TypeScript and Bun.

**Play:** https://yokai.lukeinc.tech · **Story:** https://lukeinc.tech/projects/dragon-field

A remake of *Dragon Field*, our 2023 Game Development coursework at the University of Science,
VNU-HCM (Nguyen Minh Tri & Ngo Thanh Luc, instructor MSc. Nguyen Le Hoang Dung), which was
hand-coded in Unity. The Unity project lives at tag `unity-final`.

- 3 chapters: grassland/forest → river/waterfall → abandoned village
- 9 rooms per chapter (8 rooms + boss), 3-phase bosses: **Tengu → Squid → Samurai**
- 20 stacking skills, meta shop with 3 permanent upgrade tracks
- Pixel art 16 px, auto-fire shuriken, pooled bullets/VFX, pixel font UI

## Controls

| Action | Keys |
|---|---|
| Move | `WASD` / arrow keys |
| Pause / resume | `Esc` or `P` |
| Menus | mouse, `↑`/`↓`, `←`/`→`, `Enter`/`Space`, `Esc` |
| Skill pick | click, `1`/`2`/`3`, `←`/`→` + `Enter` |

## Run locally

```bash
cd game
bun install
bun run check          # config sync + tsc + vitest + eslint
```

Build the web version (needs the Cocos Creator editor installed):

```bash
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project game --build "platform=web-desktop;debug=false"
# output: game/build/web-desktop/
```

Serve `game/build/web-desktop/` with any static HTTP server.

## Project map

```text
game/assets/scripts/core/   pure TypeScript logic (no `cc` imports, unit-tested)
game/assets/scripts/game/   thin Cocos adapters (views, audio, FX, screens)
game/assets/resources/      curated Ninja Adventure subset + data (levels, animations)
game/config/tuning.json     combat/balance numbers → bun run gen
docs/                       GDD, tech decisions, milestones, art inventory
```

`bun run check` is the gate: Cocos skips TypeScript type errors at compile time, so
`tsc --noEmit`, vitest and eslint are what prove the game is still correct.

## Credits

**Ninja Adventure Asset Pack** — art and audio created by
[Pixel-boy](https://pixel-boy.itch.io/) and
[AAA](https://www.instagram.com/challenger.aaa/?hl=fr).

Released under the **Creative Commons Zero (CC0)** license. Attribution is not
required, but it is appreciated. Links from the pack:

- Patreon: <https://www.patreon.com/pixelarchipel>
- Itchio: <https://pixel-boy.itch.io/>
- Pack: <https://pixel-boy.itch.io/ninja-adventure-asset-pack>

The pack supplies the tilesets, backgrounds, base actors, FX, UI and every music/SFX track.
Additional pixel art is generated during development with `create-game-assets` and follows the
style brief in `docs/art/gemini-style.md`. Extra audio packs are not used.

**VT323 Pixel Font** — designed by [Peter Hull](https://github.com/phoikoi/VT323) and bundled at
`game/assets/resources/art/ui/fonts/NormalFont.ttf` for full Vietnamese diacritic coverage.
Released under the **SIL Open Font License 1.1 (OFL-1.1)**.

Engine: **Cocos Creator 3.8.8** (free, Cocos license).
Code and game design: Yokai Field project.

## License

Game code © the Yokai Field project. Pack art/audio © Pixel-boy & AAA, CC0 1.0
(see the pack's `LICENSE.txt`; CC0 allows commercial use and does not require
attribution). VT323 font © Peter Hull, SIL Open Font License 1.1. Generated art is © the Yokai Field project.
