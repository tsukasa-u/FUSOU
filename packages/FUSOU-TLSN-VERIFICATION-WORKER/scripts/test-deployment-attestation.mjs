#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertCanonicalTestWorkerName } from "./test-deployment-target.mjs";

const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function equalJson(left, right, label) {
  assert.deepStrictEqual(left, right, `${label} does not match the expected value`);
}

function fieldAt(attestation, path) {
  return path.reduce((value, key) => value?.[key], attestation);
}

export function assertTestDeploymentAttestation(attestation, expected = {}) {
  expect(attestation && typeof attestation === "object", "Test attestation must be an object");
  expect(attestation.schema_version === 1, "unsupported Test attestation schema");
  expect(attestation.scope === "tlsn-test-deployment-attestation", "invalid Test attestation scope");
  expect(attestation.status === "PASS", "Test platform attestation is not PASS");

  const repository = attestation.repository;
  expect(/^[0-9a-f]{40}$/.test(repository?.head_sha ?? ""), "invalid repository HEAD");
  expect(repository.head_checked_before_deploy === true, "repository HEAD was not checked before deploy");
  if (expected.head_sha !== undefined) expect(repository.head_sha === expected.head_sha, "repository HEAD mismatch");

  const deployment = attestation.deployment;
  expect(deployment?.worker_name === assertCanonicalTestWorkerName(deployment?.worker_name), "invalid Test worker name");
  expect(UUID.test(deployment?.deployment_id ?? ""), "invalid deployment ID");
  expect(!Number.isNaN(Date.parse(deployment?.created_on ?? "")), "invalid deployment creation time");
  expect(Array.isArray(deployment.versions) && deployment.versions.length === 1, "deployment must contain one version");
  expect(deployment.versions[0]?.percentage === 100, "deployment version is not serving at 100 percent");
  expect(deployment.message_observation_status === "MATCH" || deployment.message_observation_status === "UNAVAILABLE", "invalid deployment message observation status");
  if (expected.worker_name !== undefined) expect(deployment.worker_name === expected.worker_name, "worker name mismatch");
  if (expected.deployment_id !== undefined) expect(deployment.deployment_id === expected.deployment_id, "deployment ID mismatch");

  const version = attestation.version;
  const servingVersionId = deployment.versions[0].version_id;
  expect(UUID.test(version?.version_id ?? ""), "invalid version ID");
  expect(version.version_id === servingVersionId, "deployment/version identity mismatch");
  expect(version.serving_percentage === 100, "version is not serving at 100 percent");
  if (expected.version_id !== undefined) expect(version.version_id === expected.version_id, "version ID mismatch");

  const runtime = attestation.runtime;
  expect(runtime && typeof runtime === "object", "missing runtime observation");
  if (runtime.observation_status === "PASS") {
    expect(runtime.observed_version_id === version.version_id, "runtime version does not match platform version");
  } else {
    expect(runtime.observation_status === "PENDING_REMOTE_HEALTH_CHECK" || runtime.observation_status === "UNAVAILABLE", "invalid runtime observation status");
    expect(runtime.observed_version_id === null, "unobserved runtime must not contain a version ID");
  }
  if (expected.runtime_version_id !== undefined) expect(runtime.observed_version_id === expected.runtime_version_id, "runtime version ID mismatch");

  const resultIdentity = attestation.result_identity;
  expect(/^[A-Za-z0-9._-]{1,128}$/.test(resultIdentity?.signer_key_id ?? ""), "invalid Result signer key ID");
  expect(BASE64URL.test(resultIdentity?.public_key_spki ?? ""), "invalid Result public key");
  expect(SHA256_BASE64URL.test(resultIdentity?.public_key_spki_sha256 ?? ""), "invalid Result public-key hash");
  expect(SHA256_BASE64URL.test(resultIdentity?.registry_sha256 ?? ""), "invalid Result registry hash");
  const publicKeyHash = createHash("sha256").update(Buffer.from(resultIdentity.public_key_spki, "base64url")).digest("base64url");
  expect(publicKeyHash === resultIdentity.public_key_spki_sha256, "Result public-key hash mismatch");
  if (expected.signer_key_id !== undefined) expect(resultIdentity.signer_key_id === expected.signer_key_id, "Result signer key ID mismatch");
  if (expected.public_key_spki !== undefined) expect(resultIdentity.public_key_spki === expected.public_key_spki, "Result public key mismatch");
  if (expected.registry_sha256 !== undefined) expect(resultIdentity.registry_sha256 === expected.registry_sha256, "Result registry hash mismatch");

  if (expected.result !== undefined) equalJson(attestation.result_evidence?.result, expected.result, "Result");
  if (expected.result_signature_base64url !== undefined) {
    expect(attestation.result_evidence?.result_signature_base64url === expected.result_signature_base64url, "Result signature mismatch");
  }
  return true;
}

function mutate(value, path, replacement) {
  const copy = structuredClone(value);
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key];
  target[path.at(-1)] = replacement;
  return copy;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
const publicKey = "MCowBQYDK2VwAyEApOqYzQrwukWJ6Prcpd4HNag9qy9tKjV-xZuH_SRof0A";
const fixture = {
  schema_version: 1,
  scope: "tlsn-test-deployment-attestation",
  status: "PASS",
  repository: { head_sha: "5705b385e182b0dcb764154af651791b924e1cc8", head_checked_before_deploy: true },
  deployment: {
    worker_name: "fusou-tlsn-verification-test",
    deployment_id: "3b064508-1cdb-453c-826b-bdea36a8b1e5",
    created_on: "2026-09-23T13:46:55.079495Z",
    message_observation_status: "MATCH",
    versions: [{ version_id: "c82e4bec-3c4f-4a90-9d22-cb1e9186221b", percentage: 100 }],
  },
  version: { version_id: "c82e4bec-3c4f-4a90-9d22-cb1e9186221b", serving_percentage: 100 },
  runtime: { observed_version_id: null, observation_status: "PENDING_REMOTE_HEALTH_CHECK" },
  result_identity: {
    signer_key_id: "worker-test",
    public_key_spki: publicKey,
    public_key_spki_sha256: createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("base64url"),
    registry_sha256: "qml8qFvoBUciwYnCwCZxw4sEAjRipSzOR0LbKGcMwYg",
  },
  result_evidence: {
    result: { schema_version: 1, status: "VERIFIED", value: "fixture" },
    result_signature_base64url: "A".repeat(86),
  },
};

const expected = {
  head_sha: fixture.repository.head_sha,
  worker_name: fixture.deployment.worker_name,
  deployment_id: fixture.deployment.deployment_id,
  version_id: fixture.version.version_id,
  signer_key_id: fixture.result_identity.signer_key_id,
  public_key_spki: fixture.result_identity.public_key_spki,
  registry_sha256: fixture.result_identity.registry_sha256,
  result: fixture.result_evidence.result,
  result_signature_base64url: fixture.result_evidence.result_signature_base64url,
};

assertTestDeploymentAttestation(fixture, expected);
const mutations = [
  [["repository", "head_sha"], "a".repeat(40)],
  [["deployment", "worker_name"], "fusou-tlsn-verification-production"],
  [["deployment", "deployment_id"], "4b064508-1cdb-453c-826b-bdea36a8b1e5"],
  [["version", "version_id"], "d82e4bec-3c4f-4a90-9d22-cb1e9186221b"],
  [["runtime", "observed_version_id"], "d82e4bec-3c4f-4a90-9d22-cb1e9186221b"],
  [["result_identity", "signer_key_id"], "other-key"],
  [["result_identity", "public_key_spki"], "MCowBQYDK2VwAyEAqOqYzQrwukWJ6Prcpd4HNag9qy9tKjV-xZuH_SRof0A"],
  [["result_identity", "registry_sha256"], "A".repeat(43)],
  [["result_evidence", "result"], { schema_version: 1, status: "TAMPERED", value: "fixture" }],
  [["result_evidence", "result_signature_base64url"], "B".repeat(86)],
];
for (const [path, replacement] of mutations) {
  assert.throws(() => assertTestDeploymentAttestation(mutate(fixture, path, replacement), expected), path.join("."));
}

console.log("[tlsn-test-deployment-attestation] identity contract and 10-field tamper matrix PASS");
}
