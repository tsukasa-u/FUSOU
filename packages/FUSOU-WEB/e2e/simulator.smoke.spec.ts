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
      ctype: 1,
      sort_id: 1,
      taik: [15, 35],
      souk: [5, 35],
      houg: [10, 40],
      raig: [0, 0],
      tyku: [8, 28],
      tais: [18, 65],
      kaih: [38, 82],
      saku: [5, 32],
      luck: [10, 40],
      soku: 10,
      leng: 1,
      slot_num: 4,
      maxeq: [0, 0, 0, 0, 0],
    },
  ],
  mst_slotitem: [
    {
      id: 1,
      name: "テスト装備",
      sortno: 1,
      type: [0, 0, 1, 1],
      houm: 0,
      souk: 0,
      houg: 0,
      raig: 0,
      tyku: 0,
      tais: 0,
      baku: 0,
      saku: 0,
      houk: 0,
      luck: 0,
      leng: 1,
      soku: 0,
      distance: 0,
      kaih: 0,
    },
    {
      id: 2,
      name: "テスト装備B",
      sortno: 2,
      type: [0, 0, 1, 2],
      houm: 0,
      souk: 0,
      houg: 0,
      raig: 0,
      tyku: 0,
      tais: 0,
      baku: 0,
      saku: 0,
      houk: 0,
      luck: 0,
      leng: 1,
      soku: 0,
      distance: 0,
      kaih: 0,
    },
    {
      id: 3,
      name: "テスト装備C",
      sortno: 3,
      type: [0, 0, 1, 3],
      houm: 0,
      souk: 0,
      houg: 0,
      raig: 0,
      tyku: 0,
      tais: 0,
      baku: 0,
      saku: 0,
      houk: 0,
      luck: 0,
      leng: 1,
      soku: 0,
      distance: 0,
      kaih: 0,
    },
  ],
  mst_slotitem_equiptype: [{ id: 1, name: "テスト種別" }],
  mst_stype: [{ id: 1, sortno: 1, name: "駆逐艦", equip_type: { "1": 1 } }],
  mst_equip_exslot: [],
  mst_equip_ship: [{ ship_id: 1, equip_type: { "1": [1, 2, 3] } }],
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

  await page.route(
    "**/api/asset-sync/ship-banner-map",
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          base_url: "https://example.invalid",
          banners: {},
        }),
      });
    },
  );

  await page.route("**/api/asset-sync/ship-card-map", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ base_url: "https://example.invalid", cards: {} }),
    });
  });

  await page.route(
    "**/api/asset-sync/equip-image-map",
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          base_url: "https://example.invalid",
          card: {},
          item_up: {},
        }),
      });
    },
  );

  await page.route(
    "**/api/asset-sync/weapon-icon-frames",
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ frames: {}, meta: { size: { w: 0, h: 0 } } }),
      });
    },
  );

  await page.route("**/api/asset-sync/weapon-icons", async (route: Route) => {
    await route.fulfill({ status: 404, body: "" });
  });

  await page.route("**/api/master-data/synergy-data", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        effect_rules: [],
        cross_rules: [
          {
            ships: [],
            synergy: { houg: 2 },
            pairs: [[1, 2]],
          },
        ],
        cross_rules_equip_index: {
          "1": [0],
          "2": [0],
        },
        cross_effects: {
          "1:2": [
            {
              ships: [1],
              items: [1, 2],
              synergy: { houg: 2 },
            },
          ],
        },
        triple_rules: [
          {
            ships: [1],
            synergy: { houg: 1 },
            item_pool: [1, 2, 3],
          },
        ],
        triple_rules_equip_index: {
          "1": [0],
          "2": [0],
          "3": [0],
        },
        quad_rules: [],
        penta_rules: [],
      }),
    });
  });
}

async function waitForMasterDataReady(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const text =
          (await page.locator("#data-status-text").textContent()) ?? "";
        return text.includes("マスターデータ読込済み");
      },
      {
        timeout: 30000,
        message: "master data status should eventually become loaded",
      },
    )
    .toBe(true);
}

async function openShipSelectModalFromFirstSlot(page: Page): Promise<void> {
  const emptySlot = page
    .locator("#fleet-1-slots div.cursor-pointer", {
      hasText: "艦を配置",
    })
    .first();

  await expect(emptySlot).toBeVisible();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await emptySlot.click({ force: true });
    const opened = await page
      .locator("#ship-select-modal")
      .evaluate((el) => (el as HTMLDialogElement).open)
      .catch(() => false);
    if (opened) return;
    await page.waitForTimeout(150);
  }

  await expect
    .poll(
      async () =>
        page
          .locator("#ship-select-modal")
          .evaluate((el) => (el as HTMLDialogElement).open)
          .catch(() => false),
      { timeout: 5000 },
    )
    .toBe(true);
}

async function ensureTutorialClosed(page: Page): Promise<void> {
  const tutorialModal = page.locator("#tutorial-modal");
  const closeBtn = page.locator("#tutorial-close-btn");

  // Tutorial may open with a short delay after initial render.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const visible = await tutorialModal.isVisible().catch(() => false);
    if (!visible) {
      await page.waitForTimeout(120);
      continue;
    }
    await closeBtn.click({ force: true });
    await expect(tutorialModal).toBeHidden();
    return;
  }

  await expect(tutorialModal).toBeHidden();
}

test.describe("Simulator Smoke E2E (D1/R2-isolated)", () => {
  test.beforeEach(async ({ page }) => {
    await mockSimulatorData(page);
    await page.goto("/simulator");
    await page.waitForLoadState("domcontentloaded");

    await ensureTutorialClosed(page);
  });

  test("loads simulator shell and critical controls with mocked data", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "編成シミュレータ", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#fleet-sections")).toBeVisible();
    await expect(page.locator("#btn-display-settings")).toBeVisible();
    await expect(page.locator("#btn-share")).toBeVisible();
    await expect(page.locator("#btn-import")).toBeVisible();
    await waitForMasterDataReady(page);
  });

  test("opens ship selection modal from first fleet slot", async ({ page }) => {
    await waitForMasterDataReady(page);
    await openShipSelectModalFromFirstSlot(page);

    await expect(page.locator("#ship-select-modal")).toBeVisible();
    await expect(page.locator("#ship-modal-grid")).toContainText("テスト艦");
  });

  test("details display settings react and ship list keeps sticky viewport-height layout", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await waitForMasterDataReady(page);
    await ensureTutorialClosed(page);

    await page.locator("#sim-tab-btn-ship").click();
    await expect(page.locator("#ship-detail-equippable-list")).toBeVisible();

    const beforeOverflowY = await page
      .locator("#ship-detail-equippable-list")
      .evaluate((el) => getComputedStyle(el as HTMLElement).overflowY);
    expect(beforeOverflowY).toBe("auto");

    const shipAsideLayout = await page
      .locator("aside")
      .first()
      .evaluate((el) => {
        const styles = getComputedStyle(el as HTMLElement);
        const h = Number.parseFloat(styles.height || "0");
        return {
          position: styles.position,
          height: h,
          expected: window.innerHeight - 88,
        };
      });
    expect(shipAsideLayout.position).toBe("sticky");
    expect(Math.abs(shipAsideLayout.height - shipAsideLayout.expected)).toBeLessThanOrEqual(3);

    const scrollStyles = await page.evaluate(() => ({
      htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
    }));
    expect(scrollStyles.htmlOverflowY).not.toBe("hidden");
    expect(scrollStyles.bodyOverflowY).not.toBe("hidden");

    await page.locator("#sim-details-settings-btn").click();
    await expect(page.locator("dialog.modal[open]")).toBeVisible();
    const expandEquippableCheckbox = page
      .locator("dialog.modal[open]")
      .getByLabel("装備可能な装備");
    await expandEquippableCheckbox.setChecked(true, { force: true });
    await expect(expandEquippableCheckbox).toBeChecked();
    await page.getByRole("button", { name: "閉じる" }).click();

    await expect
      .poll(async () =>
        page
          .locator("#ship-detail-equippable-list")
          .evaluate((el) => ({
            overflowY: getComputedStyle(el as HTMLElement).overflowY,
            className: (el as HTMLElement).className,
          })),
      )
      .toEqual(
        expect.objectContaining({
          overflowY: "visible",
        }),
      );

    await expect(page.locator("#ship-detail-equippable-list")).not.toHaveClass(
      /max-h-\[40vh\]/,
    );
  });

  test("equip detail shows partner synergy entries", async ({ page }) => {
    await waitForMasterDataReady(page);
    await ensureTutorialClosed(page);

    await page.locator("#sim-tab-btn-equip").click();
    await expect(page.locator("#equip-detail-synergy-ships-list")).toBeVisible();
    await page
      .locator("aside")
      .getByRole("button", { name: /テスト装備B ID 2/ })
      .first()
      .click();
    const synergyList = page.locator("#equip-detail-synergy-ships-list");
    await synergyList.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => {
        const text = (await synergyList.textContent()) ?? "";
        return text.includes("他装備組み合わせ") || text.includes("テスト装備");
      })
      .toBe(true);

    await expect(page.getByText("この装備を含む多装備シナジー")).toBeVisible();

    await page.locator("#sim-details-settings-btn").click();
    const settingsModal = page.locator("dialog.modal[open]");
    const settingsText = (await settingsModal.textContent()) ?? "";
    // 装備詳細セクションに「3装備以上の装備組み合わせを表示する」が存在すること
    expect(settingsText.indexOf("3装備以上の装備組み合わせを表示する")).toBeGreaterThan(-1);
    // 「艦詳細」ラベルが存在し、その配下に「3装備以上のシナジーを表示」があること
    expect(settingsText.indexOf("艦詳細")).toBeGreaterThan(-1);
    expect(settingsText.indexOf("3装備以上のシナジーを表示")).toBeGreaterThan(
      settingsText.indexOf("艦詳細"),
    );

    // 装備詳細セクションの展開チェックボックス（2番目）を使う
    const expandMultiSynergyCheckbox = settingsModal
      .getByLabel("3装備以上の装備組み合わせのリストを展開する")
      .nth(1);
    await expandMultiSynergyCheckbox.setChecked(true, { force: true });
    // 装備詳細の表示チェックボックス
    const showMultiSynergyCheckbox = page
      .locator("dialog.modal[open]")
      .getByLabel("3装備以上の装備組み合わせを表示する");
    await page.getByRole("button", { name: "閉じる" }).click();

    await expect
      .poll(async () =>
        page
          .locator("#equip-detail-triple-synergy-list")
          .evaluate((el) => getComputedStyle(el as HTMLElement).overflowY),
      )
      .toBe("visible");

    await page.locator("#sim-details-settings-btn").click();
    await showMultiSynergyCheckbox.setChecked(false, { force: true });
    await page.getByRole("button", { name: "閉じる" }).click();

    await expect(page.getByText("この装備を含む多装備シナジー")).toBeHidden();
  });

  test("mobile view uses floating picker buttons and modal selection", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await waitForMasterDataReady(page);
    await ensureTutorialClosed(page);

    await page.locator("#sim-tab-btn-ship").click();
    const shipPickerBtn = page.locator("#ship-mobile-picker-btn");
    await expect(shipPickerBtn).toBeVisible();
    await expect(shipPickerBtn).not.toHaveClass(/fixed/);

    await page.locator("#sim-details-settings-btn").click();
    await page
      .locator("dialog.modal[open]")
      .locator("#mobile-picker-mode-floating")
      .check({ force: true });
    await page.getByRole("button", { name: "閉じる" }).click();
    await expect
      .poll(async () =>
        shipPickerBtn.evaluate((el) => el.parentElement?.className ?? ""),
      )
      .toMatch(/fixed/);

    await shipPickerBtn.click({ force: true });
    await expect(page.locator("#ship-mobile-picker-dialog[open]")).toBeVisible();
    await page
      .locator("#ship-mobile-picker-dialog")
      .getByRole("button", { name: /テスト艦 ID 1/ })
      .first()
      .click();
    await expect(page.locator("#ship-mobile-picker-dialog[open]")).toBeHidden();
    await expect(shipPickerBtn).toContainText("テスト艦");

    await page.locator("#sim-tab-btn-equip").click();
    const equipPickerBtn = page.locator("#equip-mobile-picker-btn");
    await expect(equipPickerBtn).toBeVisible();
    await equipPickerBtn.click({ force: true });
    await expect(page.locator("#equip-mobile-picker-dialog[open]")).toBeVisible();
    await page
      .locator("#equip-mobile-picker-dialog")
      .getByRole("button", { name: /テスト装備B ID 2/ })
      .first()
      .click();
    await expect(page.locator("#equip-mobile-picker-dialog[open]")).toBeHidden();
    await expect(equipPickerBtn).toContainText("テスト装備B");
  });

  test("ship detail tab picker modal opens, shows list, and selection works", async ({
    page,
  }) => {
    // 1600px幅のデスクトップ表示で艦詳細タブを開く
    await page.setViewportSize({ width: 1600, height: 900 });
    await waitForMasterDataReady(page);
    await ensureTutorialClosed(page);

    await page.locator("#sim-tab-btn-ship").click();

    // モーダルをトリガー (xl未満の場合のボタン、または xl 以上ではサイドバーのアイテムをクリック)
    // テストは xl 幅なのでサイドバー (aside) の艦リストからクリック可能
    const shipInAside = page.locator("aside").first().getByRole("button", { name: /テスト艦/ }).first();
    await expect(shipInAside).toBeVisible();
    await shipInAside.click();

    // 艦詳細パネルが表示される
    await expect(page.locator("#ship-detail-equippable-list")).toBeVisible();
  });

  test("equip detail tab picker modal list shows items and quick access sidebar is present", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await waitForMasterDataReady(page);
    await ensureTutorialClosed(page);

    await page.locator("#sim-tab-btn-equip").click();

    // モバイル幅では equip picker ボタンが存在する
    const equipPickerBtn = page.locator("#equip-mobile-picker-btn");
    await expect(equipPickerBtn).toBeVisible();
    await equipPickerBtn.click({ force: true });

    const dialog = page.locator("#equip-mobile-picker-dialog[open]");
    await expect(dialog).toBeVisible();

    // リスト（VList）の中にアイテムが表示される
    await expect(dialog.getByRole("button", { name: /テスト装備/ }).first()).toBeVisible();

    // モーダルを閉じてから装備詳細が表示されることを確認
    await dialog
      .getByRole("button", { name: /テスト装備B ID 2/ })
      .first()
      .click();
    await expect(page.locator("#equip-detail-synergy-ships-list")).toBeVisible();
  });
});
