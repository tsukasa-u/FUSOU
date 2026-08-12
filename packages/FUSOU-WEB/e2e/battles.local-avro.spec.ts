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
    const sourceToggle = page.getByRole("checkbox", { name: "データソース" });
    await expect(sourceToggle).toBeVisible();
    await expect(page.getByText(/データ読込完了/)).toBeVisible({ timeout: 30_000 });
    const requestCountBeforeSwitch = battleRequests.length;

    await sourceToggle.check();
    await expect(page).toHaveURL(/source=local-avro/);
    await expect(page.getByRole("heading", { name: "表示設定" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "戦闘データ" })).toBeVisible();
    await expect(page.getByText("ローカル AVRO データを選択してください")).toHaveCount(0);

    expect(battleRequests.slice(requestCountBeforeSwitch)).toEqual([]);
  });

  test("clears source-specific detail selection when switching source", async ({ page }) => {
    await page.goto(
      "/battles?source=r2&tab=detail&detail_id=019fb778-10d8-7000-b4d2-e6efb2fb015f&battle_index=4",
      { waitUntil: "domcontentloaded" },
    );

    const sourceToggle = page.getByRole("checkbox", { name: "データソース" });
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
    await expect(page.getByRole("checkbox", { name: "データソース" })).toBeChecked();
    await page.getByRole("button", { name: "閉じる" }).first().click();
    await expect(page.getByRole("heading", { name: "表示設定" })).toBeHidden();
    await expect(page.getByRole("checkbox", { name: "データソース" })).not.toBeChecked();
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
    await expect(page.getByText(/戦闘詳細の読込に失敗|指定された env_uuid/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "一覧" }).click();
    await expect(page.getByRole("heading", { name: "戦闘一覧" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/データ読込完了/)).toBeVisible({ timeout: 30_000 });
  });

  test("explains the file-list fallback when the directory picker is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto("/battles", { waitUntil: "domcontentloaded" });
    await page.getByRole("checkbox", { name: "データソース" }).check();

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

    await page.getByRole("checkbox", { name: "データソース" }).check();
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
    await expect(page.getByRole("checkbox", { name: "データソース" })).not.toBeChecked();
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
    await page.getByRole("checkbox", { name: "データソース" }).check();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "ディレクトリを選択" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(resolve(process.cwd(), "../FUSOU-DATABASE/fusou"));

    await expect(page.getByRole("heading", { name: "表示設定" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "戦闘一覧" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/データ読込完了/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/保持レコード [\d,]+件/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/索引を作成中/)).toHaveCount(0);
  });
});
