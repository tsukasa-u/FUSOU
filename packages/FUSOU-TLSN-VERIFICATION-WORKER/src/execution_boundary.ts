export function canaryVerifierExecutionReceiptCapabilityAvailable(
  environment: { TLSN_ENVIRONMENT: string; TLSN_DEPLOYMENT_ROLE?: string },
  signer: unknown,
): boolean {
  return environment.TLSN_ENVIRONMENT !== "production"
    || environment.TLSN_DEPLOYMENT_ROLE !== "canary"
    || typeof signer === "function";
}