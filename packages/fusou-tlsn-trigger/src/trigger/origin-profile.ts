export type OriginTarget = {
  server_index: number;
  server_identity: string;
  port: number;
};

export type VerificationProfile = "complete" | "sparse";
export type OriginPolicy = "fixed" | "inventory" | "synthetic";

export function selectOriginTarget(
  serverIdentity: string,
  targets: readonly OriginTarget[],
): OriginTarget | undefined {
  return targets.find((target) =>
    target.port === 443 &&
    target.server_identity.toLowerCase() === serverIdentity.toLowerCase()
  );
}

export function canonicalProfileBytes(
  profile: VerificationProfile,
  serverIdentity: string,
): Uint8Array {
  const contract = profile === "sparse"
    ? {
        disclosure_mode: "sparse",
        id: "fusou-require-info-v2-sparse",
        server_identity: serverIdentity,
        target: "/kcsapi/api_get_member/require_info",
        version: 2,
      }
    : {
        id: "fusou-require-info-v1",
        server_identity: serverIdentity,
        target: "/kcsapi/api_get_member/require_info",
      };
  return new TextEncoder().encode(JSON.stringify(contract));
}