export const RUNTIME_CONFIG_PRODUCTION_SIGNING_REGISTRATION = Object.freeze({
  signer_provider: "NOT_CONFIGURED",
  independent_signer_pin: "NOT_REGISTERED",
  app_bootstrap_root: "NOT_REGISTERED",
  manifest_endpoint: "NOT_REGISTERED",
  production_publish_allowed: false,
});

export function assertRuntimeConfigProductionSigningRegistered() {
  const registration = RUNTIME_CONFIG_PRODUCTION_SIGNING_REGISTRATION;
  if (
    !registration.production_publish_allowed ||
    registration.signer_provider !== "CONFIGURED" ||
    registration.independent_signer_pin !== "REGISTERED" ||
    registration.app_bootstrap_root !== "REGISTERED" ||
    registration.manifest_endpoint !== "REGISTERED"
  ) {
    throw new Error(
      "Production Runtime Config signing is blocked: the approved signer provider, independent pin, APP bootstrap root, and manifest endpoint are not registered",
    );
  }
}
