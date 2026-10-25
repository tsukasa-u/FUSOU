import assert from "node:assert/strict";
import { test } from "node:test";
import { beginEvidenceDelivery, advanceEvidenceDelivery, MAX_DELIVERY_ARTIFACT_BYTES } from "./evidence-delivery-policy.mjs";
import { sha256 } from "./release-manifest.mjs";

function fixture() {
  const state = beginEvidenceDelivery({ session_id: "synthetic-session", binding_value: "synthetic-binding", capture_id: "synthetic-capture" });
  const event = { type: "ACCEPT_READBACK", presentation: Buffer.from("synthetic presentation"), result: Buffer.from("synthetic result"),
    archive_presentation: Buffer.from("synthetic presentation"), archive_result: Buffer.from("synthetic result") };
  const verification = { status: "VERIFIED", identity: { ...state.identity }, hashes: {
    presentation_sha256: sha256(event.presentation), result_sha256: sha256(event.result),
  }, authorization: { issued_at_ms: 100, expires_at_ms: 200 } };
  // Trusted-verifier interface mock only. No TLSN, receipt or signature is verified here.
  return { state, event, verification, deps: { now: () => 150, verifyEvidence: async () => verification } };
}
test("origin response leaves evidence pending, never implicitly verified", async () => {
  const f = fixture();
  const pending = await advanceEvidenceDelivery(f.state, { type: "ORIGIN_RESPONSE" });
  assert.equal(pending.state, "PENDING");
  assert.equal(pending.origin_response_delivered, true);
  assert.equal(pending.retry_permitted, false);
  assert.equal(f.state.origin_response_delivered, false);
});
test("uncertain send and proof failure are terminal; neither response nor retry can revive them", async () => {
  for (const type of ["UNCERTAIN_SEND", "EVIDENCE_FAILURE"]) {
    const f = fixture(), failed = await advanceEvidenceDelivery(f.state, { type });
    assert.equal(failed.retry_permitted, false);
    await assert.rejects(advanceEvidenceDelivery(failed, f.event, f.deps), /terminal/);
  }
  const f = fixture();
  await assert.rejects(advanceEvidenceDelivery(f.state, { type: "RETRY" }, f.deps), /retry/);
});
test("exact readback can advance only with independent verifier identity, hashes and fresh authorization", async () => {
  const f = fixture();
  const accepted = await advanceEvidenceDelivery(f.state, f.event, f.deps);
  assert.equal(accepted.state, "READBACK_ACCEPTED");
  assert.equal(accepted.presentation_sha256, sha256(f.event.presentation));
  assert.equal(accepted.retry_permitted, false);
  await assert.rejects(advanceEvidenceDelivery(accepted, f.event, f.deps), /terminal/);
});
test("mixed tuples, archive corruption, changed verification bytes and expiry during deferred work reject", async () => {
  for (const mutate of [
    (f) => { f.verification.identity.capture_id = "different"; },
    (f) => { f.verification.hashes.result_sha256 = "different"; },
    (f) => { f.event.archive_result = Buffer.from("changed"); },
    (f) => { f.deps.now = () => 200; },
    (f) => { f.verification.authorization = undefined; },
    (f) => { f.deps.verifyEvidence = async (raw) => { raw.result[0] ^= 1; return f.verification; }; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(advanceEvidenceDelivery(f.state, f.event, f.deps));
    assert.equal(f.state.state, "PENDING");
  }
});
test("size admission precedes verification and absent verification never falls back to success", async () => {
  const f = fixture();
  await assert.rejects(advanceEvidenceDelivery(f.state, f.event), /trusted verifier/);
  f.event.presentation = Buffer.alloc(MAX_DELIVERY_ARTIFACT_BYTES + 1);
  let invoked = false;
  f.deps.verifyEvidence = async () => { invoked = true; throw new Error("must not run"); };
  await assert.rejects(advanceEvidenceDelivery(f.state, f.event, f.deps), /admission/);
  assert.equal(invoked, false);
});
