import { isDeepStrictEqual } from "node:util";
import { sha256 } from "./release-manifest.mjs";

export const EVIDENCE_DELIVERY_POLICY = "fusou-evidence-delivery-policy-v1";
export const MAX_DELIVERY_ARTIFACT_BYTES = 16 * 1024 * 1024;
const fail = (message) => { throw new Error(`evidence delivery: ${message}`); };
const freeze = (state) => Object.freeze({ ...state, identity: Object.freeze({ ...state.identity }) });

export function beginEvidenceDelivery(identity) {
  const keys = ["session_id", "binding_value", "capture_id"].sort();
  if (!identity || !isDeepStrictEqual(Object.keys(identity).sort(), keys) ||
      Object.values(identity).some((v) => typeof v !== "string" || !v || v.includes("\0"))) fail("correlation tuple required");
  return freeze({ policy: EVIDENCE_DELIVERY_POLICY, identity, state: "PENDING",
    origin_response_delivered: false, retry_permitted: false });
}

// This adapter consumes a trusted verifier, not booleans supplied in evidence JSON.
// It does not issue an authority attempt or change receipt/signature wire bytes.
export async function advanceEvidenceDelivery(state, event, { verifyEvidence, now } = {}) {
  if (state?.policy !== EVIDENCE_DELIVERY_POLICY || state.state !== "PENDING" ||
      state.retry_permitted !== false) fail("terminal or unknown state");
  if (event.type === "ORIGIN_RESPONSE") return freeze({ ...state, origin_response_delivered: true });
  if (event.type === "UNCERTAIN_SEND" || event.type === "EVIDENCE_FAILURE") {
    return freeze({ ...state, state: event.type === "UNCERTAIN_SEND" ? "FAILED_UNCERTAIN" : "FAILED" });
  }
  if (event.type !== "ACCEPT_READBACK" || typeof verifyEvidence !== "function" || typeof now !== "function") {
    fail("explicit readback and trusted verifier/clock required; automatic retry is forbidden");
  }
  const snapshots = {};
  for (const key of ["presentation", "result", "archive_presentation", "archive_result"]) {
    const raw = event[key];
    if (!(raw instanceof Uint8Array) || raw.byteLength === 0 || raw.byteLength > MAX_DELIVERY_ARTIFACT_BYTES) fail("artifact admission limit");
    snapshots[key] = Buffer.from(raw);
  }
  if (!snapshots.presentation.equals(snapshots.archive_presentation) ||
      !snapshots.result.equals(snapshots.archive_result)) fail("archive readback bytes differ");
  const hashes = { presentation_sha256: sha256(snapshots.presentation), result_sha256: sha256(snapshots.result) };
  const verification = await verifyEvidence(snapshots, state.identity);
  if (verification?.status !== "VERIFIED" || !isDeepStrictEqual(verification.identity, state.identity) ||
      !isDeepStrictEqual(verification.hashes, hashes)) fail("independent verification identity/hash mismatch");
  const time = now();
  const auth = verification.authorization;
  if (!Number.isSafeInteger(time) || !Number.isSafeInteger(auth?.issued_at_ms) ||
      !Number.isSafeInteger(auth?.expires_at_ms) || auth.issued_at_ms > time ||
      auth.expires_at_ms <= time || auth.issued_at_ms >= auth.expires_at_ms) fail("authorization missing, expired or not yet valid at delivery");
  if (sha256(snapshots.presentation) !== hashes.presentation_sha256 ||
      sha256(snapshots.result) !== hashes.result_sha256 ||
      !snapshots.presentation.equals(snapshots.archive_presentation) ||
      !snapshots.result.equals(snapshots.archive_result)) fail("verifier changed readback bytes");
  return freeze({ ...state, state: "READBACK_ACCEPTED", ...hashes });
}
