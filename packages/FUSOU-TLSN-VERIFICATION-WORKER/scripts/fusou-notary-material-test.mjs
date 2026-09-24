#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createFusouNotaryProvisioningRecord,
  fusouNotaryRegistryFromPublicKeyExport,
  parseFusouNotaryPublicKeyExport,
} from "./fusou-notary-material.mjs";
import { loadRealFixture, readRealFixtureManifest } from "./tlsn-benchmark-fixtures.mjs";

const { entries } = readRealFixtureManifest();
const fixture = loadRealFixture(entries.get("p50"));
const verifyingKeyBytes = Buffer.from(fixture.notary_key_base64, "base64url");
const publicKeyExport = {
  schema_version: 1,
  protocol: "tlsn-v0.1.0-alpha.15",
  key_id: "fusou-notary-test",
  status: "ACTIVE",
  signature_algorithm: "secp256k1",
  verifying_key_base64url: fixture.notary_key_base64,
  sec1_public_key_base64url: verifyingKeyBytes.subarray(9).toString("base64url"),
};

const parsed = parseFusouNotaryPublicKeyExport(JSON.stringify(publicKeyExport));
assert.equal(parsed.key_id, "fusou-notary-test");
const material = fusouNotaryRegistryFromPublicKeyExport(parsed);
assert.deepEqual(JSON.parse(material.registry), { "fusou-notary-test": fixture.notary_key_base64 });
assert.equal(material.registry_sha256.length, 43);
const record = createFusouNotaryProvisioningRecord({
  publicKeyExport: parsed,
  endpoint: "notary.canary.example.net:7047",
});
assert.equal(record.owner, "FUSOU");
assert.equal(record.service, "FUSOU-NOTARY");
assert.equal(record.transport, "raw_tcp");
assert.equal(record.mpc_role, "verifier");
assert.equal(record.origin_connection, "prover_owned");
assert.equal(record.key_material_handling, "Notary private key is secret-provider-only; never written by this provisioning path");
assert.equal(record.runtime_policy.session_timeout_seconds, 300);
assert.equal(record.runtime_policy.max_concurrent_sessions, 1);
assert.throws(() => createFusouNotaryProvisioningRecord({ publicKeyExport: parsed, endpoint: "https://notary.example.net:7047" }), /raw host:port/);
assert.throws(() => parseFusouNotaryPublicKeyExport(JSON.stringify({ ...publicKeyExport, status: "VERIFY_ONLY" })), /ACTIVE/);
assert.throws(() => parseFusouNotaryPublicKeyExport(JSON.stringify({ ...publicKeyExport, sec1_public_key_base64url: Buffer.alloc(33, 7).toString("base64url") })), /compressed secp256k1/);

const root = await mkdtemp(join(tmpdir(), "fusou-notary-material-test-"));
try {
  const exportPath = join(root, "public-export.json");
  const outputPath = join(root, "output");
  await writeFile(exportPath, `${JSON.stringify(publicKeyExport)}\n`);
  const result = spawnSync(process.execPath, [
    "scripts/fusou-notary-material.mjs",
    "--export-file", exportPath,
    "--endpoint", "notary.canary.example.net:7047",
    "--output", outputPath,
  ], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(await readFile(join(outputPath, "notary-registry.json"), "utf8")), material.registry && JSON.parse(material.registry));
  const generatedRecord = JSON.parse(await readFile(join(outputPath, "notary-provisioning.json"), "utf8"));
  assert.equal(generatedRecord.registry_sha256, material.registry_sha256);
  assert.equal(generatedRecord.owner, "FUSOU");
  assert.equal(await readFile(join(outputPath, "notary-signing-key.base64url")).catch(() => null), null);
  assert.equal(generatedRecord.key_material_handling.includes("never written"), true);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("[fusou-notary-material] alpha15 export, canonical registry, ownership, endpoint, and secret boundary PASS");