export function resolvePinnedProductionTargets(input: {
  inventoryRaw: string; approvalRaw: string; inventoryPin: string | undefined; approvalPin: string | undefined;
}): Promise<{ inventorySha256: string; approvalSha256: string; targets: string[] }>;
export function assertPreparedResultContract(result: Record<string, unknown>, input: {
  profile: "complete" | "sparse"; serverIdentity: string; profileSha256: string;
  presentationBytes: Uint8Array; production: boolean; inventorySha256?: string | null; approvalSha256?: string | null;
}): Promise<void>;
