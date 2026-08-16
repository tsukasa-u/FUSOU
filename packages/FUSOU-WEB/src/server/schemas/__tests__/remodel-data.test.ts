import { describe, expect, it } from "vitest";
import {
  RemodelDataIngestBodySchema,
  RemodelChangedPeriodRowSchema,
  RemodelDetailArchiveRowSchema,
  RemodelPeriodTagRowSchema,
  RemodelSlotlistArchiveRowSchema,
  parseRemodelEffectiveSummaryRows,
  parseRemodelPeriodSummaryRows,
  RemodelMaxUpdatedAtRowSchema,
  ValidatedRemodelDataIngestBodySchema,
} from "../remodel-data";

const commonPayload = {
  dataset_id: "dataset-1",
  request_id: "request-1",
  payload_hash: "a".repeat(64),
  schema_version: 1,
  period_tag: "2026-07-08",
  timestamp_ms: 1,
};

const slotlistEntry = {
  remodel_id: 1,
  slotitem_master_id: 2,
  sp_type: 0,
  req_fuel: 1,
  req_bull: 2,
  req_steel: 3,
  req_bauxite: 4,
  req_buildkit: 5,
  req_remodelkit: 6,
  req_slot_id: 7,
  req_slot_num: 8,
  remodel_level: 0,
};

describe("RemodelMaxUpdatedAtRowSchema", () => {
  it("accepts a numeric aggregate and null for an empty table", () => {
    expect(
      RemodelMaxUpdatedAtRowSchema.safeParse({ max_updated_at_ms: 123 }).success,
    ).toBe(true);
    expect(
      RemodelMaxUpdatedAtRowSchema.safeParse({ max_updated_at_ms: null })
        .success,
    ).toBe(true);
  });

  it("rejects malformed aggregate values", () => {
    expect(
      RemodelMaxUpdatedAtRowSchema.safeParse({ max_updated_at_ms: "123" })
        .success,
    ).toBe(false);
    expect(RemodelMaxUpdatedAtRowSchema.safeParse(null).success).toBe(false);
  });
});

describe("remodel archive projection schemas", () => {
  it("accepts changed-period, period-tag, and typed archive rows", () => {
    expect(
      RemodelChangedPeriodRowSchema.safeParse({
        period_tag: "2026-07-08",
        max_updated_at_ms: 1_752_000_000_000,
      }).success,
    ).toBe(true);
    expect(
      RemodelPeriodTagRowSchema.safeParse({ period_tag: "2026-07-08" }).success,
    ).toBe(true);
    const slotlistResult = RemodelSlotlistArchiveRowSchema.safeParse({
      period_tag: "2026-07-08",
      secretary_ship_master_id: 1,
      weekday_jst: 0,
      remodel_id: 2,
      remodel_step_id: 2,
      remodel_level: 0,
      slotitem_master_id: 3,
      sp_type: 0,
      req_fuel: 1,
      req_bull: 2,
      req_steel: 3,
      req_bauxite: 4,
      req_buildkit: 5,
      req_remodelkit: 6,
      req_slot_id: 7,
      req_slot_num: 8,
      updated_at_ms: 9,
      future_column: "ignored",
    });
    expect(slotlistResult.success).toBe(true);
    if (slotlistResult.success) {
      expect(slotlistResult.data).not.toHaveProperty("future_column");
    }

    expect(
      RemodelDetailArchiveRowSchema.safeParse({
        period_tag: "2026-07-08",
        slotitem_master_id: 3,
        remodel_id: 2,
        remodel_step_id: 2,
        remodel_level: 0,
        certain_buildkit: 1,
        certain_remodelkit: 2,
        req_slot_id: null,
        req_slot_num: null,
        change_flag: 0,
        req_useitem_id: 10,
        req_useitem_id2: null,
        req_useitem_num: 1,
        req_useitem_num2: null,
        updated_at_ms: 9,
      }).success,
    ).toBe(true);
  });

  it("rejects malformed required projection fields", () => {
    expect(
      RemodelChangedPeriodRowSchema.safeParse({
        period_tag: "2026-07-08",
        max_updated_at_ms: "bad",
      }).success,
    ).toBe(false);
    expect(RemodelPeriodTagRowSchema.safeParse({ period_tag: "" }).success).toBe(
      false,
    );
    expect(RemodelSlotlistArchiveRowSchema.safeParse(null).success).toBe(false);
    expect(RemodelDetailArchiveRowSchema.safeParse(null).success).toBe(false);
  });
});

describe("remodel summary row parsers", () => {
  it("keeps valid period summary and effective summary rows", () => {
    expect(
      parseRemodelPeriodSummaryRows([
        { period_tag: "2026-07-08", row_count: 2, slotitem_count: 1 },
      ]),
    ).toHaveLength(1);
    expect(
      parseRemodelEffectiveSummaryRows([
        {
          period_tag: "2026-07-08",
          total_rows: 2,
          slotlist_rows: 1,
          recovered_from_detail_rows: 1,
          unresolved_fallback_rows: 0,
        },
      ]),
    ).toHaveLength(1);
  });

  it("drops malformed summary rows", () => {
    expect(
      parseRemodelPeriodSummaryRows([
        { period_tag: "2026-07-08", row_count: "2", slotitem_count: 1 },
      ]),
    ).toEqual([]);
    expect(
      parseRemodelEffectiveSummaryRows([
        { period_tag: "2026-07-08", total_rows: 1 },
      ]),
    ).toEqual([]);
  });
});

describe("RemodelDataIngestBodySchema", () => {
  it("accepts an object payload and preserves arbitrary fields", () => {
    const result = RemodelDataIngestBodySchema.safeParse({
      dataset_id: "dataset-1",
      event_type: "slotlist",
      entries: [],
      extra_field: true,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data["extra_field"]).toBe(true);
  });

  it("rejects null and array JSON roots", () => {
    expect(RemodelDataIngestBodySchema.safeParse(null).success).toBe(false);
    expect(RemodelDataIngestBodySchema.safeParse([]).success).toBe(false);
  });

  it("rejects non-JSON values at the raw boundary", () => {
    expect(
      RemodelDataIngestBodySchema.safeParse({ entries: [undefined] }).success,
    ).toBe(false);
    expect(
      RemodelDataIngestBodySchema.safeParse({ generated_at: new Date() })
        .success,
    ).toBe(false);
  });

  it("validates slotlist payloads and preserves typed entries", () => {
    const result = ValidatedRemodelDataIngestBodySchema.safeParse({
      ...commonPayload,
      event_type: " slotlist ",
      secretary_ship_master_id: 10,
      weekday_jst: 2,
      entries: [slotlistEntry],
      extra_field: true,
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.event_type === "slotlist") {
      expect(result.data.entries[0]?.req_fuel).toBe(1);
      expect(result.data["extra_field"]).toBe(true);
    }
  });

  it("validates detail payloads", () => {
    const result = ValidatedRemodelDataIngestBodySchema.safeParse({
      ...commonPayload,
      event_type: "detail",
      slotitem_master_id: 10,
      remodel_id: 11,
      remodel_level: 0,
      certain_buildkit: 1,
      certain_remodelkit: 2,
      change_flag: 0,
    });

    expect(result.success).toBe(true);
  });

  it("keeps indexed slotlist validation messages", () => {
    const result = ValidatedRemodelDataIngestBodySchema.safeParse({
      ...commonPayload,
      event_type: "slotlist",
      secretary_ship_master_id: 10,
      weekday_jst: 2,
      entries: [{ ...slotlistEntry, remodel_level: "1" }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "entries[0].remodel_level must be an integer or null",
      );
    }
  });

  it("keeps detail validation messages", () => {
    const result = ValidatedRemodelDataIngestBodySchema.safeParse({
      ...commonPayload,
      event_type: "detail",
      slotitem_master_id: 10,
      remodel_id: 11,
      remodel_level: 0,
      certain_buildkit: 1,
      certain_remodelkit: 2,
      change_flag: "0",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "change_flag must be an integer",
      );
    }
  });
});
