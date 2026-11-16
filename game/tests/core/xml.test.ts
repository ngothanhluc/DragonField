import { describe, expect, it } from 'vitest';
import { firstChild, parseXml } from '../../assets/scripts/core/level/xml';

describe('parseXml — đọc đúng', () => {
  it('đọc cây phần tử, thuộc tính và text trực tiếp', () => {
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

  it('nhận nháy đơn, xuống dòng trong text và khoảng trắng quanh "="', () => {
    const root = parseXml("<a x = '1' y=\"2\">dòng 1\ndòng 2</a>");

    expect(root.attributes).toEqual({ x: '1', y: '2' });
    expect(root.text).toBe('dòng 1\ndòng 2');
  });

  it('giải entity chuẩn và entity số', () => {
    const root = parseXml('<a v="&lt;&amp;&gt;&quot;&apos;">&#65;&#x42;</a>');

    expect(root.attributes['v']).toBe(`<&>"'`);
    expect(root.text).toBe('AB');
  });

  it('bỏ qua khai báo XML, comment và doctype', () => {
    const root = parseXml(
      '<?xml version="1.0"?>\n<!DOCTYPE map>\n<!-- room 1 -->\n<map name="ok"/>',
    );

    expect(root.name).toBe('map');
    expect(root.attributes['name']).toBe('ok');
  });

  it('giữ thứ tự con và text của từng phần tử (text giữ nguyên khoảng trắng hai đầu)', () => {
    const root = parseXml('<a><b>1</b> giữa <c>2</c></a>');

    expect(root.children).toHaveLength(2);
    expect(root.text).toBe(' giữa ');
    expect(root.children[1]?.text).toBe('2');
  });

  it('firstChild chỉ lấy con trực tiếp', () => {
    const root = parseXml('<a><b><c/></b><c id="2"/></a>');

    expect(firstChild(root, 'c')?.attributes['id']).toBe('2');
    expect(firstChild(root, 'z')).toBeNull();
  });
});

describe('parseXml — lỗi có vị trí', () => {
  it('từ chối nội dung rỗng', () => {
    expect(() => parseXml('   ')).toThrow(/rỗng/);
  });

  it('từ chối thẻ đóng lệch tên', () => {
    expect(() => parseXml('<a>\n  <b></a>\n</b>')).toThrow(/dòng 2.*không khớp/);
  });

  it('từ chối thẻ chưa đóng', () => {
    expect(() => parseXml('<a><b></b>')).toThrow(/<a>.*chưa được đóng/);
  });

  it('từ chối nhiều phần tử gốc', () => {
    expect(() => parseXml('<a/><b/>')).toThrow(/nhiều hơn một phần tử gốc/);
  });

  it('từ chối text ngoài phần tử gốc', () => {
    expect(() => parseXml('rác<a/>')).toThrow(/ngoài phần tử gốc/);
  });

  it('từ chối thuộc tính thiếu dấu bằng hoặc thiếu nháy', () => {
    expect(() => parseXml('<a x="1" y/>')).toThrow(/thiếu "="/);
    expect(() => parseXml('<a x=1/>')).toThrow(/dấu nháy/);
    expect(() => parseXml('<a x="1/>')).toThrow(/không đóng/);
  });

  it('từ chối thuộc tính trùng tên', () => {
    expect(() => parseXml('<a x="1" x="2"/>')).toThrow(/bị lặp/);
  });

  it('từ chối entity không hỗ trợ', () => {
    expect(() => parseXml('<a name="&nbsp;"/>')).toThrow(/entity không hỗ trợ/);
  });

  it('từ chối comment không đóng', () => {
    expect(() => parseXml('<a><!-- xx</a>')).toThrow(/comment/);
  });
});
