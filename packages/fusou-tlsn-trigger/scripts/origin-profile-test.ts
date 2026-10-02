import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalProfileBytes, selectOriginTarget, type OriginTarget } from "../src/trigger/origin-profile.ts";

const packageDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const inventory = JSON.parse(readFileSync(resolve(packageDirectory, "../configs/tlsn-origin-inventory.json"), "utf8")) as {
  schema_version: number;
  targets: OriginTarget[];
};

assert.equal(inventory.schema_version, 1);
assert.equal(inventory.targets.length, 20);
for (const target of inventory.targets) {
  assert.equal(target.port, 443);
  assert.deepEqual(selectOriginTarget(target.server_identity, inventory.targets), target);
  assert.deepEqual(selectOriginTarget(target.server_identity.toUpperCase(), inventory.targets), target);
}
assert.equal(selectOriginTarget("not-listed.example.net", inventory.targets), undefined);
assert.equal(selectOriginTarget("game.example.test", inventory.targets), undefined);
assert.equal(selectOriginTarget("game.example.com", [{ ...inventory.targets[0]!, port: 8443 }]), undefined);

const firstIdentity = inventory.targets[0]!.server_identity;
const secondIdentity = inventory.targets[1]!.server_identity;
const completeDigest = (identity: string) => createHash("sha256").update(canonicalProfileBytes("complete", identity)).digest("base64url");
const sparseDigest = (identity: string) => createHash("sha256").update(canonicalProfileBytes("sparse", identity)).digest("base64url");
assert.notEqual(completeDigest(firstIdentity), completeDigest(secondIdentity));
assert.notEqual(completeDigest(firstIdentity), sparseDigest(firstIdentity));
assert.equal(
  canonicalProfileBytes("complete", firstIdentity).toString(),
  new TextEncoder().encode(JSON.stringify({
    id: "fusou-require-info-v1",
    server_identity: firstIdentity,
    target: "/kcsapi/api_get_member/require_info",
  })).toString(),
);

console.log("[tlsn-trigger-origin-profile] 20-host selection and per-identity profile digests PASS");