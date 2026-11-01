import type { TursoClient } from "./turso-client";

export const MAX_COMPACTION_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_COMPACTION_ROWS = 100;
const COLUMNS = "id, dataset_id, table_name, period_tag, table_version, timestamp, data, uploaded_by, trust_tag, created_at";

export interface CompactionClaim {
  runId: string;
  owner: string;
  cutoffId: number;
  startedAt: number;
  published: boolean;
}

export class CompactionBusyError extends Error {
  constructor() {
    super("Compaction already owned; a crashed owner requires explicit recovery");
  }
}

export async function claimCompaction(client: TursoClient): Promise<CompactionClaim | null> {
  const tx = await client.transaction("write");
  try {
    const state = (await tx.execute("SELECT * FROM workflow_compaction_state WHERE id = 1")).rows[0];
    if (!state) throw new Error("Missing workflow durability migration");
    if (state["owner"]) throw new CompactionBusyError();
    const owner = crypto.randomUUID();
    let cutoffId = Number(state["cutoff_id"]);
    let runId = state["run_id"] ? String(state["run_id"]) : null;
    let startedAt = Number(state["started_at"]);
    if (!runId) {
      const processing = await tx.execute("SELECT id FROM buffer_logs_processing LIMIT 1");
      const source = processing.rows.length ? "buffer_logs_processing" : "buffer_logs_active";
      const candidates = await tx.execute(
        `SELECT id, length(data) AS bytes FROM ${source} ORDER BY id LIMIT ${MAX_COMPACTION_ROWS}`,
      );
      let totalBytes = 0;
      cutoffId = 0;
      for (const row of candidates.rows) {
        const bytes = Number(row["bytes"]);
        if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid buffer size");
        if (totalBytes + bytes > MAX_COMPACTION_INPUT_BYTES) break;
        totalBytes += bytes;
        cutoffId = Number(row["id"]);
      }
      if (!cutoffId) {
        if (candidates.rows.length) throw new Error("First buffer row exceeds compaction input limit");
        await tx.commit();
        return null;
      }
      if (source === "buffer_logs_active") {
        await tx.execute({
          sql: `INSERT INTO buffer_logs_processing (${COLUMNS})
            SELECT ${COLUMNS} FROM buffer_logs_active WHERE id <= ?`,
          args: [cutoffId],
        });
        await tx.execute({ sql: "DELETE FROM buffer_logs_active WHERE id <= ?", args: [cutoffId] });
      }
      runId = crypto.randomUUID();
      startedAt = Date.now();
    }
    await tx.execute({
      sql: `UPDATE workflow_compaction_state
        SET run_id = ?, owner = ?, cutoff_id = ?, started_at = ? WHERE id = 1`,
      args: [runId, owner, cutoffId, startedAt],
    });
    await tx.commit();
    return { runId, owner, cutoffId, startedAt, published: state["published"] === 1 };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

export async function markCompactionPublished(client: TursoClient, claim: CompactionClaim): Promise<void> {
  const result = await client.execute({
    sql: "UPDATE workflow_compaction_state SET published = 1 WHERE id = 1 AND owner = ? AND run_id = ?",
    args: [claim.owner, claim.runId],
  });
  if (result.rowsAffected !== 1) throw new Error("Compaction ownership lost");
}

export async function finishCompaction(client: TursoClient, claim: CompactionClaim): Promise<void> {
  const tx = await client.transaction("write");
  try {
    const owned = await tx.execute({
      sql: "SELECT id FROM workflow_compaction_state WHERE id = 1 AND owner = ? AND run_id = ? AND published = 1",
      args: [claim.owner, claim.runId],
    });
    if (!owned.rows.length) throw new Error("Cannot clean up an unpublished or unowned compaction");
    await tx.execute({ sql: "DELETE FROM buffer_logs_processing WHERE id <= ?", args: [claim.cutoffId] });
    await tx.execute("UPDATE workflow_compaction_state SET run_id = NULL, owner = NULL, cutoff_id = NULL, started_at = NULL, published = 0 WHERE id = 1");
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

export async function releaseCompaction(client: TursoClient, claim: CompactionClaim): Promise<void> {
  await client.execute({
    sql: "UPDATE workflow_compaction_state SET owner = NULL WHERE id = 1 AND owner = ? AND run_id = ?",
    args: [claim.owner, claim.runId],
  });
}
