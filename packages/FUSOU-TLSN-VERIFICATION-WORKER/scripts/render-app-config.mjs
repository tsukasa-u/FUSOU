#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { appConfigTomlFromManifest, assertPublicManifest } from "./production-trust-contract.mjs";
import { assertCanaryDeploymentManifest } from "./canary-deployment-manifest.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const manifestPath = argument("--manifest");
  const canaryManifestPath = argument("--canary-manifest");
  const outputPath = argument("--output");
  const artifactOutputPath = argument("--artifact-output-path");
  const runtimeAttestationEndpoint = argument("--runtime-attestation-endpoint");
  if (!manifestPath || !canaryManifestPath || !outputPath || !artifactOutputPath || !runtimeAttestationEndpoint) {
    throw new Error("usage: render-app-config --manifest <path> --canary-manifest <path> --output <path> --artifact-output-path <local-path> --runtime-attestation-endpoint <https-url>");
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertPublicManifest(manifest);
  const canaryDeploymentManifest = await assertCanaryDeploymentManifest(
    await readFile(canaryManifestPath, "utf8"),
  );
  const config = appConfigTomlFromManifest(
    manifest,
    artifactOutputPath,
    canaryDeploymentManifest,
    runtimeAttestationEndpoint,
  );
  await writeFile(outputPath, config, { encoding: "utf8", mode: 0o600 });
}

main().catch((error) => {
  console.error(`[tlsn-render-app-config] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
