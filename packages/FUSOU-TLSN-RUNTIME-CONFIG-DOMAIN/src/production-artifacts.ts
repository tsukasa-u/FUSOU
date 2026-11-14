import {
  canonicalJsonBytes,
  decodeCanonicalBase64Url,
  encodeBase64Url,
} from "./domain.ts";

const WORKER_REFERENCE_FIELDS = [
  "worker_reference_sha256",
  "observed_at",
  "account_id",
  "script_name",
  "logical_deployment_id",
  "cloudflare_deployment_id",
  "active_version_id",
  "worker_git_commit_sha",
  "disclosure_mode",
] as const;
const AUTHORITY_PIN_FIELDS = [
  "origin_inventory_sha256",
  "target_approval_artifact_sha256",
  "security_registry_set_sha256",
] as const;
const RESULT_REGISTRY_PIN_FIELDS = [
  "result_registry_sha256",
  "result_registry_envelope_sha256",
  "result_registry_root_key_id",
  "result_registry_root_public_key_spki",
] as const;
const COMPILE_INPUT_FIELDS = [
  "FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID",
  "FUSOU_TLSN_EXPECTED_BINDING_MODE",
  "FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID",
  "FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA",
  "FUSOU_TLSN_EXPECTED_WORKER_NAME",
  "FUSOU_TLSN_NOTARY_ENDPOINT",
  "FUSOU_TLSN_NOTARY_VERIFYING_KEY",
  "FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI",
  "FUSOU_TLSN_RESULT_SIGNER_KEY_ID",
  "FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY",
  "FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT",
  "FUSOU_TLSN_SESSION_AUTHORITY_ENDPOINT",
  "FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID",
  "FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY",
  "FUSOU_TLSN_VERIFICATION_ENDPOINT",
] as const;
const INVENTORY_SOURCE =
  "packages/configs/configs.toml:[app.connect_kc_server.server_list]";
const TARGET_APPROVAL_FIELDS = [
  "schema_version",
  "authority_model",
  "environment",
  "status",
  "inventory_sha256",
  "targets",
  "approved_at",
] as const;
const SECURITY_REGISTRY_SET_FIELDS = [
  "notary_key_id",
  "notary_registry",
  "origin_inventory_sha256",
  "target_approval_artifact_sha256",
  "profile_policy_sha256",
] as const;
const RESULT_REGISTRY_ENVELOPE_PAYLOAD_FIELDS = [
  "schema_version",
  "scope",
  "signature_algorithm",
  "root_key_id",
  "root_public_key_spki",
  "registry_sha256",
  "registry",
] as const;
const RESULT_REGISTRY_ENVELOPE_FIELDS = [
  ...RESULT_REGISTRY_ENVELOPE_PAYLOAD_FIELDS,
  "signature_base64url",
] as const;
const MANIFEST_PAYLOAD_FIELDS = [
  "schema_version",
  "scope",
  "environment",
  "epoch",
  "issued_at",
  "not_before",
  "expires_at",
  "source",
  "compile_inputs",
  "production_authority_pins",
  "result_registry_pins",
] as const;
const RESULT_REGISTRY_SCOPE = "tlsn-result-signing-key-registry";
const RESULT_REGISTRY_ENVELOPE_SCOPE =
  "fusou-result-signing-key-registry-envelope";
const RESULT_REGISTRY_ENVELOPE_SIGNATURE_ALGORITHM = "Ed25519";
const ORIGIN_INVENTORY_TARGET_FIELDS = [
  "port",
  "server_identity",
  "server_index",
] as const;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const DNS_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const APPROVAL_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30,
  0x2a,
  0x30,
  0x05,
  0x06,
  0x03,
  0x2b,
  0x65,
  0x70,
  0x03,
  0x21,
  0x00,
]);
const ALPHA15_K256_KEY_LENGTH = 42;
const SECP256K1_FIELD_PRIME =
  0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;

export interface RuntimeConfigIndependentArtifactInputs {
  readonly worker_reference_raw: Uint8Array;
  readonly origin_inventory_raw: Uint8Array;
  readonly target_approval_raw: Uint8Array;
  readonly security_registry_set_raw: Uint8Array;
  readonly result_registry_envelope_raw: Uint8Array;
}

export interface RuntimeConfigProductionArtifactVerificationOptions {
  readonly payload: unknown;
  readonly inputs: RuntimeConfigIndependentArtifactInputs;
  readonly nowMs: number;
  readonly maxReferenceAgeSeconds: number;
  readonly maxClockSkewSeconds: number;
}

export interface RuntimeConfigProductionArtifactVerification {
  readonly state: "MATCHED_SIGNED_MANIFEST_PINS";
  readonly worker_reference_sha256: string;
  readonly origin_inventory_sha256: string;
  readonly target_approval_artifact_sha256: string;
  readonly security_registry_set_sha256: string;
  readonly result_registry_sha256: string;
  readonly result_registry_envelope_sha256: string;
  readonly result_registry_root_key_id: string;
  readonly result_signer_key_id: string;
  readonly result_signer_public_key_spki: string;
}

export interface RuntimeConfigPublicationObject {
  readonly key: string;
  readonly body: Uint8Array;
  readonly sha256?: string;
}

export async function verifyRuntimeConfigProductionArtifacts(
  options: RuntimeConfigProductionArtifactVerificationOptions,
): Promise<RuntimeConfigProductionArtifactVerification> {
  const payload = requireRecord(options.payload, "Runtime Config Manifest payload");
  assertManifestArtifactFields(payload);
  assertRuntimeConfigValidationTime(options);
  const source = requireRecord(payload.source, "Manifest source");
  const compileInputs = requireStringRecord(
    payload.compile_inputs,
    "Manifest compile inputs",
    COMPILE_INPUT_FIELDS,
  );
  const authorityPins = requireRecord(
    payload.production_authority_pins,
    "Manifest Production authority pins",
  );
  const resultPins = requireRecord(
    payload.result_registry_pins,
    "Manifest Result registry pins",
  );
  assertExactKeys(source, WORKER_REFERENCE_FIELDS, "Manifest source");
  assertExactKeys(authorityPins, AUTHORITY_PIN_FIELDS, "Manifest Production authority pins");
  assertExactKeys(resultPins, RESULT_REGISTRY_PIN_FIELDS, "Manifest Result registry pins");
  assertRuntimeConfigValidationTime(options);

  const inputs = requireIndependentInputs(options.inputs);
  const digests = await Promise.all([
    sha256Base64Url(inputs.worker_reference_raw),
    sha256Base64Url(inputs.origin_inventory_raw),
    sha256Base64Url(inputs.target_approval_raw),
    sha256Base64Url(inputs.security_registry_set_raw),
    sha256Base64Url(inputs.result_registry_envelope_raw),
    sha256Base64Url(
      new TextEncoder().encode(
        requireString(
          compileInputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY,
          "Manifest Result signing key registry",
        ),
      ),
    ),
  ]);
  const [
    workerReferenceDigest,
    inventoryDigest,
    approvalDigest,
    securitySetDigest,
    resultRegistryEnvelopeDigest,
    resultRegistryDigest,
  ] = digests;

  assertDigest(source.worker_reference_sha256, "Worker reference digest");
  assertDigest(authorityPins.origin_inventory_sha256, "Origin Inventory digest");
  assertDigest(
    authorityPins.target_approval_artifact_sha256,
    "Target Approval digest",
  );
  assertDigest(
    authorityPins.security_registry_set_sha256,
    "Production security registry set digest",
  );
  assertDigest(resultPins.result_registry_sha256, "Result registry digest");
  assertDigest(
    resultPins.result_registry_envelope_sha256,
    "Result registry envelope digest",
  );
  if (
    workerReferenceDigest !== source.worker_reference_sha256 ||
    inventoryDigest !== authorityPins.origin_inventory_sha256 ||
    approvalDigest !== authorityPins.target_approval_artifact_sha256 ||
    securitySetDigest !== authorityPins.security_registry_set_sha256 ||
    resultRegistryDigest !== resultPins.result_registry_sha256 ||
    resultRegistryEnvelopeDigest !==
      resultPins.result_registry_envelope_sha256
  ) {
    throw new Error(
      "Production artifact bytes do not match the signed Manifest digests",
    );
  }

  const referenceObservedAtMs = assertCanonicalUtc(
    source.observed_at,
    "Worker reference observation time",
  );
  const skewMs = options.maxClockSkewSeconds * 1_000;
  const maxReferenceAgeMs = options.maxReferenceAgeSeconds * 1_000;
  if (
    referenceObservedAtMs > options.nowMs + skewMs ||
    options.nowMs - referenceObservedAtMs > maxReferenceAgeMs
  ) {
    throw new Error("runtime configuration Worker reference is not fresh");
  }

  const { text: resultRegistryEnvelopeText, value: resultRegistryEnvelope } =
    parseJsonBytes(
      inputs.result_registry_envelope_raw,
      "Result signer registry envelope",
    );
  const workerReference = parseJsonBytes(
    inputs.worker_reference_raw,
    "Worker reference",
  ).value;
  verifyWorkerReference(
    payload,
    source,
    compileInputs,
    resultPins,
    workerReference,
    resultRegistryEnvelopeText,
  );

  const { value: inventory } = parseJsonBytes(
    inputs.origin_inventory_raw,
    "Origin Inventory",
  );
  const { text: approvalText, value: approval } = parseJsonBytes(
    inputs.target_approval_raw,
    "Target Approval",
  );
  const { text: securitySetText, value: securitySet } = parseJsonBytes(
    inputs.security_registry_set_raw,
    "Production security registry set",
  );
  verifyAuthorityArtifacts({
    payload,
    compileInputs,
    inventory,
    approval,
    approvalText,
    inventoryDigest,
    securityRegistrySet: securitySet,
    securityRegistrySetText: securitySetText,
    approvalDigest,
    securitySetDigest,
  });

  const resultRegistryIdentity = await verifyResultRegistry({
    compileInputs,
    resultPins,
    envelope: resultRegistryEnvelope,
    resultRegistryEnvelopeDigest,
    resultRegistryDigest,
    validationTimeMs: options.nowMs,
  });

  return Object.freeze({
    state: "MATCHED_SIGNED_MANIFEST_PINS",
    worker_reference_sha256: workerReferenceDigest,
    origin_inventory_sha256: inventoryDigest,
    target_approval_artifact_sha256: approvalDigest,
    security_registry_set_sha256: securitySetDigest,
    result_registry_sha256: resultRegistryDigest,
    result_registry_envelope_sha256: resultRegistryEnvelopeDigest,
    result_registry_root_key_id: resultRegistryIdentity.rootKeyId,
    result_signer_key_id: resultRegistryIdentity.signerKeyId,
    result_signer_public_key_spki: resultRegistryIdentity.signerPublicKeySpki,
  });
}

export async function verifyRuntimeConfigPublicationObjects(options: {
  readonly payload: unknown;
  readonly objects: readonly RuntimeConfigPublicationObject[];
  readonly nowMs: number;
  readonly maxReferenceAgeSeconds: number;
  readonly maxClockSkewSeconds: number;
}): Promise<RuntimeConfigProductionArtifactVerification> {
  const payload = requireRecord(options.payload, "Runtime Config Manifest payload");
  assertManifestArtifactFields(payload);
  assertRuntimeConfigValidationTime(options);
  const source = requireRecord(payload.source, "Manifest source");
  const authorityPins = requireRecord(
    payload.production_authority_pins,
    "Manifest Production authority pins",
  );
  const resultPins = requireRecord(
    payload.result_registry_pins,
    "Manifest Result registry pins",
  );
  const expected = [
    [
      "worker-reference",
      requireString(source.worker_reference_sha256, "Worker reference digest"),
    ],
    [
      "origin-inventory",
      requireString(
        authorityPins.origin_inventory_sha256,
        "Origin Inventory digest",
      ),
    ],
    [
      "target-approval",
      requireString(
        authorityPins.target_approval_artifact_sha256,
        "Target Approval digest",
      ),
    ],
    [
      "security-registry-set",
      requireString(
        authorityPins.security_registry_set_sha256,
        "Production security registry set digest",
      ),
    ],
    [
      "result-registry-envelope",
      requireString(
        resultPins.result_registry_envelope_sha256,
        "Result registry envelope digest",
      ),
    ],
  ] as const;
  if (!Array.isArray(options.objects) || options.objects.length !== expected.length) {
    throw new Error(
      "Release publication object inventory must contain exactly five artifacts",
    );
  }
  const artifactBodies: Uint8Array[] = [];
  let totalBytes = 0;
  for (const [index, [role, digest]] of expected.entries()) {
    assertDigest(digest, `${role} expected digest`);
    const object = requireRecord(
      options.objects[index],
      `Release ${role} publication object`,
    );
    const allowedKeys = ["body", "key", "sha256"];
    if (
      Object.keys(object).some((key) => !allowedKeys.includes(key)) ||
      typeof object.key !== "string" ||
      !(object.body instanceof Uint8Array) ||
      object.body.byteLength === 0 ||
      object.body.byteLength > 2_000_000 ||
      (object.sha256 !== undefined &&
        (typeof object.sha256 !== "string" || object.sha256 !== digest))
    ) {
      throw new Error(`Release ${role} publication object is invalid`);
    }
    totalBytes += object.body.byteLength;
    if (totalBytes > 4_000_000) {
      throw new Error("Release publication objects exceed the aggregate limit");
    }
    const actualDigest = await sha256Base64Url(object.body);
    if (
      object.key !==
        `tlsn/runtime-config/v2/artifacts/${role}/${digest}` ||
      actualDigest !== digest
    ) {
      throw new Error(
        `Release ${role} bytes do not match the signed Manifest`,
      );
    }
    artifactBodies.push(object.body);
  }
  const independentInputs: RuntimeConfigIndependentArtifactInputs = {
    worker_reference_raw: artifactBodies[0]!,
    origin_inventory_raw: artifactBodies[1]!,
    target_approval_raw: artifactBodies[2]!,
    security_registry_set_raw: artifactBodies[3]!,
    result_registry_envelope_raw: artifactBodies[4]!,
  };
  return verifyRuntimeConfigProductionArtifacts({
    payload,
    inputs: independentInputs,
    nowMs: options.nowMs,
    maxReferenceAgeSeconds: options.maxReferenceAgeSeconds,
    maxClockSkewSeconds: options.maxClockSkewSeconds,
  });
}

function assertManifestArtifactFields(
  payload: Record<string, unknown>,
): void {
  assertExactKeys(payload, MANIFEST_PAYLOAD_FIELDS, "Runtime Config Manifest payload");
  if (
    payload.schema_version !== 2 ||
    payload.scope !== "fusou-tlsn-runtime-config-manifest-v2" ||
    payload.environment !== "production"
  ) {
    throw new Error("Production Runtime Config Manifest payload is invalid");
  }
}

function requireIndependentInputs(
  inputs: unknown,
): RuntimeConfigIndependentArtifactInputs {
  const record = requireRecord(inputs, "independent runtime configuration inputs");
  assertExactKeys(
    record,
    [
      "worker_reference_raw",
      "origin_inventory_raw",
      "target_approval_raw",
      "security_registry_set_raw",
      "result_registry_envelope_raw",
    ],
    "independent runtime configuration inputs",
  );
  const requiredBytes = (key: keyof RuntimeConfigIndependentArtifactInputs) => {
    const value = record[key];
    if (!(value instanceof Uint8Array) || value.byteLength === 0) {
      throw new Error(`${artifactLabel(key)} raw bytes are required`);
    }
    return value;
  };
  return {
    worker_reference_raw: requiredBytes("worker_reference_raw"),
    origin_inventory_raw: requiredBytes("origin_inventory_raw"),
    target_approval_raw: requiredBytes("target_approval_raw"),
    security_registry_set_raw: requiredBytes("security_registry_set_raw"),
    result_registry_envelope_raw: requiredBytes(
      "result_registry_envelope_raw",
    ),
  };
}

function artifactLabel(key: keyof RuntimeConfigIndependentArtifactInputs): string {
  switch (key) {
    case "worker_reference_raw":
      return "Worker reference";
    case "origin_inventory_raw":
      return "Origin Inventory";
    case "target_approval_raw":
      return "Target Approval";
    case "security_registry_set_raw":
      return "Production security registry set";
    case "result_registry_envelope_raw":
      return "Result registry envelope";
  }
}

function assertRuntimeConfigValidationTime(
  options: Pick<
    RuntimeConfigProductionArtifactVerificationOptions,
    "nowMs" | "maxReferenceAgeSeconds" | "maxClockSkewSeconds"
  >,
): void {
  if (
    !Number.isSafeInteger(options.nowMs) ||
    !Number.isSafeInteger(options.maxReferenceAgeSeconds) ||
    options.maxReferenceAgeSeconds < 0 ||
    options.maxReferenceAgeSeconds >
      Math.floor(Number.MAX_SAFE_INTEGER / 1_000) ||
    !Number.isSafeInteger(options.maxClockSkewSeconds) ||
    options.maxClockSkewSeconds < 0 ||
    options.maxClockSkewSeconds >
      Math.floor(Number.MAX_SAFE_INTEGER / 1_000)
  ) {
    throw new Error("independent runtime configuration validation time is invalid");
  }
}

function verifyWorkerReference(
  payload: Record<string, unknown>,
  source: Record<string, unknown>,
  compileInputs: Record<string, string>,
  resultPins: Record<string, unknown>,
  reference: Record<string, unknown>,
  resultRegistryEnvelopeText: string,
): void {
  const cloudflare = requireRecord(
    reference.cloudflare,
    "Worker reference Cloudflare identity",
  );
  const bindings = requireRecord(
    cloudflare.checked_public_bindings,
    "Worker reference public bindings",
  );
  const releaseContext = requireRecord(
    reference.release_context,
    "Worker reference release context",
  );
  const referenceCompileInputs = requireRecord(
    reference.compile_inputs,
    "Worker reference compile inputs",
  );
  const manifestCompileInputs = requireRecord(
    payload.compile_inputs,
    "Manifest compile inputs",
  );
  const sourceAccountId = requireString(source.account_id, "Manifest account ID");
  const scriptName = requireString(source.script_name, "Manifest Worker name");
  const logicalDeploymentId = requireString(
    source.logical_deployment_id,
    "Manifest logical deployment ID",
  );
  const cloudflareDeploymentId = requireString(
    source.cloudflare_deployment_id,
    "Manifest Cloudflare deployment ID",
  );
  const activeVersionId = requireString(
    source.active_version_id,
    "Manifest active Worker version ID",
  );
  const workerGitCommitSha = requireString(
    source.worker_git_commit_sha,
    "Manifest Worker Git commit",
  );
  const observedAt = requireString(
    source.observed_at,
    "Manifest Worker reference observation time",
  );
  const disclosureMode = requireString(
    source.disclosure_mode,
    "Manifest disclosure mode",
  );
  const registryRootKeyId = requireString(
    resultPins.result_registry_root_key_id,
    "Manifest Result registry root key ID",
  );
  const registryRootPublicKeySpki = requireString(
    resultPins.result_registry_root_public_key_spki,
    "Manifest Result registry root public key",
  );
  if (
    reference.schema_version !== 2 ||
    reference.scope !== "tlsn-app-approved-worker-deployment-reference" ||
    reference.authority !==
      "operator-controlled-approved-release-and-authenticated-cloudflare-control-plane" ||
    reference.observed_at !== observedAt ||
    reference.disclosure_mode !== disclosureMode ||
    cloudflare.account_id !== sourceAccountId ||
    cloudflare.script_name !== scriptName ||
    cloudflare.deployment_id !== cloudflareDeploymentId ||
    cloudflare.version_id !== activeVersionId ||
    cloudflare.percentage !== 100 ||
    releaseContext.deployment_role !== "production" ||
    releaseContext.git_commit_sha !== workerGitCommitSha ||
    canonicalJsonText(referenceCompileInputs) !==
      canonicalJsonText(manifestCompileInputs) ||
    compileInputs.FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID !==
      logicalDeploymentId ||
    compileInputs.FUSOU_TLSN_EXPECTED_WORKER_NAME !== scriptName ||
    compileInputs.FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID !== activeVersionId ||
    compileInputs.FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA !== workerGitCommitSha ||
    bindings.TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI !==
      compileInputs.FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI ||
    bindings.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID !==
      compileInputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID ||
    bindings.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY !==
      compileInputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY ||
    bindings.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE !==
      resultRegistryEnvelopeText ||
    bindings.TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID !==
      registryRootKeyId ||
    bindings.TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI !==
      registryRootPublicKeySpki
  ) {
    throw new Error("Worker reference identity does not match the signed manifest");
  }
}

function verifyAuthorityArtifacts(options: {
  readonly payload: Record<string, unknown>;
  readonly compileInputs: Record<string, string>;
  readonly inventory: Record<string, unknown>;
  readonly approval: Record<string, unknown>;
  readonly approvalText: string;
  readonly inventoryDigest: string;
  readonly securityRegistrySet: Record<string, unknown>;
  readonly securityRegistrySetText: string;
  readonly approvalDigest: string;
  readonly securitySetDigest: string;
}): void {
  const {
    payload,
    compileInputs,
    inventory,
    approval,
    approvalText,
    inventoryDigest,
    securityRegistrySet,
    securityRegistrySetText,
    securitySetDigest,
    approvalDigest,
  } = options;
  const authorityPins = requireRecord(
    payload.production_authority_pins,
    "Manifest Production authority pins",
  );
  assertExactKeys(
    inventory,
    ["schema_version", "source", "targets"],
    "Origin Inventory",
  );
  if (
    inventory.schema_version !== 1 ||
    inventory.source !== INVENTORY_SOURCE ||
    !Array.isArray(inventory.targets) ||
    inventory.targets.length !== 20
  ) {
    throw new Error(
      "Origin Inventory must contain exactly 20 schema-v1 targets",
    );
  }
  const positions = new Map<string, number>();
  const identities = new Set<string>();
  inventory.targets.forEach((value, index) => {
    const target = requireRecord(value, `Origin Inventory target ${index + 1}`);
    assertExactKeys(
      target,
      ORIGIN_INVENTORY_TARGET_FIELDS,
      `Origin Inventory target ${index + 1}`,
    );
    const identity = requireString(
      target.server_identity,
      `Origin Inventory target ${index + 1} identity`,
    );
    if (
      target.server_index !== index + 1 ||
      target.port !== 443 ||
      !isCanonicalServerIdentity(identity) ||
      identities.has(identity)
    ) {
      throw new Error(
        "Origin Inventory targets are invalid, unordered, or duplicated",
      );
    }
    identities.add(identity);
    positions.set(identity, index);
  });

  assertExactKeys(approval, TARGET_APPROVAL_FIELDS, "Target Approval");
  if (
    Object.keys(approval).join("\0") !== TARGET_APPROVAL_FIELDS.join("\0") ||
    JSON.stringify(
      Object.fromEntries(
        TARGET_APPROVAL_FIELDS.map((field) => [field, approval[field]]),
      ),
      null,
      2,
    ) !== approvalText ||
    approval.schema_version !== 1 ||
    approval.authority_model !== "FUSOU_DEPLOYMENT_OPERATOR" ||
    approval.environment !== "production" ||
    approval.status !== "APPROVED" ||
    approval.inventory_sha256 !== inventoryDigest ||
    !Array.isArray(approval.targets) ||
    approval.targets.length === 0 ||
    typeof approval.approved_at !== "string" ||
    !APPROVAL_TIME_PATTERN.test(approval.approved_at) ||
    !Number.isFinite(Date.parse(approval.approved_at))
  ) {
    throw new Error(
      "Target Approval does not match the current approved Production inventory",
    );
  }
  const seenApprovedTargets = new Set<string>();
  let previousPosition = -1;
  for (const value of approval.targets) {
    const identity = requireString(value, "Target Approval server identity");
    const position = positions.get(identity);
    if (
      !isCanonicalServerIdentity(identity) ||
      position === undefined ||
      seenApprovedTargets.has(identity) ||
      position <= previousPosition
    ) {
      throw new Error(
        "Target Approval contains an invalid, duplicate, or unordered target",
      );
    }
    seenApprovedTargets.add(identity);
    previousPosition = position;
  }

  assertExactKeys(
    securityRegistrySet,
    SECURITY_REGISTRY_SET_FIELDS,
    "Production security registry set",
  );
  if (canonicalJsonText(securityRegistrySet) !== securityRegistrySetText) {
    throw new Error("Production security registry set is not canonical JSON");
  }
  const notaryKeyId = requireString(
    securityRegistrySet.notary_key_id,
    "Production security registry set Notary key ID",
  );
  const notaryRegistry = requireRecord(
    securityRegistrySet.notary_registry,
    "Production security registry set Notary registry",
  );
  const notaryCompileKey = compileInputs.FUSOU_TLSN_NOTARY_VERIFYING_KEY;
  if (
    !KEY_ID_PATTERN.test(notaryKeyId) ||
    securityRegistrySet.origin_inventory_sha256 !== inventoryDigest ||
    securityRegistrySet.target_approval_artifact_sha256 !== approvalDigest ||
    securitySetDigest !== authorityPins.security_registry_set_sha256 ||
    Object.keys(notaryRegistry).length === 0 ||
    notaryRegistry[notaryKeyId] !== notaryCompileKey
  ) {
    throw new Error(
      "Production security registry set does not bind the verified authority artifacts",
    );
  }
  for (const [keyId, verifyingKey] of Object.entries(notaryRegistry)) {
    if (!KEY_ID_PATTERN.test(keyId) || typeof verifyingKey !== "string") {
      throw new Error(
        "Production security registry set Notary registry contains an invalid entry",
      );
    }
    assertAlpha15NotaryVerifyingKey(verifyingKey);
  }
  assertDigest(
    securityRegistrySet.profile_policy_sha256,
    "Production profile policy digest",
  );
}

async function verifyResultRegistry(options: {
  readonly compileInputs: Record<string, string>;
  readonly resultPins: Record<string, unknown>;
  readonly envelope: Record<string, unknown>;
  readonly resultRegistryEnvelopeDigest: string;
  readonly resultRegistryDigest: string;
  readonly validationTimeMs: number;
}): Promise<{
  readonly rootKeyId: string;
  readonly signerKeyId: string;
  readonly signerPublicKeySpki: string;
}> {
  const {
    compileInputs,
    resultPins,
    envelope,
    resultRegistryEnvelopeDigest,
    resultRegistryDigest,
    validationTimeMs,
  } = options;
  assertExactKeys(
    envelope,
    RESULT_REGISTRY_ENVELOPE_FIELDS,
    "Result registry envelope",
  );
  if (
    envelope.schema_version !== 1 ||
    envelope.scope !== RESULT_REGISTRY_ENVELOPE_SCOPE ||
    envelope.signature_algorithm !==
      RESULT_REGISTRY_ENVELOPE_SIGNATURE_ALGORITHM
  ) {
    throw new Error("Result registry envelope schema or algorithm is invalid");
  }
  const rootKeyId = requireString(
    resultPins.result_registry_root_key_id,
    "Manifest Result registry root key ID",
  );
  const rootPublicKeySpki = requireString(
    resultPins.result_registry_root_public_key_spki,
    "Manifest Result registry root public key",
  );
  if (
    !KEY_ID_PATTERN.test(rootKeyId) ||
    envelope.root_key_id !== rootKeyId ||
    envelope.root_public_key_spki !== rootPublicKeySpki
  ) {
    throw new Error(
      "Result registry root does not match the signed Manifest pin",
    );
  }
  assertDigest(envelope.registry_sha256, "Result registry envelope registry digest");
  if (envelope.registry_sha256 !== resultRegistryDigest) {
    throw new Error(
      "Result registry envelope digest does not match the registry bytes",
    );
  }
  const registryText = requireString(
    compileInputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY,
    "Manifest Result signing key registry",
  );
  const { value: registry } = parseJsonText(registryText, "Result key registry");
  await assertSigningKeyRegistry(
    registry,
    validationTimeMs,
    requireString(
      compileInputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID,
      "Manifest Result signer key ID",
    ),
    requireString(
      compileInputs.FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI,
      "Manifest Result signer public key",
    ),
  );
  const envelopeRegistry = requireRecord(
    envelope.registry,
    "Result registry envelope registry",
  );
  if (canonicalJsonText(envelopeRegistry) !== canonicalJsonText(registry)) {
    throw new Error(
      "Result registry envelope content does not match the signed Manifest registry",
    );
  }
  const payload = Object.fromEntries(
    RESULT_REGISTRY_ENVELOPE_PAYLOAD_FIELDS.map((field) => [
      field,
      envelope[field],
    ]),
  );
  const signature = decodeCanonicalBase64Url(
    requireString(
      envelope.signature_base64url,
      "Result registry envelope signature",
    ),
    "Result registry envelope signature",
    64,
  );
  const rootKey = await importEd25519PublicKey(
    rootPublicKeySpki,
    "Result registry root public key",
  );
  const validSignature = await crypto.subtle.verify(
    { name: "Ed25519" },
    rootKey,
    toArrayBuffer(signature),
    toArrayBuffer(canonicalJsonBytes(payload)),
  );
  if (!validSignature) {
    throw new Error("Result registry envelope signature is invalid");
  }
  if (
    resultRegistryEnvelopeDigest !==
    resultPins.result_registry_envelope_sha256
  ) {
    throw new Error(
      "Result registry envelope bytes do not match the signed Manifest digest",
    );
  }
  return {
    rootKeyId,
    signerKeyId: requireString(
      compileInputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID,
      "Manifest Result signer key ID",
    ),
    signerPublicKeySpki: requireString(
      compileInputs.FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI,
      "Manifest Result signer public key",
    ),
  };
}

async function assertSigningKeyRegistry(
  value: Record<string, unknown>,
  nowMs: number,
  currentKeyId: string,
  currentPublicKeySpki: string,
): Promise<void> {
  if (
    value.schema_version !== 1 ||
    value.scope !== RESULT_REGISTRY_SCOPE ||
    !Array.isArray(value.keys) ||
    value.keys.length === 0
  ) {
    throw new Error("invalid Result signing key registry schema");
  }
  const seen = new Set<string>();
  let currentKey: Record<string, unknown> | null = null;
  for (const [index, entry] of value.keys.entries()) {
    const key = requireRecord(entry, `Result signing key ${index}`);
    const keyId = requireString(key.key_id, `Result signing key ${index} ID`);
    if (!KEY_ID_PATTERN.test(keyId) || seen.has(keyId)) {
      throw new Error(`invalid or duplicate Result signing key ID at index ${index}`);
    }
    seen.add(keyId);
    const publicKeySpki = requireString(
      key.public_key_spki,
      `Result signing key ${keyId} public key`,
    );
    await importEd25519PublicKey(publicKeySpki, `Result signing key ${keyId}`);
    if (
      !["ACTIVE", "VERIFY_ONLY", "RETIRED", "REVOKED"].includes(
        String(key.status),
      )
    ) {
      throw new Error(`invalid status for Result signing key ${keyId}`);
    }
    const notBeforeMs = assertTimestamp(
      key.not_before,
      `Result signing key ${keyId}.not_before`,
    );
    let notAfterMs: number | null = null;
    if (key.not_after !== null) {
      notAfterMs = assertTimestamp(
        key.not_after,
        `Result signing key ${keyId}.not_after`,
      );
      if (notAfterMs <= notBeforeMs) {
        throw new Error(`Result signing key ${keyId} has an invalid validity window`);
      }
    }
    if (keyId === currentKeyId) currentKey = key;
  }
  if (
    currentKey === null ||
    currentKey.public_key_spki !== currentPublicKeySpki
  ) {
    throw new Error("current Result signing key is not the published registry key");
  }
  if (currentKey.status !== "ACTIVE") {
    throw new Error("current Result signing key is not ACTIVE");
  }
  const notBeforeMs = assertTimestamp(
    currentKey.not_before,
    `Result signing key ${currentKeyId}.not_before`,
  );
  const notAfterMs = currentKey.not_after === null
    ? null
    : assertTimestamp(
      currentKey.not_after,
      `Result signing key ${currentKeyId}.not_after`,
    );
  if (
    notBeforeMs > nowMs ||
    (notAfterMs !== null && notAfterMs < nowMs)
  ) {
    throw new Error(`current Result signing key is outside its validity window`);
  }
}

async function importEd25519PublicKey(
  value: string,
  label: string,
): Promise<CryptoKey> {
  const spki = assertEd25519SpkiEncoding(value, label);
  try {
    return await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(spki),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    throw new Error(`${label} must be a valid Ed25519 SPKI public key`);
  }
}

function assertEd25519SpkiEncoding(value: string, label: string): Uint8Array {
  if (value.length !== 59) {
    throw new Error(`${label} must be a canonical Ed25519 SPKI public key`);
  }
  const spki = decodeCanonicalBase64Url(value, label, 44);
  if (!ED25519_SPKI_PREFIX.every((byte, index) => spki[index] === byte)) {
    throw new Error(`${label} must be a canonical Ed25519 SPKI public key`);
  }
  return spki;
}

function assertAlpha15NotaryVerifyingKey(value: string): void {
  const bytes = decodeCanonicalBase64Url(
    value,
    "Production security registry set Notary key",
    ALPHA15_K256_KEY_LENGTH,
  );
  if (
    bytes[0] !== 1 ||
    readLittleEndian(bytes.subarray(1, 9)) !== 33n ||
    (bytes[9] !== 0x02 && bytes[9] !== 0x03)
  ) {
    throw new Error(
      "Production security registry set Notary key is not a canonical TLSNotary alpha.15 K256 bincode VerifyingKey",
    );
  }
  const x = readBigEndian(bytes.subarray(10));
  if (x >= SECP256K1_FIELD_PRIME) {
    throw new Error(
      "Production security registry set Notary key is not a valid compressed secp256k1 point",
    );
  }
  const ySquared = mod(x * x * x + 7n, SECP256K1_FIELD_PRIME);
  const squareRoot = modPow(
    ySquared,
    (SECP256K1_FIELD_PRIME + 1n) / 4n,
    SECP256K1_FIELD_PRIME,
  );
  if ((squareRoot * squareRoot) % SECP256K1_FIELD_PRIME !== ySquared) {
    throw new Error(
      "Production security registry set Notary key is not a valid compressed secp256k1 point",
    );
  }
  const oppositeSquareRoot = mod(-squareRoot, SECP256K1_FIELD_PRIME);
  const requestedParity = BigInt(bytes[9]! & 1);
  if (
    (squareRoot & 1n) !== requestedParity &&
    (oppositeSquareRoot & 1n) !== requestedParity
  ) {
    throw new Error(
      "Production security registry set Notary key has invalid point parity",
    );
  }
}

function readBigEndian(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function readLittleEndian(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index--) {
    value = (value << 8n) | BigInt(bytes[index]!);
  }
  return value;
}

function mod(value: bigint, modulus: bigint): bigint {
  const remainder = value % modulus;
  return remainder < 0n ? remainder + modulus : remainder;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = mod(base, modulus);
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    remaining >>= 1n;
  }
  return result;
}

function parseJsonBytes(
  bytes: Uint8Array,
  label: string,
): { readonly text: string; readonly value: Record<string, unknown> } {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8`);
  }
  return parseJsonText(text, label);
}

function parseJsonText(
  text: string,
  label: string,
): { readonly text: string; readonly value: Record<string, unknown> } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  return { text, value: requireRecord(value, `${label} must be a JSON object`) };
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  return value;
}

function requireStringRecord(
  value: unknown,
  label: string,
  expectedFields: readonly string[],
): Record<string, string> {
  const record = requireRecord(value, label);
  assertExactKeys(record, expectedFields, label);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string" || !entry.trim() || entry.includes("\0")) {
      throw new Error(`${label} field ${key} is invalid`);
    }
    result[key] = entry;
  }
  return result;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((field, index) => field !== sortedExpected[index])
  ) {
    throw new Error(`${label} field inventory is invalid`);
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_BASE64URL_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 base64url digest`);
  }
  decodeCanonicalBase64Url(value, label, 32);
}

function assertCanonicalUtc(value: unknown, label: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) {
    throw new Error(`${label} must be canonical UTC millisecond time`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return milliseconds;
}

function assertTimestamp(value: unknown, label: string): number {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return Date.parse(value);
}

function isCanonicalServerIdentity(value: string): boolean {
  return (
    value === value.toLowerCase() &&
    DNS_HOSTNAME_PATTERN.test(value)
  );
}

function canonicalJsonText(value: unknown): string {
  return new TextDecoder().decode(canonicalJsonBytes(value));
}

async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes)),
  );
  return encodeBase64Url(digest);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
