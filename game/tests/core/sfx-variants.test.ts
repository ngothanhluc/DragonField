/**
 * Acceptance test for #9 (SFX variants + jingles). This file is the contract: do not edit it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SFX_BANK,
  SFX_VOLUME_MIN,
  VariantPicker,
  sfxVolumeScale,
} from '../../assets/scripts/core/audio/sfx-bank';
import { SeededRng } from '../../assets/scripts/core/rng';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESOURCES = join(HERE, '..', '..', 'assets', 'resources');

const VARIED = ['shoot', 'enemy-hit', 'enemy-death', 'gold'] as const;
const JINGLES = ['room-clear', 'skill-acquired'] as const;

const bank = SFX_BANK as Readonly<Record<string, readonly string[]>>;

describe('declared SFX bank', () => {
  it.each(VARIED)('%s has 2–4 distinct variants', (id) => {
    const files = bank[id] ?? [];
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.length).toBeLessThanOrEqual(4);
    expect(new Set(files).size).toBe(files.length);
  });

  it.each(JINGLES)('%s jingle is declared', (id) => {
    expect((bank[id] ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('every declared file exists as an mp3 with an audio-clip meta, uuids unique', () => {
    const uuids = new Set<string>();
    let total = 0;
    for (const [id, files] of Object.entries(bank)) {
      expect(files.length, `${id} declares no file`).toBeGreaterThan(0);
      for (const path of files) {
        const mp3 = join(RESOURCES, `${path}.mp3`);
        expect(existsSync(mp3), `${id} → ${path}.mp3 missing`).toBe(true);
        expect(existsSync(`${mp3}.meta`), `${id} → ${path}.mp3.meta missing`).toBe(true);
        const meta = JSON.parse(readFileSync(`${mp3}.meta`, 'utf8')) as {
          importer?: string;
          uuid?: string;
        };
        expect(meta.importer, `${path}.mp3.meta importer`).toBe('audio-clip');
        expect(typeof meta.uuid).toBe('string');
        uuids.add(meta.uuid ?? '');
        total += 1;
      }
    }
    expect(uuids.size, 'two declared files share a meta uuid').toBe(total);
  });
});

describe('VariantPicker', () => {
  const synthetic: Readonly<Record<string, readonly string[]>> = {
    two: ['a', 'b'],
    three: ['a', 'b', 'c'],
    four: ['a', 'b', 'c', 'd'],
    one: ['solo'],
  };

  it.each(['two', 'three', 'four'])('never repeats immediately (%s)', (id) => {
    const picker = new VariantPicker(new SeededRng(1234), synthetic);
    let previous = picker.pick(id);
    for (let i = 0; i < 10_000; i += 1) {
      const next = picker.pick(id);
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  it.each(['two', 'three', 'four'])('distributes evenly over many rounds (%s)', (id) => {
    const files = synthetic[id] ?? [];
    const picker = new VariantPicker(new SeededRng(42), synthetic);
    const rounds = 12_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < rounds; i += 1) {
      const file = picker.pick(id);
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
    const expected = rounds / files.length;
    for (const file of files) {
      const count = counts.get(file) ?? 0;
      expect(Math.abs(count - expected) / expected, `${file}: ${count}`).toBeLessThan(0.05);
    }
  });

  it('a single-file event always returns that file', () => {
    const picker = new VariantPicker(new SeededRng(7), synthetic);
    for (let i = 0; i < 20; i += 1) expect(picker.pick('one')).toBe('solo');
  });

  it('remembers the last variant per event, not globally', () => {
    const picker = new VariantPicker(new SeededRng(99), synthetic);
    let previous = picker.pick('two');
    for (let i = 0; i < 500; i += 1) {
      picker.pick('three');
      picker.pick('four');
      const next = picker.pick('two');
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = new VariantPicker(new SeededRng(2026), synthetic);
    const b = new VariantPicker(new SeededRng(2026), synthetic);
    const seqA = Array.from({ length: 50 }, () => a.pick('four'));
    const seqB = Array.from({ length: 50 }, () => b.pick('four'));
    expect(seqA).toEqual(seqB);
  });

  it('uses the real bank by default and only returns declared files', () => {
    const picker = new VariantPicker(new SeededRng(5));
    for (const id of VARIED) {
      const file = picker.pick(id);
      expect(bank[id]).toContain(file);
    }
  });
});

describe('sfxVolumeScale (pitch is not exposed by Cocos 3.8 AudioSource; volume varies instead)', () => {
  it('stays within [SFX_VOLUME_MIN, 1] and actually varies', () => {
    expect(SFX_VOLUME_MIN).toBeGreaterThanOrEqual(0.7);
    expect(SFX_VOLUME_MIN).toBeLessThan(1);
    const rng = new SeededRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i += 1) {
      const v = sfxVolumeScale(rng);
      expect(v).toBeGreaterThanOrEqual(SFX_VOLUME_MIN);
      expect(v).toBeLessThanOrEqual(1);
      seen.add(Math.round(v * 100));
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});
