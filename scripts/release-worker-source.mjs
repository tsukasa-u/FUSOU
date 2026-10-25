import { createHash } from "node:crypto";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { sha256 } from "./release-bytes.mjs";
import { requireRelease } from "./release-build-proof.mjs";

export const WORKER_ROOT = "packages/FUSOU-TLSN-VERIFICATION-WORKER";
export const WORKER_SOURCE_PATHS = Object.freeze([
  "package.json", "pnpm-lock.yaml",
  ...["package.json", "wrangler.toml", "src/index.ts", "src/binding_authority.ts",
    "src/attestation_receipts.ts", "src/direct_verifier.ts", "src/execution_boundary.ts",
    "src/result_archive.ts", "src/verification_jobs.ts", "src/verifier_identity.ts",
    "src/private_key_validation_cache.ts", "scripts/build-wasm.mjs", "scripts/wasm-provenance.mjs",
  ].map((path) => `${WORKER_ROOT}/${path}`),
]);
const sourcePaths = new Set([...WORKER_SOURCE_PATHS, "packages/FUSOU-APP/src-tauri/Cargo.lock"]);
export async function readReleaseSource(github, sourceSha, path) {
  requireRelease(/^[0-9a-f]{40}$/.test(sourceSha) && sourcePaths.has(path), "source read outside release allowlist");
  const file = (await github.rest.repos.getContent({ owner: "tsukasa-u", repo: "FUSOU", ref: sourceSha, path })).data;
  requireRelease(file.type === "file" && file.encoding === "base64" && typeof file.content === "string" &&
    file.content.length <= 8 * 1024 * 1024 && /^[0-9a-f]{40}$/.test(file.sha), "source API file encoding/size/type");
  const encoded = file.content.replaceAll("\n", ""), raw = Buffer.from(encoded, "base64");
  requireRelease(raw.toString("base64") === encoded &&
    createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex") === file.sha, "source Git blob readback");
  return raw;
}
export function inspectWorkerSource(files, sourceSha) {
  requireRelease(files instanceof Map && /^[0-9a-f]{40}$/.test(sourceSha), "Worker source snapshot");
  const missing = WORKER_SOURCE_PATHS.filter((path) => !files.has(path));
  if (missing.length) return { status: "BLOCKED_IMPLEMENTATION", source_sha: sourceSha,
    blockers: ["WORKER_SOURCE_INCOMPLETE_AT_RELEASE_SHA"], missing_paths: missing };
  const pkg = JSON.parse(Buffer.from(files.get(`${WORKER_ROOT}/package.json`)).toString("utf8"));
  const config = Buffer.from(files.get(`${WORKER_ROOT}/wrangler.toml`)).toString("utf8");
  requireRelease(pkg.main === "src/index.ts" && pkg.scripts?.["build:wasm"] === "node scripts/build-wasm.mjs" &&
    pkg.dependencies?.hono && pkg.dependencies?.zod && pkg.devDependencies?.wrangler &&
    /^main = "src\/index.ts"\s*$/m.test(config), "unsupported Worker entry/build recipe");
  const sourceInputs = Object.fromEntries(WORKER_SOURCE_PATHS.map((path) => {
    const raw = files.get(path);
    requireRelease(raw instanceof Uint8Array && raw.byteLength > 0, "empty Worker source");
    return [path, { sha256: sha256(raw), byte_length: raw.byteLength }];
  }));
  return { status: "SOURCE_INPUTS_PRESENT", source_sha: sourceSha, source_inputs: sourceInputs,
    source_inputs_sha256: sha256(Buffer.from(canonicalJson(sourceInputs))),
    runtime_semantics: "NOT_CHECKED", bundle_status: "NOT_CHECKED",
    commands: [
      ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
      ["pnpm", "--dir", WORKER_ROOT, "run", "build:wasm"],
      ["pnpm", "--dir", WORKER_ROOT, "exec", "wrangler", "deploy", "--dry-run", "--env", "production"],
    ] };
}
export async function inspectWorkerSourceAt(github, sourceSha) {
  const files = new Map();
  await Promise.all(WORKER_SOURCE_PATHS.map(async (path) => {
    try { files.set(path, await readReleaseSource(github, sourceSha, path)); }
    catch (error) { if (error.status !== 404) throw error; }
  }));
  return inspectWorkerSource(files, sourceSha);
}

export function encodeUnsignedWorkerPackage(modules) {
  requireRelease(modules instanceof Map && modules.has("index.js") && [...modules.keys()].some((p) => p.endsWith(".wasm")),
    "real Worker JS and WASM outputs required");
  const entries = {};
  for (const [name, raw] of modules) {
    requireRelease(/^[A-Za-z0-9_.-]+\.(?:js|wasm|map|json)$/.test(name) &&
      raw instanceof Uint8Array && raw.byteLength > 0, "Worker output module");
    entries[name] = { sha256: sha256(raw), byte_length: raw.byteLength, bytes: Buffer.from(raw).toString("base64url") };
  }
  return Buffer.from(canonicalJson({ schema_version: 1, scope: "fusou-unsigned-worker-package-v1",
    entrypoint: "index.js", modules: entries }));
}

export async function generateUnsignedWorkerBuild({ sourceFiles, sourceSha, context, toolchain, workerReference,
  executionAllowed = false }, { executeRecipe } = {}) {
  const source = inspectWorkerSource(sourceFiles, sourceSha);
  if (source.status !== "SOURCE_INPUTS_PRESENT") return source;
  if (!executionAllowed) return { ...source, status: "BLOCKED_EXECUTION_AUTHORIZATION" };
  requireRelease(typeof executeRecipe === "function", "trusted isolated Worker recipe executor required");
  requireRelease(context?.repository === "tsukasa-u/FUSOU" && context.source_sha === sourceSha &&
    Number.isSafeInteger(context.run_id) && context.run_id > 0 && Number.isSafeInteger(context.run_attempt) &&
    context.run_attempt > 0 && /^[0-9a-f]{40}$/.test(context.workflow_sha) &&
    toolchain && typeof toolchain.node === "string" && typeof toolchain.pnpm === "string" &&
    typeof toolchain.rust === "string" && typeof toolchain.wrangler === "string" &&
    workerReference?.worker_git_commit_sha === sourceSha &&
    typeof workerReference.script_name === "string" && workerReference.script_name.length > 0 &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(workerReference.active_version_id) &&
    workerReference.active_version_id !== "00000000-0000-0000-0000-000000000000", "Worker execution/reference pins");
  const snapshot = source.source_inputs_sha256;
  const request = structuredClone({ source, toolchain, context });
  const expected = canonicalJson(request), reference = structuredClone(workerReference);
  const output = await executeRecipe(request);
  requireRelease(inspectWorkerSource(sourceFiles, sourceSha).source_inputs_sha256 === snapshot &&
    canonicalJson(request) === expected && canonicalJson({ source, toolchain, context }) === expected &&
    canonicalJson(workerReference) === canonicalJson(reference) &&
    canonicalJson(output.context) === canonicalJson(context) &&
    output.source_inputs_sha256 === snapshot && canonicalJson(output.toolchain) === canonicalJson(toolchain) &&
    canonicalJson(output.completed_commands) === canonicalJson(source.commands) &&
    output.exit_code === 0, "Worker recipe/source/toolchain execution mismatch");
  const raw = encodeUnsignedWorkerPackage(output.modules);
  const record = {
    schema_version: 1, scope: "fusou-release-artifact-build-record-v1",
    source_sha: sourceSha, run_id: context.run_id, run_attempt: context.run_attempt,
    workflow_sha: context.workflow_sha, platform: "cloudflare-workers",
    artifact_sha256: sha256(raw), byte_length: raw.length, worker_version_id: workerReference.active_version_id,
    details: { scope: "fusou-unsigned-worker-build-v1", source_inputs: source.source_inputs,
      source_inputs_sha256: snapshot, toolchain, commands: output.completed_commands,
      version_reference: workerReference, deployment_status: "NOT_CHECKED" },
  };
  const recordRaw = Buffer.from(canonicalJson(record));
  const provenance = Buffer.from(canonicalJson({ schema_version: 1, scope: "fusou-release-build-provenance-v1",
    source_sha: sourceSha, run_id: context.run_id, run_attempt: context.run_attempt, workflow_sha: context.workflow_sha,
    platform: "cloudflare-workers", artifact_sha256: sha256(raw), input_record_sha256: sha256(recordRaw) }));
  return { status: "BUILD_OUTPUTS_GENERATED", raw, recordRaw, provenance, publication_authorized: false,
    deployment_status: "NOT_CHECKED" };
}
