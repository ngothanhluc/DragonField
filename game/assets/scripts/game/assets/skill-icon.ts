/**
 * Skill icon loading (#5): turn a `core/skills/icons.ts` sheet path into a nearest-filtered
 * `SpriteFrame` for the HUD, the pick cards, and (M9) the shop/door screens.
 *
 * Same pattern as `sprite-frame-cache.ts`: one cached `SpriteFrame` per sheet, built on top of the
 * texture cache so a second caller during loading reuses the first result.
 */
import { Rect, Size, SpriteFrame as CocosSpriteFrame, Vec2 } from 'cc';
import { skillCardIconSheet, skillIconSheet } from '../../core/skills/icons';
import type { SkillDef } from '../../core/skills/pool';
import { loadPixelTexture } from './texture-cache';

/** 24×24 px icons: show them at an integer multiple so nearest filtering keeps them crisp. */
export const SKILL_ICON_SIZE_PX = 24;

/** See the note in `texture-cache.ts`: the `cc` stub only allows import names in value position. */
type SpriteFrame = InstanceType<typeof CocosSpriteFrame>;

const frames = new Map<string, SpriteFrame>();
const inflight = new Map<string, Promise<SpriteFrame>>();

/** One skill's icon (normal variant by default, `disabled` for the greyed-out variant). */
export function loadSkillIcon(id: string, disabled = false): Promise<SpriteFrame> {
  return loadSkillIconSheet(skillIconSheet(id, { disabled }));
}

/** Pick-card variant: the Disabled icon once the skill is at max stacks. */
export function loadSkillCardIcon(def: SkillDef, stacks: number): Promise<SpriteFrame> {
  return loadSkillIconSheet(skillCardIconSheet(def, stacks));
}

/** Already-loaded frame, or `undefined` while loading — lets a rebuilt HUD avoid a text flash. */
export function cachedSkillIcon(id: string, disabled = false): SpriteFrame | undefined {
  return frames.get(skillIconSheet(id, { disabled }));
}

/** Clear the cache — test/dev only. */
export function clearSkillIconCache(): void {
  frames.clear();
  inflight.clear();
}

function loadSkillIconSheet(sheet: string): Promise<SpriteFrame> {
  const cached = frames.get(sheet);
  if (cached !== undefined) return Promise.resolve(cached);

  const running = inflight.get(sheet);
  if (running !== undefined) return running;

  const task = loadPixelTexture(sheet).then((texture) => {
    const raced = frames.get(sheet);
    if (raced !== undefined) return raced;

    const frame = new CocosSpriteFrame();
    // Order matters: assign the texture first so SpriteFrame initialises rect/originalSize.
    frame.texture = texture;
    frame.rect = new Rect(0, 0, SKILL_ICON_SIZE_PX, SKILL_ICON_SIZE_PX);
    frame.originalSize = new Size(SKILL_ICON_SIZE_PX, SKILL_ICON_SIZE_PX);
    frame.offset = new Vec2(0, 0);
    frame.packable = false;

    frames.set(sheet, frame);
    return frame;
  });

  inflight.set(sheet, task);
  task
    .catch(() => {
      // Drop the failed attempt so a later call can retry (the texture cache does the same).
      if (inflight.get(sheet) === task) inflight.delete(sheet);
    })
    .finally(() => {
      inflight.delete(sheet);
    });

  return task;
}
