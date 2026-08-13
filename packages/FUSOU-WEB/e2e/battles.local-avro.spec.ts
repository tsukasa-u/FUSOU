import { expect, test } from "playwright/test";
import { resolve } from "node:path";

declare global {
  interface Window {
    __localPickerCalls: number;
  }
}

test.describe("browser-local AVRO source", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("fusou:tutorial:seen:battles-index", "1");
    });
  });

  test("does not start battle API requests after switching to local", async ({ page }) => {
    const battleRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/api/battle-data/")) {
        battleRequests.push(`${request.method()} ${pathname}`);
      }
    });

    await page.goto("/battles", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/source=r2/);
    await expect(page.getByText(/データ読込完了/)).toHaveCount(0);
    await page.getByRole("button", { name: "データ設定" }).click();
    const dataSourceDialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "データ設定" }),
    });
    await expect(dataSourceDialog).toBeVisible();
    const sourceToggle = dataSourceDialog.getByRole("radio", { name: /ローカル AVRO/ });
    await expect(sourceToggle).toBeVisible();
    await dataSourceDialog.getByText("次回もこのデータソースを使う").click();
    const requestCountBeforeSwitch = battleRequests.length;

    await sourceToggle.check();
    await expect(page).toHaveURL(/source=local-avro/);
    await expect(page.getByRole("heading", { name: "表示設定" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "戦闘データ" })).toBeVisible();
    await expect(page.getByText("ローカル AVRO データを選択してください")).toHaveCount(0);

    expect(battleRequests.slice(requestCountBeforeSwitch)).toEqual([]);
  });

  test("restores a remembered source when the URL does not specify one", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("fusou:battles:preferred-source", "local-avro");
    });

    await page.goto("/battles", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/source=local-avro/);
    await expect(page.getByRole("heading", { name: "表示設定" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "戦闘データ" })).toBeVisible();
    const preferredSource = await page.evaluate(() => window.localStorage.getItem("fusou:battles:preferred-source"));
    expect(preferredSource).toBe("local-avro");
  });

  test("explicit URL source takes precedence over a remembered source", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("fusou:battles:preferred-source", "local-avro");
    });

    await page.goto("/battles?source=r2", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/source=r2/);
    await page.getByRole("button", { name: "データ設定" }).click();
    const dataSourceDialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "データ設定" }),
    });
    await expect(dataSourceDialog.getByRole("radio", { name: /ローカル AVRO/ })).not.toBeChecked();
  });

  test("groups period, map, and result filters in a modal", async ({ page }) => {
    await page.goto(
      "/battles?source=r2&period_tag=latest&map_filter=6-5&result_filter=S",
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", { name: "戦闘一覧" })).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByRole("button", { name: "フィルター" })).toBeVisible();
    await expect(page.locator("#battle-filter-settings-btn svg")).toBeVisible();
    await page.getByRole("button", { name: "フィルター" }).click();
    const filterDialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "フィルター" }),
    });
    await expect(filterDialog).toBeVisible();
    await expect(filterDialog.locator("#battle-filter-period")).toHaveValue("0");
    await expect(filterDialog.locator("#battle-filter-map")).toHaveValue("6-5");
    await expect(filterDialog.locator("#battle-filter-result")).toHaveValue("S");
  });

  test("clears source-specific detail selection when switching source", async ({ page }) => {
    await page.goto(
      "/battles?source=r2&tab=detail&detail_id=019fb778-10d8-7000-b4d2-e6efb2fb015f&battle_index=4",
      { waitUntil: "domcontentloaded" },
    );

    await page.getByRole("button", { name: "データ設定" }).click();
    const dataSourceDialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "データ設定" }),
    });
    const sourceToggle = dataSourceDialog.getByRole("radio", { name: /ローカル AVRO/ });
    await expect(sourceToggle).toBeVisible();
    await sourceToggle.check();
    await expect(page).toHaveURL(/source=local-avro/);

    const url = new URL(page.url());
    expect(url.searchParams.has("tab")).toBe(false);
    expect(url.searchParams.has("detail_id")).toBe(false);
    expect(url.searchParams.has("battle_index")).toBe(false);
  });

  test("renders the background UI and restores R2 after closing an unconfigured local modal", async ({ page }) => {
    await page.goto("/battles?source=local-avro", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/source=local-avro/);
    await expect(page.getByRole("heading", { name: "表示設定" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "戦闘データ" })).toBeVisible();
    await page.getByRole("button", { name: "閉じる" }).first().click();
    await expect(page.getByRole("heading", { name: "表示設定" })).toBeHidden();
    await expect(page).toHaveURL(/source=r2/);
  });

  test("can return to the local battle list after a detail lookup error", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto(
      "/battles?source=local-avro&period_tag=all&tab=detail&detail_id=019fb778-10d8-7000-b4d2-e6efb2fb015f&battle_index=99",
      { waitUntil: "domcontentloaded" },
    );
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "ディレクトリを選択" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(resolve(process.cwd(), "../FUSOU-DATABASE/fusou"));

    await expect(page.getByRole("heading", { name: "戦闘詳細" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("戦闘詳細の読込に失敗しました。詳細はデータ読込エラーを確認してください。", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "一覧" }).click();
    await expect(page.getByRole("heading", { name: "戦闘一覧" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/データ読込完了/)).toHaveCount(0);
  });

  test("explains the file-list fallback when the directory picker is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto("/battles", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "データ設定" }).click();
    const dataSourceDialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "データ設定" }),
    });
    await dataSourceDialog.getByRole("radio", { name: /ローカル AVRO/ }).check();

    await expect(
      page.getByText("このブラウザでは毎回ファイルを再選択する必要があります。"),
    ).toBeVisible();
  });

  test("does not request local file access before an explicit directory choice", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "__localPickerCalls", {
        configurable: true,
        writable: true,
        value: 0,
      });
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: async () => {
          window.__localPickerCalls += 1;
          throw new DOMException("Directory selection cancelled", "AbortError");
        },
      });
    });
    await page.goto("/battles", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "データ設定" }).click();
    const dataSourceDialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "データ設定" }),
    });
    await dataSourceDialog.getByRole("radio", { name: /ローカル AVRO/ }).check();
    await expect(page.getByRole("heading", { name: "表示設定" })).toBeVisible();
    await expect(page.getByText("権限: 許可が必要")).toBeVisible();
    expect(
      await page.evaluate(() => window.__localPickerCalls),
    ).toBe(0);

    await page.getByRole("button", { name: "ディレクトリを選択" }).click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__localPickerCalls),
      )
      .toBe(1);
    await page.getByRole("button", { name: "データ設定" }).click();
    const restoredSettingsDialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "データ設定" }),
    });
    await expect(restoredSettingsDialog.getByRole("radio", { name: "R2" }))
      .toBeChecked();
    await expect(page).toHaveURL(/source=r2/);
  });

  test("loads and renders a real local AVRO directory through the file-list fallback", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto("/battles", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "データ設定" }).click();
    const dataSourceDialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "データ設定" }),
    });
    await dataSourceDialog.getByRole("radio", { name: /ローカル AVRO/ }).check();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "ディレクトリを選択" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(resolve(process.cwd(), "../FUSOU-DATABASE/fusou"));

    await expect(page.getByRole("heading", { name: "表示設定" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "戦闘一覧" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/データ読込完了/)).toHaveCount(0);
    await page.getByRole("button", { name: "データ設定" }).click();
    const dataSettingsDialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "データ設定" }),
    });
    await expect(dataSettingsDialog).toBeVisible();
    await expect(dataSettingsDialog.getByText("ディレクトリ: 未設定")).toBeVisible();
    await dataSettingsDialog.getByRole("button", { name: "ディレクトリを変更" }).click();
    await expect(page.getByRole("heading", { name: "表示設定" })).toBeVisible();
    await expect(page.getByText(/保持レコード [\d,]+件/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/索引を作成中/)).toHaveCount(0);
  });

  test("orders latest 6-5 battles by cell traversal order", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto(
      "/battles?source=local-avro&period_tag=latest&view=phase&map_filter=6-5&tab=detail&detail_id=019fe88c-9c48-7002-b163-7f4d02d30b81&battle_index=0",
      { waitUntil: "domcontentloaded" },
    );
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "ディレクトリを選択" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(resolve(process.cwd(), "../FUSOU-DATABASE/fusou"));

    await expect(page.getByRole("button", { name: "1戦目" })).toBeVisible({
      timeout: 30_000,
    });
    const expectedBattleIndexes = ["3", "4", "2", "1", "0"];
    for (const [position, expectedBattleIndex] of expectedBattleIndexes.entries()) {
      const label = `${position + 1}戦目`;
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page).toHaveURL(
        new RegExp(`[?&]battle_index=${expectedBattleIndex}(?:&|$)`),
      );
    }
  });
});
