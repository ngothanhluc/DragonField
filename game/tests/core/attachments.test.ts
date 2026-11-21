import { describe, expect, it } from 'vitest';
import {
  placeAttachment,
  validateAttachments,
  type AttachmentsData,
} from '../../assets/scripts/core/art/attachments';

const DIRECTIONS = ['down', 'up', 'left', 'right'] as const;

function valid(): AttachmentsData {
  return validateAttachments({
    version: 1,
    characters: {
      hero: {
        frameWidth: 32,
        frameHeight: 32,
        points: {
          hand: { down: [20, 20], up: [12, 20], left: [10, 20], right: [22, 20] },
          back: { down: [16, 12], up: [16, 12], left: [18, 12], right: [14, 12] },
        },
        bob: { idle: { down: [0, 1, 1, 0], up: [0, 0, 1, 1] } },
      },
    },
    items: {
      staff: {
        sprite: 'attachment.staff',
        slot: 'hand',
        frameWidth: 16,
        frameHeight: 16,
        grip: Object.fromEntries(DIRECTIONS.map((direction) => [direction, [8, 12]])),
      },
      'sword-back': {
        sprite: 'attachment.sword-back',
        slot: 'back',
        frameWidth: 16,
        frameHeight: 16,
        grip: Object.fromEntries(DIRECTIONS.map((direction) => [direction, [8, 10]])),
      },
    },
  });
}

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a throw');
}

describe('validateAttachments', () => {
  it('accepts a full rig and item set', () => {
    const data = valid();
    expect(data.characters['hero']?.points.hand?.right).toEqual([22, 20]);
    expect(data.items['staff']?.slot).toBe('hand');
  });

  it('lists every problem at once instead of stopping at the first', () => {
    const data = valid() as unknown as Record<string, unknown>;
    const characters = data['characters'] as Record<string, Record<string, unknown>>;
    const items = data['items'] as Record<string, Record<string, unknown>>;
    characters['hero']!['frameWidth'] = 0;
    const hand = (characters['hero']!['points'] as Record<string, Record<string, unknown>>)['hand']!;
    delete hand['left'];
    hand['down'] = [1];
    items['staff']!['slot'] = 'belt';
    (items['staff']!['grip'] as Record<string, unknown>)['up'] = [8.5, 12];

    const message = messageOf(() => validateAttachments({ ...data, version: 2 }));
    expect(message).toContain('version must be 1');
    expect(message).toContain('frameWidth');
    expect(message).toContain('points.hand.left is missing');
    expect(message).toContain('must be [x, y]');
    expect(message).toContain('items.staff.slot must be hand or back');
    expect(message).toContain('grip.up must be [x, y] of two integers');
  });

  it('rejects a non-object root, a bad bob and a bad behind list', () => {
    expect(() => validateAttachments(null)).toThrow(/object/);
    expect(
      messageOf(() =>
        validateAttachments({
          version: 1,
          characters: {
            hero: {
              frameWidth: 32,
              frameHeight: 32,
              points: {},
              bob: { idle: { down: [0, '1'] } },
            },
          },
          items: {},
        }),
      ),
    ).toContain('must be an array of integers');
    expect(
      messageOf(() =>
        validateAttachments({
          version: 1,
          characters: {},
          items: {
            staff: {
              sprite: 'attachment.staff',
              slot: 'hand',
              frameWidth: 16,
              frameHeight: 16,
              grip: Object.fromEntries(DIRECTIONS.map((direction) => [direction, [0, 0]])),
              behind: ['north'],
            },
          },
        }),
      ),
    ).toContain('behind');
  });
});

describe('placeAttachment', () => {
  it('follows the bob and wraps the frame index', () => {
    const data = valid();
    expect(placeAttachment(data, { character: 'hero', item: 'staff', animation: 'idle', direction: 'down', frame: 1 })).toEqual({
      x: 12,
      y: 9,
      behind: false,
    });
    // 6 % 4 = 2 → bob 1; -1 normalises to the last frame (down bob 0).
    expect(placeAttachment(data, { character: 'hero', item: 'staff', animation: 'idle', direction: 'up', frame: 6 }).y).toBe(9);
    expect(placeAttachment(data, { character: 'hero', item: 'staff', animation: 'idle', direction: 'down', frame: -1 }).y).toBe(8);
  });

  it('uses no bob for an animation or direction the rig does not record', () => {
    const data = valid();
    expect(placeAttachment(data, { character: 'hero', item: 'staff', animation: 'walk', direction: 'down', frame: 3 }).y).toBe(8);
    expect(placeAttachment(data, { character: 'hero', item: 'staff', animation: 'idle', direction: 'left', frame: 3 }).y).toBe(8);
  });

  it('draws a hand item behind when facing up and a back item behind otherwise', () => {
    const data = valid();
    const behind = (item: string, direction: string): boolean =>
      placeAttachment(data, { character: 'hero', item, animation: 'idle', direction, frame: 0 }).behind;
    expect(DIRECTIONS.map((direction) => behind('staff', direction))).toEqual([false, true, false, false]);
    expect(DIRECTIONS.map((direction) => behind('sword-back', direction))).toEqual([true, false, true, true]);
  });

  it('lets an item override the slot default', () => {
    const withOverride = validateAttachments({
      version: 1,
      characters: {
        hero: {
          frameWidth: 32,
          frameHeight: 32,
          points: { hand: Object.fromEntries(DIRECTIONS.map((direction) => [direction, [0, 0]])) },
          bob: {},
        },
      },
      items: {
        torch: {
          sprite: 'attachment.torch',
          slot: 'hand',
          frameWidth: 16,
          frameHeight: 16,
          grip: Object.fromEntries(DIRECTIONS.map((direction) => [direction, [0, 0]])),
          behind: ['left'],
        },
      },
    });
    const behind = (direction: string): boolean =>
      placeAttachment(withOverride, { character: 'hero', item: 'torch', animation: 'idle', direction, frame: 0 }).behind;
    expect(DIRECTIONS.map(behind)).toEqual([false, false, true, false]);
  });

  it('throws naming an unknown character, an unknown item or a missing point', () => {
    const data = valid();
    expect(() =>
      placeAttachment(data, { character: 'nobody', item: 'staff', animation: 'idle', direction: 'down', frame: 0 }),
    ).toThrow(/nobody/);
    expect(() =>
      placeAttachment(data, { character: 'hero', item: 'bow', animation: 'idle', direction: 'down', frame: 0 }),
    ).toThrow(/bow/);

    const backOnly = validateAttachments({
      version: 1,
      characters: {
        hero: {
          frameWidth: 32,
          frameHeight: 32,
          points: { back: Object.fromEntries(DIRECTIONS.map((direction) => [direction, [0, 0]])) },
          bob: {},
        },
      },
      items: data.items as unknown as Record<string, unknown>,
    });
    expect(() =>
      placeAttachment(backOnly, { character: 'hero', item: 'staff', animation: 'idle', direction: 'down', frame: 0 }),
    ).toThrow(/hand point/);
  });
});
