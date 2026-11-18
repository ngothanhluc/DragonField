import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTmxLevel } from '../../assets/scripts/core/level/tmx';
import { firstChild, parseXml } from '../../assets/scripts/core/level/xml';
import { CHAPTER_ONE_DIR, findTmxFiles, loadChapterOne } from '../helpers/tmx-levels';

const FLOOR_CSV = Array.from({ length: 32 * 18 }, () => '22').join(',');

/** Minimal valid TMX: 1 playerStart, 1 chaser spawn, 1 obstacle, 1 door → room 2. */
function validTmx(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" renderorder="right-down" width="32" height="18" tilewidth="16" tileheight="16">
 <properties>
  <property name="chapter" type="int" value="1"/>
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
    <property name="elite" type="bool" value="false"/>
   </properties>
   <point/>
  </object>
  <object id="3" name="obstacle" x="128" y="96" width="32" height="32">
   <properties>
    <property name="kind" value="pillar"/>
   </properties>
  </object>
  <object id="4" name="door" x="256" y="8">
   <properties>
    <property name="toRoom" type="int" value="2"/>
   </properties>
   <point/>
  </object>
 </objectgroup>
</map>`;
}

function parse(xml: string) {
  return parseTmxLevel(xml, { source: 'fixture.tmx' });
}

describe('parseTmxLevel — object layer contract', () => {
  it('valid map → full LevelData', () => {
    const level = parse(validTmx());

    expect(level.id).toBe('ch1-r1');
    expect(level.chapter).toBe(1);
    expect(level.room).toBe(1);
    expect(level.isBossRoom).toBe(false);
    expect(level.size).toEqual({ cols: 32, rows: 18 });
    expect(level.tileSizePx).toBe(16);
    expect(level.playerStart).toEqual({ x: 16, y: 16 });
    expect(level.waves).toEqual([
      { enemies: [{ role: 'chaser', at: { x: 6, y: 4 }, elite: false }] },
    ]);
    expect(level.obstacles).toEqual([{ kind: 'pillar', x: 8, y: 6, width: 2, height: 2 }]);
    expect(level.doors).toEqual([{ at: { x: 16, y: 0.5 }, toRoom: 2 }]);
    expect(level.boss).toBeUndefined();
    expect(level.bossStart).toBeUndefined();
  });

  it('groups spawns by wave and keeps elite', () => {
    const xml = validTmx().replace(
      '</objectgroup>',
      `<object id="5" name="spawn" x="160" y="64">
        <properties>
         <property name="role" value="caster"/>
         <property name="wave" type="int" value="2"/>
         <property name="elite" type="bool" value="true"/>
        </properties>
        <point/>
       </object>
       <object id="6" name="spawn" x="192" y="64">
        <properties>
         <property name="role" value="tank"/>
         <property name="wave" type="int" value="1"/>
        </properties>
        <point/>
       </object>
      </objectgroup>`,
    );

    const level = parse(xml);

    expect(level.waves).toHaveLength(2);
    expect(level.waves[0]?.enemies.map((enemy) => enemy.role)).toEqual(['chaser', 'tank']);
    expect(level.waves[0]?.enemies[1]?.elite).toBe(false);
    expect(level.waves[1]?.enemies[0]?.elite).toBe(true);
  });

  it('a door without toRoom = chapter exit (null)', () => {
    const xml = validTmx().replace(
      `<properties>
    <property name="toRoom" type="int" value="2"/>
   </properties>`,
      '',
    );
    const level = parse(xml);

    expect(level.doors).toEqual([{ at: { x: 16, y: 0.5 }, toRoom: null }]);
  });

  it('a boss room reads boss + bossStart', () => {
    const xml = validTmx()
      .replace(
        '<property name="room" type="int" value="1"/>',
        `<property name="room" type="int" value="1"/>
  <property name="isBossRoom" type="bool" value="true"/>
  <property name="boss" value="TenguBlue"/>`,
      )
      .replace(
        '</objectgroup>',
        '<object id="7" name="bossStart" x="256" y="80"><point/></object></objectgroup>',
      );

    const level = parse(xml);

    expect(level.isBossRoom).toBe(true);
    expect(level.boss).toEqual({ name: 'TenguBlue' });
    expect(level.bossStart).toEqual({ x: 16, y: 5 });
  });

  it('accepts room >= 10 (adding a room means adding only a .tmx)', () => {
    const xml = validTmx().replace('name="room" type="int" value="1"', 'name="room" type="int" value="10"');
    const level = parse(xml);

    expect(level.room).toBe(10);
    expect(level.id).toBe('ch1-r10');
  });
});

describe('parseTmxLevel — convention errors', () => {
  function expectError(xml: string, pattern: RegExp): void {
    expect(() => parse(xml)).toThrow(pattern);
  }

  it('rejects an unknown object name (a typo must not be ignored)', () => {
    expectError(validTmx().replace('name="spawn"', 'name="mob"'), /"mob".*convention/);
  });

  it('rejects a missing or duplicate playerStart', () => {
    expectError(validTmx().replace('name="playerStart"', 'name="bossStart"'), /missing object "playerStart"/);

    const twice = validTmx().replace(
      '</objectgroup>',
      '<object id="8" name="playerStart" x="32" y="32"><point/></object></objectgroup>',
    );
    expectError(twice, /exactly one playerStart/);
  });

  it('rejects a non-contiguous wave sequence', () => {
    const xml = validTmx().replace(
      '</objectgroup>',
      `<object id="9" name="spawn" x="96" y="96">
        <properties>
         <property name="role" value="chaser"/>
         <property name="wave" type="int" value="3"/>
        </properties>
        <point/>
       </object></objectgroup>`,
    );

    expectError(xml, /missing wave 2/);
  });

  it('rejects a missing or mistyped wave', () => {
    expectError(validTmx().replace('<property name="wave" type="int" value="1"/>', ''), /missing property "wave"/);
    expectError(
      validTmx().replace('name="wave" type="int"', 'name="wave" type="string"'),
      /must be an int/,
    );
  });

  it('rejects an invalid role/kind', () => {
    expectError(validTmx().replace('value="chaser"', 'value="brute"'), /invalid role/);
    expectError(validTmx().replace('value="pillar"', 'value="rock"'), /invalid kind/);
  });

  it('rejects a non-zero rotation', () => {
    expectError(validTmx().replace('name="obstacle" x=', 'name="obstacle" rotation="90" x='), /rotation/);
  });

  it('rejects boss/bossStart in a regular room', () => {
    expectError(
      validTmx().replace(
        '<property name="room" type="int" value="1"/>',
        `<property name="room" type="int" value="1"/>
  <property name="boss" value="TenguBlue"/>`,
      ),
      /only a boss room may declare boss/,
    );

    expectError(
      validTmx().replace(
        '</objectgroup>',
        '<object id="10" name="bossStart" x="256" y="80"><point/></object></objectgroup>',
      ),
      /only a boss room may declare bossStart/,
    );
  });

  it('a boss room without a boss name', () => {
    expectError(
      validTmx().replace(
        '<property name="room" type="int" value="1"/>',
        `<property name="room" type="int" value="1"/>
  <property name="isBossRoom" type="bool" value="true"/>`,
      ),
      /a boss room requires a boss/,
    );
  });

  it('rejects an obstacle outside the room (LevelData validation)', () => {
    expectError(validTmx().replace('width="32" height="32"', 'width="640" height="32"'), /extends outside the room/);
  });

  it('rejects a wrong map/tile size', () => {
    expectError(validTmx().replace('width="32" height="18"', 'width="31" height="18"'), /width must equal 32/);
    expectError(validTmx().replace('tilewidth="16"', 'tilewidth="32"'), /tilewidth must equal 16/);
    expectError(validTmx().replace('orientation="orthogonal"', 'orientation="isometric"'), /orthogonal/);
  });

  it('rejects a layer of the wrong size or CSV with too few cells', () => {
    expectError(validTmx().replace('name="floor" width="32"', 'name="floor" width="16"'), /width must equal 32/);
    expectError(validTmx().replace(FLOOR_CSV, '22,22'), /CSV has 2 cells/);
  });

  it('rejects a missing layer or objectgroup', () => {
    const withoutLayer = validTmx().replace(
      /<layer[\s\S]*?<\/layer>/,
      '',
    );
    expectError(withoutLayer, /at least one <layer>/);

    const withoutObjects = validTmx().replace(/<objectgroup[\s\S]*?<\/objectgroup>/, '');
    expectError(withoutObjects, /at least one <objectgroup>/);
  });

  it('rejects a missing or out-of-range chapter/room', () => {
    expectError(
      validTmx().replace('<property name="chapter" type="int" value="1"/>', ''),
      /missing property "chapter"/,
    );
    expectError(
      validTmx().replace('name="chapter" type="int" value="1"', 'name="chapter" type="int" value="4"'),
      /chapter.*1\.\.3/,
    );
    expectError(
      validTmx().replace('name="room" type="int" value="1"', 'name="room" type="int" value="0"'),
      /room.*>= 1/,
    );
  });

  it('an XML error names the source file', () => {
    expect(() => parseTmxLevel('<map>', { source: 'room-1.tmx' })).toThrow(/room-1\.tmx: .*never closed/);
    expect(() => parseTmxLevel('<scene/>', { source: 'room-1.tmx' })).toThrow(
      /room-1\.tmx:[\s\S]*<map>/,
    );
  });
});

describe('assets/resources/data/levels — every real .tmx file', () => {
  const files = findTmxFiles();

  it('has exactly 9 rooms in chapter 1', () => {
    const chapterOne = files.filter((file) => file.name.startsWith('chapter-1/'));
    expect(chapterOne).toHaveLength(9);
  });

  it('every file parses and validates with the same runtime parser', () => {
    for (const file of files) {
      expect(
        () => parseTmxLevel(file.xml, { source: file.name }),
        file.name,
      ).not.toThrow();
    }
  });

  it('groups into chapter 1: 9 rooms in order, doors point at real rooms, boss in room 9', () => {
    const chapter = loadChapterOne();

    expect(chapter.chapter).toBe(1);
    expect(chapter.rooms.map((room) => room.room)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(chapter.rooms.some((room) => room.isBossRoom)).toBe(true);

    const bossRoom = chapter.rooms[8];
    expect(bossRoom?.room).toBe(9);
    expect(bossRoom?.isBossRoom).toBe(true);
    expect(bossRoom?.boss?.name).toBe('TenguBlue');
    expect(bossRoom?.bossStart).toEqual({ x: 16, y: 5 });
  });

  it('every .tmx points at a real .tsx, and the .tsx points at a real PNG', () => {
    for (const file of files) {
      const root = parseXml(file.xml);
      const tileset = firstChild(root, 'tileset');
      const source = tileset?.attributes['source'];
      expect(source, `${file.name} is missing <tileset source>`).toBeDefined();
      if (source === undefined) continue;

      const tsxPath = resolve(dirname(file.path), source);
      expect(existsSync(tsxPath), `${file.name}: cannot find ${tsxPath}`).toBe(true);

      const tsx = parseXml(readFileSync(tsxPath, 'utf8'));
      const image = firstChild(tsx, 'image');
      const imageSource = image?.attributes['source'];
      expect(imageSource, `${tsxPath} is missing <image source>`).toBeDefined();
      if (imageSource === undefined) continue;

      const pngPath = resolve(dirname(tsxPath), imageSource);
      expect(existsSync(pngPath), `${tsxPath}: cannot find ${pngPath}`).toBe(true);
      // A tileset must live inside the asset DB (`game/assets/...`), otherwise the build does not import it.
      expect(pngPath.startsWith(resolve(CHAPTER_ONE_DIR, '../../../..'))).toBe(true);
    }
  });
});
