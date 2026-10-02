export const TRIGGER_ORIGIN_INVENTORY_ARTIFACT_RAW_SHA256_ENV: string;
export function originInventoryArtifactRawSha256(rawBytes: Uint8Array): string;
export function assertTriggerInventoryArtifactDigest(artifactDigest: string, runtimeDigest: string): string;
export function assertTaskOriginInventoryDigest(taskDigest: string | undefined, runtimeDigest: string): string;