/**
 * #92 acceptance: wandering villagers, the reusable RPG DialogBox, and village animals.
 *
 * Seam: the pure Village Life session (`createVillageLife` / `stepVillageLife` / `talkToVillager`
 * / `advanceVillageDialog`) plus the DialogBox view model (`dialogBoxView`), all exported from
 * `core/hub`. The Cocos hub adapter only renders what these return.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HUB_VILLAGER_IDS,
  NPC_BODY_RADIUS_TILES,
  VILLAGER_DIALOG_CATALOG,
  advanceDialog,
  advanceVillageDialog,
  buildHubInteractables,
  createVillageLife,
  dialogBoxView,
  findNearestInteractable,
  isVillageDialogOpen,
  moveDialogChoice,
  openShopkeeperDialog,
  parseHubTmx,
  resolveDialogPortrait,
  stepVillageLife,
  talkToVillager,
  villageLiveNpcs,
  type HubMapData,
  type VillageLifeState,
} from '../../../assets/scripts/core/hub';
import { EN, VI } from '../../../assets/scripts/core/i18n';
import type { Vec2 } from '../../../assets/scripts/core/math/vec2';
import { circleOverlapsObstacle } from '../../../assets/scripts/core/movement/collision';

const HERE = dirname(fileURLToPath(import.meta.url));
const VILLAGE_TMX = join(HERE, '../../../assets/resources/data/levels/village/village-hub.tmx');
const map: HubMapData = parseHubTmx(readFileSync(VILLAGE_TMX, 'utf8'), { source: 'village-hub.tmx' });

/** Real values from `assets/resources/data/atmosphere.json` (`animal`). */
const OPTIONS = {
  seed: 92,
  animalTuning: { fleeRadiusTiles: 3, wanderSpeedTilesPerSec: 1.2, fleeSpeedTilesPerSec: 4 },
} as const;

/** The Village Square spawn (centre of the plaza). */
const PLAZA: Vec2 = map.playerStart;
/** Animals live in the yards: never within this many tiles of the plaza spawn. */
const PLAZA_KEEP_OUT_TILES = 6;
/** Animals stay in their own yard: never farther than this from where the map places them. */
const YARD_LEASH_TILES = 4;
/** "Short" lore/tip line: fits the DialogBox at every viewport. */
const MAX_LINE_CHARS = 120;

const PLAYER_RADIUS = 0.35;
const GRID = 0.5;

function dict(locale: 'vi' | 'en'): Readonly<Record<string, string>> {
  return locale === 'vi' ? VI : EN;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function villager(state: VillageLifeState, id: string): VillageLifeState['villagers'][number] {
  const found = state.villagers.find((v) => v.id === id);
  if (found === undefined) throw new Error(`no villager ${id}`);
  return found;
}

function step(state: VillageLifeState, dtMs: number, playerPos: Vec2 | null) {
  return stepVillageLife(state, map, { dtMs, playerPos });
}

describe('#92 wandering villagers: patrol and yield', () => {
  it('spawns 4-6 villagers from the map that patrol, then stop and face an approaching player', () => {
    let life = createVillageLife(map, OPTIONS);
    expect(life.villagers.length).toBeGreaterThanOrEqual(4);
    expect(life.villagers.length).toBeLessThanOrEqual(6);
    expect(life.villagers.map((v) => v.id)).toEqual([...HUB_VILLAGER_IDS]);
    expect(life.dialog).toBeNull();

    // Nobody near: villagers walk their routes.
    const start = villager(life, 'villager-2').position;
    for (let i = 0; i < 10; i += 1) life = step(life, 100, null).state;
    expect(dist(villager(life, 'villager-2').position, start)).toBeGreaterThan(0.5);

    // Player walks up beside villager-2: it yields (stops) and faces the player.
    const here = villager(life, 'villager-2').position;
    const player = { x: here.x, y: here.y + 1 };
    for (let i = 0; i < 20; i += 1) life = step(life, 100, player).state;
    const yielded = villager(life, 'villager-2');
    expect(yielded.mode).toBe('yield');
    expect(dist(yielded.position, here)).toBeLessThan(1e-6);
    expect(yielded.facing).toBe('down');

    // Player leaves: villager-2 resumes its patrol.
    for (let i = 0; i < 30; i += 1) life = step(life, 100, null).state;
    expect(villager(life, 'villager-2').mode).not.toBe('yield');
    expect(dist(villager(life, 'villager-2').position, here)).toBeGreaterThan(0.5);
  });

  it('never blocks the spawn -> shop / North Gate / Dojo paths (villagers treated as solid bodies)', () => {
    const cols = Math.round(map.size.cols / GRID);
    const rows = Math.round(map.size.rows / GRID);
    const staticFree: boolean[] = [];
    for (let gy = 0; gy <= rows; gy += 1) {
      for (let gx = 0; gx <= cols; gx += 1) {
        const inside = gx > 0 && gy > 0 && gx < cols && gy < rows;
        const pt = { x: gx * GRID, y: gy * GRID };
        staticFree[gy * (cols + 1) + gx] =
          inside && map.obstacles.every((o) => !circleOverlapsObstacle(pt, PLAYER_RADIUS, o));
      }
    }
    const shop = map.triggers.find((t) => t.id === 'shop-entrance')!.at;
    const gate = map.triggers.find((t) => t.id === 'expedition-gate')!.at;
    const dojo = map.npcs.find((n) => n.id === 'dojo-master')!.at;
    const targets: ReadonlyArray<readonly [string, Vec2, number]> = [
      ['shop-entrance', shop, 0.6],
      ['expedition-gate', gate, 0.6],
      ['dojo-master', dojo, 1.5],
    ];

    let life = createVillageLife(map, OPTIONS);
    // 60 s of patrolling, checked every 100 ms.
    for (let tick = 0; tick < 600; tick += 1) {
      life = step(life, 100, null).state;
      const bodies = life.villagers.map((v) => v.position);
      const free = (gx: number, gy: number): boolean =>
        staticFree[gy * (cols + 1) + gx] === true &&
        bodies.every(
          (b) => Math.hypot(gx * GRID - b.x, gy * GRID - b.y) > PLAYER_RADIUS + NPC_BODY_RADIUS_TILES,
        );

      const sx = Math.round(PLAZA.x / GRID);
      const sy = Math.round(PLAZA.y / GRID);
      expect(free(sx, sy), `tick ${tick}: spawn is free`).toBe(true);
      const seen = new Set<number>([sy * (cols + 1) + sx]);
      const queue: Array<[number, number]> = [[sx, sy]];
      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          const key = ny * (cols + 1) + nx;
          if (nx < 0 || ny < 0 || nx > cols || ny > rows || seen.has(key) || !free(nx, ny)) continue;
          seen.add(key);
          queue.push([nx, ny]);
        }
      }
      for (const [name, target, within] of targets) {
        let best = Number.POSITIVE_INFINITY;
        for (const key of seen) {
          const gx = key % (cols + 1);
          const gy = Math.floor(key / (cols + 1));
          best = Math.min(best, Math.hypot(gx * GRID - target.x, gy * GRID - target.y));
        }
        expect(best, `tick ${tick}: ${name} reachable from spawn`).toBeLessThanOrEqual(within);
      }
    }
  });
});

describe('#92 RPG DialogBox: villager talk', () => {
  it('has a localized name and short lore/tip lines for every villager in vi and en', () => {
    for (const id of HUB_VILLAGER_IDS) {
      const entry = VILLAGER_DIALOG_CATALOG[id];
      for (const locale of ['vi', 'en'] as const) {
        const d = dict(locale);
        expect(d, `${locale} ${entry.nameKey}`).toHaveProperty([entry.nameKey]);
        expect(d[entry.nameKey]!.trim().length).toBeGreaterThan(0);
        for (const key of entry.lineKeys) {
          expect(d, `${locale} ${key}`).toHaveProperty([key]);
          const line = d[key]!;
          expect(line.trim().length, `${locale} ${key}`).toBeGreaterThan(0);
          expect(line.length, `${locale} ${key}: "${line}"`).toBeLessThanOrEqual(MAX_LINE_CHARS);
        }
      }
      // Translated, not copied: the vi and en first lines differ.
      expect(VI[entry.lineKeys[0] as keyof typeof VI]).not.toBe(EN[entry.lineKeys[0] as keyof typeof EN]);
    }
  });

  it('open -> typewriter -> advance reveals -> advance closes; the talker holds still; lines rotate', () => {
    let life = createVillageLife(map, OPTIONS);
    const here = villager(life, 'villager-2').position;
    const player = { x: here.x + 1, y: here.y };

    // The [E] prompt follows the villager's live position and targets the talk action.
    const prompt = findNearestInteractable(player, buildHubInteractables(map, villageLiveNpcs(life)));
    expect(prompt?.action).toEqual({ kind: 'talk-villager', npcId: 'villager-2' });

    // Open (E / click).
    life = talkToVillager(life, 'villager-2', 'en');
    expect(isVillageDialogOpen(life)).toBe(true);
    const firstKey = VILLAGER_DIALOG_CATALOG['villager-2'].lineKeys[0];
    const firstLine = EN[firstKey as keyof typeof EN];
    let view = dialogBoxView(life.dialog!, 'en');
    expect(view.speakerName).toBe(EN['hub.npc.villager2.name' as keyof typeof EN]);
    expect(view.portrait).toEqual(resolveDialogPortrait('villager-2'));
    expect(view.fullText).toBe(firstLine);
    expect(view.text).toBe('');
    expect(view.choices).toEqual([]);
    expect(view.showContinueHint).toBe(false);

    // Typewriter: text grows as a prefix of the line and blips play.
    let blips = 0;
    for (let i = 0; i < 3; i += 1) {
      const r = step(life, 100, player);
      life = r.state;
      blips += r.blipCount;
    }
    view = dialogBoxView(life.dialog!, 'en');
    expect(view.text.length).toBeGreaterThan(0);
    expect(view.text.length).toBeLessThan(firstLine.length);
    expect(firstLine.startsWith(view.text)).toBe(true);
    expect(blips).toBeGreaterThan(0);

    // The talking villager stays put, facing the player, even if the player drifts away.
    const far = { x: here.x + 5, y: here.y };
    for (let i = 0; i < 5; i += 1) life = step(life, 100, far).state;
    expect(villager(life, 'villager-2').mode).toBe('yield');
    expect(dist(villager(life, 'villager-2').position, here)).toBeLessThan(1e-6);
    expect(villager(life, 'villager-2').facing).toBe('right');

    // A second talk while one is open is ignored.
    expect(talkToVillager(life, 'villager-3', 'en').dialog?.speakerId).toBe('villager-2');

    // Advance #1: reveal the whole line at once.
    life = advanceVillageDialog(life);
    view = dialogBoxView(life.dialog!, 'en');
    expect(view.text).toBe(firstLine);
    expect(view.showContinueHint).toBe(true);
    expect(isVillageDialogOpen(life)).toBe(true);

    // Advance #2: close; the villager walks again once the player is gone.
    life = advanceVillageDialog(life);
    expect(isVillageDialogOpen(life)).toBe(false);
    expect(life.dialog).toBeNull();
    for (let i = 0; i < 30; i += 1) life = step(life, 100, null).state;
    expect(villager(life, 'villager-2').mode).not.toBe('yield');

    // Talking again rotates to the next line, here in Vietnamese.
    life = talkToVillager(life, 'villager-2', 'vi');
    const secondKey = VILLAGER_DIALOG_CATALOG['villager-2'].lineKeys[1];
    view = dialogBoxView(life.dialog!, 'vi');
    expect(view.fullText).toBe(VI[secondKey as keyof typeof VI]);
    expect(view.speakerName).toBe(VI['hub.npc.villager2.name' as keyof typeof VI]);
  });
});

describe('#92 RPG DialogBox: choices (reused by the shop and dojo tickets)', () => {
  it('open -> advance -> choice -> close, with choices shown only after the text is revealed', () => {
    const ctx = { gold: 300, chaptersUnlocked: 1, unlockedCharacters: [] };
    const greetKey = 'hub.dialog.shopkeeper.greetRich';
    const greeting = EN[greetKey as keyof typeof EN];
    expect(greeting, `en ${greetKey}`).toBeDefined();
    let dialog = openShopkeeperDialog(ctx, greeting.length);
    expect(dialog.bodyKey).toBe(greetKey);

    let view = dialogBoxView(dialog, 'en');
    expect(view.speakerName).toBe(EN['hub.npc.shopkeeper.name' as keyof typeof EN]);
    expect(view.fullText).toContain('300');
    expect(view.choices).toEqual([]);

    // Advance: reveal; the three choices appear, first one highlighted.
    const revealed = advanceDialog(dialog);
    expect(revealed.kind).toBe('revealed');
    dialog = revealed.state;
    const labelsEn = [
      EN['hub.dialog.shopkeeper.choice.metaShop' as keyof typeof EN],
      EN['hub.dialog.shopkeeper.choice.unlockHeroes' as keyof typeof EN],
      EN['hub.dialog.shopkeeper.choice.leave' as keyof typeof EN],
    ];
    view = dialogBoxView(dialog, 'en');
    expect(view.choices).toEqual([
      { label: labelsEn[0], selected: true },
      { label: labelsEn[1], selected: false },
      { label: labelsEn[2], selected: false },
    ]);
    expect(view.showContinueHint).toBe(false);

    // Same box in Vietnamese: every label translated.
    const viLabels = dialogBoxView(dialog, 'vi').choices.map((c) => c.label);
    viLabels.forEach((label, i) => {
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label).not.toBe(labelsEn[i]);
    });

    // Choice: move down, confirm -> the box closes and reports the pick.
    dialog = moveDialogChoice(dialog, 1);
    expect(dialogBoxView(dialog, 'en').choices.map((c) => c.selected)).toEqual([false, true, false]);
    const picked = advanceDialog(dialog);
    expect(picked).toMatchObject({ kind: 'choice', choice: 'unlock-heroes' });
    expect(picked.state.open).toBe(false);
  });
});

describe('#92 village animals live in the yards', () => {
  it('dog, cat, chicken and bird roam their yard and never wander into the plaza, even when chased', () => {
    let life = createVillageLife(map, OPTIONS);
    expect(life.animals.map((a) => a.sprite).sort()).toEqual([
      'animal.bird',
      'animal.cat',
      'animal.chicken',
      'animal.dog',
    ]);

    const checkAll = (when: string): void => {
      for (const animal of life.animals) {
        expect(dist(animal.state.at, PLAZA), `${when}: ${animal.sprite} keeps out of the plaza`)
          .toBeGreaterThanOrEqual(PLAZA_KEEP_OUT_TILES);
        expect(dist(animal.state.at, animal.home), `${when}: ${animal.sprite} stays in its yard`)
          .toBeLessThanOrEqual(YARD_LEASH_TILES + 1e-6);
        for (const obs of map.obstacles) {
          expect(circleOverlapsObstacle(animal.state.at, 0.3, obs), `${when}: ${animal.sprite} in ${obs.kind}`)
            .toBe(false);
        }
      }
    };

    // Left alone for 120 s: every animal roams (moves off its spot) but stays in its yard.
    const maxMove = new Map<string, number>();
    for (let i = 0; i < 1200; i += 1) {
      life = step(life, 100, null).state;
      checkAll(`idle t=${i * 100}ms`);
      for (const animal of life.animals) {
        maxMove.set(animal.id, Math.max(maxMove.get(animal.id) ?? 0, dist(animal.state.at, animal.home)));
      }
    }
    for (const animal of life.animals) {
      expect(maxMove.get(animal.id), `${animal.sprite} roams`).toBeGreaterThan(0.25);
    }

    // Chased from the yard side (pushing it toward the plaza) and from the plaza side.
    for (const target of life.animals.map((a) => a.id)) {
      for (const side of [1, -1] as const) {
        for (let i = 0; i < 100; i += 1) {
          const a = life.animals.find((x) => x.id === target)!;
          const chaser = { x: a.state.at.x, y: a.state.at.y + side * 1.2 };
          life = step(life, 100, chaser).state;
          checkAll(`chased ${target} side ${side}`);
        }
      }
    }
  });
});
