import { defineConfig, timeout } from "@trigger.dev/sdk";
import { additionalFiles, syncEnvVars } from "@trigger.dev/build/extensions/core";
import { readFile } from "node:fs/promises";
import {
  originInventoryArtifactRawSha256,
  TRIGGER_ORIGIN_INVENTORY_ARTIFACT_RAW_SHA256_ENV,
} from "./src/trigger/origin-inventory-contract.mjs";
import { triggerOriginRuntimeEnvNames } from "./scripts/trigger-origin-config.mjs";

const REQUIRED_RUNTIME_ENVS = [
  "TLSN_WORKER_INTERNAL_URL",
  "TLSN_TRIGGER_CALLBACK_SECRET",
  "TLSN_TRIGGER_VERIFIER_KEY_ID",
  "TLSN_TRIGGER_NOTARY_KEY_ID",
  "TLSN_TRIGGER_NOTARY_REGISTRY",
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required deploy env for Trigger sync: ${name}`);
  }
  return value;
}

export default defineConfig({
  project: process.env["TRIGGER_PROJECT_REF"]?.trim() || "cli-project-ref",
  runtime: "node-22",
  maxDuration: timeout.None,
  dirs: ["./src/trigger"],
  build: {
    extensions: [
      syncEnvVars(async () =>
        ({
          ...Object.fromEntries(
            [...REQUIRED_RUNTIME_ENVS, ...triggerOriginRuntimeEnvNames(process.env)]
              .map((name) => [name, requireEnv(name)]),
          ),
          [TRIGGER_ORIGIN_INVENTORY_ARTIFACT_RAW_SHA256_ENV]: originInventoryArtifactRawSha256(
            await readFile(new URL("../configs/tlsn-origin-inventory.json.txt", import.meta.url)),
          ),
        }),
      ),
      additionalFiles({
        files: [
          "../FUSOU-TLSN-VERIFICATION-WORKER/src/wasm/fusou_tlsn_verifier.js",
          "../FUSOU-TLSN-VERIFICATION-WORKER/src/wasm/fusou_tlsn_verifier_bg.wasm",
          "../configs/tlsn-origin-inventory.json.txt",
        ],
      }),
    ],
  },
});
