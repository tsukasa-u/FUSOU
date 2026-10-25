import { assertWasmArtifactProvenance, WASM_ARTIFACT_NAMES, WASM_BUILD_ARGUMENTS } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/wasm-provenance.mjs";
import { sha256 } from "./release-bytes.mjs";
import { requireRelease } from "./release-build-proof.mjs";

export function assertReleaseWasmProof(raw, { sourceSha, sourceInputs, toolchain, artifactBytes, modules }) {
  requireRelease(raw instanceof Uint8Array && artifactBytes instanceof Map && toolchain &&
    Array.isArray(sourceInputs) && sourceInputs.length > 0, "raw WASM provenance/artifacts/independent source/toolchain required");
  const provenance = JSON.parse(Buffer.from(raw));
  requireRelease(provenance.source_commit_sha === sourceSha && provenance.source_tree_status === "CLEAN" &&
    Array.isArray(provenance.source_inputs) && provenance.source_inputs.length > 0 &&
    provenance.source_inputs.every((s) => typeof s.path === "string" && !s.path.startsWith("/") &&
      !s.path.split("/").includes("..") && /^[A-Za-z0-9_-]{43}$/.test(s.sha256)) &&
    new Set(provenance.source_inputs.map((s) => s.path)).size === provenance.source_inputs.length,
  "WASM exact source/clean input provenance");
  const artifacts = WASM_ARTIFACT_NAMES.map((name) => {
    const bytes = artifactBytes.get(name);
    requireRelease(bytes instanceof Uint8Array && bytes.length > 0, `missing generated WASM artifact: ${name}`);
    return { name, byte_length: bytes.length, sha256: sha256(bytes) };
  });
  const verified = assertWasmArtifactProvenance(provenance, { currentCommitSha: sourceSha,
    sourceInputs, sourceTreeStatus: "CLEAN", toolchain, artifacts });
  requireRelease(verified.source_commit_binding === "VERIFIED" &&
    toolchain.target === "wasm32-unknown-unknown" && toolchain.profile === "release" && toolchain.cargo_net_offline === true &&
    JSON.stringify(toolchain.wasm_pack_arguments) === JSON.stringify(WASM_BUILD_ARGUMENTS) &&
    ["rustc", "wasm_pack", "wasm_bindgen", "wasm_opt", "clang_name", "clang", "cflags_sha256"]
      .every((key) => typeof toolchain[key] === "string" && toolchain[key].length > 0),
  "WASM compiler/flags/offline toolchain provenance");
  requireRelease([...modules].some(([name, bytes]) => name.endsWith(".wasm") &&
    sha256(bytes) === artifacts.find((a) => a.name.endsWith("_bg.wasm")).sha256), "bundle WASM differs from generated artifact");
  return provenance;
}
