import assert from "node:assert/strict";
import {
  FingerprintVersionMapSchema,
  QueueMessageSchema,
  R2KeysSchema,
} from "../dist/FUSOU-WORKFLOW/src/schemas.js";

const snakeCaseUpload = QueueMessageSchema.safeParse({
  table: "battle",
  avro_base64: "T2JqAQ==",
  dataset_id: "dataset-1",
  period_tag: "2026-08",
  table_version: "0.4.0",
});

assert.equal(snakeCaseUpload.success, true);
if (snakeCaseUpload.success) {
  assert.equal(snakeCaseUpload.data.datasetId, "dataset-1");
  assert.equal(snakeCaseUpload.data.periodTag, "2026-08");
  assert.equal(snakeCaseUpload.data.tableVersion, "0.4.0");
}

assert.equal(
  QueueMessageSchema.safeParse({
    table: "battle",
    avro_base64: "T2JqAQ==",
    datasetId: "dataset-1",
  }).success,
  false,
);

assert.equal(R2KeysSchema.safeParse(["master/0.json", "master/1.json"]).success, true);
assert.equal(R2KeysSchema.safeParse(["master/0.json", ""]).success, false);
assert.equal(
  FingerprintVersionMapSchema.safeParse({
    "0.4.0": { tables: { battle: ["fingerprint"] } },
  }).success,
  true,
);

console.log("[boundary-smoke] Queue and JSON boundary schemas OK");
