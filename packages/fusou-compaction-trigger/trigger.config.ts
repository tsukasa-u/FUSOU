import { defineConfig, timeout } from "@trigger.dev/sdk";
import { additionalFiles, syncEnvVars } from "@trigger.dev/build/extensions/core";

const REQUIRED_RUNTIME_ENVS = [
  "INTERNAL_COMPACTION_BASE_URL",
  "INTERNAL_COMPACTION_TOKEN",
  "R2_BUCKET",
  "R2_S3_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

const OPTIONAL_TLSN_RUNTIME_ENVS = [
  "TLSN_WORKER_INTERNAL_URL",
  "TLSN_TRIGGER_CALLBACK_SECRET",
  "TLSN_TRIGGER_SERVER_IDENTITY",
  "TLSN_TRIGGER_PROFILE_SHA256",
  "TLSN_TRIGGER_VERIFIER_KEY_ID",
  "TLSN_TRIGGER_NOTARY_KEY_ID",
  "TLSN_TRIGGER_NOTARY_REGISTRY",
  "TLSN_TRIGGER_TRUST_ROOT_CERTIFICATE_DER",
] as const;

function requireEnv(name: (typeof REQUIRED_RUNTIME_ENVS)[number]): string {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required deploy env for Trigger sync: ${name}`);
  }
  return value;
}

function requireProjectRef(): string {
  const value = process.env["TRIGGER_PROJECT_REF"];
  if (!value || !String(value).trim()) {
    throw new Error("Missing required deploy env for Trigger project: TRIGGER_PROJECT_REF");
  }
  return value;
}

export default defineConfig({
  project: requireProjectRef(),
  runtime: "node-22",
  maxDuration: timeout.None,
  dirs: ["./src/trigger"],
  build: {
    extensions: [
      syncEnvVars(async () => {
        const runtimeEnvs = Object.fromEntries(
          REQUIRED_RUNTIME_ENVS.map((name) => [name, requireEnv(name)]),
        );
        const tlsnEnvs = Object.fromEntries(
          OPTIONAL_TLSN_RUNTIME_ENVS
            .filter((name) => Boolean(process.env[name]?.trim()))
            .map((name) => [name, process.env[name]!]),
        );
        return { ...runtimeEnvs, ...tlsnEnvs };
      }),
      additionalFiles({
        files: [
          "../FUSOU-TLSN-VERIFICATION-WORKER/src/wasm/fusou_tlsn_verifier.js",
          "../FUSOU-TLSN-VERIFICATION-WORKER/src/wasm/fusou_tlsn_verifier_bg.wasm",
        ],
      }),
    ],
  },
});
