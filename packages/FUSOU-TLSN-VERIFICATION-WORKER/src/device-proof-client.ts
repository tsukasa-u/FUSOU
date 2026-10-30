import { z } from "zod";

type Subject = { canonicalUserId: string; accessToken: string };
type DeviceProof = { device_id: string; nonce: string; sig: string };
type PossessionProof = {
  device_id: string;
  session_id: string;
  binding_value: string;
  challenge: string;
  sig: string;
};

export type DeviceAuthenticationResult =
  | { ok: true; canonicalUserId: string; deviceId: string }
  | {
      ok: false;
      status: 401 | 403 | 409 | 503;
      error:
        | "device_auth_unconfigured"
        | "device_unauthorized"
        | "device_owner_mismatch"
        | "device_revoked"
        | "device_nonce_invalid"
        | "device_nonce_replayed"
        | "device_auth_unavailable";
    };

export type DevicePossessionAuthenticationResult =
  | { ok: true; canonicalUserId: string; deviceId: string; replayDigestHex: string }
  | {
      ok: false;
      status: 401 | 403 | 409 | 503;
      error:
        | "device_possession_unauthorized"
        | "device_possession_owner_mismatch"
        | "device_possession_revoked"
        | "device_possession_replayed"
        | "device_possession_unavailable";
    };

const deviceProofResponseSchema = z.object({
  authenticated: z.literal(true),
  canonical_user_id: z.string().uuid(),
  device_id: z.string().uuid(),
}).strict();

const tlsnDeviceProofResponseSchema = deviceProofResponseSchema.extend({
  replay_digest_hex: z.string().regex(/^[a-f0-9]{64}$/),
});

export function tlsnDeviceProofSigningBytes(
  proof: Pick<PossessionProof, "device_id" | "session_id" | "binding_value">,
  challenge: Uint8Array,
): Uint8Array {
  if (challenge.length !== 32) throw new Error("device proof challenge must be 32 bytes");
  const encoder = new TextEncoder();
  const chunks = [encoder.encode("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  for (const value of [
    encoder.encode(proof.device_id),
    encoder.encode(proof.session_id),
    encoder.encode(proof.binding_value),
    challenge,
  ]) {
    if (value.length > 0xffff) throw new Error("device proof field is too large");
    chunks.push(new Uint8Array([value.length >> 8, value.length & 0xff]), value);
  }
  const message = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    message.set(chunk, offset);
    offset += chunk.length;
  }
  return message;
}

export async function authenticateDeviceProof(
  subject: Subject,
  proof: DeviceProof,
  endpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<DeviceAuthenticationResult> {
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${subject.accessToken}`,
      },
      body: JSON.stringify(proof),
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: 503, error: "device_auth_unavailable" };
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(payload).data?.error;
      if (response.status === 403) {
        return { ok: false, status: 403, error: "device_owner_mismatch" };
      }
      if (response.status === 409 && error === "device_revoked") {
        return { ok: false, status: 409, error: "device_revoked" };
      }
      if (response.status === 409 && error === "nonce_already_used") {
        return { ok: false, status: 409, error: "device_nonce_replayed" };
      }
      if (response.status === 401 && error === "nonce_invalid_or_expired") {
        return { ok: false, status: 401, error: "device_nonce_invalid" };
      }
      if (response.status >= 500) {
        return { ok: false, status: 503, error: "device_auth_unavailable" };
      }
      return { ok: false, status: 401, error: "device_unauthorized" };
    }
    const parsed = deviceProofResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.canonical_user_id !== subject.canonicalUserId ||
        parsed.data.device_id !== proof.device_id) {
      return { ok: false, status: 403, error: "device_owner_mismatch" };
    }
    return {
      ok: true,
      canonicalUserId: parsed.data.canonical_user_id,
      deviceId: parsed.data.device_id,
    };
  } catch {
    return { ok: false, status: 503, error: "device_auth_unavailable" };
  }
}

export async function authenticateTlsnDeviceProof(
  subject: Subject,
  proof: PossessionProof,
  endpoint: string,
  replayDigestHex: string,
  expectedReplayDigestHex?: string,
  fetcher: typeof fetch = fetch,
): Promise<DevicePossessionAuthenticationResult> {
  if (!/^[a-f0-9]{64}$/.test(replayDigestHex)) {
    return { ok: false, status: 503, error: "device_possession_unavailable" };
  }
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${subject.accessToken}`,
      },
      body: JSON.stringify(proof),
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: 503, error: "device_possession_unavailable" };
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(payload).data?.error;
      if (response.status === 403) {
        return { ok: false, status: 403, error: "device_possession_owner_mismatch" };
      }
      if (response.status === 409 && error === "device_revoked") {
        return { ok: false, status: 409, error: "device_possession_revoked" };
      }
      if (response.status === 409 && error === "device_proof_replayed") {
        if (replayDigestHex === expectedReplayDigestHex) {
          return {
            ok: true,
            canonicalUserId: subject.canonicalUserId,
            deviceId: proof.device_id,
            replayDigestHex,
          };
        }
        return { ok: false, status: 409, error: "device_possession_replayed" };
      }
      if (response.status >= 500) {
        return { ok: false, status: 503, error: "device_possession_unavailable" };
      }
      return { ok: false, status: 401, error: "device_possession_unauthorized" };
    }
    const parsed = tlsnDeviceProofResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.canonical_user_id !== subject.canonicalUserId ||
        parsed.data.device_id !== proof.device_id) {
      return { ok: false, status: 403, error: "device_possession_owner_mismatch" };
    }
    if (parsed.data.replay_digest_hex !== replayDigestHex) {
      return { ok: false, status: 503, error: "device_possession_unavailable" };
    }
    return {
      ok: true,
      canonicalUserId: parsed.data.canonical_user_id,
      deviceId: parsed.data.device_id,
      replayDigestHex,
    };
  } catch {
    return { ok: false, status: 503, error: "device_possession_unavailable" };
  }
}
