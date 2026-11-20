import { describe, expect, it } from "vitest";
import { inferRouteOverlays } from "../../components/features/map-flow/solid/battle-map-flow/routeInference";
import { PHASE_NAMES } from "../../features/battles/constants";
import { buildTimelineEvents } from "../../features/battles/timeline";
import {
  getStorybookBattleScenario,
  getStorybookPageApiResponse,
  getStorybookRecords,
  STORYBOOK_SAMPLE_PERIOD,
  STORYBOOK_SAMPLE_SORTIE_ID,
} from "../storybook-page-fixtures";

function response(
  pathname: string,
  query = "",
  scenario: "populated" | "empty" | "error" = "populated",
) {
  return getStorybookPageApiResponse(
    pathname,
    new URLSearchParams(query),
    "GET",
    scenario,
  );
}

describe("Storybook page API fixtures", () => {
  it("uses the battle summary resolver shape for the populated overview", () => {
    const result = response("/api/battle-data/global/overview");
    const body = result?.body as {
      battles: Record<string, unknown>[];
      enemy_decks: Array<{ uuid: string }>;
      enemy_ships: Array<{ mst_ship_id: number }>;
    };

    expect(result?.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      period_tag: STORYBOOK_SAMPLE_PERIOD.period_tag,
      table_version: STORYBOOK_SAMPLE_PERIOD.table_version,
    });
    expect(body.battles).toHaveLength(2);
    expect(body.battles[0]).toMatchObject({
      uuid: "storybook-battle-001",
      maparea_id: 1,
      mapinfo_no: 1,
      battle_result: {
        win_rank: "S",
        drop_ship_id: 9,
        drop_ship_name: "吹雪",
      },
      enemy_summary: "駆逐イ級 / 駆逐ロ級 / 軽巡ホ級",
    });
    expect(body.battles[1]).toMatchObject({
      uuid: "storybook-battle-002",
      battle_result: {
        win_rank: "A",
        drop_ship_id: 12,
        drop_ship_name: "磯波",
      },
    });
    expect(body.enemy_decks.map(({ uuid }) => uuid)).toEqual([
      "storybook-enemy-deck-001",
      "storybook-enemy-deck-002",
    ]);
    expect(body.enemy_ships.map(({ mst_ship_id }) => mst_ship_id)).toEqual([
      1501,
      1502,
      1505,
      1502,
      1505,
      1509,
    ]);
  });

  it("resolves drops and sortie details through the production data resolvers", () => {
    const drops = response("/api/battle-data/global/drops");
    const detailEnv = response(
      "/api/battle-data/detail-env",
      `env_uuid=${STORYBOOK_SAMPLE_SORTIE_ID}`,
    );

    expect(drops?.body).toMatchObject({
      success: true,
      battles: [
        {
          battle_result: { win_rank: "S", drop_ship_id: 9 },
        },
        {
          battle_result: { win_rank: "A", drop_ship_id: 12 },
        },
      ],
      mst_ships: [{ id: 9 }, { id: 12 }],
    });

    const battles = (detailEnv?.body as {
      battles: Record<string, {
        battle: Record<string, unknown> | null;
        derived?: {
          friendly_fleet?: Record<string, unknown>[];
          enemy_fleet?: Record<string, unknown>[];
        };
      }>;
    }).battles;
    expect(battles["0"]?.battle).toMatchObject({
      env_uuid: STORYBOOK_SAMPLE_SORTIE_ID,
      index: 0,
      hougeki: [
        {
          at: 0,
          df: [0],
          damage: [13],
        },
      ],
      opening_air_attack: [
        {
          e_damages: [7, 0],
        },
      ],
    });
    const friendlyFleet = battles["0"]?.derived?.friendly_fleet;
    expect(friendlyFleet).toHaveLength(6);
    expect(friendlyFleet?.map((ship) => ship["name"])).toEqual([
      "赤城",
      "金剛",
      "夕立改二",
      "時雨改二",
      "綾波",
      "雪風",
    ]);
    expect(friendlyFleet?.[0]).toMatchObject({
      name: "赤城",
      shipId: 83,
      level: 99,
      nowhp: 48,
      maxhp: 79,
      equipments: expect.arrayContaining([
        expect.objectContaining({ slotItemId: 16, name: "九七式艦攻" }),
        expect.objectContaining({ slotItemId: 24, name: "彗星" }),
      ]),
    });
    expect(friendlyFleet?.[1]).toMatchObject({
      name: "金剛",
      shipId: 78,
      level: 99,
      equipments: expect.arrayContaining([
        expect.objectContaining({ slotItemId: 2, name: "12.7cm連装砲" }),
        expect.objectContaining({ slotItemId: 27, name: "13号対空電探" }),
      ]),
    });
    const enemyFleet = battles["0"]?.derived?.enemy_fleet;
    expect(enemyFleet).toHaveLength(3);
    expect(enemyFleet?.[0]).toMatchObject({
      name: "駆逐イ級",
      shipId: 1501,
    });
    expect(enemyFleet?.[1]).toMatchObject({
      name: "駆逐ロ級",
      shipId: 1502,
    });
    expect(friendlyFleet?.[0]?.["bannerUrl"]).toContain(
      "/api/asset-sync/ship-banner/83",
    );
    expect(enemyFleet?.[0]?.["bannerUrl"]).toContain(
      "/api/asset-sync/ship-banner/1501",
    );
  });

  it("covers every canonical battle phase with linked resolver data and timeline events", () => {
    const scenarioNames = ["air-operations", "night-battle"] as const;
    const emittedPhases = new Set<string>();

    for (const scenarioName of scenarioNames) {
      const detail = getStorybookBattleScenario(scenarioName);
      expect(detail.battle).not.toBeNull();
      expect(detail.derived?.friendly_fleet).toHaveLength(6);
      expect(detail.derived?.enemy_fleet).toHaveLength(6);

      const events = buildTimelineEvents(detail.battle ?? {}, null).filter(
        (event) => event.type !== "separator",
      );
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) emittedPhases.add(event.phase);
    }

    expect([...emittedPhases]).toEqual(
      expect.arrayContaining(Object.values(PHASE_NAMES)),
    );
  });

  it("keeps both battle branches on connected 1-1 route cells", () => {
    const battleCells = getStorybookRecords("battle").map(
      (battle) => battle["cell_id"],
    );
    const cells = getStorybookRecords("cells");

    expect(battleCells).toEqual([2, 3]);
    expect(cells.map((cell) => cell["cell_index"])).toEqual([
      [1, 2],
      [1, 3],
    ]);
  });

  it("preserves mapped route curves and endpoints in the overlay", () => {
    const [route] = inferRouteOverlays(
      [
        { cellId: 1, x: 0, y: 0 },
        { cellId: 2, x: 100, y: 50 },
      ],
      undefined,
      [{ from: 1, to: 2, count: 3 }],
      [
        {
          routeId: 7,
          from: 1,
          to: 2,
          startX: 10,
          startY: 5,
          ctrlX: 50,
          ctrlY: -20,
          endX: 90,
          endY: 40,
          curvature: 0.5,
        },
      ],
    );

    expect(route).toMatchObject({
      fromCellId: 1,
      toCellId: 2,
      renderFromX: 10,
      renderFromY: 5,
      renderToX: 90,
      renderToY: 40,
      ctrlX: 50,
      ctrlY: -20,
      pathD: "M 10 5 Q 50 -20 90 40",
      observedCount: 3,
    });
  });

  it("keeps empty and request-error scenarios distinct from populated data", () => {
    const empty = response("/api/battle-data/global/overview", "", "empty");
    const failed = response("/api/battle-data/global/overview", "", "error");

    expect(empty?.body).toMatchObject({
      success: true,
      battles: [],
      cells: [],
      enemy_decks: [],
      enemy_ships: [],
    });
    expect(failed?.status).toBe(503);
  });
});
