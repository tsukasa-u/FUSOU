import assert from "node:assert/strict";
import { verifyLocalWasmArtifactProvenance } from "./wasm-provenance.mjs";

assert.equal(process.env.FUSOU_RELEASE_ALLOW_WASM_BUILD, "1", "native provenance inspection is not authorized");
assert.match(process.env.FUSOU_RELEASE_SOURCE_SHA ?? "", /^[0-9a-f]{40}$/, "exact release SHA is required");
const provenance = await verifyLocalWasmArtifactProvenance();
assert.equal(provenance.status, "VERIFIED_LOCAL_CONSISTENCY", provenance.reason);
assert.equal(provenance.source_commit_binding, "VERIFIED");

assert.equal(provenance.source_commit_sha, process.env.FUSOU_RELEASE_SOURCE_SHA);

console.log(`[tlsn-wasm-provenance] source commit binding VERIFIED: ${provenance.source_commit_sha}`);
