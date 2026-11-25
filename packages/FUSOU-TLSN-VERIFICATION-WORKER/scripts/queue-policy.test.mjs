import assert from "node:assert/strict";
import test from "node:test";
import {
  queueMessageMatchesBindingRecord,
  queueMessageMatchesRuntimeTrust,
  queueMessagePreflightDisposition,
  queuePostflightDisposition,
  queuePreflightDisposition,
} from "../src/queue-policy.ts";

const productionMessage = {
  job_id: "c693e11f-8382-48de-ae44-f8d74a7fa5a4",
  binding_id: "a".repeat(43),
  session_id: "c693e11f-8382-48de-ae44-f8d74a7fa5a4",
  canonical_user_id: "c693e11f-8382-48de-ae44-f8d74a7fa5a4",
  device_id: "c693e11f-8382-48de-ae44-f8d74a7fa5a4",
  device_challenge: "b".repeat(43),
  verification_input_source: "r2",
  verification_input_key: "tlsn-verification/c693e11f-8382-48de-ae44-f8d74a7fa5a4/presentation.bin",
  verification_result_key: "tlsn-verification/c693e11f-8382-48de-ae44-f8d74a7fa5a4/result.json",
  origin_policy: "inventory",
  deployment_role: "production",
  origin_inventory_sha256: "c".repeat(43),
  target_approval_artifact_sha256: "d".repeat(43),
  security_registry_set_sha256: "e".repeat(43),
  profile: "complete",
  disclosure_mode: "full",
  message_type: "tlsn-verification-v1",
  presentation_id: "f".repeat(43),
};

const productionTrust = {
  environment: "production",
  deploymentRole: "production",
  originInventorySha256: productionMessage.origin_inventory_sha256,
  targetApprovalArtifactSha256: productionMessage.target_approval_artifact_sha256,
  securityRegistrySetSha256: productionMessage.security_registry_set_sha256,
};

function productionRecord() {
  return {
    binding_id: productionMessage.binding_id,
    session_id: productionMessage.session_id,
    canonical_user_id: productionMessage.canonical_user_id,
    device_id: productionMessage.device_id,
    tlsn_device_challenge: productionMessage.device_challenge,
    presentation_id: productionMessage.presentation_id,
    verification_job_id: productionMessage.job_id,
    verification_input_source: "r2",
    verification_input_key: productionMessage.verification_input_key,
    verification_result_key: productionMessage.verification_result_key,
    verification_profile: "complete",
    status: "processing",
  };
}

test("Production Queue messages must match all current trust digests and policy", () => {
  assert.equal(queueMessageMatchesRuntimeTrust(productionMessage, productionTrust), true);
  for (const [field, value] of [
    ["origin_policy", "fixed"],
    ["origin_inventory_sha256", "z".repeat(43)],
    ["target_approval_artifact_sha256", "z".repeat(43)],
    ["security_registry_set_sha256", "z".repeat(43)],
    ["deployment_role", "test"],
  ]) {
    assert.equal(queueMessageMatchesRuntimeTrust(
      { ...productionMessage, [field]: value },
      productionTrust,
    ), false, `${field} mismatch must be rejected`);
  }
});

test("test Queue messages retain the fixed test policy and cannot claim Production digests", () => {
  const testMessage = {
    ...productionMessage,
    origin_policy: "fixed",
    deployment_role: "test",
    origin_inventory_sha256: undefined,
    target_approval_artifact_sha256: undefined,
    security_registry_set_sha256: undefined,
  };
  assert.equal(queueMessageMatchesRuntimeTrust(testMessage, { environment: "test" }), true);
  assert.equal(queueMessageMatchesRuntimeTrust(
    { ...testMessage, security_registry_set_sha256: "e".repeat(43) },
    { environment: "test" },
  ), false);
  assert.equal(queueMessageMatchesRuntimeTrust(testMessage, { environment: "canary" }), false);
});

test("Queue messages must match the DO's job, identities, challenge, Presentation, input, and profile", () => {
  const record = productionRecord();
  assert.equal(queueMessageMatchesBindingRecord(productionMessage, record), true);
  for (const [field, value] of [
    ["job_id", "d693e11f-8382-48de-ae44-f8d74a7fa5a4"],
    ["session_id", "d693e11f-8382-48de-ae44-f8d74a7fa5a4"],
    ["canonical_user_id", "d693e11f-8382-48de-ae44-f8d74a7fa5a4"],
    ["device_id", "d693e11f-8382-48de-ae44-f8d74a7fa5a4"],
    ["device_challenge", "z".repeat(43)],
    ["presentation_id", "z".repeat(43)],
    ["verification_input_key", "tlsn-verification/d693e11f-8382-48de-ae44-f8d74a7fa5a4/presentation.bin"],
    ["verification_result_key", "tlsn-verification/d693e11f-8382-48de-ae44-f8d74a7fa5a4/result.json"],
    ["profile", "sparse"],
  ]) {
    assert.equal(queueMessageMatchesBindingRecord(
      { ...productionMessage, [field]: value },
      record,
    ), false, `${field} mismatch must be rejected`);
    assert.equal(queueMessagePreflightDisposition(
      { ...productionMessage, [field]: value },
      record,
      true,
      1,
    ), "reject", `${field} mismatch must not claim or fail the recorded job`);
  }
  assert.equal(queueMessagePreflightDisposition(productionMessage, record, false, 1), "reject");
  assert.equal(queueMessagePreflightDisposition(
    productionMessage,
    { ...record, status: "verifying" },
    true,
    2,
  ), "retry", "a matching duplicate must preserve and wait on the active lease");
  assert.equal(queueMessagePreflightDisposition(
    { ...productionMessage, profile: "sparse" },
    { ...record, status: "verifying" },
    true,
    2,
  ), "reject", "a mismatched duplicate must not fail the active lease");
});

test("redelivery preserves active leases, confirms terminal states, and retries uncertain work", () => {
  const record = productionRecord();
  assert.equal(queuePreflightDisposition(record, 1), "process");
  assert.equal(queuePreflightDisposition({ ...record, status: "verifying" }, 1), "ack");
  assert.equal(queuePreflightDisposition({ ...record, status: "verifying" }, 2), "retry");
  assert.equal(queuePreflightDisposition({ ...record, status: "consumed" }, 1), "confirm_result");
  assert.equal(queuePreflightDisposition({ ...record, status: "failed" }, 1), "ack");
  assert.equal(queuePreflightDisposition({ ...record, status: "expired" }, 1), "ack");

  assert.equal(queuePostflightDisposition({ ...record, status: "consumed" }, 503), "confirm_result");
  assert.equal(queuePostflightDisposition({ ...record, status: "failed" }, 503), "ack");
  assert.equal(queuePostflightDisposition({ ...record, status: "verifying" }, 202), "ack");
  assert.equal(queuePostflightDisposition({ ...record, status: "verifying" }, 503), "retry");
  assert.equal(queuePostflightDisposition(record, 503), "retry");
});
