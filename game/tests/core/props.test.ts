/**
 * Prop objects in the `.tmx` object layer (#35).
 *
 * The acceptance test (`props.acceptance.test.ts`) pins the catalogue and the rooms on disk;
 * this file pins the **parser seam**: one `prop` object becomes one drawn prop plus, for a
 * solid prop, exactly one `prop` obstacle at its collider — the rule collision/bullets use.
 */
import { describe, expect, it } from 'vitest';
import { parseTmxLevel } from '../../assets/scripts/core/level/tmx';
import { PROP_CATALOGUE, propCollider, propDef } from '../../assets/scripts/core/level/props';

const FLOOR_CSV = Array.from({ length: 32 * 18 }, () => '22').join(',');

/** Minimal valid room; `extra` goes inside the object layer. */
function tmx(extra: string, chapter = 1): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" renderorder="right-down" width="32" height="18" tilewidth="16" tileheight="16">
 <properties>
  <property name="chapter" type="int" value="${chapter}"/>
  <property name="room" type="int" value="1"/>
 </properties>
 <tileset firstgid="1" source="field.tsx"/>
 <layer id="1" name="floor" width="32" height="18">
  <data encoding="csv">${FLOOR_CSV}</data>
 </layer>
 <objectgroup id="2" name="objects">
  <object id="1" name="playerStart" x="256" y="256"><point/></object>
  <object id="2" name="spawn" x="96" y="64">
   <properties>
    <property name="role" value="chaser"/>
    <property name="wave" type="int" value="1"/>
   </properties>
   <point/>
  </object>
${extra}
 </objectgroup>
</map>`;
}

function propObject(id: number, key: string, x: number, y: number, width = 32, height = 32): string {
  return `  <object id="${id}" name="prop" x="${x}" y="${y}" width="${width}" height="${height}">
   <properties>
    <property name="key" value="${key}"/>
   </properties>
  </object>`;
}

function parse(extra: string, chapter = 1) {
  return parseTmxLevel(tmx(extra, chapter), { source: 'fixture.tmx' });
}

describe('prop objects → props + prop obstacles', () => {
  it('a solid prop is drawn and adds exactly its collider as a `prop` obstacle', () => {
    // `tree-green` is a 32×32 tree with a 16×8 trunk at (8, 24) inside its cell.
    const level = parse(propObject(3, 'tree-green', 128, 96));

    expect(level.props).toEqual([{ key: 'tree-green', x: 8, y: 6 }]);
    expect(level.obstacles).toEqual([
      { kind: 'prop', x: 8 + 8 / 16, y: 6 + 24 / 16, width: 1, height: 0.5 },
    ]);
    expect(propDef(1, 'tree-green')?.solid).toBe(true);
  });

  it('a walk-over prop is drawn and adds no obstacle at all', () => {
    const level = parse(propObject(3, 'flower-red', 64, 64, 16, 16));

    expect(level.props).toEqual([{ key: 'flower-red', x: 4, y: 4 }]);
    expect(level.obstacles).toEqual([]);
  });

  it('keeps authored obstacles and props in one list, in object order', () => {
    const obstacle = `  <object id="4" name="obstacle" x="0" y="0" width="16" height="16">
   <properties>
    <property name="kind" value="pillar"/>
   </properties>
  </object>`;
    const level = parse(`${propObject(3, 'crate', 160, 160, 16, 16)}\n${obstacle}`);

    expect(level.obstacles.map((entry) => entry.kind)).toEqual(['prop', 'pillar']);
  });

  it('rejects an unknown key with the key and the chapter', () => {
    expect(() => parse(propObject(3, 'no-such-prop', 64, 64))).toThrow(/unknown prop "no-such-prop" in chapter 1/);
  });

  it('rejects a prop without the `key` property', () => {
    const withoutKey = `  <object id="3" name="prop" x="64" y="64" width="16" height="16"/>`;
    expect(() => parse(withoutKey)).toThrow(/prop requires the "key" property/);
  });

  it('rejects a hand-written obstacle of kind prop (it is generated, never authored)', () => {
    const handWritten = `  <object id="3" name="obstacle" x="64" y="64" width="16" height="16">
   <properties>
    <property name="kind" value="prop"/>
   </properties>
  </object>`;
    expect(() => parse(handWritten)).toThrow(/invalid kind "prop"/);
  });

  it('reads the chapter catalogue, so the same key can differ between chapters', () => {
    const level = parse(propObject(3, 'house-timber', 64, 64, 64, 96), 3);
    const def = propDef(3, 'house-timber');
    expect(def).toBeDefined();
    expect(level.props).toEqual([{ key: 'house-timber', x: 4, y: 4 }]);
    expect(level.obstacles).toHaveLength(1);
    expect(level.obstacles[0]).toEqual(propCollider({ key: 'house-timber', x: 4, y: 4 }, def!));
    expect(() => parse(propObject(3, 'house-timber', 64, 64, 64, 96), 1)).toThrow(/unknown prop/);
  });
});

describe('prop catalogue entries', () => {
  it('every collider is inside its rect, touches the bottom and is smaller than the drawing', () => {
    const problems: string[] = [];
    for (const [chapter, defs] of Object.entries(PROP_CATALOGUE)) {
      for (const def of defs) {
        const collider = def.collider;
        if (!def.solid) {
          if (collider !== null) problems.push(`${chapter}/${def.key}: walk-over with a collider`);
          continue;
        }
        if (collider === null) {
          problems.push(`${chapter}/${def.key}: solid without a collider`);
          continue;
        }
        if (collider.x < 0 || collider.y < 0) problems.push(`${chapter}/${def.key}: collider outside`);
        if (collider.x + collider.width > def.rect.width) problems.push(`${chapter}/${def.key}: collider too wide`);
        if (collider.y + collider.height > def.rect.height) problems.push(`${chapter}/${def.key}: collider too tall`);
        if (def.rect.height - (collider.y + collider.height) > 4) problems.push(`${chapter}/${def.key}: collider floats`);
        if (def.kind === 'tree' && collider.width * collider.height >= (def.rect.width * def.rect.height) / 3) {
          problems.push(`${chapter}/${def.key}: tree collider is not a trunk`);
        }
        // A tree/roof overlay is the part above the blocking base, so it never overlaps it.
        const overlay = def.overlay;
        if (overlay !== undefined && overlay.height > collider.y) {
          problems.push(`${chapter}/${def.key}: overlay reaches into the collider`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
