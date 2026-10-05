import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  WASM_ARTIFACT_NAMES,
  assertWasmArtifactProvenance,
  collectWasmSourceInputs,
  createWasmArtifactProvenance,
} from "./wasm-provenance.mjs";

const hash = (value) => createHash("sha256").update(value).digest("base64url");
const commit = "a".repeat(40);
const sourceInputs = [{ path: "packages/FUSOU-TLSN-VERIFIER/src/lib.rs", sha256: hash("current source") }];
const toolchain = {
  target: "wasm32-unknown-unknown",
  profile: "release",
  cargo_net_offline: true,
  rustc: "rustc 1.95.0 (fixture)",
  wasm_pack: "wasm-pack 0.13.1",
  wasm_bindgen: "wasm-bindgen 0.2.128",
  wasm_opt: "wasm-opt version 133",
  clang_name: "clang-18",
  clang: "clang version 18.1.0",
  cflags_sha256: hash("--target=wasm32-unknown-unknown"),
};
const artifacts = WASM_ARTIFACT_NAMES.map((name) => ({
  name,
  byte_length: Buffer.byteLength(`artifact:${name}`),
  sha256: hash(`artifact:${name}`),
}));
const provenance = createWasmArtifactProvenance({ sourceCommitSha: commit, sourceInputs, sourceTreeStatus: "CLEAN", toolchain, artifacts });
const verified = assertWasmArtifactProvenance(provenance, {
  currentCommitSha: commit,
  sourceInputs,
  sourceTreeStatus: "CLEAN",
  toolchain,
  artifacts,
});
assert.equal(verified.status, "VERIFIED_LOCAL_CONSISTENCY");
assert.equal(verified.source_commit_binding, "VERIFIED");
assert.equal(JSON.stringify(provenance).includes("private_key"), false);

const dirtyProvenance = createWasmArtifactProvenance({
  sourceCommitSha: commit,
  sourceInputs,
  sourceTreeStatus: "DIRTY",
  toolchain,
  artifacts,
});
const dirtyVerification = assertWasmArtifactProvenance(dirtyProvenance, {
  currentCommitSha: commit,
  sourceInputs,
  sourceTreeStatus: "DIRTY",
  toolchain,
  artifacts,
});
assert.equal(dirtyVerification.status, "VERIFIED_LOCAL_CONSISTENCY");
assert.equal(dirtyVerification.source_commit_binding, "UNVERIFIED_DIRTY_TREE");
assert.throws(() => assertWasmArtifactProvenance(dirtyProvenance, {
  currentCommitSha: commit,
  sourceInputs,
  sourceTreeStatus: "CLEAN",
  toolchain,
  artifacts,
}), /source tree cleanliness does not match/);

assert.throws(() => assertWasmArtifactProvenance(provenance, {
  currentCommitSha: "b".repeat(40), sourceInputs, sourceTreeStatus: "CLEAN", toolchain, artifacts,
}), /source commit does not match current HEAD/);
assert.throws(() => assertWasmArtifactProvenance(provenance, {
  currentCommitSha: commit,
  sourceInputs: [{ ...sourceInputs[0], sha256: hash("changed source") }],
  sourceTreeStatus: "CLEAN",
  toolchain,
  artifacts,
}), /source input fingerprint is stale or substituted/);
assert.throws(() => assertWasmArtifactProvenance(provenance, {
  currentCommitSha: commit,
  sourceInputs,
  sourceTreeStatus: "CLEAN",
  toolchain: { ...toolchain, clang: "clang version 19.0.0" },
  artifacts,
}), /toolchain fingerprint does not match/);
for (const field of ["wasm_bindgen", "wasm_opt"]) {
  assert.throws(() => assertWasmArtifactProvenance(provenance, {
    currentCommitSha: commit,
    sourceInputs,
    sourceTreeStatus: "CLEAN",
    toolchain: { ...toolchain, [field]: `${toolchain[field]} substituted` },
    artifacts,
  }), /toolchain fingerprint does not match/);
}
assert.throws(() => assertWasmArtifactProvenance(provenance, {
  currentCommitSha: commit,
  sourceInputs,
  sourceTreeStatus: "CLEAN",
  toolchain,
  artifacts: artifacts.map((artifact, index) => index === 2 ? { ...artifact, sha256: hash("substituted wasm") } : artifact),
}), /artifact hash does not match/);

const rebuiltArtifacts = artifacts.map((artifact, index) => index === 2
  ? { ...artifact, byte_length: Buffer.byteLength("rebuilt wasm"), sha256: hash("rebuilt wasm") }
  : artifact);
const rebuiltProvenance = createWasmArtifactProvenance({
  sourceCommitSha: commit,
  sourceInputs,
  sourceTreeStatus: "CLEAN",
  toolchain,
  artifacts: rebuiltArtifacts,
});
assert.equal(assertWasmArtifactProvenance(rebuiltProvenance, {
  currentCommitSha: commit,
  sourceInputs,
  sourceTreeStatus: "CLEAN",
  toolchain,
  artifacts: rebuiltArtifacts,
}).status, "VERIFIED_LOCAL_CONSISTENCY");

const securityWorkflow = await readFile(
  new URL("../../../.github/workflows/tlsn-verification-worker-security.yml", import.meta.url),
  "utf8",
);
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const verifierLockPath = "packages/FUSOU-TLSN-VERIFIER/Cargo.lock";
const verifierLockBytes = await readFile(new URL("../../FUSOU-TLSN-VERIFIER/Cargo.lock", import.meta.url));
const verifierLockText = verifierLockBytes.toString("utf8");
const verifierManifest = await readFile(new URL("../../FUSOU-TLSN-VERIFIER/Cargo.toml", import.meta.url), "utf8");
const trackedLock = spawnSync("git", ["ls-files", "--error-unmatch", "--", verifierLockPath], {
  cwd: repositoryRoot,
  encoding: "utf8",
});
assert.equal(trackedLock.status, 0, "verifier Cargo.lock must be tracked for clean checkouts");
assert.match(verifierManifest, /tlsn\s*=\s*\{[^\n]*rev\s*=\s*"47aee45b53e06648c1b2ad3689b367b8c923fdec"/);
assert.ok([...verifierLockText.matchAll(/^source = "git\+[^\n]+#[0-9a-f]{40}"$/gm)].length > 0, "Cargo.lock must pin Git dependencies to full revisions");
assert.ok([...verifierLockText.matchAll(/^checksum = "[0-9a-f]{64}"$/gm)].length > 0, "Cargo.lock must pin registry package checksums");

const actualSourceInputs = await collectWasmSourceInputs();
const trackedSourceInputs = spawnSync("git", ["ls-files", "--error-unmatch", "--", ...actualSourceInputs.map((input) => input.path)], {
  cwd: repositoryRoot,
  encoding: "utf8",
});
assert.equal(trackedSourceInputs.status, 0, "all WASM provenance source inputs must be Git-tracked");
const lockSourceInput = actualSourceInputs.find((input) => input.path === verifierLockPath);
assert.ok(lockSourceInput, "WASM provenance source inputs must include verifier Cargo.lock");
assert.equal(lockSourceInput.sha256, hash(verifierLockBytes));

const lockBoundProvenance = createWasmArtifactProvenance({
  sourceCommitSha: commit,
  sourceInputs: actualSourceInputs,
  sourceTreeStatus: "CLEAN",
  toolchain,
  artifacts,
});
const changedLockInputs = actualSourceInputs.map((input) => input.path === verifierLockPath
  ? { ...input, sha256: hash(Buffer.concat([verifierLockBytes, Buffer.from("substituted")])) }
  : input);
assert.throws(() => assertWasmArtifactProvenance(lockBoundProvenance, {
  currentCommitSha: commit,
  sourceInputs: changedLockInputs,
  sourceTreeStatus: "CLEAN",
  toolchain,
  artifacts,
}), /source input fingerprint is stale or substituted/);

const requiredWorkflowSteps = [
  "Install pinned Rust WASM toolchain",
  "Provision pinned WASM code generation tools",
  "Fetch locked WASM build dependencies",
  "Build WASM verifier from checked-out source",
  "Verify WASM source commit and artifact hashes",
  "Verify WASM provenance contract",
  "Verify readiness signature and binding gates",
].map((name) => securityWorkflow.indexOf(`name: ${name}`));
assert.ok(requiredWorkflowSteps.every((position) => position >= 0), "CI must provision and verify WASM before readiness tests");
assert.deepEqual(requiredWorkflowSteps, [...requiredWorkflowSteps].sort((a, b) => a - b));
assert.match(securityWorkflow, /cargo install wasm-pack --version 0\.13\.1 --locked/);
assert.match(securityWorkflow, /wasm-bindgen-0\.2\.128-x86_64-unknown-linux-musl\.tar\.gz/);
assert.match(securityWorkflow, /binaryen-version_133-x86_64-linux\.tar\.gz/);
assert.match(securityWorkflow, /run: cargo fetch --locked --manifest-path packages\/FUSOU-TLSN-VERIFIER\/Cargo\.toml\s*\n/);
assert.doesNotMatch(securityWorkflow, /cargo fetch --locked --manifest-path packages\/FUSOU-TLSN-VERIFIER\/Cargo\.toml\s+--target\b/);
assert.match(verifierManifest, /wasm-bindgen\s*=\s*"=0\.2\.128"/);
assert.match(verifierLockText, /name = "wasm-bindgen"\nversion = "0\.2\.128"/);
assert.match(securityWorkflow, /echo "\$tool_root\/bin" >> "\$GITHUB_PATH"/);
assert.match(securityWorkflow, /packages\/FUSOU-TLSN-VERIFIER\/\*\*/);
assert.match(securityWorkflow, /packages\/tlsn-alpha15-sparse\/\*\*/);
const buildScript = await readFile(new URL("./build-wasm.mjs", import.meta.url), "utf8");
assert.match(buildScript, /CARGO_NET_OFFLINE:\s*"true"/);

console.log("[tlsn-wasm-provenance] commit, tracked Cargo.lock, lock input binding, toolchain, artifact substitution, workflow prerequisites, and rebuild checks PASS");