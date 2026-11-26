import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AttachmentNodeController,
  resolveAttachmentNode,
} from '../../assets/scripts/core/art/attachment-node';
import { validateAttachments, type AttachmentsData } from '../../assets/scripts/core/art/attachments';
import { validateManifest, type Direction } from '../../assets/scripts/core/art/manifest';
import { entryAnchorY } from '../../assets/scripts/core/art/runtime';
import { TILE_SIZE_PX } from '../../assets/scripts/core/level/level-data';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIRECTIONS: readonly Direction[] = ['down', 'up', 'left', 'right'];

function makeRigData(): AttachmentsData {
  return validateAttachments({
    version: 1,
    characters: {
      cultivator: {
        frameWidth: 16,
        frameHeight: 16,
        points: {
          back: { down: [10, 6], up: [8, 10], left: [10, 8], right: [6, 8] },
          hand: { down: [11, 11], up: [5, 11], left: [6, 11], right: [10, 11] },
        },
        bob: {
          idle: {
            down: [0, 1, 2, 1],
            up: [0, 0, 1, 0],
            left: [0, 1, 1, 0],
            right: [0, -1, 0, 1],
          },
        },
      },
      archer: {
        frameWidth: 32,
        frameHeight: 32,
        points: {
          hand: { down: [20, 20], up: [12, 20], left: [10, 20], right: [22, 20] },
        },
        bob: {
          walk: { down: [0, 1, 0, 2] },
        },
      },
    },
    items: {
      'sword-back': {
        sprite: 'attachment.sword-back',
        slot: 'back',
        frameWidth: 16,
        frameHeight: 16,
        grip: { down: [8, 7], up: [8, 7], left: [8, 7], right: [7, 7] },
      },
      bow: {
        sprite: 'attachment.bow',
        slot: 'hand',
        frameWidth: 16,
        frameHeight: 16,
        grip: { down: [8, 8], up: [8, 8], left: [8, 8], right: [8, 8] },
      },
      'shield-orb': {
        sprite: 'attachment.shield-orb',
        slot: 'hand',
        frameWidth: 16,
        frameHeight: 16,
        grip: { down: [8, 8], up: [8, 8], left: [8, 8], right: [8, 8] },
        behind: ['up', 'left'],
      },
      'cloak-override': {
        sprite: 'attachment.cloak-override',
        slot: 'back',
        frameWidth: 16,
        frameHeight: 16,
        grip: { down: [8, 8], up: [8, 8], left: [8, 8], right: [8, 8] },
        behind: ['down', 'up'],
      },
    },
  });
}

describe('AttachmentNodeController & resolveAttachmentNode (M10)', () => {
  it('draws a hand item behind ONLY when facing up', () => {
    const data = makeRigData();
    const ctrl = new AttachmentNodeController(data, {
      character: 'cultivator',
      item: 'bow',
    });

    const behindByDir = DIRECTIONS.map((direction) =>
      ctrl.update({ animation: 'idle', direction, frame: 0 }).behind,
    );
    expect(behindByDir).toEqual([false, true, false, false]);
  });

  it('draws a back item behind for down, left, right and in front for up', () => {
    const data = makeRigData();
    const ctrl = new AttachmentNodeController(data, {
      character: 'cultivator',
      item: 'sword-back',
    });

    const behindByDir = DIRECTIONS.map((direction) =>
      ctrl.update({ animation: 'idle', direction, frame: 0 }).behind,
    );
    expect(behindByDir).toEqual([true, false, true, true]);
  });

  it('lets an item behind override list win over slot defaults', () => {
    const data = makeRigData();

    const handOverride = new AttachmentNodeController(data, {
      character: 'cultivator',
      item: 'shield-orb',
    });
    expect(
      DIRECTIONS.map((direction) =>
        handOverride.update({ animation: 'idle', direction, frame: 0 }).behind,
      ),
    ).toEqual([false, true, true, false]);

    const backOverride = new AttachmentNodeController(data, {
      character: 'cultivator',
      item: 'cloak-override',
    });
    expect(
      DIRECTIONS.map((direction) =>
        backOverride.update({ animation: 'idle', direction, frame: 0 }).behind,
      ),
    ).toEqual([true, true, false, false]);
  });

  it('includes per-frame bob in placement, localOffsetPx, and localOffsetTiles across frames and directions', () => {
    const data = makeRigData();
    const ctrl = new AttachmentNodeController(data, {
      character: 'cultivator',
      item: 'sword-back',
      bodyAnchorY: 0,
      itemAnchorY: 0.5,
    });

    // down: back point [10, 6], grip [8, 7], bob [0, 1, 2, 1]
    const f0 = ctrl.update({ animation: 'idle', direction: 'down', frame: 0 });
    expect(f0.placement).toEqual({ x: 2, y: -1, behind: true });
    expect(f0.bobPx).toBe(0);
    // localX = (2 + 8) - 8 = 2; localY = 16*(1 - 0) - (-1 + 8) = 9
    expect(f0.localOffsetPx).toEqual({ x: 2, y: 9 });
    expect(f0.localOffsetTiles).toEqual({ x: 2 / TILE_SIZE_PX, y: 9 / TILE_SIZE_PX });

    // frame 2 has bob = 2 (body moves 2px down -> placement.y +2, Cocos localY -2)
    const f2 = ctrl.update({ animation: 'idle', direction: 'down', frame: 2 });
    expect(f2.placement).toEqual({ x: 2, y: 1, behind: true });
    expect(f2.bobPx).toBe(2);
    expect(f2.localOffsetPx).toEqual({ x: 2, y: 7 });
    expect(f2.localOffsetTiles).toEqual({ x: 2 / TILE_SIZE_PX, y: 7 / TILE_SIZE_PX });

    // frame 6 wraps 6 % 4 = 2
    const f6 = ctrl.update({ animation: 'idle', direction: 'down', frame: 6 });
    expect(f6.localOffsetPx).toEqual(f2.localOffsetPx);

    // right: back point [6, 8], grip [7, 7], bob [0, -1, 0, 1] -> frame 1 has bob -1
    const r1 = ctrl.update({ animation: 'idle', direction: 'right', frame: 1 });
    expect(r1.placement).toEqual({ x: -1, y: 0, behind: true });
    expect(r1.bobPx).toBe(-1);
    // localX = (-1 + 8) - 8 = -1; localY = 16 - (0 + 8) = 8
    expect(r1.localOffsetPx).toEqual({ x: -1, y: 8 });
  });

  it('respects non-zero bodyAnchorY when computing Cocos local offset', () => {
    const data = makeRigData();
    // archer 32x32 with footPx=8 -> bodyAnchorY = 0.25 (origin 8px above bottom, 24px below top)
    // hand.down = [20, 20], bow grip = [8, 8], walk.down bob[3] = 2 -> placement = (12, 14)
    const state = resolveAttachmentNode(
      data,
      { character: 'archer', item: 'bow', bodyAnchorY: 0.25, itemAnchorY: 0.5 },
      { animation: 'walk', direction: 'down', frame: 3 },
    );
    expect(state.active).toBe(true);
    expect(state.bobPx).toBe(2);
    expect(state.placement).toEqual({ x: 12, y: 14, behind: false });
    // localX = (12 + 8) - 16 = 4; localY = 32*(1 - 0.25) - (14 + 8) = 24 - 22 = 2
    expect(state.localOffsetPx).toEqual({ x: 4, y: 2 });
    expect(state.spriteKey).toBe('attachment.bow.down');
    expect(state.spritePrefix).toBe('attachment.bow');
  });

  it('handles missing/optional bob animations and directions gracefully without crashing', () => {
    const data = makeRigData();
    const ctrl = new AttachmentNodeController(data, {
      character: 'cultivator',
      item: 'sword-back',
    });

    const walk = ctrl.update({ animation: 'walk', direction: 'left', frame: 3 });
    expect(walk.active).toBe(true);
    expect(walk.bobPx).toBe(0);
    // left: back [10, 8], grip [8, 7] -> placement (2, 1), localX = 2, localY = 16 - (1 + 8) = 7
    expect(walk.placement).toEqual({ x: 2, y: 1, behind: true });
    expect(walk.localOffsetPx).toEqual({ x: 2, y: 7 });

    const attack = ctrl.update({ animation: 'attack', direction: 'up', frame: Number.NaN });
    expect(attack.active).toBe(true);
    expect(attack.bobPx).toBe(0);
    expect(attack.behind).toBe(false);
  });

  it('hides and shows on skill events and restores the exact same offset and draw order', () => {
    const data = makeRigData();
    const ctrl = new AttachmentNodeController(
      data,
      { character: 'cultivator', item: 'sword-back' },
      { animation: 'idle', direction: 'down', frame: 2 },
    );

    const beforeHide = ctrl.getState();
    expect(ctrl.isActive()).toBe(true);
    expect(ctrl.isVisible()).toBe(true);
    expect(ctrl.isHidden()).toBe(false);

    // Hide for Ten Thousand Swords
    const hiddenState = ctrl.hideForSkill('ten-thousand-swords');
    expect(ctrl.isActive()).toBe(true);
    expect(ctrl.isVisible()).toBe(false);
    expect(ctrl.isHidden()).toBe(true);
    expect(hiddenState.visible).toBe(false);
    expect(hiddenState.active).toBe(true);
    expect(hiddenState.localOffsetPx).toEqual(beforeHide.localOffsetPx);
    expect(hiddenState.behind).toBe(beforeHide.behind);

    // Show restores the exact same offset, bob, and draw order
    const restored = ctrl.showForSkill('ten-thousand-swords');
    expect(ctrl.isVisible()).toBe(true);
    expect(ctrl.isHidden()).toBe(false);
    expect(restored).toEqual(beforeHide);
  });

  it('supports overlapping skill hides, frame updates while hidden, manual setHidden, and clearHidden', () => {
    const data = makeRigData();
    const ctrl = new AttachmentNodeController(data, {
      character: 'cultivator',
      item: 'sword-back',
    });

    ctrl.hideForSkill('ten-thousand-swords');
    ctrl.hideForSkill('dash-cloak');
    expect(ctrl.isVisible()).toBe(false);

    // Character moves / animates while hidden
    const whileHidden = ctrl.update({ animation: 'idle', direction: 'up', frame: 2 });
    expect(whileHidden.visible).toBe(false);
    expect(whileHidden.behind).toBe(false);
    expect(whileHidden.bobPx).toBe(1);

    // Ending first skill does NOT prematurely unhide while second is active
    ctrl.showForSkill('ten-thousand-swords');
    expect(ctrl.isVisible()).toBe(false);
    expect(ctrl.isHidden()).toBe(true);

    // Ending second skill restores visibility with the latest pose's bob & draw order
    const shown = ctrl.showForSkill('dash-cloak');
    expect(shown.visible).toBe(true);
    expect(shown.behind).toBe(false);
    expect(shown.bobPx).toBe(1);
    expect(shown.spriteKey).toBe('attachment.sword-back.up');

    // Manual setHidden + clearHidden
    ctrl.setHidden(true);
    ctrl.hideForSkill('ten-thousand-swords');
    expect(ctrl.isVisible()).toBe(false);
    ctrl.showForSkill('ten-thousand-swords');
    expect(ctrl.isVisible()).toBe(false); // manual hide still set
    ctrl.setHidden(false);
    expect(ctrl.isVisible()).toBe(true);

    ctrl.setHidden(true);
    ctrl.hideForSkill('ten-thousand-swords');
    ctrl.clearHidden();
    expect(ctrl.isHidden()).toBe(false);
    expect(ctrl.isVisible()).toBe(true);
  });

  it('produces no attachment node for projectile weapons, unequipped, or non-rigged (baked giant) bodies', () => {
    const data = makeRigData();

    // 1. Projectile weapon form never creates an attachment node (even if item/rig passed)
    const projectile = new AttachmentNodeController(data, {
      character: 'cultivator',
      item: 'sword-back',
      weaponForm: 'projectile',
    });
    expect(projectile.isActive()).toBe(false);
    expect(projectile.isVisible()).toBe(false);
    expect(projectile.getState().spriteKey).toBeNull();
    expect(projectile.getState().placement).toBeNull();
    expect(projectile.getState().localOffsetPx).toEqual({ x: 0, y: 0 });
    expect(projectile.getState().behind).toBe(false);

    // 2. Unequipped (item = null)
    const unequipped = new AttachmentNodeController(data, {
      character: 'cultivator',
      item: null,
    });
    expect(unequipped.isActive()).toBe(false);
    expect(unequipped.isVisible()).toBe(false);

    // 3. Non-rigged / baked-weapon character or giant body (e.g. 'player' / 'samurai' / 'tengu')
    const bakedBody = new AttachmentNodeController(data, {
      character: 'samurai',
      item: 'sword-back',
    });
    expect(bakedBody.isActive()).toBe(false);
    expect(bakedBody.isVisible()).toBe(false);

    const bakedExplicit = new AttachmentNodeController(data, {
      character: 'cultivator',
      item: 'sword-back',
      weaponForm: 'baked',
    });
    expect(bakedExplicit.isActive()).toBe(false);
    expect(bakedExplicit.isVisible()).toBe(false);

    // Null character
    const noChar = new AttachmentNodeController(data, {
      character: null,
      item: 'sword-back',
    });
    expect(noChar.isActive()).toBe(false);

    // Showing/clearing hide on an inactive node never makes it visible
    projectile.hideForSkill('ten-thousand-swords');
    projectile.showForSkill('ten-thousand-swords');
    projectile.clearHidden();
    expect(projectile.isVisible()).toBe(false);
  });

  it('integrates cleanly with real attachments.json and animations.json for cultivator + sword-back', () => {
    const attachmentsRaw = JSON.parse(
      readFileSync(join(HERE, '..', '..', 'assets', 'resources', 'data', 'attachments.json'), 'utf8'),
    ) as unknown;
    const manifestRaw = JSON.parse(
      readFileSync(join(HERE, '..', '..', 'assets', 'resources', 'data', 'animations.json'), 'utf8'),
    ) as unknown;

    const attachments = validateAttachments(attachmentsRaw);
    const manifest = validateManifest(manifestRaw);

    const bodyEntry = manifest.sprites['cultivator.idle.down']!;
    const itemEntry = manifest.sprites['attachment.sword-back.down']!;

    const ctrl = new AttachmentNodeController(attachments, {
      character: 'cultivator',
      item: 'sword-back',
      weaponForm: 'attachment',
      bodyAnchorY: entryAnchorY(bodyEntry),
      itemAnchorY: entryAnchorY(itemEntry),
    });

    for (const direction of DIRECTIONS) {
      const state = ctrl.update({ animation: 'idle', direction, frame: 0 });
      expect(state.active).toBe(true);
      expect(state.visible).toBe(true);
      expect(state.spriteKey).toBe(`attachment.sword-back.${direction}`);
      expect(manifest.sprites[state.spriteKey!]).toBeDefined();
      expect(state.behind).toBe(direction !== 'up');
    }

    // Recorded walk bob in attachments.json applies cleanly; unrecorded clips fall back to 0.
    const walkState = ctrl.update({ animation: 'walk', direction: 'down', frame: 1 });
    expect(walkState.active).toBe(true);
    expect(walkState.bobPx).toBe(attachments.characters['cultivator']!.bob['walk']!['down']![1]);

    const unrecordedState = ctrl.update({ animation: 'roll', direction: 'down', frame: 2 });
    expect(unrecordedState.active).toBe(true);
    expect(unrecordedState.bobPx).toBe(0);

    // Baked ninja ('player') has no rig in real attachments.json -> inactive
    ctrl.setEquipment({ character: 'player', item: null, weaponForm: 'projectile' });
    expect(ctrl.isActive()).toBe(false);
    expect(ctrl.isVisible()).toBe(false);
  });

  it('integrates cleanly with real attachments.json and animations.json for archer + bow-hand and mage + staff-hand', () => {
    const attachments = validateAttachments(
      JSON.parse(
        readFileSync(join(HERE, '..', '..', 'assets', 'resources', 'data', 'attachments.json'), 'utf8'),
      ) as unknown,
    );
    const manifest = validateManifest(
      JSON.parse(
        readFileSync(join(HERE, '..', '..', 'assets', 'resources', 'data', 'animations.json'), 'utf8'),
      ) as unknown,
    );

    for (const [charId, itemId] of [
      ['archer', 'bow-hand'],
      ['mage', 'staff-hand'],
    ] as const) {
      const bodyEntry = manifest.sprites[`${charId}.idle.down`]!;
      const itemEntry = manifest.sprites[`attachment.${itemId}.down`]!;
      const ctrl = new AttachmentNodeController(attachments, {
        character: charId,
        item: itemId,
        weaponForm: 'attachment',
        bodyAnchorY: entryAnchorY(bodyEntry),
        itemAnchorY: entryAnchorY(itemEntry),
      });

      for (const direction of DIRECTIONS) {
        const state = ctrl.update({ animation: 'walk', direction, frame: 1 });
        expect(state.active, `${charId} ${direction}`).toBe(true);
        expect(state.visible, `${charId} ${direction}`).toBe(true);
        expect(state.spriteKey).toBe(`attachment.${itemId}.${direction}`);
        expect(manifest.sprites[state.spriteKey!]).toBeDefined();
        expect(state.behind, `${charId} hand ${direction}`).toBe(direction === 'up');
      }
    }
  });
});
