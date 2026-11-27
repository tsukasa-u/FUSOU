import {
  canonicalJsonBytes,
  decodeCanonicalBase64Url,
  encodeBase64Url,
  parseCanonicalUnsignedDecimal,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";
import { CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID } from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts";

const domain = new TextEncoder().encode("FUSOU-TLSN-FRESHNESS-ISSUE-RETIREMENT-V1\0");
const scope = "fusou-tlsn-freshness-issue-retirement-v1";
const token = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const digest = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;

export interface IssueRetirementInput {
  readonly approvalBytes: Uint8Array;
  readonly signatureBytes: Uint8Array;
}

export type IssueRetirementResult =
  | { readonly status: "CONFLICT" | "NOT_FOUND" }
  | {
      readonly status: "RETIRED";
      readonly operationId: string;
      readonly approvalSha256: string;
      readonly retiredFence: string;
      readonly replacementFence: string;
      readonly retiredAtMs: number;
    };

interface IssueRetirementApproval {
  readonly schema_version: 1;
  readonly scope: typeof scope;
  readonly key_id: string;
  readonly environment: "production";
  readonly profile_id: typeof CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID;
  readonly coordinator_id: string;
  readonly chain_id: string;
  readonly restore_epoch: string;
  readonly operation_id: string;
  readonly request_sha256: string;
  readonly prior_fence: string;
  readonly current_state_sha256: string;
  readonly incident_id: string;
  readonly issued_at_ms: number;
  readonly expires_at_ms: number;
}

export async function verifyIssueRetirementApproval(
  input: IssueRetirementInput,
  authority: { readonly keyId: string; readonly publicKeySpki: string },
) {
  if (!(input?.approvalBytes instanceof Uint8Array) || input.approvalBytes.length === 0 ||
      input.approvalBytes.length > 4_096 || !(input.signatureBytes instanceof Uint8Array) ||
      input.signatureBytes.length !== 64) {
    throw new Error("Invalid Freshness issue retirement input");
  }
  const raw = Uint8Array.from(input.approvalBytes);
  const signature = Uint8Array.from(input.signatureBytes);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  const v: IssueRetirementApproval = JSON.parse(text);
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== 15 ||
      v.schema_version !== 1 || v.scope !== scope || typeof v.key_id !== "string" ||
      !token.test(v.key_id) || v.key_id !== authority.keyId || v.environment !== "production" ||
      v.profile_id !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
      typeof v.coordinator_id !== "string" || !/^[a-f0-9]{64}$/u.test(v.coordinator_id) ||
      typeof v.chain_id !== "string" || !token.test(v.chain_id) ||
      typeof v.restore_epoch !== "string" || !token.test(v.restore_epoch) ||
      typeof v.operation_id !== "string" || !uuid.test(v.operation_id) ||
      typeof v.request_sha256 !== "string" || !digest.test(v.request_sha256) ||
      typeof v.current_state_sha256 !== "string" || !digest.test(v.current_state_sha256) ||
      typeof v.prior_fence !== "string" || typeof v.incident_id !== "string" ||
      !token.test(v.incident_id) || !Number.isSafeInteger(v.issued_at_ms) ||
      !Number.isSafeInteger(v.expires_at_ms) || v.issued_at_ms < 0 ||
      v.expires_at_ms <= v.issued_at_ms || v.expires_at_ms - v.issued_at_ms > 86_400_000 ||
      text !== new TextDecoder().decode(canonicalJsonBytes(v))) {
    throw new Error("Invalid Freshness issue retirement approval");
  }
  parseCanonicalUnsignedDecimal(v.prior_fence, "Issue retirement prior fence");
  const key = await crypto.subtle.importKey(
    "spki",
    Uint8Array.from(decodeCanonicalBase64Url(authority.publicKeySpki, "Retirement authority SPKI", 44)),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const message = new Uint8Array(domain.length + raw.length);
  message.set(domain);
  message.set(raw, domain.length);
  if (!await crypto.subtle.verify("Ed25519", key, signature, message)) {
    throw new Error("Freshness issue retirement signature failed");
  }
  return {
    approval: v,
    approvalSha256: encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", raw))),
    raw,
    signature,
  };
}
