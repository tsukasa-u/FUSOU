import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mock } from "node:test";
import * as semantic from "../production-evidence-semantic.mjs";
import { sha256Base64Url } from "../deployment-attestation.mjs";
import { profilesForServerIdentity } from "../profile-canonical-contract.mjs";

// Test-only doubles of the closed cryptographic boundary; never imported by capture or verification.
const state = JSON.parse(readFileSync(process.env.TLSN_CONSUMER_TEST_STATE_PATH, "utf8"));
const trace = [];
function record(event) {
  trace.push(event);
  writeFileSync(process.env.TLSN_CONSUMER_TEST_TRACE_PATH, JSON.stringify(trace));
}
mock.module(new URL("../production-evidence-semantic.mjs", import.meta.url).href, {
  namedExports: {
    ...semantic,
    inspectAlpha15Presentation: async (inputs) => {
      const { presentationBytes, notaryRegistry, notaryKeyId, disclosureMode } = inputs;
      for (const forbidden of ["trustRootDer", "syntheticTrustRootDer", "trustAnchorDer"]) {
        assert.equal(Object.hasOwn(inputs, forbidden), false);
      }
      assert.deepEqual(notaryRegistry, state.notaryRegistry);
      assert.equal(notaryKeyId, state.result.notary_key_id);
      assert.equal(disclosureMode, state.disclosureMode);
      record({ boundary: "inspection" });
      return {
        source: "verified-alpha15-presentation",
        presentation_sha256: sha256Base64Url(presentationBytes),
        disclosure_mode: disclosureMode,
        verified_presentation: {
          ...state.semanticVerification.verified_presentation,
          server_identity: state.observedIdentity,
        },
      };
    },
    verifyProductionPresentation: async (inputs) => {
      assert.equal(inputs.serverIdentity, state.observedIdentity);
      assert.equal(inputs.profileSha256, profilesForServerIdentity(state.observedIdentity)[state.disclosureMode].sha256);
      assert.equal(inputs.originInventorySha256, state.result.origin_inventory_sha256);
      assert.equal(inputs.targetApprovalArtifactSha256, state.result.target_approval_artifact_sha256);
      assert.equal(inputs.notaryKeyId, state.result.notary_key_id);
      assert.equal(inputs.verifierKeyId, state.result.verifier_key_id);
      for (const forbidden of ["trustRootDer", "syntheticTrustRootDer", "trustAnchorDer"]) {
        assert.equal(Object.hasOwn(inputs, forbidden), false);
      }
      record({ boundary: "semantic" });
      return state.semanticVerification;
    },
  },
});
globalThis.fetch = async (url, options = {}) => {
  record({ boundary: "http", url, method: options.method ?? "GET" });
  const parsed = new URL(url);
  if (parsed.origin === "https://worker.example.test" && parsed.pathname === "/health") {
    return Response.json(state.health);
  }
  if (parsed.origin === "https://auth.example.test" && parsed.pathname === "/auth/v1/user") {
    return Response.json(state.user);
  }
  if (parsed.origin === "https://web.example.test" && parsed.pathname === "/api/auth/anonymous-sync/v2/device-identity") {
    return Response.json(state.deviceIdentity);
  }
  if (parsed.origin === "https://worker.example.test" && ["/verify/tlsn", "/verify/tlsn/sparse"].includes(parsed.pathname)) {
    return Response.json({ error: "binding_consumed" }, { status: 409 });
  }
  throw new Error(`unexpected consumer-test request: ${url}`);
};
