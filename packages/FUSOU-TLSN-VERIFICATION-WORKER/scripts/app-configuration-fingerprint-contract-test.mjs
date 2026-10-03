import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APP_CONFIGURATION_FINGERPRINT_CONTRACT,
  appConfigurationProjectionSha256,
  recomputeAppConfigurationCombinedSha256,
  verifyAppConfigurationFingerprint,
} from "./candidate-artifact-identity.mjs";

const contract = APP_CONFIGURATION_FINGERPRINT_CONTRACT;
const vector = contract.test_vector;

test("APP fingerprint matches the shared Rust/Node canonical test vector", () => {
  assert.deepEqual(Object.keys(vector.compile_time_fields).sort(), [...contract.projection_fields.compile_time].sort());
  assert.deepEqual(Object.keys(vector.runtime_fields).sort(), [...contract.projection_fields.runtime].sort());
  assert.equal(appConfigurationProjectionSha256("compile_time", vector.compile_time_fields), vector.compile_time_sha256);
  assert.equal(appConfigurationProjectionSha256("runtime", vector.runtime_fields), vector.runtime_sha256);
  assert.equal(recomputeAppConfigurationCombinedSha256({
    schema_version: contract.schema_version,
    scope: contract.scope,
    compile_time_sha256: vector.compile_time_sha256,
    runtime_sha256: vector.runtime_sha256,
  }), vector.combined_sha256);
  assert.equal(verifyAppConfigurationFingerprint({
    schema_version: contract.schema_version,
    scope: contract.scope,
    compile_time_sha256: vector.compile_time_sha256,
    runtime_sha256: vector.runtime_sha256,
    combined_sha256: vector.combined_sha256,
    candidate_binding_status: "UNBOUND",
  }).combined_sha256, vector.combined_sha256);
});

test("APP fingerprint verification rejects a combined digest not derived from its projections", () => {
  assert.throws(() => verifyAppConfigurationFingerprint({
    schema_version: contract.schema_version,
    scope: contract.scope,
    compile_time_sha256: vector.compile_time_sha256,
    runtime_sha256: vector.runtime_sha256,
    combined_sha256: vector.compile_time_sha256,
    candidate_binding_status: "UNBOUND",
  }), /does not match its canonical preimage/);
});

test("APP fingerprint projection rejects omitted or additional configuration fields", () => {
  assert.throws(() => appConfigurationProjectionSha256("compile_time", {
    ...vector.compile_time_fields,
    unexpected: "value",
  }), /fields do not match the shared contract/);
});