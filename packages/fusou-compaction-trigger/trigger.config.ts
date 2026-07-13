import { defineConfig, timeout } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

const REQUIRED_RUNTIME_ENVS = [
  "INTERNAL_COMPACTION_BASE_URL",
  "INTERNAL_COMPACTION_TOKEN",
  "R2_BUCKET",
  "R2_S3_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

function requireEnv(name: (typeof REQUIRED_RUNTIME_ENVS)[number]): string {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required deploy env for Trigger sync: ${name}`);
  }
  return value;
}

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF,
  runtime: "node-22",
  maxDuration: timeout.None,
  dirs: ["./src/trigger"],
  build: {
    extensions: [
      syncEnvVars(async () => {
        return Object.fromEntries(
          REQUIRED_RUNTIME_ENVS.map((name) => [name, requireEnv(name)]),
        );
      }),
    ],
  },
});
