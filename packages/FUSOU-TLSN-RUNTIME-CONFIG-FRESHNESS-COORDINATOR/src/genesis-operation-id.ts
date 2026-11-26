import {
  canonicalJsonBytes,
  encodeBase64Url,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";

export async function cloudflareOperatorGenesisOperationId(
  approvalBytes: Uint8Array,
): Promise<string> {
  const preimage = canonicalJsonBytes({
    domain: "FUSOU-TLSN-CLOUDFLARE-OPERATOR-GENESIS-OPERATION-ID-V1\0",
    approval: encodeBase64Url(approvalBytes),
  });
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(preimage));
  const uuid = new Uint8Array(digest, 0, 16);
  uuid[6] = (uuid[6]! & 0x0f) | 0x40;
  uuid[8] = (uuid[8]! & 0x3f) | 0x80;
  const hex = [...uuid]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}
