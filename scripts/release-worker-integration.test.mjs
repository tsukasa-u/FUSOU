import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { WORKER_ROOT, WORKER_SOURCE_PATHS, inspectWorkerSource, encodeUnsignedWorkerPackage, parseUnsignedWorkerPackage } from "./release-worker-source.mjs";
import { buildUnsignedWorker } from "./release-worker-build.mjs";
import { wasmFixture, workerSourceFixture, fixtureToolchain } from "./release-check-fixture.mjs";
import { assertReleaseWasmProof } from "./release-wasm-proof.mjs";
import { sha256, MAX_RELEASE_RECORD_BYTES } from "./release-bytes.mjs";
import { parseReleaseRecord } from "./release-build-proof.mjs";
import { buildWorkerWasm } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/build-wasm.mjs";
import { assertPreparedResultContract, resolvePinnedProductionTargets } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/production-result-contract.mjs";
import { archiveCustomMetadata, createR2ArchiveReadbackBackend } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-readback.mjs";

const root = new URL("../", import.meta.url), sourceSha = "a".repeat(40);
const read = (path) => readFile(new URL(path, root));
test("restored actual source has a parse-only closed import graph; semantics and bundle remain NOT_CHECKED", async () => {
  const files = new Map(await Promise.all(WORKER_SOURCE_PATHS.map(async (path) => [path, await read(path)])));
  const result = inspectWorkerSource(files, sourceSha);
  assert.equal(result.status, "SOURCE_INPUTS_PRESENT");
  assert.equal(result.runtime_semantics, "NOT_CHECKED");
  assert.equal(result.bundle_status, "NOT_CHECKED");
  assert.ok(result.import_closure.dependencies[`${WORKER_ROOT}/src/index.ts`].includes("hono"));
  assert.deepEqual(Object.keys(JSON.parse(files.get(`${WORKER_ROOT}/package.json`)).scripts).sort(),
    ["build:wasm", "typecheck", "verify:wasm-provenance"]);
  files.delete(`${WORKER_ROOT}/src/binding_authority.ts`);
  assert.deepEqual(inspectWorkerSource(files, sourceSha).missing_paths, [`${WORKER_ROOT}/src/binding_authority.ts`]);
});
test("parse-only candidate source is never evaluated, and dynamic imports and unresolved modules fail closed", () => {
  const files = workerSourceFixture(), path = `${WORKER_ROOT}/src/index.ts`;
  files.set(path, Buffer.from('throw new Error("must never execute"); import "./binding_authority.js";'));
  assert.equal(inspectWorkerSource(files, sourceSha).status, "SOURCE_INPUTS_PRESENT");
  files.set(path, Buffer.from('import("./unknown.js");'));
  assert.throws(() => inspectWorkerSource(files, sourceSha), /dynamic|parse-only/);
  files.set(path, Buffer.from('import "./unknown.js";'));
  assert.throws(() => inspectWorkerSource(files, sourceSha), /missing Worker import/);
});
test("actual runtime statically retains APP endpoints, separate signing domains and archive-before-authority ordering", async () => {
  const index = (await read(`${WORKER_ROOT}/src/index.ts`)).toString();
  const app = (await read("packages/FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs")).toString();
  for (const endpoint of ["/health", "/attestation/session", "/verify/tlsn", "/verify/tlsn/sparse"]) {
    assert.ok(index.includes(`"${endpoint}"`)); assert.ok(app.includes(`"${endpoint}"`));
  }
  assert.ok(index.includes("FUSOU-VERIFIER-RESULT-V2"));
  assert.ok(index.includes("FUSOU-VERIFIER-SPARSE-RESULT-V2"));
  assert.ok(index.includes("assertPreparedResultContract"));
  const commits = [...index.matchAll(/await authority\.commitVerifiedResult/g)];
  assert.equal(commits.length, 2);
  for (const commit of commits) {
    const prefix = index.slice(Math.max(0, commit.index - 3000), commit.index);
    assert.ok(prefix.includes("await persistAndVerifyPresentationArchive("));
    assert.ok(prefix.includes("await persistAndVerifyResultArchive("));
    assert.ok(prefix.includes("archiveContext"));
  }
});

for (const profile of ["complete", "sparse"]) {
  test(`${profile} current Result requires exact raw Presentation and both Production target digests`, async () => {
    const presentationBytes = Buffer.from('{"synthetic":"presentation"}');
    const options = { profile, presentationBytes, serverIdentity: "game.example.test", profileSha256: "p".repeat(43),
      production: true, inventorySha256: "i".repeat(43), approvalSha256: "a".repeat(43) };
    const result = { version: profile === "complete" ? 2 : 3,
      profile_id: profile === "complete" ? "fusou-require-info-v1" : "fusou-require-info-v2-sparse",
      profile_sha256: options.profileSha256, server_identity: options.serverIdentity,
      presentation_sha256: sha256(presentationBytes), origin_inventory_sha256: options.inventorySha256,
      target_approval_artifact_sha256: options.approvalSha256, ...(profile === "sparse" ? { disclosure_mode: "sparse" } : {}) };
    await assertPreparedResultContract(result, options);
    for (const mutation of [
      { ...result, version: result.version - 1 }, { ...result, server_identity: "candidate.example.test" },
      { ...result, presentation_sha256: sha256(Buffer.from("other")) },
      { ...result, origin_inventory_sha256: null }, { ...result, target_approval_artifact_sha256: null },
    ]) await assert.rejects(assertPreparedResultContract(mutation, options), /Result|provenance/);
    await assert.rejects(assertPreparedResultContract(result, { ...options, presentationBytes: Buffer.concat([presentationBytes, Buffer.from("\n")]) }), /provenance/);
    await assert.rejects(assertPreparedResultContract(result, { ...options, inventorySha256: null, approvalSha256: null }), /both target digests/);
    await assert.rejects(assertPreparedResultContract({ ...result, server_identity: "GAME.EXAMPLE.TEST" },
      { ...options, serverIdentity: "GAME.EXAMPLE.TEST" }), /server identity|hostname|DNS/);
  });
}
test("historical APPROVED marker is not authority without externally supplied exact-byte pins", async () => {
  const inventoryRaw = (await read("packages/configs/tlsn-origin-inventory.json.txt")).toString();
  const approvalRaw = (await read("packages/configs/tlsn-target-approval.json.txt")).toString();
  await assert.rejects(resolvePinnedProductionTargets({ inventoryRaw, approvalRaw }), /independent/);
  // Test-only expected values exercise byte comparison, not current Production approval.
  const options = { inventoryRaw, approvalRaw, inventoryPin: sha256(Buffer.from(inventoryRaw)), approvalPin: sha256(Buffer.from(approvalRaw)) };
  assert.equal((await resolvePinnedProductionTargets(options)).targets.length, 20);
  await assert.rejects(resolvePinnedProductionTargets({ ...options, inventoryRaw: inventoryRaw + "\n" }), /independent pins/);
  await assert.rejects(resolvePinnedProductionTargets({ ...options, approvalPin: "a".repeat(43) }), /independent pins/);
});

for (const mutation of ["source", "dirty", "compiler", "flags", "bytes", "missing", "bundle"]) {
  test(`raw WASM proof rejects ${mutation} mismatch without running WASM`, () => {
    const f = wasmFixture(sourceSha), options = { sourceSha, sourceInputs: structuredClone(f.provenance.source_inputs),
      toolchain: structuredClone(f.toolchain), artifactBytes: new Map(f.artifacts), modules: new Map(f.modules) };
    assert.equal(assertReleaseWasmProof(f.raw, options).source_commit_sha, sourceSha);
    const provenance = structuredClone(f.provenance);
    if (mutation === "source") options.sourceSha = "b".repeat(40);
    if (mutation === "dirty") provenance.source_tree_status = "DIRTY";
    if (mutation === "compiler") options.toolchain.rustc = "foreign compiler";
    if (mutation === "flags") options.toolchain.cflags_sha256 = "b".repeat(43);
    if (mutation === "bytes") options.artifactBytes.set("fusou_tlsn_verifier.js", Buffer.from("modified"));
    if (mutation === "missing") options.artifactBytes.delete("fusou_tlsn_verifier_bg.wasm.d.ts");
    if (mutation === "bundle") options.modules.set("verifier.wasm", Buffer.from("foreign binary"));
    assert.throws(() => assertReleaseWasmProof(Buffer.from(JSON.stringify(provenance)), options), /WASM|toolchain|artifact/);
  });
}
function mockedWasmBuild(mutation) {
  const f = wasmFixture(sourceSha), calls = []; let snapshots = 0;
  const options = { expectedSourceSha: sourceSha, executionAllowed: true,
    environment: { RUSTUP_TOOLCHAIN: "1.98.1", PATH: "/synthetic", GITHUB_TOKEN: "synthetic-marker",
      NODE_OPTIONS: "--synthetic-unsafe-option", FUSOU_RESULT_PRIVATE_KEY: "synthetic-marker" } };
  const dependencies = {
    run: (command, argv, options) => {
      calls.push({ command, argv, options });
      return { status: mutation === "failure" && argv[0] === "build" ? 1 : 0,
        stdout: command === "git" ? (mutation === "head" ? "b".repeat(40) : sourceSha) : "" };
    }, collectInputs: async () => {
      snapshots++;
      return mutation === "changed" && snapshots > 1 ? [] : f.provenance.source_inputs;
    }, writeProvenance: async () => ({ ...f.provenance, ...(mutation === "dirty" ? { source_tree_status: "DIRTY" } : {}) }),
    findCompiler: () => "synthetic-clang", compilerFlags: () => "--synthetic-flags", resolvePack: () => "synthetic-wasm-pack",
  };
  return { options, dependencies, calls, snapshots: () => snapshots };
}
test("WASM authorization and exact source checks precede native tools and source collectors", async () => {
  const f = mockedWasmBuild();
  await assert.rejects(buildWorkerWasm({ ...f.options, executionAllowed: false }, f.dependencies), /not authorized/);
  await assert.rejects(buildWorkerWasm({ ...f.options, expectedSourceSha: undefined }, f.dependencies), /exact/);
  assert.equal(f.calls.length, 0); assert.equal(f.snapshots(), 0);
});
test("mocked WASM recipe records offline locked flags and removes secret-bearing environment", async () => {
  const f = mockedWasmBuild();
  assert.equal((await buildWorkerWasm(f.options, f.dependencies)).source_commit_sha, sourceSha);
  const compile = f.calls.find((call) => call.argv[0] === "build");
  assert.deepEqual(compile.argv.slice(-2), ["--", "--locked"]);
  assert.equal(compile.options.env.CARGO_NET_OFFLINE, "true");
  for (const key of ["GITHUB_TOKEN", "NODE_OPTIONS", "FUSOU_RESULT_PRIVATE_KEY"]) assert.equal(compile.options.env[key], undefined);
});
for (const mutation of ["head", "failure", "changed", "dirty"]) {
  test(`mocked WASM build rejects ${mutation} without native execution`, async () => {
    const f = mockedWasmBuild(mutation);
    await assert.rejects(buildWorkerWasm(f.options, f.dependencies), /source|failed|provenance/);
    if (mutation === "head") assert.equal(f.snapshots(), 0);
  });
}
test("Worker driver requires explicit authorization before reading files or invoking tools", async () => {
  const fail = () => { throw new Error("must not execute"); };
  const result = await buildUnsignedWorker({}, { read: fail, run: fail, list: fail });
  assert.deepEqual(result, { status: "BLOCKED_EXTERNAL_INPUTS", blockers: ["WORKER_BUILD_EXECUTION_NOT_AUTHORIZED"] });
});
test("Worker artifact bytes are not restricted to the small metadata-record limit", () => {
  const modules = new Map([["index.js", Buffer.alloc(MAX_RELEASE_RECORD_BYTES + 1, 32)],
    ["verifier.wasm", Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])]]);
  const raw = encodeUnsignedWorkerPackage(modules);
  assert.ok(raw.length > MAX_RELEASE_RECORD_BYTES);
  assert.equal(parseUnsignedWorkerPackage(raw).entrypoint, "index.js");
  assert.throws(() => parseReleaseRecord(raw), /record bytes\/size/);
});
test("actual Worker driver recipe is exercised with in-memory source and generated outputs only", async () => {
  const sourceFiles = workerSourceFixture(), wasm = wasmFixture(sourceSha), calls = [], prefix = "/synthetic/source/";
  const files = new Map([...sourceFiles].map(([path, raw]) => [prefix + path, raw]));
  for (const [name, raw] of wasm.artifacts) files.set(`${prefix}${WORKER_ROOT}/src/wasm/${name}`, raw);
  files.set(`${prefix}${WORKER_ROOT}/src/wasm/wasm-provenance.json`, wasm.raw);
  for (const [name, raw] of wasm.modules) files.set(`${prefix}.fusou-worker-bundle/${name}`, raw);
  const result = await buildUnsignedWorker({ inputs: { rust_toolchain: fixtureToolchain.rust,
    worker_reference: { compile_inputs: { FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA: sourceSha },
      cloudflare: { version_id: "11111111-1111-1111-1111-111111111111", script_name: "synthetic-worker" } } },
    eligibility: { commit_sha: sourceSha, coordinator_sha: "b".repeat(40) }, workspace: "/synthetic", runId: 30, runAttempt: 1,
    executionAllowed: true }, { read: async (path) => { assert.ok(files.has(path), path); return files.get(path); },
    list: async () => [...wasm.modules.keys()], collectInputs: async () => wasm.provenance.source_inputs,
    run: (command, args) => { calls.push([command, ...args]); return Buffer.from(command === "git" ? sourceSha :
      args.includes("--version") ? args.includes("wrangler") ? fixtureToolchain.wrangler : fixtureToolchain.pnpm : ""); } });
  assert.equal(result.status, "BUILD_OUTPUTS_GENERATED");
  assert.equal(result.publication_authorized, false);
  assert.ok(calls.some((argv) => argv.includes("--dry-run")));
  assert.ok(calls.some((argv) => argv.includes("typecheck")));
});

const archiveContext = { source_sha: sourceSha, session_id: "session", job_id: "job", verification_attempt_id: "attempt", binding_id: sha256(Buffer.from("binding")) };
async function archiveFunctions() {
  const path = `${WORKER_ROOT}/src/result_archive.ts`;
  const source = stripTypeScriptTypes((await read(path)).toString(), { mode: "strip" })
    .replace('"./archive-readback.mjs"', JSON.stringify(new URL(`${WORKER_ROOT}/src/archive-readback.mjs`, root).href));
  return import("data:text/javascript," + encodeURIComponent(source));
}
test("archive persistence checks actual readback generation, authority metadata, bytes and explicit cleanup failures", async () => {
  const { persistAndVerifyResultArchive: persist } = await archiveFunctions(), bytes = Buffer.from("synthetic result");
  for (const mutation of ["none", "version", "metadata", "bytes", "cleanup"]) {
    let deletes = 0;
    const metadata = archiveCustomMetadata("result", archiveContext);
    const bucket = { put: async (key, raw, options) => {
      assert.deepEqual(options.customMetadata, metadata); assert.deepEqual(raw, bytes);
      return { version: "written" };
    }, get: async () => ({ version: mutation === "version" ? "foreign" : "written",
      customMetadata: mutation === "metadata" ? {} : metadata,
      arrayBuffer: async () => mutation === "bytes" || mutation === "cleanup" ? Buffer.from("corrupt") : bytes }),
    delete: async () => { deletes++; if (mutation === "cleanup") throw new Error("cleanup failed"); } };
    const call = () => persist(bucket, "object", bytes, sha256(bytes), archiveContext);
    if (mutation === "none") await call();
    else await assert.rejects(call(), (error) => mutation === "cleanup" ? error instanceof AggregateError && error.errors.length === 2 :
      /archive verification failed/.test(error.message));
    assert.equal(deletes, ["none", "version"].includes(mutation) ? 0 : 1);
  }
  let deleted = false;
  await persist({ put: async () => undefined, get: async () => ({ arrayBuffer: async () => bytes }), delete: async () => { deleted = true; } },
    "legacy-object", bytes, sha256(bytes));
  assert.equal(deleted, false);
});
test("R2 readback adapter uses observed metadata and independent capture resolver, never echoes expected identity", async () => {
  let calls = 0, seen;
  const bytes = Buffer.from("synthetic readback"), metadata = archiveCustomMetadata("result", archiveContext);
  const adapter = createR2ArchiveReadbackBackend({ backendId: "synthetic-r2",
    bucket: { get: async () => { calls++; return { version: "actual-version", customMetadata: metadata, arrayBuffer: async () => bytes }; } },
    resolveCapture: async (identity) => { seen = identity; return "independent-capture"; } });
  const observed = await adapter.get({ object_key: "actual-key", session_id: "candidate-self-claim", version_id: "candidate-version" });
  assert.equal(calls, 1); assert.equal(observed.session_id, archiveContext.session_id);
  assert.equal(observed.version_id, "actual-version"); assert.equal(seen.object_key, "actual-key");
  assert.equal(observed.sha256, sha256(bytes)); assert.equal(observed.retention_status, "NOT_CHECKED");
  assert.throws(() => createR2ArchiveReadbackBackend({ bucket: {}, backendId: "id" }), /independent capture/);
  const absent = createR2ArchiveReadbackBackend({ bucket: { get: async () => null }, backendId: "id", resolveCapture: async () => "id" });
  await assert.rejects(absent.get({ object_key: "missing" }), /missing/);
});
