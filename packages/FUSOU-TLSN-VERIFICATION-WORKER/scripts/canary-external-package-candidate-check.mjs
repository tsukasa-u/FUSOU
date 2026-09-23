#!/usr/bin/env node

import { checkCanaryExternalPackageCandidate } from "./canary-external-package-candidate.mjs";

const argumentsList = process.argv.slice(2).filter((argument) => argument !== "--");
const outputDirectory = argumentsList[0] === "--output" ? argumentsList[1] : null;
if (!outputDirectory || argumentsList.length !== 2) {
  console.error("Usage: node scripts/canary-external-package-candidate-check.mjs --output DIR");
  process.exitCode = 2;
} else {
  try {
    console.log(JSON.stringify(await checkCanaryExternalPackageCandidate({ outputDirectory }), null, 2));
  } catch (error) {
    console.error(`[tlsn-canary-external-package-candidate-check] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
