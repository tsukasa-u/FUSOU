import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  assertCanonicalServerIdentity, parseOriginInventory, parseTargetApproval, resolveApprovedProductionIdentity,
} from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/origin-trust-contract.mjs";

function fixture() {
  // Structural policy fixtures only; no approved real hostname, signature or TLS evidence.
  const raw = JSON.stringify({ schema_version: 1, source: "packages/configs/configs.toml:[app.connect_kc_server.server_list]",
    targets: Array.from({ length: 20 }, (_, i) => ({ server_index: i + 1, server_identity: `game${i + 1}.example.test`, port: 443 })) });
  const inventory = parseOriginInventory(raw);
  const digest = createHash("sha256").update(raw).digest("base64url");
  const record = { schema_version: 1, authority_model: "FUSOU_DEPLOYMENT_OPERATOR", environment: "production",
    status: "APPROVED", inventory_sha256: digest, targets: [inventory.targets[0].server_identity], approved_at: "2026-10-25T00:00:00Z" };
  return { inventory, digest, record };
}
test("canonical hostname contract rejects ambiguous inputs without silently normalizing", () => {
  assert.equal(assertCanonicalServerIdentity("game.example.test"), "game.example.test");
  for (const host of ["Game.example.test", "game.example.test.", " game.example.test", "*.example.test",
    "https://game.example.test/path", "game.example.test:443", "127.0.0.1", "[::1]", "a..test", "localhost"]) {
    assert.throws(() => assertCanonicalServerIdentity(host));
  }
});
test("observed identity must belong to both inventory and approval, not merely candidate selection", () => {
  const { inventory, digest, record } = fixture();
  const approval = parseTargetApproval(JSON.stringify(record, null, 2), inventory, digest);
  assert.equal(resolveApprovedProductionIdentity("game1.example.test", inventory, approval.targets), "game1.example.test");
  assert.throws(() => resolveApprovedProductionIdentity("game2.example.test", inventory, approval.targets), /Target Approval/);
  assert.throws(() => resolveApprovedProductionIdentity("other.example.test", inventory, approval.targets), /inventory/);
});
test("approval raw serialization, inventory binding, membership and order fail closed", () => {
  const { inventory, digest, record } = fixture();
  for (const mutate of [
    (r) => { r.inventory_sha256 = "a".repeat(43); }, (r) => { r.targets = ["other.example.test"]; },
    (r) => { r.targets.push(r.targets[0]); }, (r) => { r.targets = ["game2.example.test", "game1.example.test"]; },
    (r) => { r.targets = ["Game1.example.test"]; }, (r) => { r.status = "PENDING"; },
  ]) {
    const changed = structuredClone(record);
    mutate(changed);
    assert.throws(() => parseTargetApproval(JSON.stringify(changed, null, 2), inventory, digest));
  }
  assert.throws(() => parseTargetApproval(`${JSON.stringify(record, null, 2)}\n`, inventory, digest), /canonically/);
});
