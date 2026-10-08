import type { z } from "zod";

export const verificationTaskPayloadSchema: z.ZodType<{
  job_id: string;
  binding_id: string;
  session_id: string;
  canonical_user_id: string;
  device_id: string;
  device_challenge: string;
  verification_input_source?: "r2" | undefined;
  verification_input_key: string;
  verification_result_key: string;
  benchmark_trace_id?: string | undefined;
  origin_policy: "fixed" | "inventory";
  deployment_role: "production" | "canary" | "test";
  origin_inventory_sha256?: string | undefined;
  target_approval_artifact_sha256?: string | undefined;
  security_registry_set_sha256?: string | undefined;
  profile: "complete" | "sparse";
  disclosure_mode: "full" | "sparse";
}>;
