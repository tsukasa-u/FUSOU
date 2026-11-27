import { createHash, createPublicKey, verify } from "node:crypto";
import { canonicalJson } from "./production-trust-contract.mjs";
import { tlsnRuntimeConfigApprovedConfigurationSha256 } from "./tlsn-runtime-config-manifest.mjs";

export const RUNTIME_CONFIG_PRODUCTION_SIGNING_REGISTRATION = Object.freeze({
  manifest_child_signer_provider: "NOT_CONFIGURED",
  root_signed_manifest_delegation: "NOT_REGISTERED",
  app_bootstrap_root: "NOT_REGISTERED",
  manifest_endpoint: "NOT_REGISTERED",
  production_publish_allowed: false,
});

// Initial dedicated testplay. The pin is trusted tooling configuration, not
// part of the approval document, CLI environment, or Manifest signer input.
export const FIRST_TESTPLAY_MANIFEST_APPROVAL_AUTHORITY = Object.freeze({
  keyId: "fusou-first-testplay-manifest-approval-c25f1b71e",
  publicKeySpki: "MCowBQYDK2VwAyEAtLynZRF0Y3WfAN6Bu2Tbl-oya6JqMHfNHY6BfHa3CYw",
  sourceSha: "c25f1b71e830ab2fd27fcb07f67bff9c4e847dcf",
  manifestUrl: "https://tlsn-config.fusou.dev/tlsn/runtime-config/v2/manifest.json",
});

export function manifestSigningApprovalBytes({
  authority, prepared, trustedSigner, manifestAuthorityDelegationRaw, predecessor,
}) {
  return Buffer.from(canonicalJson({
    schema_version: 1,
    scope: predecessor
      ? "fusou-tlsn-successor-manifest-signing-approval-v1"
      : "fusou-tlsn-initial-manifest-signing-approval-v1",
    authority_key_id: authority.keyId,
    manifest_url: authority.manifestUrl,
    source_sha: authority.sourceSha,
    bootstrap_root_key_id: trustedSigner.key_id,
    bootstrap_root_public_key_spki: trustedSigner.public_key_spki,
    manifest_delegation_sha256: createHash("sha256").update(manifestAuthorityDelegationRaw).digest("base64url"),
    approved_configuration_sha256: tlsnRuntimeConfigApprovedConfigurationSha256(
      prepared.payload, authority.manifestUrl,
    ),
    ...(predecessor && {
      previous_epoch: predecessor.epoch,
      previous_manifest_sha256: predecessor.digest,
      successor_epoch: prepared.payload.epoch,
    }),
  }));
}

export function manifestSigningApprovalMessage(approvalBytes, successor = false) {
  return Buffer.concat([
    Buffer.from(successor
      ? "FUSOU-TLSN-SUCCESSOR-MANIFEST-SIGNING-APPROVAL-V1\0"
      : "FUSOU-TLSN-INITIAL-MANIFEST-SIGNING-APPROVAL-V1\0", "ascii"),
    approvalBytes,
  ]);
}

export function assertInitialManifestSigningApproval(options, authority) {
  assertManifestSigningApproval(options, authority);
}

export function assertSuccessorManifestSigningApproval(options, authority) {
  const epoch = options?.policy?.last_accepted_epoch;
  const digest = options?.policy?.last_accepted_manifest_sha256;
  const next = options?.prepared?.payload?.epoch;
  if (!/^[1-9][0-9]{0,19}$/u.test(epoch ?? "") ||
      !/^[1-9][0-9]{0,19}$/u.test(next ?? "") ||
      !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(digest ?? "") ||
      BigInt(next) !== BigInt(epoch) + 1n) {
    throw new Error("Production successor Manifest approval must bind an exact predecessor and consecutive epoch");
  }
  assertManifestSigningApproval(options, authority, { epoch, digest });
}

function assertManifestSigningApproval(options, authority, predecessor) {
  const { prepared, policy, trustedSigner, manifestAuthorityDelegationRaw } =
    options ?? {};
  const { approvalBytes, signatureBytes } = (predecessor
    ? options.successorManifestSigningApproval
    : options?.initialManifestSigningApproval) ?? {};
  if (!(approvalBytes instanceof Uint8Array) || approvalBytes.byteLength === 0 ||
      approvalBytes.byteLength > 4096 || !(signatureBytes instanceof Uint8Array) ||
      signatureBytes.byteLength !== 64 || !(manifestAuthorityDelegationRaw instanceof Uint8Array) ||
      !trustedSigner || policy?.manifest_url !== authority.manifestUrl ||
      prepared?.payload?.source?.worker_git_commit_sha !== authority.sourceSha ||
      (!predecessor && prepared.payload.epoch !== "1")) {
    throw new Error("Production Manifest requires a valid independently signed approval for the fixed release");
  }
  const approvalKey = createPublicKey({
    key: Buffer.from(authority.publicKeySpki, "base64url"), type: "spki", format: "der",
  });
  if (approvalKey.asymmetricKeyType !== "ed25519" ||
      trustedSigner.public_key_spki === authority.publicKeySpki ||
      options.signerProvider?.public_key_spki === authority.publicKeySpki ||
      !verify(null, manifestSigningApprovalMessage(approvalBytes, Boolean(predecessor)), approvalKey, signatureBytes)) {
    throw new Error("Production Manifest approval signature or authority is invalid");
  }
  const expected = manifestSigningApprovalBytes({ authority, prepared, trustedSigner, manifestAuthorityDelegationRaw, predecessor });
  if (!expected.equals(approvalBytes)) {
    throw new Error("Production Manifest approval does not match the Bootstrap root, delegation, configuration or predecessor");
  }
}

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
