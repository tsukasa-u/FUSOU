import assert from "node:assert/strict";
import { verificationTaskPayloadSchema } from "../src/trigger/verification-task-contract.mjs";
import { verificationTaskPayloadSchema as workerPayloadSchema } from "../../FUSOU-TLSN-VERIFICATION-WORKER/src/verification_jobs.ts";

const jobId = "123e4567-e89b-42d3-a456-426614174000";
const basePayload = {
  job_id: jobId,
  binding_id: "A".repeat(43),
  session_id: "223e4567-e89b-42d3-a456-426614174000",
  canonical_user_id: "323e4567-e89b-42d3-a456-426614174000",
  device_id: "423e4567-e89b-42d3-a456-426614174000",
  device_challenge: "B".repeat(43),
  verification_input_source: "r2",
  verification_input_key: `tlsn-verification/${jobId}/presentation.bin`,
  verification_result_key: `tlsn-verification/${jobId}/result.json`,
};

for (const profile of ["complete", "sparse"]) {
  for (const deploymentRole of ["production", "canary", "test"]) {
    const payload = {
      ...basePayload,
      profile,
      disclosure_mode: profile === "sparse" ? "sparse" : "full",
      deployment_role: deploymentRole,
      origin_policy: deploymentRole === "production" ? "inventory" : "fixed",
      ...(deploymentRole === "production" ? {
        origin_inventory_sha256: "C".repeat(43),
        target_approval_artifact_sha256: "D".repeat(43),
      } : {}),
      ...(deploymentRole !== "test" ? { security_registry_set_sha256: "E".repeat(43) } : {}),
    };
    const parsedWorkerPayload = workerPayloadSchema.parse(payload);
    assert.deepEqual(verificationTaskPayloadSchema.parse(parsedWorkerPayload), parsedWorkerPayload);
    assert.throws(() => verificationTaskPayloadSchema.parse({ ...payload, unknown: true }), /Unrecognized key/);
    assert.throws(() => verificationTaskPayloadSchema.parse({ ...payload, verification_input_source: "direct" }));
    assert.throws(() => verificationTaskPayloadSchema.parse({ ...payload, verification_input_key: undefined }));
    assert.throws(() => verificationTaskPayloadSchema.parse({
      ...payload, disclosure_mode: profile === "sparse" ? "full" : "sparse",
    }), /disclosure_mode does not match/);

    for (const field of ["origin_inventory_sha256", "target_approval_artifact_sha256"]) {
      if (deploymentRole === "production") {
        for (const invalidDigest of [undefined, null, "invalid"]) {
          assert.throws(() => verificationTaskPayloadSchema.parse({ ...payload, [field]: invalidDigest }));
        }
      } else {
        assert.throws(
          () => verificationTaskPayloadSchema.parse({ ...payload, [field]: "F".repeat(43) }),
          /Only Production tasks/,
        );
      }
    }
    if (deploymentRole !== "test") {
      assert.throws(() => verificationTaskPayloadSchema.parse({
        ...payload, security_registry_set_sha256: undefined,
      }), /require a security registry set digest/);
    } else {
      assert.throws(() => verificationTaskPayloadSchema.parse({
        ...payload, security_registry_set_sha256: "F".repeat(43),
      }), /Synthetic test tasks must not carry/);
    }
  }
}

console.info("Worker-to-Trigger payload, provenance pair and R2 boundary tests passed");
