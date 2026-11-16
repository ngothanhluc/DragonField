import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTmxLevel } from '../../assets/scripts/core/level/tmx';
import { firstChild, parseXml } from '../../assets/scripts/core/level/xml';
import { CHAPTER_ONE_DIR, findTmxFiles, loadChapterOne } from '../helpers/tmx-levels';

const FLOOR_CSV = Array.from({ length: 32 * 18 }, () => '22').join(',');

/** TMX tối thiểu hợp lệ: 1 playerStart, 1 spawn chaser, 1 obstacle, 1 door → phòng 2. */
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

describe('parseTmxLevel — hợp đồng object layer', () => {
  it('map hợp lệ → LevelData đầy đủ', () => {
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

  it('gộp spawn theo wave và giữ elite', () => {
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

  it('door không có toRoom = cửa cuối chapter (null)', () => {
    const xml = validTmx().replace(
      `<properties>
    <property name="toRoom" type="int" value="2"/>
   </properties>`,
      '',
    );
    const level = parse(xml);

    expect(level.doors).toEqual([{ at: { x: 16, y: 0.5 }, toRoom: null }]);
  });

  it('phòng boss đọc boss + bossStart', () => {
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

  it('nhận room >= 10 (thêm phòng chỉ bằng .tmx)', () => {
    const xml = validTmx().replace('name="room" type="int" value="1"', 'name="room" type="int" value="10"');
    const level = parse(xml);

    expect(level.room).toBe(10);
    expect(level.id).toBe('ch1-r10');
  });
});

describe('parseTmxLevel — lỗi quy ước', () => {
  function expectError(xml: string, pattern: RegExp): void {
    expect(() => parse(xml)).toThrow(pattern);
  }

  it('từ chối object tên lạ (typo không được bỏ qua)', () => {
    expectError(validTmx().replace('name="spawn"', 'name="mob"'), /"mob".*quy ước/);
  });

  it('từ chối thiếu playerStart hoặc có hai playerStart', () => {
    expectError(validTmx().replace('name="playerStart"', 'name="bossStart"'), /thiếu object "playerStart"/);

    const twice = validTmx().replace(
      '</objectgroup>',
      '<object id="8" name="playerStart" x="32" y="32"><point/></object></objectgroup>',
    );
    expectError(twice, /đúng một playerStart/);
  });

  it('từ chối wave đứt quãng', () => {
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

    expectError(xml, /thiếu wave 2/);
  });

  it('từ chối wave thiếu hoặc sai kiểu', () => {
    expectError(validTmx().replace('<property name="wave" type="int" value="1"/>', ''), /thiếu property "wave"/);
    expectError(
      validTmx().replace('name="wave" type="int"', 'name="wave" type="string"'),
      /phải là int/,
    );
  });

  it('từ chối role/kind không hợp lệ', () => {
    expectError(validTmx().replace('value="chaser"', 'value="brute"'), /role không hợp lệ/);
    expectError(validTmx().replace('value="pillar"', 'value="rock"'), /kind không hợp lệ/);
  });

  it('từ chối rotation khác 0', () => {
    expectError(validTmx().replace('name="obstacle" x=', 'name="obstacle" rotation="90" x='), /rotation/);
  });

  it('từ chối boss/bossStart ở phòng thường', () => {
    expectError(
      validTmx().replace(
        '<property name="room" type="int" value="1"/>',
        `<property name="room" type="int" value="1"/>
  <property name="boss" value="TenguBlue"/>`,
      ),
      /chỉ phòng boss mới được khai báo boss/,
    );

    expectError(
      validTmx().replace(
        '</objectgroup>',
        '<object id="10" name="bossStart" x="256" y="80"><point/></object></objectgroup>',
      ),
      /chỉ phòng boss mới được khai báo bossStart/,
    );
  });

  it('phòng boss thiếu boss name', () => {
    expectError(
      validTmx().replace(
        '<property name="room" type="int" value="1"/>',
        `<property name="room" type="int" value="1"/>
  <property name="isBossRoom" type="bool" value="true"/>`,
      ),
      /phòng boss bắt buộc có boss/,
    );
  });

  it('từ chối obstacle vượt ra ngoài phòng (validation LevelData)', () => {
    expectError(validTmx().replace('width="32" height="32"', 'width="640" height="32"'), /vượt ra ngoài phòng/);
  });

  it('từ chối kích thước map/tile sai', () => {
    expectError(validTmx().replace('width="32" height="18"', 'width="31" height="18"'), /width phải bằng 32/);
    expectError(validTmx().replace('tilewidth="16"', 'tilewidth="32"'), /tilewidth phải bằng 16/);
    expectError(validTmx().replace('orientation="orthogonal"', 'orientation="isometric"'), /orthogonal/);
  });

  it('từ chối layer sai kích thước hoặc CSV thiếu ô', () => {
    expectError(validTmx().replace('name="floor" width="32"', 'name="floor" width="16"'), /width phải bằng 32/);
    expectError(validTmx().replace(FLOOR_CSV, '22,22'), /CSV có 2 ô/);
  });

  it('từ chối thiếu layer hoặc objectgroup', () => {
    const withoutLayer = validTmx().replace(
      /<layer[\s\S]*?<\/layer>/,
      '',
    );
    expectError(withoutLayer, /ít nhất một <layer>/);

    const withoutObjects = validTmx().replace(/<objectgroup[\s\S]*?<\/objectgroup>/, '');
    expectError(withoutObjects, /ít nhất một <objectgroup>/);
  });

  it('từ chối chapter/room thiếu hoặc sai miền', () => {
    expectError(
      validTmx().replace('<property name="chapter" type="int" value="1"/>', ''),
      /thiếu property "chapter"/,
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

  it('lỗi XML nêu tên file nguồn', () => {
    expect(() => parseTmxLevel('<map>', { source: 'room-1.tmx' })).toThrow(/room-1\.tmx: .*chưa được đóng/);
    expect(() => parseTmxLevel('<scene/>', { source: 'room-1.tmx' })).toThrow(
      /room-1\.tmx:[\s\S]*<map>/,
    );
  });
});

describe('assets/resources/data/levels — mọi file .tmx thật', () => {
  const files = findTmxFiles();

  it('có đúng 9 phòng chapter 1', () => {
    const chapterOne = files.filter((file) => file.name.startsWith('chapter-1/'));
    expect(chapterOne).toHaveLength(9);
  });

  it('mỗi file parse và validate được bằng cùng parser của runtime', () => {
    for (const file of files) {
      expect(
        () => parseTmxLevel(file.xml, { source: file.name }),
        file.name,
      ).not.toThrow();
    }
  });

  it('gom thành chapter 1: 9 phòng đúng thứ tự, door trỏ tới phòng có thật, boss ở phòng 9', () => {
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

  it('mỗi .tmx trỏ tới .tsx có thật, và .tsx trỏ tới PNG có thật', () => {
    for (const file of files) {
      const root = parseXml(file.xml);
      const tileset = firstChild(root, 'tileset');
      const source = tileset?.attributes['source'];
      expect(source, `${file.name} thiếu <tileset source>`).toBeDefined();
      if (source === undefined) continue;

      const tsxPath = resolve(dirname(file.path), source);
      expect(existsSync(tsxPath), `${file.name}: không thấy ${tsxPath}`).toBe(true);

      const tsx = parseXml(readFileSync(tsxPath, 'utf8'));
      const image = firstChild(tsx, 'image');
      const imageSource = image?.attributes['source'];
      expect(imageSource, `${tsxPath} thiếu <image source>`).toBeDefined();
      if (imageSource === undefined) continue;

      const pngPath = resolve(dirname(tsxPath), imageSource);
      expect(existsSync(pngPath), `${tsxPath}: không thấy ${pngPath}`).toBe(true);
      // Tileset phải nằm trong asset DB (`game/assets/...`), nếu không build không import.
      expect(pngPath.startsWith(resolve(CHAPTER_ONE_DIR, '../../../..'))).toBe(true);
    }
  });
});
