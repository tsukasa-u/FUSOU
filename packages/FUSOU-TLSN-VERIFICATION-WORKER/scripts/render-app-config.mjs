#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { appConfigTomlFromManifest, assertPublicManifest } from "./production-trust-contract.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const manifestPath = argument("--manifest");
  const outputPath = argument("--output");
  const artifactOutputPath = argument("--artifact-output-path");
  if (!manifestPath || !outputPath || !artifactOutputPath) {
    throw new Error("usage: render-app-config --manifest <path> --output <path> --artifact-output-path <local-path>");
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertPublicManifest(manifest);
  const config = appConfigTomlFromManifest(manifest, artifactOutputPath);
  await writeFile(outputPath, config, { encoding: "utf8", mode: 0o600 });
}

main().catch((error) => {
  console.error(`[tlsn-render-app-config] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
