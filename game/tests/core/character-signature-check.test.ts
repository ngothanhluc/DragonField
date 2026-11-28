import { describe, expect, it } from 'vitest';
import {
  TUNING_SOURCE,
  parseTuning,
} from '../../assets/scripts/core/enemies/tuning';

/**
 * The signature cross-field rule only compares two valid counts. An invalid
 * `maxProjectileCount` already produces its own field problem and must not gain a second
 * problem for the same field (the old parser fell back to `projectileCount`).
 */

const CHARACTER_IDS = ['ninja', 'archer', 'mage', 'cultivator'] as const;

type CharacterId = (typeof CHARACTER_IDS)[number];

function parseError(mutate: (root: Record<string, unknown>) => void): string {
  const root = structuredClone(TUNING_SOURCE) as Record<string, unknown>;
  mutate(root);
  try {
    parseTuning(root);
  } catch (error) {
    return (error as Error).message;
  }
  return '<accepted>';
}

function setMaxProjectileCount(
  root: Record<string, unknown>,
  id: CharacterId,
  value: unknown,
): void {
  const characters = root.characters as Record<
    string,
    Record<string, unknown>
  >;
  const character = characters[id] as Record<string, unknown>;
  const signature = character.signature as Record<string, unknown>;
  signature.maxProjectileCount = value;
}

const INVALID_COUNTS: Array<[string, unknown, string]> = [
  ['a string', 'x', 'must be a finite number, got "x"'],
  ['negative', -1, 'must not be negative, got -1'],
  ['zero', 0, 'must be > 0, got 0'],
  ['fractional', 0.5, 'must be an integer, got 0.5'],
  ['null', null, 'must be a finite number, got null'],
  ['an array', [], 'must be a finite number, got array'],
];

describe('character signature projectile-count rule', () => {
  for (const [label, value, fieldMessage] of INVALID_COUNTS) {
    it(`reports only the field problem when maxProjectileCount is ${label}`, () => {
      for (const id of CHARACTER_IDS) {
        expect(
          parseError((root) => setMaxProjectileCount(root, id, value)),
        ).toBe(
          `config/tuning.json is invalid (1 problem(s))\n  - characters.${id}.signature.maxProjectileCount: ${fieldMessage}`,
        );
      }
    });
  }

  it('still reports the cross-field problem for a valid count below projectileCount', () => {
    expect(parseError((root) => setMaxProjectileCount(root, 'archer', 6))).toBe(
      'config/tuning.json is invalid (1 problem(s))\n' +
        '  - characters.archer.signature.maxProjectileCount: must be >= projectileCount (7), got 6',
    );
  });
});
