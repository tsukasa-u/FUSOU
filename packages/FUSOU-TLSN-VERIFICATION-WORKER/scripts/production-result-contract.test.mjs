import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { assertPreparedResultContract } from "../src/production-result-contract.mjs";

const serverIdentity = "game.example.test";
const profileSha256 = "p".repeat(43);
const inventorySha256 = "i".repeat(43);
const approvalSha256 = "a".repeat(43);
const presentationBytes = new TextEncoder().encode("synthetic Presentation bytes");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function result(profile = "complete", overrides = {}) {
  const sparse = profile === "sparse";
  return {
    version: sparse ? 3 : 2,
    profile_id: sparse ? "fusou-require-info-v2-sparse" : "fusou-require-info-v1",
    profile_sha256: profileSha256,
    server_identity: serverIdentity,
    ...(sparse ? { disclosure_mode: "sparse" } : {}),
    presentation_sha256: digest(presentationBytes),
    origin_inventory_sha256: inventorySha256,
    target_approval_artifact_sha256: approvalSha256,
    ...overrides,
  };
}

function contractOptions(profile = "complete", production = true) {
  return {
    profile,
    serverIdentity,
    profileSha256,
    presentationBytes,
    production,
    inventorySha256: production ? inventorySha256 : null,
    approvalSha256: production ? approvalSha256 : null,
  };
}

test("Production Complete v2 binds the exact Presentation and both authority digests", async () => {
  await assert.doesNotReject(
    assertPreparedResultContract(result(), contractOptions()),
  );
});

test("Production Sparse v3 binds the exact Presentation and both authority digests", async () => {
  await assert.doesNotReject(
    assertPreparedResultContract(result("sparse"), contractOptions("sparse")),
  );
});

test("Production Result rejects missing digest pairs and changed Presentation bytes", async () => {
  await assert.rejects(
    assertPreparedResultContract(result(), {
      ...contractOptions(),
      inventorySha256: null,
    }),
    /Production Result requires both target digests/,
  );

  await assert.rejects(
    assertPreparedResultContract(result(), {
      ...contractOptions(),
      presentationBytes: new TextEncoder().encode("different Presentation bytes"),
    }),
    /Result provenance does not match exact Presentation and target inputs/,
  );

  await assert.rejects(
    assertPreparedResultContract(result("complete", {
      target_approval_artifact_sha256: "x".repeat(43),
    }), contractOptions()),
    /Result provenance does not match exact Presentation and target inputs/,
  );
});

test("generic test-only Result may omit Production target digests", async () => {
  const testResult = result("complete", {
    origin_inventory_sha256: null,
    target_approval_artifact_sha256: null,
  });
  await assert.doesNotReject(
    assertPreparedResultContract(testResult, contractOptions("complete", false)),
  );
});
