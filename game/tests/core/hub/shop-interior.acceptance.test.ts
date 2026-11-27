/**
 * #93 acceptance: the enterable Shop interior and the Shopkeeper dialog.
 *
 * Seam: the pure hub core (`core/hub`). The real `village-hub.tmx` + `shop-interior.tmx`, the
 * existing `HubState` fade machine driven by the new `hubTransitionForAction`, and the new
 * Shop Visit session (`createShopVisit` / `talkToShopkeeper` / `advanceShopDialog` /
 * `selectShopChoice` / `closeShopPanel` / `shopPanelInitialFocus`). The Cocos hub adapter only
 * renders what these return and opens the existing Meta Shop screen for the routed panel.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NPC_BODY_RADIUS_TILES,
  advanceShopDialog,
  buildHubInteractables,
  closeShopPanel,
  createHubState,
  createShopVisit,
  dialogBoxView,
  findNearestInteractable,
  findStepTrigger,
  hubTransitionForAction,
  isShopVisitBusy,
  moveDialogChoice,
  parseHubTmx,
  selectShopChoice,
  shopPanelInitialFocus,
  spawnsFromHubMaps,
  startHubTransition,
  stepHubTransition,
  stepTriggerEntered,
  talkToShopkeeper,
  type HubInteractAction,
  type HubMapData,
  type HubState,
  type ShopVisitState,
} from '../../../assets/scripts/core/hub';
import type { Obstacle } from '../../../assets/scripts/core/level/level-data';
import { childrenNamed, elementText, parseXml } from '../../../assets/scripts/core/level/xml';
import type { Vec2 } from '../../../assets/scripts/core/math/vec2';
import { circleOverlapsObstacle } from '../../../assets/scripts/core/movement/collision';
import { SHOP_CHARACTER_START_INDEX } from '../../../assets/scripts/core/view/menu-layout';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEVELS = join(HERE, '../../../assets/resources/data/levels/village');
const villageXml = readFileSync(join(LEVELS, 'village-hub.tmx'), 'utf8');
const shopXml = readFileSync(join(LEVELS, 'shop-interior.tmx'), 'utf8');
const village: HubMapData = parseHubTmx(villageXml, { source: 'village-hub.tmx' });
const shop: HubMapData = parseHubTmx(shopXml, { source: 'shop-interior.tmx' });

const PLAYER_RADIUS = 0.35;
/** BFS step: fine enough that a player pressed against the counter (y ≈ 5.2) is sampled. */
const GRID = 0.25;

/** Shop entry spawn from `shop-interior.tmx` `playerStart` (128, 147.2) px / 16. */
const SHOP_ENTRY: Vec2 = { x: 8, y: 9.2 };
/** Village spawn in front of the shop door: `village-hub.tmx` `entryPoint from=shop-interior` (112, 211.2) px / 16. */
const VILLAGE_FROM_SHOP: Vec2 = { x: 7, y: 13.2 };

const ENTER_SHOP: HubInteractAction = { kind: 'enter-shop', triggerId: 'shop-entrance' };
const EXIT_SHOP: HubInteractAction = { kind: 'exit-shop', triggerId: 'shop-exit' };
const TALK_SHOPKEEPER: HubInteractAction = { kind: 'talk-shopkeeper', npcId: 'shopkeeper' };

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Every `GRID`-tile point a 0.35-tile player body can walk to from `start`. */
function reachable(map: HubMapData, start: Vec2): Vec2[] {
  const cols = Math.round(map.size.cols / GRID);
  const rows = Math.round(map.size.rows / GRID);
  const free = (gx: number, gy: number): boolean => {
    if (gx <= 0 || gy <= 0 || gx >= cols || gy >= rows) return false;
    const p = { x: gx * GRID, y: gy * GRID };
    return map.obstacles.every((o) => !circleOverlapsObstacle(p, PLAYER_RADIUS, o));
  };
  const sx = Math.round(start.x / GRID);
  const sy = Math.round(start.y / GRID);
  expect(free(sx, sy), `${map.id} start (${start.x}, ${start.y}) is walkable`).toBe(true);
  const seen = new Set<string>([`${sx},${sy}`]);
  const queue: Array<[number, number]> = [[sx, sy]];
  const out: Vec2[] = [];
  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    out.push({ x: cx * GRID, y: cy * GRID });
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !free(nx, ny)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return out;
}

/** Non-zero gids of one CSV tile layer, as `[row][col]`. */
function tileLayer(xml: string, name: string): number[][] {
  const layer = childrenNamed(parseXml(xml), 'layer').find((l) => l.attributes['name'] === name);
  if (layer === undefined) throw new Error(`no layer ${name}`);
  const data = childrenNamed(layer, 'data')[0];
  if (data === undefined) throw new Error(`layer ${name} has no data`);
  return elementText(data)
    .trim()
    .split('\n')
    .map((line) =>
      line
        .split(',')
        .filter((cell) => cell.trim() !== '')
        .map((cell) => Number(cell.trim())),
    );
}

function centreInside(col: number, row: number, o: Obstacle): boolean {
  const cx = col + 0.5;
  const cy = row + 0.5;
  return cx > o.x && cx < o.x + o.width && cy > o.y && cy < o.y + o.height;
}

function stepMs(state: HubState, ms: number, spawns = spawnsFromHubMaps(village, shop)) {
  return stepHubTransition(state, ms, spawns);
}

describe('#93 shop-interior.tmx: entry -> counter -> exit rug, collision parity', () => {
  const walk = reachable(shop, shop.playerStart);
  const shopkeeper = shop.npcs.find((n) => n.id === 'shopkeeper');
  const items = buildHubInteractables(shop);

  it('spawns the player on the entry, clear of the exit rug', () => {
    expect(shop.playerStart).toEqual(SHOP_ENTRY);
    expect(findStepTrigger(shop.playerStart, shop.triggers)).toBeNull();
  });

  it('reaches the counter, where [E] talks to the Shopkeeper', () => {
    const atCounter = walk.filter(
      (p) => findNearestInteractable(p, items)?.action.kind === 'talk-shopkeeper',
    );
    expect(atCounter.length).toBeGreaterThan(0);
    const prompt = findNearestInteractable(atCounter[0]!, items);
    expect(prompt?.action).toEqual(TALK_SHOPKEEPER);
    expect(prompt?.promptKey).toBe('hub.prompt.talk');
  });

  it('reaches the South exit rug, which steps out of the shop', () => {
    const onRug = walk.filter((p) => findStepTrigger(p, shop.triggers)?.id === 'shop-exit');
    expect(onRug.length).toBeGreaterThan(0);
    const rug = shop.triggers.find((t) => t.id === 'shop-exit');
    expect(rug?.autoEnterOnStep).toBe(true);
    // Rug sits on the south wall (bottom row of a 12-row room).
    expect(rug!.rect!.y + rug!.rect!.height).toBeGreaterThanOrEqual(11);
  });

  it('keeps the Shopkeeper behind the counter: the player never walks into or behind them', () => {
    expect(shopkeeper).toBeDefined();
    const closest = Math.min(...walk.map((p) => dist(p, shopkeeper!.at)));
    // Never overlapping the Shopkeeper's body...
    expect(closest).toBeGreaterThanOrEqual(PLAYER_RADIUS + NPC_BODY_RADIUS_TILES);
    // ...and the counter keeps a full tile between them, while the talk prompt (2.0) still reaches.
    expect(closest).toBeGreaterThanOrEqual(1);
    expect(closest).toBeLessThanOrEqual(2);
  });

  it('collision parity: every furniture tile is solid, every solid furniture box is drawn', () => {
    const furniture = tileLayer(shopXml, 'furniture');
    const solids = shop.obstacles.filter((o) => o.kind !== 'wall' && o.kind !== 'edge');
    expect(solids.length).toBeGreaterThanOrEqual(4);

    for (let row = 0; row < shop.size.rows; row += 1) {
      for (let col = 0; col < shop.size.cols; col += 1) {
        const gid = furniture[row]?.[col] ?? 0;
        const covered = shop.obstacles.some((o) => centreInside(col, row, o));
        if (gid !== 0) expect(covered, `furniture tile (${col}, ${row}) has no collider`).toBe(true);
        const coveredBySolid = solids.some((o) => centreInside(col, row, o));
        if (coveredBySolid) {
          expect(gid, `invisible collider over empty tile (${col}, ${row})`).not.toBe(0);
        }
      }
    }
  });

  it('collision parity: wall tiles are solid and the floor inside the walls is open', () => {
    const walls = tileLayer(shopXml, 'walls');
    const furniture = tileLayer(shopXml, 'furniture');
    for (let row = 0; row < shop.size.rows; row += 1) {
      for (let col = 0; col < shop.size.cols; col += 1) {
        const wall = walls[row]?.[col] ?? 0;
        const covered = shop.obstacles.some((o) => centreInside(col, row, o));
        if (wall !== 0) expect(covered, `wall tile (${col}, ${row}) has no collider`).toBe(true);
        if (wall === 0 && (furniture[row]?.[col] ?? 0) === 0) {
          expect(covered, `open floor (${col}, ${row}) is blocked`).toBe(false);
        }
      }
    }
  });
});

describe('#93 scene transitions: Village <-> Shop Interior', () => {
  it('maps hub actions to the transition they start, per location', () => {
    expect(hubTransitionForAction(ENTER_SHOP, 'village')).toEqual({ kind: 'shop-interior' });
    expect(hubTransitionForAction(EXIT_SHOP, 'shop-interior')).toEqual({
      kind: 'village',
      from: 'shop-interior',
    });
    // Only the door of the place you are in works; talking and the gate are not transitions.
    expect(hubTransitionForAction(ENTER_SHOP, 'shop-interior')).toBeNull();
    expect(hubTransitionForAction(EXIT_SHOP, 'village')).toBeNull();
    expect(hubTransitionForAction(TALK_SHOPKEEPER, 'shop-interior')).toBeNull();
    expect(
      hubTransitionForAction({ kind: 'open-expedition', triggerId: 'expedition-gate' }, 'village'),
    ).toBeNull();
    expect(hubTransitionForAction({ kind: 'open-dojo', npcId: 'dojo-master' }, 'village')).toBeNull();
  });

  it('walking into the West Shop doorway fades (~200 ms) into the shop at its entry', () => {
    // The doorway is walkable from the Village Square and is an auto step-trigger for enter-shop.
    const walk = reachable(village, village.playerStart);
    const inDoor = walk.find((p) => findStepTrigger(p, village.triggers)?.id === 'shop-entrance');
    expect(inDoor).toBeDefined();
    const entered = stepTriggerEntered(null, findStepTrigger(inDoor!, village.triggers)!.id);
    const doorAction = buildHubInteractables(village).find((i) => i.id === entered)?.action;
    expect(doorAction).toEqual(ENTER_SHOP);

    let state = createHubState({ entryOrigin: 'title' });
    const target = hubTransitionForAction(doorAction!, state.location);
    expect(target).not.toBeNull();
    state = startHubTransition(state, target!);

    const half = stepMs(state, 199);
    expect(half.switchedLocation).toBe(false);
    expect(half.state.location).toBe('village');

    const black = stepMs(half.state, 1);
    expect(black.switchedLocation).toBe(true);
    expect(black.state.location).toBe('shop-interior');
    expect(black.state.playerPos).toEqual(SHOP_ENTRY);
    expect(black.state.playerFacing).toBe('up');
    expect(black.state.cameraMode).toBe('static');
    expect(black.state.autoFireEnabled).toBe(false);

    const clear = stepMs(black.state, 200);
    expect(clear.state.transition.phase).toBe('idle');
    expect(clear.state.transition.fadeAlpha).toBe(0);
  });

  it('walking onto the exit rug fades back out to the shop front door in the village', () => {
    let state = createHubState({ entryOrigin: 'title' });
    state = startHubTransition(state, hubTransitionForAction(ENTER_SHOP, 'village')!);
    state = stepMs(state, 400).state;
    expect(state.location).toBe('shop-interior');

    const target = hubTransitionForAction(EXIT_SHOP, state.location);
    expect(target).toEqual({ kind: 'village', from: 'shop-interior' });
    state = startHubTransition(state, target!);
    const out = stepMs(state, 200);
    expect(out.switchedLocation).toBe(true);
    expect(out.state.location).toBe('village');
    expect(out.state.cameraMode).toBe('follow');
    expect(out.state.playerPos).toEqual(VILLAGE_FROM_SHOP);
    expect(out.state.playerFacing).toBe('down');

    // In front of the door: close to it, walkable, and not inside it (no doorway ping-pong).
    const door = village.triggers.find((t) => t.id === 'shop-entrance')!;
    expect(dist(out.state.playerPos, door.at)).toBeLessThanOrEqual(2);
    expect(findStepTrigger(out.state.playerPos, village.triggers)).toBeNull();
    for (const o of village.obstacles) {
      expect(circleOverlapsObstacle(out.state.playerPos, PLAYER_RADIUS, o)).toBe(false);
    }
  });
});

describe('#93 Shopkeeper dialog routes to the right panel', () => {
  const save = { gold: 137, chaptersUnlocked: 1, unlockedCharacters: ['ninja'] as const };

  function revealed(locale: 'vi' | 'en' = 'en'): ShopVisitState {
    const talking = talkToShopkeeper(createShopVisit(), { ...save, lastRunOutcome: null }, locale);
    const shown = advanceShopDialog(talking);
    expect(shown.dialog?.isFullyRevealed).toBe(true);
    expect(shown.panel).toBeNull();
    return shown;
  }

  it('starts idle: no dialog, no panel, player free', () => {
    const visit = createShopVisit();
    expect(visit.dialog).toBeNull();
    expect(visit.panel).toBeNull();
    expect(isShopVisitBusy(visit)).toBe(false);
  });

  it('greets with the Shopkeeper portrait and the gold count, then offers 3 choices', () => {
    for (const locale of ['en', 'vi'] as const) {
      const visit = talkToShopkeeper(createShopVisit(), { ...save, lastRunOutcome: null }, locale);
      expect(isShopVisitBusy(visit)).toBe(true);
      const dialog = visit.dialog!;
      expect(dialog.speakerId).toBe('shopkeeper');
      expect(dialog.portrait.displaySizePx).toBe(64);
      const view = dialogBoxView(dialog, locale);
      expect(view.fullText).toContain('137');
      expect(dialog.totalChars).toBe(view.fullText.length);
      expect(view.choices).toEqual([]);

      // Talking again while the box is open does nothing.
      expect(talkToShopkeeper(visit, { ...save, lastRunOutcome: null }, locale)).toBe(visit);
    }

    expect(dialogBoxView(revealed('vi').dialog!, 'vi').choices.map((c) => c.label)).toEqual([
      'Mua Nâng Cấp Vĩnh Viễn',
      'Mở Khóa Nhân Vật',
      'Tạm Biệt',
    ]);
    expect(dialogBoxView(revealed('en').dialog!, 'en').choices.map((c) => c.label)).toEqual([
      'Permanent Upgrades',
      'Hero Unlocks',
      'Leave',
    ]);
  });

  it('Mua Nâng Cấp Vĩnh Viễn opens the 6-track Meta Shop panel; closing it returns to the shop', () => {
    const opened = advanceShopDialog(revealed());
    expect(opened.dialog).toBeNull();
    expect(opened.panel).toBe('meta-shop');
    expect(isShopVisitBusy(opened)).toBe(true);
    expect(shopPanelInitialFocus('meta-shop')).toBe(0);
    // No talking over an open panel.
    expect(talkToShopkeeper(opened, { ...save, lastRunOutcome: null }, 'en')).toBe(opened);

    const back = closeShopPanel(opened);
    expect(back.panel).toBeNull();
    expect(back.dialog).toBeNull();
    expect(isShopVisitBusy(back)).toBe(false);
  });

  it('Mở Khóa Nhân Vật opens Hero Unlocks (the Meta Shop focused on the hero column)', () => {
    const shown = revealed();
    const moved: ShopVisitState = { ...shown, dialog: moveDialogChoice(shown.dialog!, 1) };
    const opened = advanceShopDialog(moved);
    expect(opened.dialog).toBeNull();
    expect(opened.panel).toBe('hero-unlocks');
    // First Hero Unlocks row comes right after the 6 upgrade tracks.
    expect(shopPanelInitialFocus('hero-unlocks')).toBe(6);
    expect(shopPanelInitialFocus('hero-unlocks')).toBe(SHOP_CHARACTER_START_INDEX);

    // Clicking the row routes the same way.
    expect(selectShopChoice(revealed(), 'unlock-heroes').panel).toBe('hero-unlocks');
    expect(selectShopChoice(revealed(), 'meta-shop').panel).toBe('meta-shop');
    expect(closeShopPanel(opened).panel).toBeNull();
  });

  it('Tạm Biệt closes the dialog and opens no panel', () => {
    const left = selectShopChoice(revealed(), 'leave');
    expect(left.dialog).toBeNull();
    expect(left.panel).toBeNull();
    expect(isShopVisitBusy(left)).toBe(false);

    const shown = revealed();
    const viaKeys = advanceShopDialog({ ...shown, dialog: moveDialogChoice(shown.dialog!, -1) });
    expect(viaKeys.dialog).toBeNull();
    expect(viaKeys.panel).toBeNull();
  });
});
