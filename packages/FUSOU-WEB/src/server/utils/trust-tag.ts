import type { AttestationLevel, TrustTag } from "../types";

export type TrustInput = {
  attestation_level: AttestationLevel;
  attestation_valid: boolean;
  environment_flags: {
    emulator_detected: boolean;
    debugger_detected: boolean;
    hook_detected: boolean;
  };
  schema_fingerprint_valid: boolean;
};

export function normalizeTrustTag(value: unknown): TrustTag | null {
  if (
    value === "hw_verified" ||
    value === "sw_verified" ||
    value === "unverified" ||
    value === "suspicious"
  ) {
    return value;
  }
  return null;
}

export function determineTrustTag(input: TrustInput): TrustTag {
  const hasEnvAnomaly =
    input.environment_flags.emulator_detected ||
    input.environment_flags.debugger_detected ||
    input.environment_flags.hook_detected;

  if (!input.schema_fingerprint_valid) {
    return "suspicious";
  }

  if (
    input.attestation_level === "tpm" ||
    input.attestation_level === "secure_enclave"
  ) {
    if (input.attestation_valid && !hasEnvAnomaly) {
      return "hw_verified";
    }
    return "suspicious";
  }

  if (input.attestation_level === "software_fingerprint") {
    if (input.attestation_valid && !hasEnvAnomaly) {
      return "sw_verified";
    }
    return "suspicious";
  }

  return "unverified";
}
