import assert from "node:assert/strict";
import test from "node:test";
import { testplayAcceptanceStages } from "./testplay-acceptance-stages.mjs";

test("protocol, identity-bound evidence and remote production delivery have separate requirements", () => {
  const stages = testplayAcceptanceStages();
  assert.equal(stages.assessment_scope, "SOURCE_CONTRACT_ONLY");
  assert.deepEqual(stages.TLSN_PROTOCOL_TESTPLAY.requirements, [
    "actual_game_server_presentation", "notary_signature",
    "observed_canonical_dns_and_web_pki", "signed_result_and_exact_presentation_binding",
  ]);
  assert.equal(stages.TLSN_PROTOCOL_TESTPLAY.independent_app_entry_point, "NOT_IMPLEMENTED");
  assert.ok(stages.IDENTITY_BOUND_TESTPLAY.requirements.includes("all_19_roles_and_independent_local_verification"));
  assert.equal(stages.IDENTITY_BOUND_TESTPLAY.full_bundle_remote_delivery_required_by_local_verifier, false);
  assert.ok(stages.PRODUCTION_EVIDENCE_DELIVERY.requirements.includes("independently_verified_delivery_receipt"));
  for (const stage of ["TLSN_PROTOCOL_TESTPLAY", "IDENTITY_BOUND_TESTPLAY", "PRODUCTION_EVIDENCE_DELIVERY"]) {
    assert.equal(stages[stage].status, "BLOCKED_CODE");
  }
});

test("source assessment neither authorizes gameplay nor waives the retained receipt/provider gates", () => {
  const stages = testplayAcceptanceStages();
  assert.equal(stages.gameplay_authorized, false);
  assert.ok(stages.IDENTITY_BOUND_TESTPLAY.code_blockers.includes("candidate_execution_receipt_gate_retained"));
  assert.equal(stages.PRODUCTION_EVIDENCE_DELIVERY.production_acceptance, "BLOCKED");
  assert.equal(stages.PRODUCTION_EVIDENCE_DELIVERY.deployment, "NOT_CHECKED");
  assert.equal(stages.TLSN_PROTOCOL_TESTPLAY.real_evidence_verification, "NOT_CHECKED");
  assert.equal(stages.IDENTITY_BOUND_TESTPLAY.real_evidence_verification, "NOT_CHECKED");
});

test("reports do not share mutable stage arrays and local flags cannot grant readiness", () => {
  const first = testplayAcceptanceStages();
  first.TLSN_PROTOCOL_TESTPLAY.status = "READY_FOR_TLSN_PROTOCOL_TESTPLAY";
  first.IDENTITY_BOUND_TESTPLAY.requirements.length = 0;
  const next = testplayAcceptanceStages({ ready: true, recovered: true });
  assert.equal(next.TLSN_PROTOCOL_TESTPLAY.status, "BLOCKED_CODE");
  assert.notEqual(next.IDENTITY_BOUND_TESTPLAY.requirements.length, 0);
  assert.equal(next.gameplay_authorized, false);
});
