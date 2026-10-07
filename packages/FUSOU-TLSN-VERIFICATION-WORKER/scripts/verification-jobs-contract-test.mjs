import assert from "node:assert/strict";
import { verificationQueueMessageSchema, verificationTaskPayloadSchema } from "../src/verification_jobs.ts";

const jobId = "123e4567-e89b-42d3-a456-426614174000";
const basePayload = {
  job_id: jobId,
  binding_id: "A".repeat(43),
  session_id: "223e4567-e89b-42d3-a456-426614174000",
  canonical_user_id: "323e4567-e89b-42d3-a456-426614174000",
  device_id: "423e4567-e89b-42d3-a456-426614174000",
  device_challenge: "B".repeat(43),
  verification_input_source: "direct",
  verification_result_key: `tlsn-verification/${jobId}/result.json`,
  profile: "complete",
  disclosure_mode: "full",
};

const testPayload = verificationTaskPayloadSchema.parse({
  ...basePayload,
  origin_policy: "fixed",
  deployment_role: "test",
});
assert.equal(testPayload.deployment_role, "test");
assert.equal("origin_inventory_sha256" in testPayload, false);
assert.equal("target_approval_artifact_sha256" in testPayload, false);
assert.equal("security_registry_set_sha256" in testPayload, false);

assert.throws(() => verificationTaskPayloadSchema.parse({
  ...testPayload,
  security_registry_set_sha256: "C".repeat(43),
}), /Synthetic test tasks must not carry/);
assert.throws(() => verificationQueueMessageSchema.parse({
  ...testPayload,
  message_type: "tlsn-verification-v1",
  presentation_id: "G".repeat(43),
  verification_input_source: "r2",
  verification_input_key: `tlsn-verification/${jobId}/presentation.bin`,
  security_registry_set_sha256: "C".repeat(43),
}), /Synthetic test tasks must not carry/);

const canaryPayload = verificationTaskPayloadSchema.parse({
  ...basePayload,
  origin_policy: "fixed",
  deployment_role: "canary",
  security_registry_set_sha256: "D".repeat(43),
});
assert.equal("origin_inventory_sha256" in canaryPayload, false);
assert.equal("target_approval_artifact_sha256" in canaryPayload, false);

const productionPayload = verificationTaskPayloadSchema.parse({
  ...basePayload,
  origin_policy: "inventory",
  deployment_role: "production",
  origin_inventory_sha256: "E".repeat(43),
  target_approval_artifact_sha256: "F".repeat(43),
  security_registry_set_sha256: "F".repeat(43),
});
assert.equal(productionPayload.origin_inventory_sha256, "E".repeat(43));
assert.equal(productionPayload.target_approval_artifact_sha256, "F".repeat(43));

assert.throws(() => verificationTaskPayloadSchema.parse({
  ...productionPayload,
  origin_inventory_sha256: undefined,
  target_approval_artifact_sha256: undefined,
}), /Production task requires the runtime Origin inventory digest/);
assert.throws(() => verificationTaskPayloadSchema.parse({
  ...canaryPayload,
  origin_inventory_sha256: "E".repeat(43),
}), /Only Production tasks may carry the Production inventory digest/);
assert.throws(() => verificationTaskPayloadSchema.parse({
  ...canaryPayload,
  security_registry_set_sha256: undefined,
}), /Production and Canary tasks require the runtime security registry set digest/);

console.info("Verification task role and trust-digest contract tests passed");