#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireAppWorkerReference } from "./app-worker-deployment-reference.mjs";
import { buildApprovedApp, entryInputSha256, sha256 } from "./app-build-handoff.mjs";
import { controlPlaneResponse, environment, provenance, manifest, version1 } from "./app-worker-reference-fixture.mjs";

const repository = new URL("../../..", import.meta.url).pathname;
const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
const reference = await acquireAppWorkerReference({
  environment, provenance, publicManifest: manifest,
  fetchImpl: async (url) => new Response(JSON.stringify(controlPlaneResponse(url))),
});
const root = await mkdtemp(join(tmpdir(), "fusou-app-build-handoff-smoke-"));
try {
  const referencePath = join(root, "approved-reference.json");
  const bytes = `${JSON.stringify(reference, null, 2)}\n`;
  await writeFile(referencePath, bytes, { flag: "wx", mode: 0o600 });
  const result = await buildApprovedApp({
    referencePath, expectedReferenceSha256: sha256(bytes),
    expectedWorkerSha: environment.TLSN_GIT_COMMIT_SHA, expectedAppSha: source,
    outputDirectory: join(root, "build"), repositoryDirectory: repository,
    toolchain: "1.95.0", profile: "debug",
  });
  assert.equal(result.record.compiled_report.active_version_id, version1);
  assert.equal(result.record.entry_input_sha256, entryInputSha256(reference.compile_inputs));
  assert.equal(result.record.artifact.sha256, sha256(await readFile(result.artifactPath)));
  console.log(`[app-build-handoff-smoke] actual APP binary and Node/Rust entry digest VERIFIED; APP source ${source}; Cloudflare observation MOCK ONLY`);
} finally {
  await rm(root, { recursive: true, force: true });
}
