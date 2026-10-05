import assert from "node:assert/strict";
import { verifyLocalWasmArtifactProvenance } from "./wasm-provenance.mjs";

const provenance = await verifyLocalWasmArtifactProvenance();
assert.equal(provenance.status, "VERIFIED_LOCAL_CONSISTENCY", provenance.reason);
assert.equal(provenance.source_commit_binding, "VERIFIED");

if (process.env.GITHUB_SHA) {
  assert.equal(provenance.source_commit_sha, process.env.GITHUB_SHA.toLowerCase());
}

console.log(`[tlsn-wasm-provenance] source commit binding VERIFIED: ${provenance.source_commit_sha}`);
