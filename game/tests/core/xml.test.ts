import { describe, expect, it } from 'vitest';
import { firstChild, parseXml } from '../../assets/scripts/core/level/xml';

describe('parseXml — reads correctly', () => {
  it('reads the element tree, attributes and direct text', () => {
    const root = parseXml(
      '<map width="32" height="18"><layer name="floor">1,2,3</layer><object/></map>',
    );

    expect(root.name).toBe('map');
    expect(root.attributes).toEqual({ width: '32', height: '18' });
    expect(root.children.map((child) => child.name)).toEqual(['layer', 'object']);
    expect(root.children[0]?.attributes['name']).toBe('floor');
    expect(root.children[0]?.text).toBe('1,2,3');
    expect(root.children[1]?.children).toEqual([]);
  });

  it('accepts single quotes, newlines in text, and whitespace around "="', () => {
    const root = parseXml("<a x = '1' y=\"2\">dòng 1\ndòng 2</a>"); // i18n-allow: sample text

    expect(root.attributes).toEqual({ x: '1', y: '2' });
    expect(root.text).toBe('dòng 1\ndòng 2'); // i18n-allow: sample text
  });

  it('resolves standard entities and numeric entities', () => {
    const root = parseXml('<a v="&lt;&amp;&gt;&quot;&apos;">&#65;&#x42;</a>');

    expect(root.attributes['v']).toBe(`<&>"'`);
    expect(root.text).toBe('AB');
  });

  it('skips the XML declaration, comments and doctype', () => {
    const root = parseXml(
      '<?xml version="1.0"?>\n<!DOCTYPE map>\n<!-- room 1 -->\n<map name="ok"/>',
    );

    expect(root.name).toBe('map');
    expect(root.attributes['name']).toBe('ok');
  });

  it('keeps child order and each element text (text keeps leading/trailing whitespace)', () => {
    const root = parseXml('<a><b>1</b> giữa <c>2</c></a>'); // i18n-allow: sample text

    expect(root.children).toHaveLength(2);
    expect(root.text).toBe(' giữa '); // i18n-allow: sample text
    expect(root.children[1]?.text).toBe('2');
  });

  it('firstChild only returns direct children', () => {
    const root = parseXml('<a><b><c/></b><c id="2"/></a>');

    expect(firstChild(root, 'c')?.attributes['id']).toBe('2');
    expect(firstChild(root, 'z')).toBeNull();
  });
});

describe('parseXml — errors carry a position', () => {
  it('rejects empty content', () => {
    expect(() => parseXml('   ')).toThrow(/empty/);
  });

  it('rejects a close tag with the wrong name', () => {
    expect(() => parseXml('<a>\n  <b></a>\n</b>')).toThrow(/line 2.*does not match/);
  });

  it('rejects an unclosed tag', () => {
    expect(() => parseXml('<a><b></b>')).toThrow(/<a>.*never closed/);
  });

  it('rejects multiple root elements', () => {
    expect(() => parseXml('<a/><b/>')).toThrow(/more than one root element/);
  });

  it('rejects text outside the root element', () => {
    expect(() => parseXml('rác<a/>')).toThrow(/outside the root element/); // i18n-allow: sample text
  });

  it('rejects an attribute missing the equals sign or the quotes', () => {
    expect(() => parseXml('<a x="1" y/>')).toThrow(/missing "="/);
    expect(() => parseXml('<a x=1/>')).toThrow(/quoted/);
    expect(() => parseXml('<a x="1/>')).toThrow(/not closed/);
  });

  it('rejects a duplicated attribute name', () => {
    expect(() => parseXml('<a x="1" x="2"/>')).toThrow(/duplicated/);
  });

  it('rejects an unsupported entity', () => {
    expect(() => parseXml('<a name="&nbsp;"/>')).toThrow(/unsupported entity/);
  });

  it('rejects an unclosed comment', () => {
    expect(() => parseXml('<a><!-- xx</a>')).toThrow(/comment/);
  });
});
