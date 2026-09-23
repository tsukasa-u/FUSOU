export const CANARY_WORKER_NAME = "fusou-tlsn-verification-canary";
export const CANARY_BOOTSTRAP_WORKER_NAME = "fusou-tlsn-verification-canary-bootstrap";
export const CANARY_VERIFIER_WORKER_NAME = "fusou-tlsn-verifier-canary";

export function assertCanonicalCanaryWorkerName(value) {
  if (value !== CANARY_WORKER_NAME) {
    throw new Error("DENIED: TLSN_CANARY_WORKER_NAME must exactly match the canonical Canary Worker identity");
  }
  return CANARY_WORKER_NAME;
}