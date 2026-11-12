export const RUNTIME_CONFIG_PRODUCTION_SIGNING_REGISTRATION = Object.freeze({
  manifest_child_signer_provider: "NOT_CONFIGURED",
  root_signed_manifest_delegation: "NOT_REGISTERED",
  app_bootstrap_root: "NOT_REGISTERED",
  manifest_endpoint: "NOT_REGISTERED",
  production_publish_allowed: false,
});

export function assertRuntimeConfigProductionSigningRegistered() {
  const registration = RUNTIME_CONFIG_PRODUCTION_SIGNING_REGISTRATION;
  if (
    !registration.production_publish_allowed ||
    registration.manifest_child_signer_provider !== "CONFIGURED" ||
    registration.root_signed_manifest_delegation !== "REGISTERED" ||
    registration.app_bootstrap_root !== "REGISTERED" ||
    registration.manifest_endpoint !== "REGISTERED"
  ) {
    throw new Error(
      "Production Runtime Config signing is blocked: the Manifest child signer, root-signed delegation, APP bootstrap root, and manifest endpoint are not registered",
    );
  }
}
