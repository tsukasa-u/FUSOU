import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { sha256 } from "./release-bytes.mjs";
import { requireRelease } from "./release-build-proof.mjs";
import { assertReleaseWasmProof } from "./release-wasm-proof.mjs";
import { MAX_TRANSPORT_BYTES } from "./release-transport.mjs";

export const WORKER_ROOT = "packages/FUSOU-TLSN-VERIFICATION-WORKER";
export const WORKER_SOURCE_PATHS = Object.freeze([
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  "packages/configs/tlsn-origin-inventory.json.txt", "packages/configs/tlsn-target-approval.json.txt",
  ...["package.json", "wrangler.toml", "tsconfig.json", "src/index.ts", "src/binding_authority.ts",
    "src/device-proof-client.ts", "src/device-proof-framing.ts",
    "src/attestation_receipts.ts", "src/direct_verifier.ts", "src/execution_boundary.ts",
    "src/result_archive.ts", "src/verification_jobs.ts", "src/verifier_identity.ts",
    "src/private_key_validation_cache.ts", "src/origin-trust-contract.mjs", "src/origin-trust-contract.d.mts",
    "src/result-registry-contract.mjs", "src/result-registry-contract.d.mts",
    "src/production-result-contract.mjs", "src/production-result-contract.d.mts", "src/text-module.d.ts",
    "src/archive-readback.mjs", "src/archive-readback.d.mts",
    "src/archive-catalog.mjs", "src/archive-catalog.d.mts",
    "src/archive-http-contract.mjs", "src/archive-http.mjs", "src/archive-http.d.mts", "src/archive-oidc.mjs",
    "src/archive-oidc-claims.mjs",
    "scripts/build-wasm.mjs", "scripts/verify-wasm-provenance.mjs", "scripts/wasm-provenance.mjs", "scripts/app-build-tool-environment.mjs",
  ].map((path) => `${WORKER_ROOT}/${path}`),
]);
const sourcePaths = new Set([...WORKER_SOURCE_PATHS, "packages/FUSOU-APP/src-tauri/Cargo.lock"]);
export function inspectWorkerImports(files) {
  const codeFiles = Object.fromEntries([...files].filter(([path]) => path.startsWith(`${WORKER_ROOT}/`) &&
    /\.(?:ts|mjs)$/.test(path) && !/\.d\.(?:mts|ts)$/.test(path)).map(([path, bytes]) => [path, Buffer.from(bytes).toString("utf8")]));
  const parsed = spawnSync(process.execPath, ["--no-warnings", "--experimental-vm-modules",
    fileURLToPath(new URL("./release-worker-imports.mjs", import.meta.url))], {
    input: JSON.stringify(codeFiles), encoding: "utf8", timeout: 15_000, maxBuffer: 256 * 1024,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !["NODE_OPTIONS", "NODE_PATH", "NODE_V8_COVERAGE"].includes(key))),
  });
  requireRelease(!parsed.error && parsed.status === 0, `Worker parse-only import closure: ${parsed.stderr || parsed.error?.message || "failed"}`);
  const dependencies = JSON.parse(parsed.stdout), pkg = JSON.parse(Buffer.from(files.get(`${WORKER_ROOT}/package.json`)));
  const generated = new Set([`${WORKER_ROOT}/src/wasm/fusou_tlsn_verifier.js`, `${WORKER_ROOT}/src/wasm/fusou_tlsn_verifier_bg.wasm`]);
  for (const [path, imports] of Object.entries(dependencies)) for (const specifier of imports) {
    if (!specifier.startsWith(".")) {
      requireRelease(specifier === "cloudflare:workers" || path.startsWith(`${WORKER_ROOT}/scripts/`) && specifier.startsWith("node:") ||
        Object.hasOwn(pkg.dependencies, specifier), "undeclared Worker runtime package");
      continue;
    }
    const target = posix.normalize(posix.join(posix.dirname(path), specifier));
    requireRelease(generated.has(target) || files.has(target) || target.endsWith(".js") && files.has(target.slice(0, -3) + ".ts"),
      `missing Worker import: ${path} -> ${specifier}`);
  }
  return { entrypoint: `${WORKER_ROOT}/src/index.ts`, dependencies, generated_inputs: [...generated] };
}
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
    pkg.scripts?.["verify:wasm-provenance"] === "node scripts/verify-wasm-provenance.mjs" && pkg.scripts?.typecheck === "tsc --noEmit" &&
    pkg.dependencies?.hono && pkg.dependencies?.zod && pkg.devDependencies?.wrangler &&
    /^main = "src\/index.ts"\s*$/m.test(config), "unsupported Worker entry/build recipe");
  const sourceInputs = Object.fromEntries(WORKER_SOURCE_PATHS.map((path) => {
    const raw = files.get(path);
    requireRelease(raw instanceof Uint8Array && raw.byteLength > 0, "empty Worker source");
    return [path, { sha256: sha256(raw), byte_length: raw.byteLength }];
  }));
  const closure = inspectWorkerImports(files);
  return { status: "SOURCE_INPUTS_PRESENT", source_sha: sourceSha, source_inputs: sourceInputs, import_closure: closure,
    source_inputs_sha256: sha256(Buffer.from(canonicalJson(sourceInputs))),
    runtime_semantics: "NOT_CHECKED", bundle_status: "NOT_CHECKED",
    commands: [
      ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
      ["pnpm", "--dir", WORKER_ROOT, "run", "build:wasm"],
      ["pnpm", "--dir", WORKER_ROOT, "run", "verify:wasm-provenance"],
      ["pnpm", "--dir", WORKER_ROOT, "run", "typecheck"],
      ["pnpm", "--dir", WORKER_ROOT, "exec", "wrangler", "deploy", "--dry-run", "--env", "production",
        "--outdir", "../../.fusou-worker-bundle"],
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

export function parseUnsignedWorkerPackage(raw) {
  requireRelease(raw instanceof Uint8Array && raw.byteLength <= MAX_TRANSPORT_BYTES, "Worker package artifact size");
  const pkg = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  requireRelease(pkg.schema_version === 1 && pkg.scope === "fusou-unsigned-worker-package-v1" &&
    pkg.entrypoint === "index.js" && pkg.modules && typeof pkg.modules === "object", "Worker package artifact contract");
  return pkg;
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
  const raw = Buffer.from(canonicalJson({ schema_version: 1, scope: "fusou-unsigned-worker-package-v1",
    entrypoint: "index.js", modules: entries }));
  requireRelease(raw.length <= MAX_TRANSPORT_BYTES, "Worker package artifact size");
  return raw;
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
  requireRelease(output.modules.get("wasm-provenance.json") instanceof Uint8Array &&
    Buffer.from(output.modules.get("wasm-provenance.json")).equals(output.wasmProvenanceRaw), "Worker package/provenance bytes mismatch");
  const raw = encodeUnsignedWorkerPackage(output.modules);
  const wasmProvenance = assertReleaseWasmProof(output.wasmProvenanceRaw, { sourceSha,
    sourceInputs: output.wasmSourceInputs, toolchain: output.wasmToolchain, artifactBytes: output.wasmArtifacts, modules: output.modules });
  const record = {
    schema_version: 1, scope: "fusou-release-artifact-build-record-v1",
    source_sha: sourceSha, run_id: context.run_id, run_attempt: context.run_attempt,
    workflow_sha: context.workflow_sha, platform: "cloudflare-workers",
    artifact_sha256: sha256(raw), byte_length: raw.length, worker_version_id: workerReference.active_version_id,
    details: { scope: "fusou-unsigned-worker-build-v1", source_inputs: source.source_inputs,
      source_inputs_sha256: snapshot, toolchain, commands: output.completed_commands,
      import_closure: source.import_closure, wasm_provenance_sha256: sha256(output.wasmProvenanceRaw),
      wasm_toolchain: wasmProvenance.toolchain, wasm_source_inputs: wasmProvenance.source_inputs,
      version_reference: workerReference, deployment_status: "NOT_CHECKED" },
  };
  const recordRaw = Buffer.from(canonicalJson(record));
  const provenance = Buffer.from(canonicalJson({ schema_version: 1, scope: "fusou-release-build-provenance-v1",
    source_sha: sourceSha, run_id: context.run_id, run_attempt: context.run_attempt, workflow_sha: context.workflow_sha,
    platform: "cloudflare-workers", artifact_sha256: sha256(raw), input_record_sha256: sha256(recordRaw) }));
  return { status: "BUILD_OUTPUTS_GENERATED", raw, recordRaw, provenance, wasmProvenanceRaw: output.wasmProvenanceRaw,
    wasmArtifacts: output.wasmArtifacts, publication_authorized: false,
    deployment_status: "NOT_CHECKED" };
}
