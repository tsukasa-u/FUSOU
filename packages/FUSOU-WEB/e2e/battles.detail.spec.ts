import { expect, test } from "playwright/test";

test("direct detail URL does not keep the overview loading alert pending", async ({ page }) => {
  await page.goto(
    "/battles?source=r2&period_tag=2026-07-08&tab=detail&detail_id=019fb778-10d8-7000-b4d2-e6efb2fb015f&battle_index=3",
    { waitUntil: "domcontentloaded" },
  );

  await expect(page.getByRole("heading", { name: "戦闘詳細" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "1戦目" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/データ読込中\.\.\./)).toHaveCount(0);
  await expect(page.getByText("データ読込完了 (2件)")).toBeVisible();
});