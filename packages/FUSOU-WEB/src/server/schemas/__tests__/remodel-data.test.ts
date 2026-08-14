import { describe, expect, it } from "vitest";
import {
  RemodelDataIngestBodySchema,
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

describe("RemodelDataIngestBodySchema", () => {
  it("accepts an object payload and preserves arbitrary fields", () => {
    const result = RemodelDataIngestBodySchema.safeParse({
      dataset_id: "dataset-1",
      event_type: "slotlist",
      entries: [],
      extra_field: true,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.extra_field).toBe(true);
  });

  it("rejects null and array JSON roots", () => {
    expect(RemodelDataIngestBodySchema.safeParse(null).success).toBe(false);
    expect(RemodelDataIngestBodySchema.safeParse([]).success).toBe(false);
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
      expect(result.data.extra_field).toBe(true);
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
