/**
 * Declarative field spec for one tuning block.
 *
 * A block used to be written four times — an interface, a field list, a zero factory and a
 * parser — so the copies could drift apart. One spec object now derives all four. Only number
 * fields exist today; a new field kind becomes another descriptor here instead of another
 * hand-written block.
 */

/** Problem sink, so this module does not depend on the schema's `ProblemList`. */
export interface ProblemSink {
  add(path: string, message: string): void;
}

export interface NumberFieldOptions {
  readonly integer?: boolean;
  readonly positive?: boolean;
}

export interface NumberField {
  readonly kind: 'number';
  readonly integer: boolean;
  readonly positive: boolean;
}

/** One entry per field of a block: the key is the field name, the value its descriptor. */
export type BlockSpec = Record<string, NumberField>;

/** Descriptor for one number field; options mean the same as in `readNumber`. */
export function numberField(options: NumberFieldOptions = {}): NumberField {
  return {
    kind: 'number',
    integer: options.integer === true,
    positive: options.positive === true,
  };
}

/** Readonly shape of a block, inferred from its spec. */
export type InferBlock<S> = { readonly [K in keyof S]: number };

/** Field names in declaration order. */
export function blockFields<S extends BlockSpec>(
  spec: S,
): Array<keyof S & string> {
  return Object.keys(spec) as Array<keyof S & string>;
}

/** Safe value used when the block is missing or invalid (the parser throws anyway). */
export function zeroBlock<S extends BlockSpec>(spec: S): InferBlock<S> {
  const zero = Object.fromEntries(
    Object.keys(spec).map((field) => [field, 0]),
  ) as Record<string, number>;
  return zero as InferBlock<S>;
}

/**
 * Read one block with the shared object/number rules: report every problem, then build the
 * block from exactly the declared fields so unknown keys never reach the result.
 */
export function parseBlock<S extends BlockSpec>(
  spec: S,
  parent: Record<string, unknown>,
  key: string,
  parentPath: string,
  problems: ProblemSink,
): InferBlock<S> {
  const fields = blockFields(spec);
  const source = readObject(parent, key, parentPath, problems, fields);
  if (source === undefined) return zeroBlock(spec);

  const blockPath = joinPath(parentPath, key);
  const values: Array<[string, number]> = [];
  for (const field of fields) {
    const descriptor = spec[field];
    values.push([
      field,
      readNumber(source, field, blockPath, problems, descriptor) ?? 0,
    ]);
  }
  return Object.fromEntries(values) as InferBlock<S>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function describe(value: unknown): string {
  if (value === undefined) return 'undefined (missing field?)';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function joinPath(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}

/**
 * Read one number field; `options` decides the constraints. Returns `undefined` on error so
 * the caller can use a safe default (a bad config yields one clear error instead of
 * NaN leaking into combat).
 */
export function readNumber(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemSink,
  options: { readonly integer?: boolean; readonly positive?: boolean } = {},
): number | undefined {
  const value = source[field];
  const fieldPath = joinPath(path, field);

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.add(fieldPath, `must be a finite number, got ${describe(value)}`);
    return undefined;
  }
  if (value < 0) {
    problems.add(fieldPath, `must not be negative, got ${value}`);
    return undefined;
  }
  if (options.positive === true && value === 0) {
    problems.add(fieldPath, `must be > 0, got ${value}`);
    return undefined;
  }
  if (options.integer === true && !Number.isInteger(value)) {
    problems.add(fieldPath, `must be an integer, got ${value}`);
    return undefined;
  }
  return value;
}

/** Report exactly the missing field, plus the list of expected fields. */
export function readObject(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemSink,
  expected: readonly string[],
): Record<string, unknown> | undefined {
  const value = source[field];
  if (!isRecord(value)) {
    problems.add(
      joinPath(path, field),
      `must be an object { ${expected.join(', ')} }, got ${describe(value)}`,
    );
    return undefined;
  }

  for (const key of expected) {
    if (!(key in value))
      problems.add(joinPath(joinPath(path, field), key), 'missing field');
  }
  return value;
}
