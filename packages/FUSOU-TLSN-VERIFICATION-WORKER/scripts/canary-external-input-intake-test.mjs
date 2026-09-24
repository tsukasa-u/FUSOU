#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  CANARY_EXTERNAL_ARTIFACT_INTAKE,
  CANARY_EXTERNAL_INPUT_INTAKE,
  assertCanaryExternalInputIntakeContract,
  canaryInputIntakeEntry,
} from "./canary-external-input-intake.mjs";
import { CANARY_SECRET_INPUTS } from "./deployment-contract.mjs";

assert.equal(assertCanaryExternalInputIntakeContract(), true);
assert.ok(CANARY_EXTERNAL_ARTIFACT_INTAKE.length > 0);
for (const artifact of CANARY_EXTERNAL_ARTIFACT_INTAKE) {
  assert.ok(artifact.name);
  assert.ok(artifact.category);
  assert.ok(artifact.source);
  assert.ok(artifact.classification);
  assert.ok(artifact.purpose);
  assert.equal(typeof artifact.required, "boolean");
  assert.ok(artifact.representation);
  assert.ok(artifact.format);
  assert.ok(artifact.canonicalization);
  assert.ok(artifact.fingerprint);
  assert.ok(artifact.issuer);
  assert.ok(artifact.validity);
  assert.ok(artifact.current_head_relation);
  assert.ok(artifact.consumer);
  assert.ok(artifact.validator);
  assert.ok(artifact.failure_conditions.length > 0);
  assert.ok(artifact.readiness_effect);
  assert.ok(["MISSING", "HISTORICAL", "FIXTURE_ONLY", "SYNTHETIC", "INVALID", "CURRENT"].includes(artifact.status_when_absent));
}

for (const name of CANARY_SECRET_INPUTS) {
  const entry = canaryInputIntakeEntry(name);
  if (name === "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER") {
    assert.equal(entry.secret, false);
    assert.equal(entry.source, "DEPLOYMENT_INPUT");
    assert.equal(entry.protected_input_channel, true);
  } else {
    assert.equal(entry.secret, true, `${name} must be classified as secret`);
    assert.equal(entry.source, "CANARY_GENERATED", `${name} must retain its current generator ownership`);
  }
}

assert.equal(canaryInputIntakeEntry("TLSN_REMOTE_DEVICE_ID_A").secret, false);
assert.equal(canaryInputIntakeEntry("TLSN_REMOTE_DEVICE_ID_A").ownership, "DEPLOYMENT_INPUT_REQUIRED");
assert.equal(canaryInputIntakeEntry("TLSN_REMOTE_ACCESS_TOKEN_A").required, true);
assert.equal(canaryInputIntakeEntry("TLSN_REMOTE_ACCESS_TOKEN_A").required_group, undefined);
assert.equal(canaryInputIntakeEntry("TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE").required, false);
assert.equal(canaryInputIntakeEntry("TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE").required_group, "REMOTE_DEVICE_PRIVATE_KEY_ONE_OF");
assert.equal(canaryInputIntakeEntry("TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL").required_group, "REMOTE_DEVICE_PRIVATE_KEY_ONE_OF");
assert.equal(canaryInputIntakeEntry("TLSN_CANDIDATE_PROFILE_SHA256").ownership, "DERIVED");
assert.equal(canaryInputIntakeEntry("TLSN_CANDIDATE_PROFILE_SHA256").external_dependency, true);
assert.equal(canaryInputIntakeEntry("TLSN_CANARY_DEPLOYMENT_ID").ownership, "DEPLOYMENT_GENERATED");
assert.equal(canaryInputIntakeEntry("TLSN_CANARY_DEPLOYMENT_ID").external_dependency, false);
assert.equal(canaryInputIntakeEntry("TLSN_REMOTE_EXPECTED_PROVENANCE_JSON").ownership, "REMOTE_VALIDATION_ONLY");
assert.equal(canaryInputIntakeEntry("TLSN_REMOTE_EXPECTED_PROVENANCE_JSON").external_dependency, false);

for (const name of [
  "TLSN_REMOTE_ACCESS_TOKEN_A",
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE",
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
]) {
  const entry = canaryInputIntakeEntry(name);
  assert.equal(entry.secret, true, `${name} must be secret`);
  assert.equal(entry.phase, "REMOTE_VALIDATION_ONLY", `${name} must not enter deployment preflight`);
  assert.match(entry.consumer, /remote-validation only/);
}

for (const entry of CANARY_EXTERNAL_INPUT_INTAKE) {
  assert.doesNotMatch(entry.representation, /actual value|literal secret/i);
}

console.log("[tlsn-canary-external-input-intake] inventory, source, phase, and secret-boundary contract PASS");
