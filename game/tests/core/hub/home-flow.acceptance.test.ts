/**
 * #91 acceptance — Village Hub as home: streamlined Title, North Expedition Gate run launch,
 * Results → back to the Village, and the interactable registry extension point.
 *
 * Seam: pure `core/hub/home-flow.ts` (zero `cc`). `ScreenFlow`/`bootstrap` route through it; the
 * Cocos wiring itself (TiledMap, camera, Y-sort, roof fade, fades) is proven in the browser.
 *
 * The module is loaded dynamically so a missing module fails on an assertion, not on import.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  HUB_PROMPT_KEYS,
  buildHubInteractables,
  findNearestInteractable,
  parseHubTmx,
  type HubEntryOrigin,
  type HubInteractAction,
  type HubTriggerId,
} from "../../../assets/scripts/core/hub";
import { EN, VI } from "../../../assets/scripts/core/i18n";
import { moveWithCollision } from "../../../assets/scripts/core/movement/collision";

const HERE = dirname(fileURLToPath(import.meta.url));
const VILLAGE_TMX = join(
  HERE,
  "../../../assets/resources/data/levels/village/village-hub.tmx",
);

/** Runtime player body radius (`PLAYER_RADIUS_TILES` in `game/combat-loop.ts`). */
const PLAYER_RADIUS = 0.25;

type TitleMenuItemId = "enter-village" | "continue-run" | "settings";
type HomeScreenId =
  "title" | "settings" | "village" | "chapter-select" | "run" | "result";
type HomeFlowEvent =
  | { readonly kind: "title-select"; readonly item: TitleMenuItemId }
  | { readonly kind: "back" }
  | { readonly kind: "hub-interact"; readonly action: HubInteractAction }
  | {
      readonly kind: "start-run";
      readonly chapter: number;
      readonly ascension: number;
    }
  | { readonly kind: "run-ended"; readonly outcome: "victory" | "defeat" }
  | { readonly kind: "result-to-village" }
  | { readonly kind: "result-to-chapter-select" };

interface HomeFlowState {
  readonly screen: HomeScreenId;
  /** How the player last entered the village; `null` before the first entry. */
  readonly hubEntryOrigin: HubEntryOrigin | null;
}

interface HubInteractRegistry {
  register<K extends HubInteractAction["kind"]>(
    kind: K,
    handler: (action: Extract<HubInteractAction, { readonly kind: K }>) => void,
  ): () => void;
  dispatch(action: HubInteractAction): boolean;
  has(kind: HubInteractAction["kind"]): boolean;
}

interface HomeFlowModule {
  titleMenuItems(hasValidRunSave: boolean): readonly TitleMenuItemId[];
  initialHomeFlow(): HomeFlowState;
  stepHomeFlow(state: HomeFlowState, event: HomeFlowEvent): HomeFlowState;
  createHubInteractRegistry(): HubInteractRegistry;
  stepTriggerEntered(
    previous: HubTriggerId | null,
    current: HubTriggerId | null,
  ): HubTriggerId | null;
}

let homeFlow: HomeFlowModule | null = null;

beforeAll(async () => {
  try {
    homeFlow =
      (await import("../../../assets/scripts/core/hub/home-flow")) as unknown as HomeFlowModule;
  } catch {
    homeFlow = null;
  }
});

function lib(): HomeFlowModule {
  expect(
    homeFlow,
    "core/hub/home-flow.ts must exist and export the home flow API",
  ).not.toBeNull();
  if (homeFlow === null) throw new Error("unreachable");
  return homeFlow;
}

const GATE: HubInteractAction = {
  kind: "open-expedition",
  triggerId: "expedition-gate",
};

function run(events: readonly HomeFlowEvent[]): HomeFlowState {
  const { initialHomeFlow, stepHomeFlow } = lib();
  return events.reduce(
    (state, event) => stepHomeFlow(state, event),
    initialHomeFlow(),
  );
}

describe("#91 streamlined Title screen", () => {
  it("shows Vào Làng / Tiếp Tục Hành Trình (only with a valid run save) / Cài Đặt, in that order", () => {
    expect(lib().titleMenuItems(true)).toEqual([
      "enter-village",
      "continue-run",
      "settings",
    ]);
    expect(lib().titleMenuItems(false)).toEqual(["enter-village", "settings"]);
  });

  it("localizes the three Title buttons in vi (default) and en", () => {
    const vi = VI as Readonly<Record<string, string>>;
    const en = EN as Readonly<Record<string, string>>;
    expect(vi["title.enterVillage"]).toBe("Vào Làng");
    expect(vi["title.continueRun"]).toBe("Tiếp Tục Hành Trình");
    expect(vi["title.settings"]).toBe("Cài Đặt");
    expect(en["title.enterVillage"]).toBe("Enter Village");
    expect(en["title.continueRun"]).toBe("Continue Run");
    expect(en["title.settings"]).toBe("Settings");
  });

  it('localizes every hub [E] prompt and the Results "back to village" button in vi and en', () => {
    const vi = VI as Readonly<Record<string, string>>;
    const en = EN as Readonly<Record<string, string>>;
    for (const key of HUB_PROMPT_KEYS) {
      expect(vi[key], `vi ${key}`).toBeTruthy();
      expect(en[key], `en ${key}`).toBeTruthy();
    }
    expect(vi["hub.prompt.talk"]).toBe("Trò chuyện");
    expect(vi["result.villageBtn"]).toContain("Làng");
    expect(en["result.villageBtn"]).toMatch(/village/i);
  });
});

describe("#91 screen flow Title → Village → Run → Results → Village", () => {
  it("starts on the Title screen", () => {
    expect(lib().initialHomeFlow().screen).toBe("title");
  });

  it("runs the full loop and returns to the village after a death", () => {
    const states: HomeScreenId[] = [];
    const { initialHomeFlow, stepHomeFlow } = lib();
    let state = initialHomeFlow();
    const events: HomeFlowEvent[] = [
      { kind: "title-select", item: "enter-village" },
      { kind: "hub-interact", action: GATE },
      { kind: "start-run", chapter: 1, ascension: 0 },
      { kind: "run-ended", outcome: "defeat" },
      { kind: "result-to-village" },
    ];
    for (const event of events) {
      state = stepHomeFlow(state, event);
      states.push(state.screen);
    }
    expect(states).toEqual([
      "village",
      "chapter-select",
      "run",
      "result",
      "village",
    ]);
    expect(state.hubEntryOrigin).toBe("run-defeat");
  });

  it('enters the village from Title with origin "title" and returns with "run-victory" after a win', () => {
    expect(
      run([{ kind: "title-select", item: "enter-village" }]),
    ).toMatchObject({
      screen: "village",
      hubEntryOrigin: "title",
    });
    expect(
      run([
        { kind: "title-select", item: "enter-village" },
        { kind: "hub-interact", action: GATE },
        { kind: "start-run", chapter: 2, ascension: 1 },
        { kind: "run-ended", outcome: "victory" },
        { kind: "result-to-village" },
      ]),
    ).toMatchObject({ screen: "village", hubEntryOrigin: "run-victory" });
  });

  it("backs out of the gate Chapter Select into the village, not the Title", () => {
    expect(
      run([
        { kind: "title-select", item: "enter-village" },
        { kind: "hub-interact", action: GATE },
        { kind: "back" },
      ]).screen,
    ).toBe("village");
  });

  it("replays from Results via Chapter Select, whose Back also lands in the village", () => {
    const atResult: HomeFlowEvent[] = [
      { kind: "title-select", item: "enter-village" },
      { kind: "hub-interact", action: GATE },
      { kind: "start-run", chapter: 1, ascension: 0 },
      { kind: "run-ended", outcome: "defeat" },
    ];
    expect(
      run([...atResult, { kind: "result-to-chapter-select" }]).screen,
    ).toBe("chapter-select");
    expect(
      run([...atResult, { kind: "result-to-chapter-select" }, { kind: "back" }])
        .screen,
    ).toBe("village");
    expect(
      run([
        ...atResult,
        { kind: "result-to-chapter-select" },
        { kind: "start-run", chapter: 1, ascension: 0 },
      ]).screen,
    ).toBe("run");
  });

  it("Tiếp Tục Hành Trình jumps straight into the run; Cài Đặt opens Settings and Back returns to Title", () => {
    expect(run([{ kind: "title-select", item: "continue-run" }]).screen).toBe(
      "run",
    );
    expect(run([{ kind: "title-select", item: "settings" }]).screen).toBe(
      "settings",
    );
    expect(
      run([{ kind: "title-select", item: "settings" }, { kind: "back" }])
        .screen,
    ).toBe("title");
  });

  it("ignores events that are not valid on the current screen", () => {
    const { initialHomeFlow, stepHomeFlow } = lib();
    const title = initialHomeFlow();
    expect(
      stepHomeFlow(title, { kind: "run-ended", outcome: "defeat" }),
    ).toEqual(title);
    expect(stepHomeFlow(title, { kind: "hub-interact", action: GATE })).toEqual(
      title,
    );

    const village = run([{ kind: "title-select", item: "enter-village" }]);
    // A run only launches through the gate's Chapter Select.
    expect(
      stepHomeFlow(village, { kind: "start-run", chapter: 1, ascension: 0 }),
    ).toEqual(village);
    // Villager talk / shop / dojo are registry actions, not screen changes, in this ticket.
    expect(
      stepHomeFlow(village, {
        kind: "hub-interact",
        action: { kind: "talk-villager", npcId: "villager-1" },
      }),
    ).toEqual(village);
  });
});

describe("#91 North Expedition Gate on the real village-hub.tmx", () => {
  const map = parseHubTmx(readFileSync(VILLAGE_TMX, "utf8"), {
    source: "village-hub.tmx",
  });
  const interactables = buildHubInteractables(map);

  it("offers the gate [E] prompt within 2.0 tiles and none just beyond", () => {
    // Gate rect spans y 1.4–3.0 tiles; (18, 4.9) is 1.9 tiles below it, (18, 5.1) is 2.1.
    const near = findNearestInteractable({ x: 18, y: 4.9 }, interactables);
    expect(near?.action).toEqual(GATE);
    expect(near?.distanceTiles).toBeLessThanOrEqual(2.0);
    expect(
      findNearestInteractable({ x: 18, y: 5.1 }, interactables),
    ).toBeNull();
  });

  it("pressing [E] at the gate opens Chapter Select through the home flow", () => {
    const near = findNearestInteractable({ x: 18, y: 4.9 }, interactables);
    expect(near).not.toBeNull();
    const village = run([{ kind: "title-select", item: "enter-village" }]);
    expect(
      lib().stepHomeFlow(village, {
        kind: "hub-interact",
        action: near!.action,
      }).screen,
    ).toBe("chapter-select");
  });

  it("auto step-triggers fire once on entering a zone, not every frame while standing in it", () => {
    const { stepTriggerEntered } = lib();
    expect(stepTriggerEntered(null, "expedition-gate")).toBe("expedition-gate");
    expect(stepTriggerEntered("expedition-gate", "expedition-gate")).toBeNull();
    expect(stepTriggerEntered("expedition-gate", null)).toBeNull();
    expect(stepTriggerEntered(null, null)).toBeNull();
    expect(stepTriggerEntered("shop-entrance", "expedition-gate")).toBe(
      "expedition-gate",
    );
  });

  it("blocks the runtime player body against solid props via collisionLevel", () => {
    const props = map.obstacles.filter((o) => o.kind === "prop");
    expect(props.length).toBeGreaterThan(0);
    let blocked = 0;
    for (const prop of props) {
      const start = { x: prop.x - 1, y: prop.y + prop.height / 2 };
      const end = moveWithCollision(
        start,
        { x: 3, y: 0 },
        PLAYER_RADIUS,
        map.collisionLevel,
        0,
      );
      if (end.x <= prop.x - PLAYER_RADIUS + 1e-6) blocked += 1;
      // Never ends inside the prop.
      const inside =
        end.x > prop.x &&
        end.x < prop.x + prop.width &&
        end.y > prop.y &&
        end.y < prop.y + prop.height;
      expect(inside, `ended inside prop at (${prop.x}, ${prop.y})`).toBe(false);
    }
    expect(blocked).toBeGreaterThan(0);
  });
});

describe("#91 interactable registry (extension point for villagers, shop interior, dojo)", () => {
  it("dispatches an action to its registered handler and reports unhandled kinds", () => {
    const registry = lib().createHubInteractRegistry();
    expect(registry.has("open-expedition")).toBe(false);
    expect(registry.dispatch(GATE)).toBe(false);

    const seen: HubInteractAction[] = [];
    const unregister = registry.register("open-expedition", (action) =>
      seen.push(action),
    );
    expect(registry.has("open-expedition")).toBe(true);
    expect(registry.dispatch(GATE)).toBe(true);
    expect(seen).toEqual([GATE]);

    expect(
      registry.dispatch({ kind: "talk-villager", npcId: "villager-2" }),
    ).toBe(false);

    unregister();
    expect(registry.has("open-expedition")).toBe(false);
    expect(registry.dispatch(GATE)).toBe(false);
    expect(seen).toHaveLength(1);
  });

  it("refuses a second handler for the same kind so tickets cannot silently override each other", () => {
    const registry = lib().createHubInteractRegistry();
    registry.register("enter-shop", () => undefined);
    expect(() => registry.register("enter-shop", () => undefined)).toThrow();
  });
});
