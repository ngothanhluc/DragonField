/**
 * Parser XML tối giản, đủ để đọc file `.tmx`/`.tsx` do Tiled sinh ra.
 *
 * Vì sao tự viết thay vì dùng `DOMParser`: `core/` là TS thuần, chạy trong Node
 * bằng vitest (không có DOM), và runtime Cocos cũng dùng **đúng** parser này
 * (`core/level/tmx.ts`) nên test và build không thể lệch nhau.
 *
 * Phạm vi:
 * - Thẻ mở/đóng/self-closing, thuộc tính `"…"` và `'…'`, entity chuẩn (kể cả `&#nn;`).
 * - Bỏ qua `<?xml …?>`, `<!-- … -->`, `<!DOCTYPE …>`.
 * - Một phần tử gốc duy nhất; text ngoài phần tử gốc hoặc thẻ lệch tên đều là lỗi.
 * - Không hỗ trợ namespace (Tiled không dùng) và không giữ thứ tự text/child — TMX
 *   chỉ cần text của `<data>` và cây phần tử.
 *
 * Mọi lỗi ném `Error` kèm số dòng/cột (1-based) để sửa file tay vẫn tìm được chỗ sai.
 */

export interface XmlElement {
  readonly name: string;
  /** Thuộc tính đã giải entity; giá trị không bao giờ `undefined`. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  /** Text trực tiếp của phần tử (đã giải entity), thường là CSV trong `<data>`. */
  readonly text: string;
}

interface MutableElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_:.-]*$/;

/** Vị trí 1-based để message khớp với thứ mà editor hiển thị. */
function positionAt(source: string, index: number): string {
  let line = 1;
  let column = 1;
  const end = Math.min(index, source.length);
  for (let i = 0; i < end; i += 1) {
    if (source[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return `dòng ${line}, cột ${column}`;
}

function xmlError(source: string, index: number, message: string): Error {
  return new Error(`XML không hợp lệ (${positionAt(source, index)}): ${message}`);
}

function decodeEntities(source: string, raw: string, baseIndex: number): string {
  if (!raw.includes('&')) return raw;

  let result = '';
  let index = 0;
  while (index < raw.length) {
    const char = raw[index];
    if (char !== '&') {
      result += char;
      index += 1;
      continue;
    }

    const end = raw.indexOf(';', index + 1);
    if (end < 0) {
      throw xmlError(source, baseIndex + index, `entity không có ";" kết thúc trong "${raw}"`);
    }

    const body = raw.slice(index + 1, end);
    const named: Readonly<Record<string, string>> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
    };

    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      if (!Number.isInteger(code) || code <= 0) {
        throw xmlError(source, baseIndex + index, `entity số không hợp lệ "&${body};"`);
      }
      result += String.fromCodePoint(code);
    } else if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code <= 0) {
        throw xmlError(source, baseIndex + index, `entity số không hợp lệ "&${body};"`);
      }
      result += String.fromCodePoint(code);
    } else {
      const replacement = named[body];
      if (replacement === undefined) {
        throw xmlError(source, baseIndex + index, `entity không hỗ trợ "&${body};"`);
      }
      result += replacement;
    }

    index = end + 1;
  }

  return result;
}

function isWhitespace(text: string): boolean {
  return text.trim() === '';
}

function top(stack: readonly MutableElement[]): MutableElement {
  const element = stack[stack.length - 1];
  if (element === undefined) throw new Error('XML không hợp lệ: stack rỗng (lỗi nội bộ)');
  return element;
}

/** Bỏ qua khoảng trắng trong thẻ mở. */
function skipWhitespace(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor] ?? '')) cursor += 1;
  return cursor;
}

export function parseXml(source: string): XmlElement {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('XML không hợp lệ: nội dung rỗng');
  }

  const stack: MutableElement[] = [];
  let root: XmlElement | null = null;
  let index = 0;

  const finishElement = (element: MutableElement): XmlElement => {
    const frozen: XmlElement = {
      name: element.name,
      attributes: element.attributes,
      children: element.children,
      text: element.text,
    };
    return frozen;
  };

  const appendText = (raw: string, at: number): void => {
    if (isWhitespace(raw)) return;
    if (stack.length === 0) {
      throw xmlError(source, at, `text nằm ngoài phần tử gốc: ${JSON.stringify(raw.slice(0, 24))}`);
    }
    top(stack).text += decodeEntities(source, raw, at);
  };

  while (index < source.length) {
    const nextTag = source.indexOf('<', index);

    if (nextTag < 0) {
      appendText(source.slice(index), index);
      index = source.length;
      break;
    }

    if (nextTag > index) {
      appendText(source.slice(index, nextTag), index);
    }

    index = nextTag;

    if (source.startsWith('<?', index)) {
      const end = source.indexOf('?>', index + 2);
      if (end < 0) throw xmlError(source, index, 'khai báo "<?…?>" không đóng');
      index = end + 2;
      continue;
    }

    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      if (end < 0) throw xmlError(source, index, 'comment "<!--…-->" không đóng');
      index = end + 3;
      continue;
    }

    if (source.startsWith('<!', index)) {
      const end = source.indexOf('>', index + 2);
      if (end < 0) throw xmlError(source, index, 'khai báo "<!…>" không đóng');
      index = end + 1;
      continue;
    }

    if (source.startsWith('</', index)) {
      const end = source.indexOf('>', index + 2);
      if (end < 0) throw xmlError(source, index, 'thẻ đóng không có ">"');
      const name = source.slice(index + 2, end).trim();
      const current = stack.pop();
      if (current === undefined) {
        throw xmlError(source, index, `thẻ đóng "</${name}>" khi không có phần tử mở`);
      }
      if (current.name !== name) {
        throw xmlError(source, index, `thẻ đóng "</${name}>" không khớp "<${current.name}>"`);
      }
      const finished = finishElement(current);
      if (stack.length === 0) {
        if (root !== null) {
          throw xmlError(source, index, 'có nhiều hơn một phần tử gốc');
        }
        root = finished;
      } else {
        top(stack).children.push(finished);
      }
      index = end + 1;
      continue;
    }

    // Thẻ mở: <name attr="value" …> hoặc <name …/>
    let cursor = index + 1;
    if (!/[A-Za-z_]/.test(source[cursor] ?? '')) {
      throw xmlError(source, index, 'thẻ mở phải bắt đầu bằng chữ cái');
    }

    let nameEnd = cursor;
    while (nameEnd < source.length && !/[\s/>]/.test(source[nameEnd] ?? '')) nameEnd += 1;
    const name = source.slice(cursor, nameEnd);
    if (!NAME_PATTERN.test(name)) {
      throw xmlError(source, index, `tên phần tử không hợp lệ "${name}"`);
    }
    cursor = nameEnd;

    const attributes: Record<string, string> = {};
    let selfClosing = false;

    for (;;) {
      cursor = skipWhitespace(source, cursor);
      const char = source[cursor];

      if (char === undefined) throw xmlError(source, index, `thẻ "<${name}>" không đóng`);
      if (char === '>') {
        cursor += 1;
        break;
      }
      if (char === '/') {
        if (source[cursor + 1] !== '>') {
          throw xmlError(source, cursor, `kỳ vọng "/>" để đóng thẻ "<${name}>"`);
        }
        cursor += 2;
        selfClosing = true;
        break;
      }

      let attributeEnd = cursor;
      while (attributeEnd < source.length && !/[\s=/>]/.test(source[attributeEnd] ?? '')) {
        attributeEnd += 1;
      }
      const attributeName = source.slice(cursor, attributeEnd);
      if (attributeName === '' || !NAME_PATTERN.test(attributeName)) {
        throw xmlError(source, cursor, `tên thuộc tính không hợp lệ "${attributeName}"`);
      }
      if (Object.prototype.hasOwnProperty.call(attributes, attributeName)) {
        throw xmlError(source, cursor, `thuộc tính "${attributeName}" bị lặp trong "<${name}>"`);
      }

      cursor = skipWhitespace(source, attributeEnd);
      if (source[cursor] !== '=') {
        throw xmlError(source, cursor, `thuộc tính "${attributeName}" thiếu "="`);
      }
      cursor = skipWhitespace(source, cursor + 1);

      const quote = source[cursor];
      if (quote !== '"' && quote !== "'") {
        throw xmlError(source, cursor, `giá trị thuộc tính "${attributeName}" phải nằm trong dấu nháy`);
      }
      const valueStart = cursor + 1;
      const valueEnd = source.indexOf(quote, valueStart);
      if (valueEnd < 0) {
        throw xmlError(source, valueStart, `giá trị thuộc tính "${attributeName}" không đóng`);
      }

      attributes[attributeName] = decodeEntities(source, source.slice(valueStart, valueEnd), valueStart);
      cursor = valueEnd + 1;
    }

    const element: MutableElement = { name, attributes, children: [], text: '' };

    if (stack.length === 0) {
      if (root !== null) {
        throw xmlError(source, index, 'có nhiều hơn một phần tử gốc');
      }
      if (selfClosing) {
        root = finishElement(element);
      } else {
        stack.push(element);
      }
    } else {
      if (selfClosing) {
        top(stack).children.push(finishElement(element));
      } else {
        stack.push(element);
      }
    }

    index = cursor;
  }

  if (stack.length > 0) {
    const open = top(stack);
    throw new Error(`XML không hợp lệ: phần tử "<${open.name}>" chưa được đóng`);
  }
  if (root === null) {
    throw new Error('XML không hợp lệ: không có phần tử gốc');
  }

  return root;
}

/** Text trực tiếp của `element`, đã trim (dùng cho `<data>` CSV). */
export function elementText(element: XmlElement): string {
  return element.text.trim();
}

/** Con trực tiếp đầu tiên có tên `name`, hoặc `null`. */
export function firstChild(element: XmlElement, name: string): XmlElement | null {
  for (const child of element.children) {
    if (child.name === name) return child;
  }
  return null;
}

/** Mọi con trực tiếp có tên `name`. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}
