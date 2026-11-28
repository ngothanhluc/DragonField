import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import {
  DASH_SPEC,
  TUNING,
  TUNING_SOURCE,
  parseTuning,
  type DashTuning,
} from "../../assets/scripts/core/enemies/tuning";
import type * as TuningSpec from "../../assets/scripts/core/enemies/tuning-spec";
import type { InferBlock } from "../../assets/scripts/core/enemies/tuning-spec";

/**
 * Acceptance for the declarative tuning spec: one spec per block, from which the type, the
 * parser, the zero value and the field list are derived generically. `dash` is the pilot block;
 * every other block keeps its hand-written form.
 */

const SCHEMA_PATH = new URL(
  "../../assets/scripts/core/enemies/tuning-schema.ts",
  import.meta.url,
);
const SPEC_PATH = new URL(
  "../../assets/scripts/core/enemies/tuning-spec.ts",
  import.meta.url,
);
const SPEC_META_PATH = new URL(
  "../../assets/scripts/core/enemies/tuning-spec.ts.meta",
  import.meta.url,
);
const ASSETS_DIR = new URL("../../assets/", import.meta.url);

type SpecModule = typeof TuningSpec;

let spec: SpecModule | undefined;

beforeAll(async () => {
  try {
    spec = await import("../../assets/scripts/core/enemies/tuning-spec");
  } catch {
    spec = undefined;
  }
});

function specModule(): SpecModule {
  expect(
    spec,
    "core/enemies/tuning-spec.ts must exist and export the generic spec API",
  ).toBeDefined();
  return spec as SpecModule;
}

function readText(url: URL): string {
  try {
    return readFileSync(url, "utf8");
  } catch {
    return "";
  }
}

/** Problem sink matching the `{ add(path, message) }` contract of `parseBlock`. */
function collector(): {
  problems: Array<[string, string]>;
  add(path: string, message: string): void;
} {
  const problems: Array<[string, string]> = [];
  return {
    problems,
    add(path: string, message: string) {
      problems.push([path, message]);
    },
  };
}

function cloneSource(): Record<string, unknown> {
  return structuredClone(TUNING_SOURCE) as Record<string, unknown>;
}

function parseError(mutate: (root: Record<string, unknown>) => void): string {
  const root = cloneSource();
  mutate(root);
  try {
    parseTuning(root);
  } catch (error) {
    return (error as Error).message;
  }
  return "<accepted>";
}

function dashOf(root: Record<string, unknown>): Record<string, unknown> {
  return root.dash as Record<string, unknown>;
}

const DASH_ORDER = [
  "bufferMs",
  "cooldownMs",
  "durationMs",
  "speedTilesPerSecond",
  "invulnerabilityMs",
];

describe("criterion 1 — generic spec API (no per-block code)", () => {
  it("blockFields lists the fields in declaration order", () => {
    const { blockFields, numberField } = specModule();
    const box = {
      alpha: numberField(),
      beta: numberField({ integer: true }),
      gamma: numberField({ positive: true }),
    };
    expect(blockFields(box)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("zeroBlock gives 0 for every number field", () => {
    const { zeroBlock, numberField } = specModule();
    const box = {
      alpha: numberField(),
      beta: numberField({ integer: true }),
      gamma: numberField({ positive: true }),
    };
    expect(zeroBlock(box)).toEqual({ alpha: 0, beta: 0, gamma: 0 });
  });

  it("parseBlock returns exactly the declared fields, in order, and drops unknown keys", () => {
    const { parseBlock, numberField } = specModule();
    const box = {
      alpha: numberField(),
      beta: numberField({ integer: true }),
      gamma: numberField({ positive: true }),
    };
    const sink = collector();
    const parsed = parseBlock(
      box,
      { box: { gamma: 0.25, extra: 9, alpha: 1.5, beta: 2 } },
      "box",
      "",
      sink,
    );
    expect(sink.problems).toEqual([]);
    expect(parsed).toEqual({ alpha: 1.5, beta: 2, gamma: 0.25 });
    expect(Object.keys(parsed)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("parseBlock reports field problems with the full nested path and the old messages", () => {
    const { parseBlock, numberField } = specModule();
    const box = {
      alpha: numberField(),
      beta: numberField({ integer: true }),
      gamma: numberField({ positive: true }),
    };
    const sink = collector();
    parseBlock(
      box,
      { box: { alpha: -1, beta: 2.5, gamma: 0 } },
      "box",
      "outer",
      sink,
    );
    expect(sink.problems).toEqual([
      ["outer.box.alpha", "must not be negative, got -1"],
      ["outer.box.beta", "must be an integer, got 2.5"],
      ["outer.box.gamma", "must be > 0, got 0"],
    ]);
  });

  it("parseBlock reports a missing field twice (missing + not a number), like readObject + readNumber", () => {
    const { parseBlock, numberField } = specModule();
    const box = {
      alpha: numberField(),
      beta: numberField({ integer: true }),
      gamma: numberField({ positive: true }),
    };
    const sink = collector();
    parseBlock(box, { box: { alpha: 1, beta: 2 } }, "box", "", sink);
    expect(sink.problems).toEqual([
      ["box.gamma", "missing field"],
      ["box.gamma", "must be a finite number, got undefined (missing field?)"],
    ]);
  });

  it("parseBlock reports a missing/non-object block and returns the zero value", () => {
    const { parseBlock, numberField } = specModule();
    const box = {
      alpha: numberField(),
      beta: numberField({ integer: true }),
      gamma: numberField({ positive: true }),
    };
    const sink = collector();
    const parsed = parseBlock(box, {}, "box", "", sink);
    expect(sink.problems).toEqual([
      [
        "box",
        "must be an object { alpha, beta, gamma }, got undefined (missing field?)",
      ],
    ]);
    expect(parsed).toEqual({ alpha: 0, beta: 0, gamma: 0 });
  });

  it("tuning-spec.ts holds no per-block code and does not import cc", () => {
    const source = readText(SPEC_PATH);
    expect(source, "tuning-spec.ts must exist").not.toBe("");
    expect(source).not.toMatch(/dash/i);
    expect(source).not.toMatch(/from\s+['"]cc['"]/);
  });

  it("tuning-spec.ts has a typescript .meta with a uuid no other asset uses", () => {
    const metaText = readText(SPEC_META_PATH);
    expect(metaText, "tuning-spec.ts.meta must exist").not.toBe("");
    const meta = JSON.parse(metaText) as { importer?: string; uuid?: string };
    expect(meta.importer).toBe("typescript");
    expect(meta.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const others = (readdirSync(ASSETS_DIR, { recursive: true }) as string[])
      .filter(
        (path) =>
          path.endsWith(".meta") && !path.endsWith("tuning-spec.ts.meta"),
      )
      .map((path) => readFileSync(new URL(path, ASSETS_DIR), "utf8"));
    expect(others.some((text) => text.includes(meta.uuid as string))).toBe(
      false,
    );
  });
});

describe("criterion 1 — pilot block `dash` is defined once", () => {
  it("DASH_SPEC drives the field list and zero value", () => {
    const { blockFields, zeroBlock } = specModule();
    expect(DASH_SPEC, "tuning-schema.ts must export DASH_SPEC").toBeDefined();
    expect(blockFields(DASH_SPEC)).toEqual(DASH_ORDER);
    expect(zeroBlock(DASH_SPEC)).toEqual({
      bufferMs: 0,
      cooldownMs: 0,
      durationMs: 0,
      speedTilesPerSecond: 0,
      invulnerabilityMs: 0,
    });
  });

  it("DashTuning is inferred from DASH_SPEC (tsc checks this)", () => {
    expectTypeOf<InferBlock<typeof DASH_SPEC>>().toEqualTypeOf<DashTuning>();
    expectTypeOf<DashTuning>().toEqualTypeOf<{
      readonly bufferMs: number;
      readonly cooldownMs: number;
      readonly durationMs: number;
      readonly speedTilesPerSecond: number;
      readonly invulnerabilityMs: number;
    }>();
  });

  it("tuning-schema.ts no longer hand-writes the dash interface, field list, zero or parser", () => {
    const schema = readText(SCHEMA_PATH);
    expect(schema).not.toMatch(/interface\s+DashTuning\b/);
    expect(schema).not.toMatch(/\bDASH_FIELDS\b/);
    expect(schema).not.toMatch(/function\s+zeroDash\b/);
    expect(schema).not.toMatch(/function\s+parseDash\b/);
    expect(schema).toMatch(
      /type\s+DashTuning\s*=\s*InferBlock<typeof DASH_SPEC>/,
    );
  });
});

describe("criterion 2 — the parser rejects the same invalid dash inputs as before", () => {
  const HEADER1 = "config/tuning.json is invalid (1 problem(s))\n  - ";
  const BLOCK_MESSAGE =
    "dash: must be an object { bufferMs, cooldownMs, durationMs, speedTilesPerSecond, invulnerabilityMs }, got ";

  it.each<[string, (root: Record<string, unknown>) => void, string]>([
    [
      "missing block",
      (root) => delete root.dash,
      `${HEADER1}${BLOCK_MESSAGE}undefined (missing field?)`,
    ],
    [
      "array block",
      (root) => (root.dash = []),
      `${HEADER1}${BLOCK_MESSAGE}array`,
    ],
    [
      "null block",
      (root) => (root.dash = null),
      `${HEADER1}${BLOCK_MESSAGE}null`,
    ],
    [
      "missing cooldownMs",
      (root) => delete dashOf(root).cooldownMs,
      "config/tuning.json is invalid (2 problem(s))\n  - dash.cooldownMs: missing field\n  - dash.cooldownMs: must be a finite number, got undefined (missing field?)",
    ],
    [
      "negative bufferMs",
      (root) => (dashOf(root).bufferMs = -1),
      `${HEADER1}dash.bufferMs: must not be negative, got -1`,
    ],
    [
      "fractional bufferMs",
      (root) => (dashOf(root).bufferMs = 1.5),
      `${HEADER1}dash.bufferMs: must be an integer, got 1.5`,
    ],
    [
      "zero cooldownMs",
      (root) => (dashOf(root).cooldownMs = 0),
      `${HEADER1}dash.cooldownMs: must be > 0, got 0`,
    ],
    [
      "zero durationMs",
      (root) => (dashOf(root).durationMs = 0),
      `${HEADER1}dash.durationMs: must be > 0, got 0`,
    ],
    [
      "fractional durationMs",
      (root) => (dashOf(root).durationMs = 1.5),
      `${HEADER1}dash.durationMs: must be an integer, got 1.5`,
    ],
    [
      "zero speed",
      (root) => (dashOf(root).speedTilesPerSecond = 0),
      `${HEADER1}dash.speedTilesPerSecond: must be > 0, got 0`,
    ],
    [
      "string speed",
      (root) => (dashOf(root).speedTilesPerSecond = "x"),
      `${HEADER1}dash.speedTilesPerSecond: must be a finite number, got "x"`,
    ],
    [
      "NaN invulnerability",
      (root) => (dashOf(root).invulnerabilityMs = Number.NaN),
      `${HEADER1}dash.invulnerabilityMs: must be a finite number, got NaN`,
    ],
    [
      "Infinity invulnerability",
      (root) => (dashOf(root).invulnerabilityMs = Infinity),
      `${HEADER1}dash.invulnerabilityMs: must be a finite number, got Infinity`,
    ],
    [
      "fractional invulnerability",
      (root) => (dashOf(root).invulnerabilityMs = 2.5),
      `${HEADER1}dash.invulnerabilityMs: must be an integer, got 2.5`,
    ],
    [
      "two problems keep field order",
      (root) => {
        dashOf(root).bufferMs = -1;
        dashOf(root).cooldownMs = 0;
      },
      "config/tuning.json is invalid (2 problem(s))\n  - dash.bufferMs: must not be negative, got -1\n  - dash.cooldownMs: must be > 0, got 0",
    ],
  ])("%s", (_name, mutate, expected) => {
    expect(parseError(mutate)).toBe(expected);
  });

  it("still accepts the same edge values (0 buffer/invulnerability, fractional speed, unknown keys)", () => {
    const root = cloneSource();
    Object.assign(dashOf(root), {
      bufferMs: 0,
      invulnerabilityMs: 0,
      speedTilesPerSecond: 14.5,
      extra: "ignored",
    });
    const parsed = parseTuning(root);
    expect(parsed.dash).toEqual({
      bufferMs: 0,
      cooldownMs: 1800,
      durationMs: 180,
      speedTilesPerSecond: 14.5,
      invulnerabilityMs: 0,
    });
    expect(Object.keys(parsed.dash)).toEqual(DASH_ORDER);
    expect(Object.isFrozen(parsed.dash)).toBe(true);
  });
});

describe("criterion 4 — other blocks untouched", () => {
  it("the parsed config still deep-equals the source JSON, with the same block order", () => {
    expect(TUNING).toEqual(TUNING_SOURCE);
    expect(Object.keys(TUNING)).toEqual(
      Object.keys(TUNING_SOURCE as Record<string, unknown>),
    );
    expect(TUNING.dash).toEqual({
      bufferMs: 150,
      cooldownMs: 1800,
      durationMs: 180,
      speedTilesPerSecond: 14,
      invulnerabilityMs: 220,
    });
  });

  it("problems from neighbouring blocks keep their messages and their order around dash", () => {
    const message = parseError((root) => {
      (root.navigation as Record<string, unknown>).stuckWindowMs = 0;
      dashOf(root).cooldownMs = 0;
      (root.activeSkill as Record<string, unknown>).bufferMs = 1.5;
    });
    expect(message).toBe(
      "config/tuning.json is invalid (3 problem(s))\n" +
        "  - navigation.stuckWindowMs: must be > 0, got 0\n" +
        "  - dash.cooldownMs: must be > 0, got 0\n" +
        "  - activeSkill.bufferMs: must be an integer, got 1.5",
    );
  });
});
