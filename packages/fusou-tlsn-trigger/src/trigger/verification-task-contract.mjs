import { z } from "zod";

export const verificationTaskPayloadSchema = z.object({
  job_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  binding_id: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  session_id: z.string().uuid(),
  canonical_user_id: z.string().uuid(),
  device_id: z.string().uuid(),
  device_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  verification_input_source: z.literal("r2").optional(),
  verification_input_key: z.string().regex(/^tlsn-verification\/[0-9a-f-]+\/presentation\.bin$/),
  verification_result_key: z.string().regex(/^tlsn-verification\/[0-9a-f-]+\/result\.json$/),
  benchmark_trace_id: z.string().uuid().optional(),
  origin_policy: z.enum(["fixed", "inventory"]),
  deployment_role: z.enum(["production", "canary", "test"]),
  origin_inventory_sha256: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  target_approval_artifact_sha256: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  security_registry_set_sha256: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  profile: z.enum(["complete", "sparse"]),
  disclosure_mode: z.enum(["full", "sparse"]),
}).strict().superRefine((payload, context) => {
  const expectedDisclosureMode = payload.profile === "sparse" ? "sparse" : "full";
  if (payload.disclosure_mode !== expectedDisclosureMode) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["disclosure_mode"],
      message: "disclosure_mode does not match profile",
    });
  }
  const expectedPolicy = payload.deployment_role === "production" ? "inventory" : "fixed";
  if (payload.origin_policy !== expectedPolicy) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["origin_policy"], message: "origin_policy does not match deployment_role" });
  }
  for (const [field, label] of [
    ["origin_inventory_sha256", "Origin inventory"],
    ["target_approval_artifact_sha256", "Target Approval artifact"],
  ]) {
    if (payload.deployment_role === "production" && !payload[field]) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `Production task requires a ${label} digest` });
    }
    if (payload.deployment_role !== "production" && payload[field] !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `Only Production tasks may carry a ${label} digest` });
    }
  }
  if (payload.deployment_role !== "test" && !payload.security_registry_set_sha256) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["security_registry_set_sha256"], message: "Production and Canary tasks require a security registry set digest" });
  }
  if (payload.deployment_role === "test" && payload.security_registry_set_sha256 !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["security_registry_set_sha256"], message: "Synthetic test tasks must not carry a deployment security registry set digest" });
  }
});
