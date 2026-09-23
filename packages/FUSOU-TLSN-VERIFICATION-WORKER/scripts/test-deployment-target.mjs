export const TEST_WORKER_NAME = "fusou-tlsn-verification-test";

export function assertCanonicalTestWorkerName(value) {
  if (value !== TEST_WORKER_NAME) {
    throw new Error("DENIED: TLSN_TEST_WORKER_NAME must exactly match the canonical Test Worker identity");
  }
  return TEST_WORKER_NAME;
}
