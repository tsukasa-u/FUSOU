import { describe, expect, it } from "vitest";
import { bufferDatabase } from "./sqlite-fixture";
import { bulkInsertActive, fetchHotRows, type InsertBufferLogParams } from "../src/db/turso-client";
import {
  claimCompaction, finishCompaction, markCompactionPublished,
  releaseCompaction, MAX_COMPACTION_INPUT_BYTES,
} from "../src/db/compaction-state";

const record = (data = new Uint8Array([1])): InsertBufferLogParams => ({
  dataset_id: "dataset", table_name: "battle", period_tag: "2026-10-28",
  table_version: "0.5", timestamp: 1, data,
});

describe("durable queue and compaction transactions", () => {
  it("does not reinsert a redelivered message, even after archiving its rows", async () => {
    const { client, database } = bufferDatabase();
    expect(await bulkInsertActive(client, [record(), record()], "message")).toEqual({ insertedCount: 2 });
    expect(await bulkInsertActive(client, [record(), record()], "message")).toEqual({ insertedCount: 0 });
    const claim = (await claimCompaction(client))!;
    await markCompactionPublished(client, claim);
    await finishCompaction(client, claim);
    expect(await bulkInsertActive(client, [record()], "message")).toEqual({ insertedCount: 0 });
    expect(database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_active").get()?.["n"]).toBe(0);
  });

  it("rolls back a partially inserted message and its receipt", async () => {
    const { client, database } = bufferDatabase();
    database.exec("CREATE TRIGGER reject_bad BEFORE INSERT ON buffer_logs_active WHEN NEW.table_name = 'bad' BEGIN SELECT RAISE(ABORT, 'bad row'); END");
    await expect(bulkInsertActive(client, [record(), { ...record(), table_name: "bad" }], "m")).rejects.toThrow();
    expect(database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_active").get()?.["n"]).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS n FROM workflow_queue_receipts").get()?.["n"]).toBe(0);
  });

  it("claims exclusively and resumes the same batch and cutoff after failure", async () => {
    const { client, database } = bufferDatabase();
    await bulkInsertActive(client, [record()], "first");
    const first = (await claimCompaction(client))!;
    await expect(claimCompaction(client)).rejects.toThrow("already owned");
    await bulkInsertActive(client, [record()], "second");
    await releaseCompaction(client, first);
    const retried = (await claimCompaction(client))!;
    expect(retried.runId).toBe(first.runId);
    expect(retried.cutoffId).toBe(first.cutoffId);
    await expect(finishCompaction(client, retried)).rejects.toThrow("unpublished");
    await markCompactionPublished(client, retried);
    await finishCompaction(client, retried);
    expect(database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_active").get()?.["n"]).toBe(1);
    expect((await claimCompaction(client))!.runId).not.toBe(first.runId);
  });

  it("bounds batches by blob bytes, leaves the remainder, and never swaps table names", async () => {
    const { client, database } = bufferDatabase();
    const blob = new Uint8Array(MAX_COMPACTION_INPUT_BYTES / 2);
    await bulkInsertActive(client, [record(blob), record(blob), record(blob)], "large");
    const claim = (await claimCompaction(client))!;
    expect(claim.cutoffId).toBe(2);
    expect(database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_active").get()?.["n"]).toBe(1);
    expect(database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_processing").get()?.["n"]).toBe(2);
    await markCompactionPublished(client, claim);
    await finishCompaction(client, claim);
    expect(database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_processing").get()?.["n"]).toBe(0);
  });

  it("preserves oversized legacy rows rather than deleting them", async () => {
    const { client, database } = bufferDatabase();
    await bulkInsertActive(client, [record(new Uint8Array(MAX_COMPACTION_INPUT_BYTES + 1))], "oversize");
    await expect(claimCompaction(client)).rejects.toThrow("exceeds");
    expect(database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_active").get()?.["n"]).toBe(1);
    expect(database.prepare("SELECT owner FROM workflow_compaction_state").get()?.["owner"]).toBeNull();
  });

  it("finds both version aliases in active and processing buffers", async () => {
    const { client, database } = bufferDatabase();
    await bulkInsertActive(client, [record()], "canonical");
    database.exec(`INSERT INTO buffer_logs_processing
      (dataset_id, table_name, period_tag, table_version, timestamp, data)
      VALUES ('dataset', 'battle', 'period', '0.5', 1, X'01')`);
    for (const table_version of ["0.5", "0.5.0"]) {
      expect(await fetchHotRows(client, { dataset_id: "dataset", table_name: "battle", table_version })).toHaveLength(2);
    }
  });
});
