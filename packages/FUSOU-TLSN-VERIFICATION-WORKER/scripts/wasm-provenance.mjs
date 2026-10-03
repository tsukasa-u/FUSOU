import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const WASM_PROVENANCE_SCHEMA_VERSION = 2;
export const WASM_PROVENANCE_SCOPE = "fusou-tlsn-wasm-build-provenance";
export const WASM_ARTIFACT_NAMES = Object.freeze([
  "fusou_tlsn_verifier.js",
  "fusou_tlsn_verifier.d.ts",
  "fusou_tlsn_verifier_bg.wasm",
  "fusou_tlsn_verifier_bg.wasm.d.ts",
]);

const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new Error(`${label} fields are invalid`);
  }
}

function commandOutput(command, args, label, environment = process.env) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: environment });
  if (result.error || result.status !== 0) throw new Error(`${label} is unavailable`);
  return result.stdout.trim();
}

export function findWasmCompiler(environment = process.env) {
  if (environment.CC_wasm32_unknown_unknown) return environment.CC_wasm32_unknown_unknown;
  for (const candidate of ["clang", "clang-18", "clang-17"]) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!result.error && result.status === 0) return candidate;
  }
  return undefined;
}

export function wasmCompilerFlags(compiler, environment = process.env) {
  const result = spawnSync(compiler, ["-print-resource-dir"], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error("wasm Clang resource directory is unavailable");
  const resourceDirectory = result.stdout.trim();
  const flags = ["--target=wasm32-unknown-unknown"];
  if (resourceDirectory) flags.push(`-I${resolve(resourceDirectory, "include")}`);
  flags.push(environment.CFLAGS_wasm32_unknown_unknown ?? "");
  return flags.join(" ").trim();
}

export function resolveWasmPackCommand(workerDirectory) {
  const local = resolve(workerDirectory, "../../node_modules/.bin", process.platform === "win32" ? "wasm-pack.cmd" : "wasm-pack");
  return existsSync(local) ? local : "wasm-pack";
}

async function walkFiles(directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`WASM source input must not be a symbolic link: ${path}`);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function collectWasmSourceInputs({ workerDirectory = resolve(MODULE_DIRECTORY, "..") } = {}) {
  const repositoryRoot = resolve(workerDirectory, "../..");
  const verifierDirectory = resolve(workerDirectory, "../FUSOU-TLSN-VERIFIER");
  const sparseDirectory = resolve(workerDirectory, "../tlsn-alpha15-sparse");
  const selected = [
    resolve(verifierDirectory, "Cargo.toml"),
    resolve(verifierDirectory, "Cargo.lock"),
    ...await walkFiles(resolve(verifierDirectory, "src")),
    resolve(sparseDirectory, "Cargo.toml"),
    ...await walkFiles(resolve(sparseDirectory, "crates")),
    resolve(workerDirectory, "scripts/build-wasm.mjs"),
    resolve(workerDirectory, "scripts/wasm-provenance.mjs"),
  ].sort((a, b) => a.localeCompare(b));
  const inputs = [];
  for (const absolutePath of selected) {
    const path = relative(repositoryRoot, absolutePath).split(sep).join("/");
    if (!path || path.startsWith("../")) throw new Error("WASM source input escaped the repository root");
    inputs.push({ path, sha256: sha256(await readFile(absolutePath)) });
  }
  return inputs;
}

function collectWasmSourceTreeStatus(sourceInputs, repositoryRoot) {
  const inputPaths = sourceInputs.map((input) => input.path);
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", ...inputPaths], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ...inputPaths], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (tracked.error || ![0, 1].includes(tracked.status) || status.error || status.status !== 0) {
    throw new Error("cannot determine whether WASM source inputs match the current Git tree");
  }
  return tracked.status === 0 && status.stdout.length === 0 ? "CLEAN" : "DIRTY";
}

export function collectWasmToolchain({
  workerDirectory = resolve(MODULE_DIRECTORY, ".."),
  environment = process.env,
  effectiveCompilerFlags,
} = {}) {
  const wasmPack = resolveWasmPackCommand(workerDirectory);
  const compiler = findWasmCompiler(environment);
  if (!compiler) throw new Error("wasm-capable Clang compiler is unavailable");
  const compilerFlags = effectiveCompilerFlags ?? wasmCompilerFlags(compiler, environment);
  const toolEnvironment = {
    ...environment,
    RUSTUP_TOOLCHAIN: environment.RUSTUP_TOOLCHAIN ?? "1.95.0",
  };
  return {
    target: "wasm32-unknown-unknown",
    profile: "release",
    cargo_net_offline: true,
    rustc: commandOutput("rustc", ["--version", "--verbose"], "rustc", toolEnvironment),
    wasm_pack: commandOutput(wasmPack, ["--version"], "wasm-pack", toolEnvironment),
    clang_name: basename(compiler),
    clang: commandOutput(compiler, ["--version"], "Clang", toolEnvironment).split("\n")[0],
    cflags_sha256: sha256(Buffer.from(compilerFlags, "utf8")),
  };
}

export async function collectWasmArtifacts({ artifactDirectory } = {}) {
  if (typeof artifactDirectory !== "string" || artifactDirectory.length === 0) {
    throw new Error("WASM artifact directory is required");
  }
  const artifacts = [];
  for (const name of WASM_ARTIFACT_NAMES) {
    const path = resolve(artifactDirectory, name);
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`WASM artifact is not a regular file: ${name}`);
    const bytes = await readFile(path);
    artifacts.push({ name, byte_length: bytes.length, sha256: sha256(bytes) });
  }
  return artifacts;
}

export function createWasmArtifactProvenance({ sourceCommitSha, sourceInputs, sourceTreeStatus, toolchain, artifacts } = {}) {
  if (typeof sourceCommitSha !== "string" || !/^[0-9a-f]{40}$/i.test(sourceCommitSha)) {
    throw new Error("WASM source commit SHA is invalid");
  }
  if (!["CLEAN", "DIRTY"].includes(sourceTreeStatus)) throw new Error("WASM source tree status is invalid");
  const buildInputs = { source_inputs: sourceInputs, toolchain };
  return {
    schema_version: WASM_PROVENANCE_SCHEMA_VERSION,
    scope: WASM_PROVENANCE_SCOPE,
    source_commit_sha: sourceCommitSha.toLowerCase(),
    source_tree_status: sourceTreeStatus,
    source_inputs: sourceInputs,
    toolchain,
    build_inputs_sha256: sha256(Buffer.from(canonicalJson(buildInputs), "utf8")),
    artifacts,
  };
}

export function assertWasmArtifactProvenance(provenance, {
  currentCommitSha,
  sourceInputs,
  sourceTreeStatus,
  toolchain,
  artifacts,
} = {}) {
  exactKeys(provenance, ["schema_version", "scope", "source_commit_sha", "source_tree_status", "source_inputs", "toolchain", "build_inputs_sha256", "artifacts"], "WASM provenance");
  if (provenance.schema_version !== WASM_PROVENANCE_SCHEMA_VERSION || provenance.scope !== WASM_PROVENANCE_SCOPE) {
    throw new Error("WASM provenance schema or scope is invalid");
  }
  if (typeof currentCommitSha !== "string" || provenance.source_commit_sha !== currentCommitSha.toLowerCase()) {
    throw new Error("WASM artifact source commit does not match current HEAD");
  }
  if (!["CLEAN", "DIRTY"].includes(provenance.source_tree_status)
    || provenance.source_tree_status !== sourceTreeStatus) {
    throw new Error("WASM source tree cleanliness does not match the current source inputs");
  }
  if (!Array.isArray(sourceInputs) || !Array.isArray(provenance.source_inputs)
    || canonicalJson(provenance.source_inputs) !== canonicalJson(sourceInputs)) {
    throw new Error("WASM source input fingerprint is stale or substituted");
  }
  if (canonicalJson(provenance.toolchain) !== canonicalJson(toolchain)) {
    throw new Error("WASM build toolchain fingerprint does not match the current toolchain");
  }
  const expectedBuildInputsSha256 = sha256(Buffer.from(canonicalJson({ source_inputs: sourceInputs, toolchain }), "utf8"));
  if (!HASH_PATTERN.test(provenance.build_inputs_sha256) || provenance.build_inputs_sha256 !== expectedBuildInputsSha256) {
    throw new Error("WASM build input fingerprint is invalid");
  }
  if (!Array.isArray(artifacts) || !Array.isArray(provenance.artifacts)
    || canonicalJson(provenance.artifacts) !== canonicalJson(artifacts)) {
    throw new Error("WASM artifact hash does not match the generated files");
  }
  if (artifacts.length !== WASM_ARTIFACT_NAMES.length || artifacts.some((artifact, index) => artifact.name !== WASM_ARTIFACT_NAMES[index])) {
    throw new Error("WASM artifact set is incomplete or unexpected");
  }
  return {
    status: "VERIFIED_LOCAL_CONSISTENCY",
    source_commit_sha: provenance.source_commit_sha,
    source_tree_status: provenance.source_tree_status,
    source_commit_binding: provenance.source_tree_status === "CLEAN" ? "VERIFIED" : "UNVERIFIED_DIRTY_TREE",
    build_inputs_sha256: provenance.build_inputs_sha256,
    artifacts: provenance.artifacts,
  };
}

export async function writeWasmArtifactProvenance({
  workerDirectory = resolve(MODULE_DIRECTORY, ".."),
  artifactDirectory,
  environment = process.env,
  effectiveCompilerFlags,
} = {}) {
  const repositoryRoot = resolve(workerDirectory, "../..");
  const headResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" });
  if (headResult.error || headResult.status !== 0) throw new Error("cannot determine current WASM source commit");
  const sourceInputs = await collectWasmSourceInputs({ workerDirectory });
  const provenance = createWasmArtifactProvenance({
    sourceCommitSha: headResult.stdout.trim(),
    sourceInputs,
    sourceTreeStatus: collectWasmSourceTreeStatus(sourceInputs, repositoryRoot),
    toolchain: collectWasmToolchain({ workerDirectory, environment, effectiveCompilerFlags }),
    artifacts: await collectWasmArtifacts({ artifactDirectory }),
  });
  await writeFile(resolve(artifactDirectory, "wasm-provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o600 });
  return provenance;
}

export async function verifyLocalWasmArtifactProvenance({ workerDirectory = resolve(MODULE_DIRECTORY, "..") } = {}) {
  const artifactDirectory = resolve(workerDirectory, "src/wasm");
  try {
    const provenance = JSON.parse(await readFile(resolve(artifactDirectory, "wasm-provenance.json"), "utf8"));
    const repositoryRoot = resolve(workerDirectory, "../..");
    const headResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" });
    if (headResult.error || headResult.status !== 0) throw new Error("cannot determine current HEAD");
    const sourceInputs = await collectWasmSourceInputs({ workerDirectory });
    return assertWasmArtifactProvenance(provenance, {
      currentCommitSha: headResult.stdout.trim(),
      sourceInputs,
      sourceTreeStatus: collectWasmSourceTreeStatus(sourceInputs, repositoryRoot),
      toolchain: collectWasmToolchain({ workerDirectory }),
      artifacts: await collectWasmArtifacts({ artifactDirectory }),
    });
  } catch (error) {
    return {
      status: "BLOCKED",
      reason: error instanceof Error ? error.message : "WASM provenance could not be verified",
    };
  }
}