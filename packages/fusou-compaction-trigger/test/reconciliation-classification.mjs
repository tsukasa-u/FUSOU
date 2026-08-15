import assert from "node:assert/strict";
import test from "node:test";
import {
  findMissingR2Rows,
  findOrphanR2Objects,
  sourceIdsRequiringD1Cleanup,
} from "../scripts/repair-d1-indexes-from-r2.mjs";

test("does not classify a ready D1 source object as an orphan R2 output", () => {
  const sourceKey = "0.4.0/2025-11-05/period/1766019600-1eb26956896e/battle-002.avro";
  const outputKey = "1.0.0/2026-08/daily/compaction-run/battle-001.avro";

  const orphanObjects = findOrphanR2Objects(
    [{ key: sourceKey }, { key: outputKey }],
    new Set([sourceKey]),
  );

  assert.deepEqual(orphanObjects.map((object) => object.key), [outputKey]);
});

test("does not classify consumed source archives as compaction outputs", () => {
  const archivedSourceKey = "compacted/0.4.0/2025-11-05/period/1766019600-1eb26956896e/battle-002.avro";

  assert.deepEqual(
    findOrphanR2Objects([{ key: archivedSourceKey }], new Set()),
    [],
  );
});

test("retries only active source rows after a partial cleanup", () => {
  assert.deepEqual(
    sourceIdsRequiringD1Cleanup([
      { sourceFileId: 12, sourceD1State: "deleted" },
      { sourceFileId: 13, sourceD1State: "active" },
      { sourceFileId: 13, sourceD1State: "active" },
    ]),
    [13],
  );
});

test("detects missing R2 objects for ready rows", () => {
  const missingRows = findMissingR2Rows(
    [
      { id: 1, file_path: "ready.avro", lifecycle_state: "ready" },
      { id: 2, file_path: "failed.avro", lifecycle_state: "failed" },
    ],
    new Set(),
  );

  assert.deepEqual(missingRows.map((row) => row.id), [1]);
});
