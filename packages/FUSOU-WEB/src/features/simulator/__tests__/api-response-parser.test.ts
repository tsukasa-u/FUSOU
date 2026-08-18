import { describe, expect, it } from "vitest";
import {
  convertGetDataToMasterData,
  convertPortToSnapshot,
  convertRequireInfoToSnapshot,
} from "../api-response-parser";

describe("simulator API response parser", () => {
  it("normalizes numeric-string port fields and ignores malformed rows", () => {
    const result = convertPortToSnapshot({
      api_data: {
        api_ship: [
          {
            api_id: "101",
            api_ship_id: "1",
            api_lv: "99",
            api_slot: ["201"],
            api_onslot: ["18"],
          },
          { api_id: 0, api_ship_id: 2, api_lv: 1 },
          { api_id: 102, api_ship_id: 2 },
          {
            api_id: 103,
            api_ship_id: 3,
            api_lv: 1,
            api_karyoku: ["invalid"],
          },
          "malformed",
        ],
        api_deck_port: [
          { api_id: "1", api_name: "First", api_ship: ["101"] },
          null,
        ],
        api_combined_flag: "1",
      },
    });

    expect(result.s3s).toHaveLength(1);
    expect(result.s3s[0]).toMatchObject({ i0d: 101, s5d: 1, l0v: 99 });
    expect(result.d8k).toEqual([{ i0d: 1, n2e: "First", s3s: [101] }]);
    expect(result.combinedFlag).toBe(1);
  });

  it("preserves missing stats separately from valid zero stats", () => {
    const result = convertPortToSnapshot({
      api_data: {
        api_ship: [
          {
            api_id: 101,
            api_ship_id: 1,
            api_lv: 1,
            api_karyoku: [0],
            api_raisou: [],
          },
        ],
        api_deck_port: [],
      },
    });

    expect(result.s3s[0]).toMatchObject({ k5u: 0, r4u: null });
  });

  it("normalizes require_info records before snapshot conversion", () => {
    expect(
      convertRequireInfoToSnapshot({
        api_data: {
          api_slot_item: [
            {
              api_id: "201",
              api_slotitem_id: "301",
              api_level: "7",
              api_alv: "3",
            },
            { api_id: 202, api_slotitem_id: 0, api_level: 0 },
            { api_id: 203, api_slotitem_id: 302 },
            false,
          ],
        },
      }),
    ).toEqual({ s8s: [{ i0d: 201, s9d: 301, l3l: 7, a1v: 3 }] });
  });

  it("filters malformed master records and preserves equipment type conversion", () => {
    const result = convertGetDataToMasterData({
      api_data: {
        api_mst_ship: [{ api_id: 1, api_name: "Ship", api_stype: 2, api_ctype: 3 }, null],
        api_mst_slotitem: [
          {
            api_id: 10,
            api_name: "Interceptor",
            api_type: [0, 0, "48"],
            api_houm: 5,
            api_houk: 7,
          },
          { api_id: 0, api_name: "Invalid", api_type: [1] },
          "malformed",
        ],
      },
    });

    expect(result["mst_ships"]).toEqual([
      expect.objectContaining({ id: 1, name: "Ship" }),
    ]);
    expect(result["mst_slot_items"]).toEqual([
      expect.objectContaining({ id: 10, type: [0, 0, 48], houm: 0, houk: 0, geigeki: 7, taibaku: 5 }),
    ]);
  });
});
