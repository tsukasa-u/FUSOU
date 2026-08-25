import { describe, expect, it } from "vitest";
import {
  LatestSokuSpeedPeriodRowSchema,
  SokuSpeedIngestBodySchema,
  ValidatedSokuSpeedIngestBodySchema,
  parseSokuSpeedObservationRows,
  SokuSpeedExslotSchema,
  SokuSpeedSlotRowsSchema,
  SokuSpeedUpgradeResponseSchema,
  parseSokuSpeedUpgradeResponse,
} from "../soku-speed";

describe("LatestSokuSpeedPeriodRowSchema", () => {
  it("accepts a complete latest-period row", () => {
    expect(
      LatestSokuSpeedPeriodRowSchema.safeParse({
        period_tag: "2026-07-08",
        table_version: "1.0",
      }).success,
    ).toBe(true);
  });

  it("rejects incomplete or malformed rows", () => {
    expect(
      LatestSokuSpeedPeriodRowSchema.safeParse({ period_tag: "2026-07-08" })
        .success,
    ).toBe(false);
    expect(
      LatestSokuSpeedPeriodRowSchema.safeParse({
        period_tag: 20260708,
        table_version: "1.0",
      }).success,
    ).toBe(false);
    expect(LatestSokuSpeedPeriodRowSchema.safeParse(null).success).toBe(false);
  });
});

describe("SokuSpeedUpgradeResponseSchema", () => {
  it("accepts a cached response and preserves valid zero item arrays", () => {
    const result = SokuSpeedUpgradeResponseSchema.safeParse({
      ok: true,
      period_tag: "2026-07-08",
      table_version: "1.0",
      data: { "1": [{ soku_observed: 5, item_ids: [10] }] },
    });

    expect(result.success).toBe(true);
    expect(
      parseSokuSpeedUpgradeResponse({
        ok: true,
        period_tag: null,
        table_version: null,
        data: {},
      })?.data,
    ).toEqual({});
  });

  it("rejects malformed cached response roots and mismatched period metadata", () => {
    expect(parseSokuSpeedUpgradeResponse({ ok: true, data: {} })).toBeNull();
    expect(
      parseSokuSpeedUpgradeResponse({
        ok: true,
        period_tag: "2026-07-08",
        table_version: null,
        data: {},
      }),
    ).toBeNull();
    expect(
      parseSokuSpeedUpgradeResponse({
        ok: true,
        period_tag: "2026-07-08",
        table_version: "1.0",
        data: { "1": [{ soku_observed: 0, item_ids: [0] }] },
      }),
    ).toBeNull();
    expect(
      parseSokuSpeedUpgradeResponse({
        ok: true,
        period_tag: "2026-07-08",
        table_version: "1.0",
        data: { "1": [{ soku_observed: 7, item_ids: [10] }] },
      }),
    ).toBeNull();
  });
});

describe("SokuSpeedIngestBodySchema", () => {
  it("accepts an object payload and preserves upload fields", () => {
    const result = SokuSpeedIngestBodySchema.safeParse({
      dataset_id: "dataset-1",
      request_id: "request-1",
      event_type: "snapshot",
      ships: [],
      content_hash: "hash",
      file_size: "100",
      extra_field: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.file_size).toBe(100);
      expect(result.data["extra_field"]).toBe(true);
    }
  });

  it("normalizes numeric file sizes and preserves string metadata", () => {
    const result = SokuSpeedIngestBodySchema.safeParse({
      dataset_id: " dataset-1 ",
      request_id: " request-1 ",
      file_size: "100",
      content_hash: " hash ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dataset_id).toBe("dataset-1");
      expect(result.data.file_size).toBe(100);
      expect(result.data.content_hash).toBe("hash");
    }
  });

  it("rejects null and array JSON roots", () => {
    expect(SokuSpeedIngestBodySchema.safeParse(null).success).toBe(false);
    expect(SokuSpeedIngestBodySchema.safeParse([]).success).toBe(false);
  });

  it("accepts a valid snapshot with equipment", () => {
    const result = ValidatedSokuSpeedIngestBodySchema.safeParse({
      dataset_id: "11111111-1111-4111-8111-111111111111",
      request_id: "request-1",
      payload_hash: "b".repeat(64),
      event_type: "snapshot",
      period_tag: "2026-01-01",
      table_version: "1.0",
      ships: [
        {
          master_id: 1,
          lv: 10,
          soku_observed: 5,
          slots: [{ slotitem_id: 2, locked: true, level: 0, alv: 0 }],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("preserves indexed ship validation messages", () => {
    const result = ValidatedSokuSpeedIngestBodySchema.safeParse({
      dataset_id: "11111111-1111-4111-8111-111111111111",
      request_id: "request-1",
      payload_hash: "b".repeat(64),
      event_type: "snapshot",
      period_tag: "2026-01-01",
      table_version: "1.0",
      ships: [{ master_id: "1" }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "ships[0] has invalid numeric fields",
      );
    }
  });
});

describe("soku-speed observation schemas", () => {
  it("accepts valid nested slot JSON and observation rows", () => {
    expect(
      SokuSpeedSlotRowsSchema.safeParse([{ slotitem_id: 2 }]).success,
    ).toBe(true);
    expect(SokuSpeedExslotSchema.safeParse(null).success).toBe(true);
    expect(
      parseSokuSpeedObservationRows([
        {
          master_id: 1,
          soku_observed: 5,
          slots_json: '[{"slotitem_id":2}]',
          exslot_json: "",
        },
      ]),
    ).toHaveLength(1);
  });

  it("drops malformed observation rows and rejects malformed slots", () => {
    expect(
      parseSokuSpeedObservationRows([
        { master_id: "1", soku_observed: 5, slots_json: "[]", exslot_json: "" },
        { master_id: 1, soku_observed: 5, slots_json: "[]", exslot_json: "" },
      ]),
    ).toHaveLength(1);
    expect(SokuSpeedSlotRowsSchema.safeParse([{ slotitem_id: "2" }]).success).toBe(
      false,
    );
  });
});
