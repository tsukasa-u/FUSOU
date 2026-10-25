import assert from "node:assert/strict";
import { test } from "node:test";
import { RELEASE_SCOPE, sha256, encodeReleaseManifest, parseReleaseManifest, validateReleaseManifest,
  observeReleaseBuildRuns, assertReleaseRuntimeConfigBinding, verifyProductionReleaseManifest,
  recheckReleaseManifestTag } from "./release-manifest.mjs";

const commit = "a".repeat(40), coordinator = "b".repeat(40);
function fixture() {
  const evidenceBytes = new Map(), artifactBytes = new Map(), buildRecords = new Map();
  const blob = (label) => { const b = Buffer.from(label); const hash = sha256(b); evidenceBytes.set(hash, b); return hash; };
  const artifacts = ["app", "worker"].map((role) => {
    const raw = Buffer.from(`synthetic ${role} bytes`), platform = role === "app" ? "linux-x86_64" : "cloudflare-workers";
    const record = Buffer.from(JSON.stringify({
      artifact_sha256: sha256(raw), input_record_sha256: blob(`${role} detailed build record`),
      platform, run_attempt: 1, run_id: 30, schema_version: 1, scope: "fusou-release-build-provenance-v1",
      source_sha: commit, workflow_sha: coordinator,
    }));
    artifactBytes.set(role, raw); buildRecords.set(role, record);
    return { name: role, role, platform, sha256: sha256(raw), byte_length: raw.length, source_sha: commit,
      build_run_id: 30, build_run_attempt: 1, build_workflow_sha: coordinator, build_record_sha256: sha256(record) };
  });
  const manifest = {
    schema_version: 1, scope: RELEASE_SCOPE,
    release: { repository: "tsukasa-u/FUSOU", tag: "fusou-v0.6.0", kind: "production", commit_sha: commit, app_version: "0.6.0" },
    validation: { run_id: 10, run_attempt: 1, workflow_path: ".github/workflows/tlsn-tag-validation.yml", workflow_blob_sha: coordinator, source_sha: commit },
    eligibility: { run_id: 20, run_attempt: 1, coordinator_sha: coordinator, status: "PRODUCTION_ELIGIBLE" },
    artifacts,
    worker: { name: "fusou-verifier", source_sha: commit, artifact_sha256: artifacts[1].sha256, version_id: "11111111-1111-1111-1111-111111111111" },
    runtime_config: { schema_version: 2, epoch: "1", manifest_sha256: blob("runtime envelope"), signer_key_id: "runtime", trust_root_sha256: blob("public root") },
    registries: { result_signer_key_id: "result", result_registry_sha256: blob("result registry"), notary_registry_sha256: blob("notary registry"),
      session_authority_key_id: "authority", security_registry_set_sha256: blob("security set") },
    targets: { origin_inventory_sha256: blob("inventory"), target_approval_artifact_sha256: blob("approval") },
    checks: Object.fromEntries(["locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"].map((key) => {
      const record = { check: key, evidence_sha256: blob(`${key} evidence`), run_attempt: 1, run_id: 30,
        schema_version: 1, scope: "fusou-release-check-v1", source_sha: commit, status: "PASS", workflow_sha: coordinator };
      return [key, blob(JSON.stringify(record))];
    })),
    deployment: { status: "NOT_CHECKED" },
  };
  const observedRuns = new Map([["30:1", { id: 30, run_attempt: 1, repository: { full_name: "tsukasa-u/FUSOU" },
    head_repository: { full_name: "tsukasa-u/FUSOU" }, event: "workflow_run",
    path: ".github/workflows/tlsn-release-eligibility.yml", head_branch: "main", head_sha: coordinator,
    status: "completed", conclusion: "success" }]]);
  return { manifest, options: { expected: structuredClone(manifest), artifactBytes, buildRecords, evidenceBytes, observedRuns } };
}
test("manifest canonical roundtrip binds actual bytes without authorizing signing or deployment", () => {
  const { manifest, options } = fixture();
  const raw = encodeReleaseManifest(manifest);
  const verified = validateReleaseManifest(raw, options);
  assert.equal(verified.status, "RELEASE_ARTIFACTS_VALIDATED");
  assert.equal(verified.manifest_sha256, sha256(raw));
  assert.equal(verified.publication_authorized, false);
  assert.equal(verified.signature_status, "NOT_CHECKED");
});
test("build provenance run is independently queried, not taken from an artifact claim", async () => {
  const f = fixture();
  const run = f.options.observedRuns.get("30:1");
  let calls = 0;
  const github = { rest: { actions: { getWorkflowRun: async ({ run_id }) => {
    assert.equal(run_id, 30); calls++; return { data: run };
  } } } };
  assert.equal((await observeReleaseBuildRuns(github, f.manifest, f.options.evidenceBytes)).size, 1);
  assert.equal(calls, 1);
  for (const change of [
    { id: 31 }, { run_attempt: 2 }, { head_sha: commit }, { head_branch: "fusou-v0.6.0" },
    { path: "other.yml" }, { conclusion: "failure" }, { repository: { full_name: "other/repo" } },
  ]) {
    const g = fixture();
    Object.assign(g.options.observedRuns.get("30:1"), change);
    assert.throws(() => validateReleaseManifest(encodeReleaseManifest(g.manifest), g.options), /build run metadata/);
  }
});
test("key order in object construction canonicalizes; wire whitespace, order, duplicates and BOM reject", () => {
  const { manifest } = fixture();
  const raw = encodeReleaseManifest(manifest);
  const reversed = Object.fromEntries(Object.entries(manifest).reverse());
  assert.deepEqual(encodeReleaseManifest(reversed), raw);
  for (const text of [`${raw}\n`, JSON.stringify(manifest), `\ufeff${raw}`,
    raw.toString().replace('"schema_version":1', '"schema_version":0,"schema_version":1')]) {
    assert.throws(() => parseReleaseManifest(Buffer.from(text)));
  }
});
test("every independent release axis rejects mixed release data", () => {
  for (const [field, key, value] of [
    ["release", "commit_sha", coordinator], ["worker", "version_id", "22222222-2222-2222-2222-222222222222"],
    ["runtime_config", "manifest_sha256", sha256(Buffer.from("different"))],
    ["runtime_config", "epoch", "2"], ["validation", "run_id", 99],
    ["eligibility", "run_attempt", 2], ["registries", "result_signer_key_id", "other"],
    ["targets", "origin_inventory_sha256", sha256(Buffer.from("different"))],
  ]) {
    const f = fixture();
    f.options.expected[field][key] = value;
    assert.throws(() => validateReleaseManifest(encodeReleaseManifest(f.manifest), f.options), /independent reference/);
  }
});
test("artifact corruption, truncation, wrong/missing provenance and evidence readback fail closed", () => {
  for (const mutate of [
    (f) => f.options.artifactBytes.set("app", Buffer.from("corrupt")),
    (f) => f.options.artifactBytes.delete("worker"),
    (f) => f.options.buildRecords.set("app", Buffer.from("{}")),
    (f) => f.options.evidenceBytes.delete(f.manifest.runtime_config.manifest_sha256),
    (f) => f.options.evidenceBytes.set(f.manifest.targets.origin_inventory_sha256, Buffer.from("changed")),
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => validateReleaseManifest(encodeReleaseManifest(f.manifest), f.options));
  }
});
test("missing, unknown/secret fields and self-attested completed deployment reject", () => {
  for (const mutate of [
    (m) => { delete m.worker; }, (m) => { m.private_key = "never allowed"; },
    (m) => { m.runtime_config.manifest_sha256 = null; }, (m) => { m.artifacts[0].sha256 = ""; },
    (m) => { m.deployment.status = "DEPLOYMENT_VERIFIED"; }, (m) => { m.release.kind = "development"; },
  ]) {
    const f = fixture(); mutate(f.manifest);
    assert.throws(() => encodeReleaseManifest(f.manifest));
  }
  const f = fixture();
  assert.throws(() => validateReleaseManifest(encodeReleaseManifest(f.manifest)), /independent/);
});
test("signed Runtime Config payload linkage rejects wrong Worker version, source, epoch, target or signer", () => {
  const f = fixture(), m = f.manifest;
  const registry = '{"synthetic":"public-reference-only"}';
  m.registries.result_registry_sha256 = sha256(Buffer.from(registry));
  const payload = { epoch: m.runtime_config.epoch, source: {
    worker_git_commit_sha: m.release.commit_sha, active_version_id: m.worker.version_id, script_name: m.worker.name,
  }, production_authority_pins: { ...m.targets, security_registry_set_sha256: m.registries.security_registry_set_sha256 },
  result_registry_pins: { result_registry_sha256: m.registries.result_registry_sha256 },
  compile_inputs: { FUSOU_TLSN_RESULT_SIGNER_KEY_ID: m.registries.result_signer_key_id,
    FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID: m.registries.session_authority_key_id, FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY: registry } };
  const envelope = f.options.evidenceBytes.get(m.runtime_config.manifest_sha256);
  assertReleaseRuntimeConfigBinding(m, payload, envelope);
  for (const mutate of [
    (p) => { p.source.active_version_id = "other"; }, (p) => { p.source.worker_git_commit_sha = coordinator; },
    (p) => { p.epoch = "2"; }, (p) => { p.production_authority_pins.origin_inventory_sha256 = "other"; },
    (p) => { p.compile_inputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID = "other"; },
  ]) {
    const p = structuredClone(payload); mutate(p);
    assert.throws(() => assertReleaseRuntimeConfigBinding(m, p, envelope));
  }
});
test("Production manifest verifier has no signature or independent-input bypass", async () => {
  const f = fixture();
  await assert.rejects(verifyProductionReleaseManifest(encodeReleaseManifest(f.manifest), f.options), /independent Production verification inputs/);
});
test("downstream consumer independently rechecks current tag and exact validation run attempt", async () => {
  const { manifest } = fixture();
  let target = commit;
  const repository = { full_name: "tsukasa-u/FUSOU" };
  const github = { rest: {
    actions: { getWorkflowRun: async () => ({ data: { id: 10, run_attempt: 1, repository, head_repository: repository,
      path: ".github/workflows/tlsn-tag-validation.yml", head_sha: commit, head_branch: manifest.release.tag,
      event: "push", status: "completed", conclusion: "success" } }) },
    git: { getRef: async () => ({ data: { object: { type: "commit", sha: target } } }) },
    repos: {
      getBranch: async () => ({ data: { commit: { sha: coordinator } } }),
      compareCommitsWithBasehead: async () => ({ data: { status: "ahead", merge_base_commit: { sha: commit } } }),
      getContent: async () => ({ data: { type: "file", sha: coordinator } }),
    },
  } };
  await recheckReleaseManifestTag(github, manifest, coordinator);
  target = coordinator;
  await assert.rejects(recheckReleaseManifestTag(github, manifest, coordinator), /tag moved/);
  target = commit;
  manifest.validation.run_attempt = 2;
  await assert.rejects(recheckReleaseManifestTag(github, manifest, coordinator), /live tag\/validation/);
});
test("even matching record hashes cannot turn failed, foreign-source or missing check evidence into success", () => {
  for (const mutate of [
    (record) => { record.status = "FAIL"; }, (record) => { record.source_sha = coordinator; },
    (record) => { record.evidence_sha256 = sha256(Buffer.from("missing")); },
    (record) => { record.run_attempt = 2; },
  ]) {
    const f = fixture(), originalHash = f.manifest.checks.offline_verification;
    const record = JSON.parse(f.options.evidenceBytes.get(originalHash));
    mutate(record);
    const bytes = Buffer.from(JSON.stringify(record)), hash = sha256(bytes);
    f.options.evidenceBytes.set(hash, bytes);
    f.manifest.checks.offline_verification = hash;
    f.options.expected.checks.offline_verification = hash;
    assert.throws(() => validateReleaseManifest(encodeReleaseManifest(f.manifest), f.options));
  }
});
