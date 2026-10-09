#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireAppWorkerReference } from "./app-worker-deployment-reference.mjs";
import { buildApprovedApp, entryInputSha256, sha256 } from "./app-build-handoff.mjs";
import { controlPlaneResponse, environment, provenance, manifest, version1 } from "./app-worker-reference-fixture.mjs";
import { writeDotenvxFixture, publicFixtureInputs, fixtureSecrets } from "./app-dotenvx-fixture.mjs";
import { loadCanonicalAppDotenvx } from "./app-dotenvx-inputs.mjs";
import { publicAppConfigurationSha256 } from "./app-public-configuration.mjs";

const repository = new URL("../../..", import.meta.url).pathname;
const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
const reference = await acquireAppWorkerReference({
  environment, provenance, publicManifest: manifest,
  fetchImpl: async (url) => new Response(JSON.stringify(controlPlaneResponse(url))),
});
const root = await mkdtemp(join(tmpdir(), "fusou-app-build-handoff-smoke-"));
try {
  const fixtureApp = join(root, "dotenvx-fixture/packages/FUSOU-APP");
  await writeDotenvxFixture(fixtureApp, { encrypted: true });
  const referencePath = join(root, "approved-reference.json");
  const bytes = `${JSON.stringify(reference, null, 2)}\n`;
  await writeFile(referencePath, bytes, { flag: "wx", mode: 0o600 });
  const result = await buildApprovedApp({
    referencePath, expectedReferenceSha256: sha256(bytes),
    expectedWorkerSha: environment.TLSN_GIT_COMMIT_SHA, expectedAppSha: source,
    outputDirectory: join(root, "build"), repositoryDirectory: repository,
    toolchain: "1.95.0", profile: "debug",
  }, { loadDotenvx: (_appDirectory, buildEnvironment) => loadCanonicalAppDotenvx(fixtureApp, buildEnvironment) });
  assert.equal(result.record.compiled_report.active_version_id, version1);
  assert.equal(result.record.entry_input_sha256, entryInputSha256(reference.compile_inputs));
  assert.equal(result.record.artifact.sha256, sha256(await readFile(result.artifactPath)));
  assert.equal(result.record.public_app_configuration_sha256, publicAppConfigurationSha256(publicFixtureInputs));
  assert.equal(result.record.public_app_configuration_comparison, "VERIFIED");
  const substitutedRuntime = execFileSync(result.artifactPath, ["--app-compiled-public-configuration"], {
    encoding: "utf8",
    env: { PUBLIC_SUPABASE_URL: "https://runtime-substitution.example.com", PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_runtime_substitution", DISCORD_CLIENT_ID: "333" },
  });
  assert.equal(JSON.parse(substitutedRuntime).public_app_configuration_sha256, result.record.public_app_configuration_sha256);
  const recordBytes = await readFile(result.recordPath, "utf8");
  for (const value of [...Object.values(publicFixtureInputs), ...Object.values(fixtureSecrets)]) assert.ok(!recordBytes.includes(value));
  console.log(`[app-build-handoff-smoke] actual APP binary and Node/Rust entry digest VERIFIED; APP source ${source}; Cloudflare observation MOCK ONLY`);
  console.log(`[app-dotenvx-binary-smoke] encrypted canonical fixture acquisition and actual fusou-auth/Discord compiled digest VERIFIED; runtime substitution rejected; APP source ${source}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
