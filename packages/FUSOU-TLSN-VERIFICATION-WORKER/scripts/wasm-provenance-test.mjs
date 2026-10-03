import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  WASM_ARTIFACT_NAMES,
  assertWasmArtifactProvenance,
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

console.log("[tlsn-wasm-provenance] commit, source, toolchain, artifact substitution, and rebuild checks PASS");