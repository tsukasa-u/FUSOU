#!/usr/bin/env node

import { parseArgs } from "node:util";
import { buildApprovedApp } from "./app-build-handoff.mjs";

try {
  let values;
  try {
    ({ values } = parseArgs({ options: {
    reference: { type: "string" },
    "reference-sha256": { type: "string" },
    "worker-sha": { type: "string" },
    "app-sha": { type: "string" },
    output: { type: "string" },
    toolchain: { type: "string" },
    profile: { type: "string", default: "release" },
    } }));
  } catch {
    throw new Error("invalid approved APP build command-line arguments");
  }
  for (const name of ["reference", "reference-sha256", "worker-sha", "app-sha", "output", "toolchain"]) {
    if (!values[name]) throw new Error(`missing required build argument: --${name}`);
  }
  const result = await buildApprovedApp({
    referencePath: values.reference, expectedReferenceSha256: values["reference-sha256"],
    expectedWorkerSha: values["worker-sha"], expectedAppSha: values["app-sha"],
    outputDirectory: values.output, toolchain: values.toolchain, profile: values.profile,
    repositoryDirectory: new URL("../../..", import.meta.url).pathname,
  });
  console.log(`[approved-app-build] compiled input comparison VERIFIED; record: ${result.recordPath}`);
} catch (error) {
  console.error(`[approved-app-build] ${error instanceof Error ? error.message : "build failed"}`);
  process.exitCode = 1;
}
