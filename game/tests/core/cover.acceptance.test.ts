/**
 * Ticket #36 acceptance: y-sorting, canopies/roofs that fade while someone is under them, and
 * walk-in grass that shows actors faded. Visual only — readability layers stay on top.
 */
import { describe, expect, it } from 'vitest';
import { ENEMY_TUNING } from '../../assets/scripts/core/enemies/tuning';
import { PROP_CATALOGUE, type PropDef } from '../../assets/scripts/core/level/props';
import {
  WORLD_DRAW_LAYERS,
  actorCoverAlpha,
  drawOrder,
  easeAlpha,
  overlayAlphaTarget,
  propCoverArea,
  propOverlayArea,
} from '../../assets/scripts/core/view/cover';
import { TUNING } from '../../assets/scripts/core/enemies/tuning';

const cover = (TUNING as unknown as { cover?: { overlayAlpha: number; actorInCoverAlpha: number; fadeRate: number } }).cover;

function firstDef(predicate: (def: PropDef) => boolean): PropDef {
  for (const chapter of [1, 2, 3, 4]) {
    const def = (PROP_CATALOGUE[chapter] ?? []).find(predicate);
    if (def !== undefined) return def;
  }
  throw new Error('no matching prop in the catalogue');
}

describe('depth', () => {
  it('a larger foot y draws in front; ties keep input order', () => {
    expect(drawOrder([
      { id: 'player', footY: 9 },
      { id: 'tree', footY: 7 },
      { id: 'bat', footY: 12 },
      { id: 'rock', footY: 9 },
    ])).toEqual(['tree', 'player', 'rock', 'bat']);
  });

  it('overlays draw above actors, and bullets/telegraphs/damage numbers above every overlay', () => {
    const index = (name: string): number => WORLD_DRAW_LAYERS.indexOf(name);
    for (const name of ['ground', 'actors', 'overlays', 'bullets', 'telegraphs', 'damage-numbers']) {
      expect(index(name), name).toBeGreaterThanOrEqual(0);
    }
    expect(index('ground')).toBeLessThan(index('actors'));
    expect(index('actors')).toBeLessThan(index('overlays'));
    for (const top of ['bullets', 'telegraphs', 'damage-numbers']) {
      expect(index(top), top).toBeGreaterThan(index('overlays'));
    }
  });
});

describe('canopies and roofs', () => {
  const tree = firstDef((def) => def.kind === 'tree' && def.overlay !== undefined);
  const placed = { x: 10, y: 4 };

  it('a tree overlay is its canopy, above the trunk collider, in tiles', () => {
    const area = propOverlayArea(placed, tree);
    expect(area).not.toBeNull();
    if (area === null || tree.overlay === undefined || tree.collider === null) return;
    expect(area.x).toBeCloseTo(placed.x + tree.overlay.x / 16, 9);
    expect(area.y).toBeCloseTo(placed.y + tree.overlay.y / 16, 9);
    expect(area.width).toBeCloseTo(tree.overlay.width / 16, 9);
    // The canopy ends where the trunk begins.
    expect(area.y + area.height).toBeLessThanOrEqual(placed.y + tree.collider.y / 16 + 1e-9);
    // Houses have a roof overlay too.
    expect(propOverlayArea(placed, firstDef((def) => def.kind === 'house'))).not.toBeNull();
    // A rock has none.
    expect(propOverlayArea(placed, firstDef((def) => def.kind === 'rock'))).toBeNull();
  });

  it('fades to the tuned alpha only while a body overlaps it', () => {
    expect(cover?.overlayAlpha).toBeCloseTo(0.4, 9);
    const area = { x: 10, y: 4, width: 2, height: 1.5 };
    const faded = cover?.overlayAlpha ?? 0.4;
    expect(overlayAlphaTarget(area, [{ position: { x: 11, y: 4.75 }, radiusTiles: 0.25 }], faded)).toBe(faded);
    expect(overlayAlphaTarget(area, [{ position: { x: 12.2, y: 4.75 }, radiusTiles: 0.25 }], faded)).toBe(faded);
    expect(overlayAlphaTarget(area, [{ position: { x: 13, y: 4.75 }, radiusTiles: 0.25 }], faded)).toBe(1);
    expect(overlayAlphaTarget(area, [], faded)).toBe(1);
  });

  it('eases frame-rate independently and never overshoots', () => {
    const rate = cover?.fadeRate ?? 10;
    let slow = 1;
    for (let i = 0; i < 15; i += 1) slow = easeAlpha(slow, 0.4, 1 / 30, rate);
    let fast = 1;
    for (let i = 0; i < 72; i += 1) fast = easeAlpha(fast, 0.4, 1 / 144, rate);
    expect(Math.abs(slow - fast)).toBeLessThan(0.01);
    expect(slow).toBeLessThan(1);
    expect(slow).toBeGreaterThanOrEqual(0.4);
  });
});

describe('walk-in grass', () => {
  const grass = firstDef((def) => def.cover === true);
  const placed = { x: 6, y: 6 };

  it('cover props are walk-over and expose their area', () => {
    expect(grass.solid).toBe(false);
    const area = propCoverArea(placed, grass);
    expect(area).not.toBeNull();
    expect(propCoverArea(placed, firstDef((def) => def.kind === 'rock'))).toBeNull();
  });

  it('an actor whose feet are in the grass is drawn at the tuned alpha', () => {
    expect(cover?.actorInCoverAlpha).toBeCloseTo(0.5, 9);
    const area = propCoverArea(placed, grass);
    if (area === null) throw new Error('grass has no cover area');
    const alpha = cover?.actorInCoverAlpha ?? 0.5;
    const inside = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    expect(actorCoverAlpha(inside, [area], alpha)).toBe(alpha);
    expect(actorCoverAlpha({ x: area.x - 1, y: inside.y }, [area], alpha)).toBe(1);
  });

  it('cover has no gameplay effect: enemy tuning has no stealth field', () => {
    expect(JSON.stringify(ENEMY_TUNING)).not.toMatch(/stealth|hidden|visibility/i);
  });
});
