/**
 * Declarative field spec for one tuning block.
 *
 * A block used to be written four times — an interface, a field list, a zero factory and a
 * parser — so the copies could drift apart. One spec object now derives all four. Each field
 * kind is a descriptor here instead of another hand-written block, so a block with nested
 * blocks, per-stack tables or cross-field rules still has a single source.
 */

/** Problem sink, so this module does not depend on the schema's `ProblemList`. */
export interface ProblemSink {
  add(path: string, message: string): void;
}

export interface NumberFieldOptions {
  readonly integer?: boolean;
  readonly positive?: boolean;
  /** Inclusive lower bound, reported as `must be >= N, got X`. */
  readonly min?: number;
  /** Inclusive upper bound above the implied 0, reported as `must be within 0..N, got X`. */
  readonly max?: number;
}

export interface NumberField {
  readonly kind: 'number';
  readonly integer: boolean;
  readonly positive: boolean;
  readonly min?: number;
  readonly max?: number;
}

/** A `0..1` ratio: a value above 1 is reported, then clamped. */
export interface RatioField {
  readonly kind: 'ratio';
}

/** A signed integer within `[min, max]` (negative values are allowed). */
export interface SignedIntegerField {
  readonly kind: 'signedInteger';
  readonly min: number;
  readonly max: number;
}

export interface BooleanField {
  readonly kind: 'boolean';
}

export interface NumberTableFieldOptions {
  readonly length?: number;
  readonly positive?: boolean;
  readonly integer?: boolean;
  readonly max?: number;
}

/** An array of numbers with an exact length, one entry per skill stack. */
export interface NumberTableField {
  readonly kind: 'table';
  readonly length?: number;
  readonly positive: boolean;
  readonly integer: boolean;
  readonly max?: number;
}

/** A non-empty list of finite positive numbers; its length is the stack count. */
export interface NumberListField {
  readonly kind: 'list';
}

/** A spec nested inside another block, with an optional cross-field check. */
export interface BlockField<S extends BlockSpec = BlockSpec> {
  readonly kind: 'block';
  readonly spec: S;
  // Method syntax keeps the check bivariant, so a block descriptor with a concrete spec
  // stays assignable to the generic `FieldDescriptor` union.
  check?(block: InferBlock<S>, path: string, problems: ProblemSink): void;
}

export type BlockCheck<S extends BlockSpec> = (
  block: InferBlock<S>,
  path: string,
  problems: ProblemSink,
) => void;

export type FieldDescriptor =
  | NumberField
  | RatioField
  | SignedIntegerField
  | BooleanField
  | NumberTableField
  | NumberListField
  | BlockField;

/** One entry per field of a block: the key is the field name, the value its descriptor. */
export type BlockSpec = Record<string, FieldDescriptor>;

/** Value produced for one descriptor, so nested blocks infer their own shape. */
export type FieldValue<D> = D extends NumberField
  ? number
  : D extends RatioField
    ? number
    : D extends SignedIntegerField
      ? number
      : D extends BooleanField
        ? boolean
        : D extends NumberTableField | NumberListField
          ? readonly number[]
          : D extends BlockField<infer Nested extends BlockSpec>
            ? InferBlock<Nested>
            : never;

/** Readonly shape of a block, inferred from its spec. */
export type InferBlock<S extends BlockSpec> = {
  readonly [K in keyof S]: FieldValue<S[K]>;
};

/** Descriptor for one number field; options mean the same as in `readNumber`. */
export function numberField(options: NumberFieldOptions = {}): NumberField {
  return {
    kind: 'number',
    integer: options.integer === true,
    positive: options.positive === true,
    min: options.min,
    max: options.max,
  };
}

/** Descriptor for a `0..1` ratio field. */
export function ratioField(): RatioField {
  return { kind: 'ratio' };
}

/** Descriptor for a signed integer field within `[min, max]`. */
export function signedIntegerField(options: {
  readonly min: number;
  readonly max: number;
}): SignedIntegerField {
  return { kind: 'signedInteger', min: options.min, max: options.max };
}

/** Descriptor for a boolean field. */
export function booleanField(): BooleanField {
  return { kind: 'boolean' };
}

/** Descriptor for an exact-length array of numbers (one entry per stack). */
export function numberTableField(
  options: NumberTableFieldOptions = {},
): NumberTableField {
  return {
    kind: 'table',
    length: options.length,
    positive: options.positive === true,
    integer: options.integer === true,
    max: options.max,
  };
}

/** Descriptor for a non-empty list of positive numbers (any stack count). */
export function numberListField(): NumberListField {
  return { kind: 'list' };
}

/** Descriptor for a nested block; `check` sees the parsed block for cross-field rules. */
export function blockField<S extends BlockSpec>(
  spec: S,
  check?: BlockCheck<S>,
): BlockField<S> {
  return { kind: 'block', spec, check };
}

/** Field names in declaration order. */
export function blockFields<S extends BlockSpec>(
  spec: S,
): Array<keyof S & string> {
  return Object.keys(spec) as Array<keyof S & string>;
}

/** Safe value used when the block is missing or invalid (the parser throws anyway). */
export function zeroBlock<S extends BlockSpec>(spec: S): InferBlock<S> {
  const zero: Record<string, unknown> = {};
  for (const field of blockFields(spec)) {
    zero[field] = zeroField(spec[field] as FieldDescriptor);
  }
  return zero as InferBlock<S>;
}

function zeroField(descriptor: FieldDescriptor): unknown {
  switch (descriptor.kind) {
    case 'number':
    case 'ratio':
    case 'signedInteger':
      return 0;
    case 'boolean':
      return false;
    case 'table':
    case 'list':
      return [];
    case 'block':
      return zeroBlock(descriptor.spec);
  }
}

/**
 * Read one block with the shared object rules: report every problem, then build the block
 * from exactly the declared fields so unknown keys never reach the result.
 */
export function parseBlock<S extends BlockSpec>(
  spec: S,
  parent: Record<string, unknown>,
  key: string,
  parentPath: string,
  problems: ProblemSink,
  check?: BlockCheck<S>,
): InferBlock<S> {
  const fields = blockFields(spec);
  const source = readObject(parent, key, parentPath, problems, fields);
  if (source === undefined) return zeroBlock(spec);

  const blockPath = joinPath(parentPath, key);
  const values: Array<[string, unknown]> = [];
  for (const field of fields) {
    values.push([
      field,
      readField(spec[field] as FieldDescriptor, source, field, blockPath, problems),
    ]);
  }
  const block = Object.fromEntries(values) as InferBlock<S>;
  if (check !== undefined) check(block, blockPath, problems);
  return block;
}

/**
 * Read a record keyed by fixed ids, each entry one block (for `characters`). A missing record
 * reports once at the record path, like any other block.
 */
export function parseKeyedRecord<S extends BlockSpec, K extends string>(
  spec: S,
  keys: readonly K[],
  parent: Record<string, unknown>,
  key: string,
  parentPath: string,
  problems: ProblemSink,
): Record<K, InferBlock<S>> {
  const source = readObject(parent, key, parentPath, problems, keys);
  const recordPath = joinPath(parentPath, key);
  const result = {} as Record<K, InferBlock<S>>;
  for (const id of keys) {
    result[id] =
      source === undefined
        ? zeroBlock(spec)
        : parseBlock(spec, source, id, recordPath, problems);
  }
  return result;
}

function readField(
  descriptor: FieldDescriptor,
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemSink,
): unknown {
  switch (descriptor.kind) {
    case 'number':
      return readNumber(source, field, path, problems, descriptor) ?? 0;
    case 'ratio':
      return readRatio(source, field, path, problems);
    case 'signedInteger':
      return (
        readSignedInteger(
          source,
          field,
          path,
          problems,
          descriptor.min,
          descriptor.max,
        ) ?? 0
      );
    case 'boolean':
      return readBoolean(source, field, path, problems, false);
    case 'table':
      return readNumberArray(source, field, path, problems, descriptor);
    case 'list':
      return readNumberList(source, field, path, problems);
    case 'block':
      return parseBlock(
        descriptor.spec,
        source,
        field,
        path,
        problems,
        descriptor.check,
      );
  }
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
  options: NumberFieldOptions = {},
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
  if (options.min !== undefined && value < options.min) {
    problems.add(fieldPath, `must be >= ${options.min}, got ${value}`);
    return undefined;
  }
  if (options.max !== undefined && value > options.max) {
    problems.add(fieldPath, `must be within 0..${options.max}, got ${value}`);
    return undefined;
  }
  return value;
}

/** A `0..1` opacity/ratio: a value above 1 is reported and clamped (never silently > 1). */
export function readRatio(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemSink,
): number {
  const value = readNumber(source, field, path, problems);
  if (value === undefined) return 0;
  if (value > 1) {
    problems.add(joinPath(path, field), `must be within 0..1, got ${value}`);
    return 1;
  }
  return value;
}

/** Read a boolean field; missing/wrong type is reported with the expected type. */
export function readBoolean(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemSink,
  fallback: boolean,
): boolean {
  const value = source[field];
  if (typeof value === 'boolean') return value;
  problems.add(joinPath(path, field), `must be a boolean, got ${describe(value)}`);
  return fallback;
}

/** Read a signed integer within `[min, max]` (signed deltas like `maxHpDelta`). */
function readSignedInteger(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemSink,
  min: number,
  max: number,
): number | undefined {
  const value = source[field];
  const fieldPath = joinPath(path, field);

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.add(fieldPath, `must be a finite number, got ${describe(value)}`);
    return undefined;
  }
  if (!Number.isInteger(value)) {
    problems.add(fieldPath, `must be an integer, got ${value}`);
    return undefined;
  }
  if (value < min || value > max) {
    problems.add(fieldPath, `must be within ${min}..${max}, got ${value}`);
    return undefined;
  }
  return value;
}

/**
 * Read an array of non-negative finite numbers with an exact length (per-stack tables).
 * Returns `[]` on a shape error so callers keep a safe fallback.
 */
export function readNumberArray(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemSink,
  options: NumberTableFieldOptions = {},
): readonly number[] {
  const fieldPath = joinPath(path, field);
  const value = source[field];
  if (!Array.isArray(value)) {
    problems.add(fieldPath, `must be an array of numbers, got ${describe(value)}`);
    return [];
  }
  if (options.length !== undefined && value.length !== options.length) {
    problems.add(
      fieldPath,
      `must have exactly ${options.length} elements (one per stack), got ${value.length}`,
    );
    return [];
  }
  const result: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      problems.add(`${fieldPath}[${index}]`, `must be a finite number, got ${describe(entry)}`);
      continue;
    }
    if (entry < 0) {
      problems.add(`${fieldPath}[${index}]`, `must not be negative, got ${entry}`);
      continue;
    }
    if (options.positive === true && entry === 0) {
      problems.add(`${fieldPath}[${index}]`, `must be > 0, got ${entry}`);
      continue;
    }
    if (options.integer === true && !Number.isInteger(entry)) {
      problems.add(`${fieldPath}[${index}]`, `must be an integer, got ${entry}`);
      continue;
    }
    if (options.max !== undefined && entry > options.max) {
      problems.add(`${fieldPath}[${index}]`, `must be <= ${options.max}, got ${entry}`);
      continue;
    }
    result.push(entry);
  }
  return result;
}

/**
 * Read a non-empty array of finite, positive numbers (per-stack multipliers). The array's
 * length is the skill's stack count; the hooks clamp a stack past the end to the last entry.
 */
export function readNumberList(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemSink,
): readonly number[] {
  const fieldPath = joinPath(path, field);
  const value = source[field];
  if (!Array.isArray(value) || value.length === 0) {
    problems.add(fieldPath, `must be a non-empty array of numbers, got ${describe(value)}`);
    return [];
  }

  const result: number[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) {
      problems.add(`${fieldPath}[${index}]`, `must be a finite number > 0, got ${describe(entry)}`);
      result.push(0);
      return;
    }
    result.push(entry);
  });
  return result;
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
