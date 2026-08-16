import { describe, expect, it } from "vitest";
import { renderRaigekiRows } from "../render-helpers";

describe("battle render numeric semantics", () => {
  it("renders a valid zero-damage raigeki row", () => {
    const html = renderRaigekiRows(
      { f_dam: [0], f_now_hps: [0] },
      "雷撃",
      null,
    );
    expect(html).not.toContain("有効打なし");
    expect(html).toContain("0");
  });
});