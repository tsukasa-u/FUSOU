import { expect, test, type Page, type Route } from "playwright/test";

type MasterTableResponse = {
  table_name: string;
  table_version: string;
  period_tag: string;
  count: number;
  records: unknown[];
};

const TABLE_VERSION = "test";
const PERIOD_TAG = "test-period";

const masterRecords: Record<string, unknown[]> = {
  mst_ship: [
    {
      id: 1,
      name: "テスト艦",
      stype: 1,
      slots: [0, 0, 0, 0, 0],
      sort_no: 1,
    },
  ],
  mst_slotitem: [
    {
      id: 1,
      name: "テスト装備",
      type: [0, 0, 0, 0],
      houg: 0,
      raig: 0,
      tyku: 0,
      tais: 0,
      baku: 0,
      saku: 0,
      luck: 0,
      leng: 1,
      rare: 1,
      kaih: 0,
    },
  ],
  mst_slotitem_equiptype: [{ id: 1, name: "小口径主砲" }],
  mst_stype: [{ id: 1, name: "駆逐艦" }],
  mst_equip_exslot: [],
  mst_equip_ship: [],
  mst_equip_exslot_ship: [],
  mst_equip_limit_exslot: [],
};

async function mockSimulatorData(page: Page): Promise<void> {
  await page.route("**/api/master-data/json?**", async (route: Route) => {
    const requestUrl = new URL(route.request().url());
    const tableName = requestUrl.searchParams.get("table_name") ?? "";
    const records = masterRecords[tableName] ?? [];

    const body: MasterTableResponse = {
      table_name: tableName,
      table_version: TABLE_VERSION,
      period_tag: PERIOD_TAG,
      count: records.length,
      records,
    };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.route("**/api/asset-sync/ship-banner-map", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ base_url: "https://example.invalid", banners: {} }),
    });
  });

  await page.route("**/api/asset-sync/ship-card-map", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ base_url: "https://example.invalid", cards: {} }),
    });
  });

  await page.route("**/api/asset-sync/equip-image-map", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        base_url: "https://example.invalid",
        card: {},
        item_up: {},
      }),
    });
  });

  await page.route("**/api/asset-sync/weapon-icon-frames", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ frames: {}, meta: { size: { w: 0, h: 0 } } }),
    });
  });

  await page.route("**/api/asset-sync/weapon-icons", async (route: Route) => {
    await route.fulfill({ status: 404, body: "" });
  });
}

test.describe("Simulator Smoke E2E (D1/R2-isolated)", () => {
  test.beforeEach(async ({ page }) => {
    await mockSimulatorData(page);
    await page.goto("/simulator");
    await page.waitForLoadState("domcontentloaded");
  });

  test("loads simulator shell and critical controls with mocked data", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "編成シミュレータ" })).toBeVisible();
    await expect(page.locator("#fleet-sections")).toBeVisible();
    await expect(page.locator("#btn-display-settings")).toBeVisible();
    await expect(page.locator("#btn-share")).toBeVisible();
    await expect(page.locator("#btn-import")).toBeVisible();

    await expect(page.locator("#data-status-text")).toContainText("マスターデータ読込済み");
  });

  test("opens ship selection modal from first fleet slot", async ({ page }) => {
    const emptySlot = page.locator("#fleet-1-slots div.cursor-pointer", {
      hasText: "艦を配置",
    }).first();

    await expect(emptySlot).toBeVisible();
    await emptySlot.click({ force: true });

    await expect(page.locator("#ship-select-modal")).toBeVisible();
    await expect(page.locator("#ship-modal-grid")).toContainText("テスト艦");
  });
});
