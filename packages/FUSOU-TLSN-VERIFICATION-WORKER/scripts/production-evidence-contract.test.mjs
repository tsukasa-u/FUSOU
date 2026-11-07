import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertProductionEvidenceManifest,
  blockedProductionEvidenceManifest,
} from "./production-evidence-contract.mjs";

function validManifest() {
  return blockedProductionEvidenceManifest({
    captureId: "33333333-3333-4333-8333-333333333333",
    now: "2026-11-07T00:00:00.000Z",
    captureProvenance: "production",
  });
}

test("blocked Production Evidence manifest includes the complete semantic predicate contract", () => {
  assert.doesNotThrow(() => assertProductionEvidenceManifest(validManifest()));
});

test("Production Evidence contract rejects status-only semantic predicates", () => {
  const manifest = validManifest();
  manifest.semantic_predicates.presentation_cryptography = { status: "PASS" };

  assert.throws(
    () => assertProductionEvidenceManifest(manifest),
    /semantic evidence predicate schema is invalid: presentation_cryptography/,
  );
});

test("Production Evidence contract rejects missing semantic predicate metadata", () => {
  const manifest = validManifest();
  delete manifest.semantic_predicates.presentation_cryptography.authority_identity;

  assert.throws(
    () => assertProductionEvidenceManifest(manifest),
    /semantic authority_identity must be a non-empty identity/,
  );
});
