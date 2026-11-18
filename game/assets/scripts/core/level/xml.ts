/**
 * Minimal XML parser, just enough to read `.tmx`/`.tsx` files produced by Tiled.
 *
 * Why hand-rolled instead of `DOMParser`: `core/` is pure TS, runs under Node with
 * vitest (no DOM), and the Cocos runtime uses **this same** parser
 * (`core/level/tmx.ts`), so tests and build cannot drift apart.
 *
 * Scope:
 * - Open/close/self-closing tags, `"…"` and `'…'` attributes, standard entities (including `&#nn;`).
 * - Skips `<?xml …?>`, `<!-- … -->`, `<!DOCTYPE …>`.
 * - A single root element; text outside the root or mismatched tag names are errors.
 * - No namespace support (Tiled does not use them) and text/child order is not kept — TMX
 *   only needs `<data>` text and the element tree.
 *
 * Every error throws an `Error` with line/column (1-based) so fixing a file by hand still finds the spot.
 */

export interface XmlElement {
  readonly name: string;
  /** Attributes with entities resolved; a value is never `undefined`. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  /** Direct element text (entities resolved), usually CSV inside `<data>`. */
  readonly text: string;
}

interface MutableElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_:.-]*$/;

/** 1-based position so messages match what the editor shows. */
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
  return `line ${line}, column ${column}`;
}

function xmlError(source: string, index: number, message: string): Error {
  return new Error(`Invalid XML (${positionAt(source, index)}): ${message}`);
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
      throw xmlError(source, baseIndex + index, `entity has no terminating ";" in "${raw}"`);
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
        throw xmlError(source, baseIndex + index, `invalid numeric entity "&${body};"`);
      }
      result += String.fromCodePoint(code);
    } else if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code <= 0) {
        throw xmlError(source, baseIndex + index, `invalid numeric entity "&${body};"`);
      }
      result += String.fromCodePoint(code);
    } else {
      const replacement = named[body];
      if (replacement === undefined) {
        throw xmlError(source, baseIndex + index, `unsupported entity "&${body};"`);
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
  if (element === undefined) throw new Error('Invalid XML: empty stack (internal error)');
  return element;
}

/** Skip whitespace inside an open tag. */
function skipWhitespace(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor] ?? '')) cursor += 1;
  return cursor;
}

export function parseXml(source: string): XmlElement {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('Invalid XML: empty content');
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
      throw xmlError(source, at, `text outside the root element: ${JSON.stringify(raw.slice(0, 24))}`);
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
      if (end < 0) throw xmlError(source, index, '"<?…?>" declaration is not closed');
      index = end + 2;
      continue;
    }

    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      if (end < 0) throw xmlError(source, index, '"<!--…-->" comment is not closed');
      index = end + 3;
      continue;
    }

    if (source.startsWith('<!', index)) {
      const end = source.indexOf('>', index + 2);
      if (end < 0) throw xmlError(source, index, '"<!…>" declaration is not closed');
      index = end + 1;
      continue;
    }

    if (source.startsWith('</', index)) {
      const end = source.indexOf('>', index + 2);
      if (end < 0) throw xmlError(source, index, 'close tag has no ">"');
      const name = source.slice(index + 2, end).trim();
      const current = stack.pop();
      if (current === undefined) {
        throw xmlError(source, index, `close tag "</${name}>" with no open element`);
      }
      if (current.name !== name) {
        throw xmlError(source, index, `close tag "</${name}>" does not match "<${current.name}>"`);
      }
      const finished = finishElement(current);
      if (stack.length === 0) {
        if (root !== null) {
          throw xmlError(source, index, 'more than one root element');
        }
        root = finished;
      } else {
        top(stack).children.push(finished);
      }
      index = end + 1;
      continue;
    }

    // Open tag: <name attr="value" …> or <name …/>
    let cursor = index + 1;
    if (!/[A-Za-z_]/.test(source[cursor] ?? '')) {
      throw xmlError(source, index, 'an open tag must start with a letter');
    }

    let nameEnd = cursor;
    while (nameEnd < source.length && !/[\s/>]/.test(source[nameEnd] ?? '')) nameEnd += 1;
    const name = source.slice(cursor, nameEnd);
    if (!NAME_PATTERN.test(name)) {
      throw xmlError(source, index, `invalid element name "${name}"`);
    }
    cursor = nameEnd;

    const attributes: Record<string, string> = {};
    let selfClosing = false;

    for (;;) {
      cursor = skipWhitespace(source, cursor);
      const char = source[cursor];

      if (char === undefined) throw xmlError(source, index, `tag "<${name}>" is not closed`);
      if (char === '>') {
        cursor += 1;
        break;
      }
      if (char === '/') {
        if (source[cursor + 1] !== '>') {
          throw xmlError(source, cursor, `expected "/>" to close tag "<${name}>"`);
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
        throw xmlError(source, cursor, `invalid attribute name "${attributeName}"`);
      }
      if (Object.prototype.hasOwnProperty.call(attributes, attributeName)) {
        throw xmlError(source, cursor, `attribute "${attributeName}" is duplicated in "<${name}>"`);
      }

      cursor = skipWhitespace(source, attributeEnd);
      if (source[cursor] !== '=') {
        throw xmlError(source, cursor, `attribute "${attributeName}" is missing "="`);
      }
      cursor = skipWhitespace(source, cursor + 1);

      const quote = source[cursor];
      if (quote !== '"' && quote !== "'") {
        throw xmlError(source, cursor, `attribute value "${attributeName}" must be quoted`);
      }
      const valueStart = cursor + 1;
      const valueEnd = source.indexOf(quote, valueStart);
      if (valueEnd < 0) {
        throw xmlError(source, valueStart, `attribute value "${attributeName}" is not closed`);
      }

      attributes[attributeName] = decodeEntities(source, source.slice(valueStart, valueEnd), valueStart);
      cursor = valueEnd + 1;
    }

    const element: MutableElement = { name, attributes, children: [], text: '' };

    if (stack.length === 0) {
      if (root !== null) {
        throw xmlError(source, index, 'more than one root element');
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
    throw new Error(`Invalid XML: element "<${open.name}>" is never closed`);
  }
  if (root === null) {
    throw new Error('Invalid XML: no root element');
  }

  return root;
}

/** Direct text of `element`, trimmed (used for `<data>` CSV). */
export function elementText(element: XmlElement): string {
  return element.text.trim();
}

/** First direct child named `name`, or `null`. */
export function firstChild(element: XmlElement, name: string): XmlElement | null {
  for (const child of element.children) {
    if (child.name === name) return child;
  }
  return null;
}

/** Every direct child named `name`. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}
