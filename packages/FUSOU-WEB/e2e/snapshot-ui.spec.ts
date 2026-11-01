import { expect, test } from "playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("fusou:tutorial:seen:battles-index", "1");
    localStorage.setItem("fusou:tutorial:seen:ship-growth", "1");
  });
});

test("sortie tabs reuse a bundle when the requested table version is omitted", async ({ page }) => {
  let envRequests = 0;
  let detailRequests = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/battle-data/detail-env") {
      envRequests++;
      const battles = Object.fromEntries([0, 1, 2].map((index) => [String(index), {
        table_version: "0.5.0",
        battle: {
          index, env_uuid: "audit-sortie", maparea_id: 1, mapinfo_no: 1,
          cell_id: index + 1, timestamp: 1793000000000, formation: [1, 1],
          battle_result: { rank: "S" },
        },
        refs: { mst_ship: [], mst_slotitem: [] },
        derived: { friendly_fleet: [], enemy_fleet: [] },
      }]));
      await route.fulfill({ json: {
        success: true, env_uuid: "audit-sortie", period_tag: "2026-10-22",
        table_version: "0.5.0", battles,
      } });
    } else {
      if (url.pathname === "/api/battle-data/detail") detailRequests++;
      await route.fulfill({ json: {
        ok: true, success: true, records: [], battles: [], periods: [],
      } });
    }
  });
  await page.goto("/battles?source=r2&period_tag=2026-10-22&tab=detail&detail_id=audit-sortie&battle_index=0");
  const second = page.getByRole("button", { name: "2戦目", exact: true });
  await expect(second).toBeVisible({ timeout: 30_000 });
  await second.click();
  await expect(second).toHaveClass(/tab-active/);
  await page.getByRole("button", { name: "3戦目", exact: true }).click();
  await page.getByRole("button", { name: "1戦目", exact: true }).click();
  await expect(page.getByRole("button", { name: "1戦目", exact: true })).toHaveClass(/tab-active/);
  expect(envRequests).toBe(1);
  expect(detailRequests).toBe(0);
});

for (const selection of ["latest", "cumulative", "all-periods"]) {
test(`growth ${selection} refresh bypasses cache and exposes live bounds failures`, async ({ page }) => {
  let failBounds = false;
  let expRequests = 0;
  let boundsRequests = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/ship-growth/summary") {
      // Deliberately unsorted: latest must be chosen by value, not array order.
      await route.fulfill({ json: { ok: true, periods: [
        { period_tag: "2026-09-01", table_version: "0.5.0" },
        { period_tag: "2026-10-22", table_version: "0.5.0" },
      ] } });
    } else if (url.pathname === "/api/master-data/json") {
      await route.fulfill({ json: { records: [{ id: 1, name: "Audit ship", stype: 2 }] } });
    } else if (url.pathname === "/api/ship-growth/exp") {
      expRequests++;
      expect(url.searchParams.get("period_tag")).toBe("2026-10-22");
      await route.fulfill({ json: { ok: true, exp: [{ lv: 1, exp_current: 0 }] } });
    } else if (url.pathname === "/api/ship-growth/bounds") {
      boundsRequests++;
      await route.fulfill(failBounds
        ? { status: 503, json: { ok: false, error: "snapshot unavailable" } }
        : { json: { ok: true, bounds: [{
          master_id: 1, lv: 1, kaihi_naked: 10, taisen_naked: 0, sakuteki_naked: 5,
        }], caps: [{ master_id: 1, kaih_max: 20, tais_max: 0, saku_max: 10 }] } });
    } else if (url.pathname === "/api/ship-growth/cumulative") {
      await route.fulfill({ json: { ok: true, bounds: [], caps: [] } });
    } else if (url.pathname === "/api/ship-growth/all-periods") {
      await route.fulfill({ json: { ok: true, entries: [
        { period_tag: "2026-09-01", table_version: "0.5.0", bounds: [], caps: [] },
        { period_tag: "2026-10-22", table_version: "0.5.0", bounds: [], caps: [] },
      ] } });
    } else {
      await route.fulfill({ json: { ok: true, records: [] } });
    }
  });
  const query = selection === "cumulative" ? "?period_tag=all"
    : selection === "all-periods" ? "?all_periods=1" : "";
  await page.goto(`/ship-growth${query}`);
  await expect(page.locator("canvas")).toHaveCount(2, { timeout: 30_000 });
  if (selection === "all-periods") {
    await expect(page.getByText(/期間分の履歴/)).toContainText("全 2 期間中");
  }
  const refresh = page.getByRole("button", { name: "更新", exact: true });
  await refresh.click();
  await expect(refresh).toBeEnabled();
  expect(expRequests).toBe(2);
  expect(boundsRequests).toBe(2);
  failBounds = true;
  await refresh.click();
  await expect(page.getByText("データの読み込みに失敗しました", { exact: true })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(boundsRequests).toBe(3);
});
}
