import type { Bindings } from "../types";
import { createEnvContext, getEnv } from "../utils";
import {
  getSupabaseRestConfig,
  supabaseRestRequest,
  type SupabaseRestConfig,
} from "./supabase-rest";

export const SECURE_ENCLAVE_TRUSTED_ROOT_ENV =
  "INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256";
export const TPM_AK_TRUSTED_ROOT_ENV = "INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const TRUSTED_ROOTS_KV_KEY = "attestation-trusted-roots:v1:active";
const TRUSTED_ROOTS_KV_TTL_SECONDS = 300;

type TrustedRootPlatform = "secure_enclave" | "tpm";

type TrustedRootsSnapshot = {
  secure_enclave: string[];
  tpm: string[];
};

type TrustedRootRow = {
  platform?: unknown;
  root_sha256?: unknown;
  status?: unknown;
  valid_from?: unknown;
  valid_to?: unknown;
};

function resolveCacheKV(c: { env?: Bindings } | { env?: { env?: Bindings } }):
  | KVNamespace
  | undefined {
  return (
    ((c as any)?.env?.DATA_LOADER_CACHE_KV as KVNamespace | undefined) ??
    ((c as any)?.env?.env?.DATA_LOADER_CACHE_KV as KVNamespace | undefined)
  );
}

function normalizeTrustedRootHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/^sha256:/, "");
  return SHA256_HEX_PATTERN.test(normalized) ? normalized : null;
}

function dedupeSortedHashes(values: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const normalized = normalizeTrustedRootHash(value);
    if (normalized) out.add(normalized);
  }
  return Array.from(out).sort();
}

function isSnapshot(value: unknown): value is TrustedRootsSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.secure_enclave) || !Array.isArray(raw.tpm)) {
    return false;
  }

  return (
    raw.secure_enclave.every((item) => normalizeTrustedRootHash(item) != null) &&
    raw.tpm.every((item) => normalizeTrustedRootHash(item) != null)
  );
}

function parseTrustedRootRows(rows: unknown, now: Date): TrustedRootsSnapshot {
  const out: Record<TrustedRootPlatform, string[]> = {
    secure_enclave: [],
    tpm: [],
  };

  if (!Array.isArray(rows)) {
    return out;
  }

  for (const rowValue of rows) {
    const row = rowValue as TrustedRootRow;
    const platformRaw = typeof row.platform === "string" ? row.platform : "";
    const platform =
      platformRaw === "secure_enclave" || platformRaw === "tpm"
        ? platformRaw
        : null;
    if (!platform) continue;

    const status = typeof row.status === "string" ? row.status : "";
    if (status !== "active") continue;

    const hash = normalizeTrustedRootHash(row.root_sha256);
    if (!hash) continue;

    const validFrom =
      typeof row.valid_from === "string" && row.valid_from.trim().length > 0
        ? new Date(row.valid_from)
        : null;
    const validTo =
      typeof row.valid_to === "string" && row.valid_to.trim().length > 0
        ? new Date(row.valid_to)
        : null;

    if (validFrom && Number.isFinite(validFrom.getTime()) && now < validFrom) {
      continue;
    }
    if (validTo && Number.isFinite(validTo.getTime()) && now > validTo) {
      continue;
    }

    out[platform].push(hash);
  }

  return {
    secure_enclave: dedupeSortedHashes(out.secure_enclave),
    tpm: dedupeSortedHashes(out.tpm),
  };
}

function parseTrustedRootsFromEnv(c: { env?: Bindings } | { env?: { env?: Bindings } }): TrustedRootsSnapshot {
  const envCtx = createEnvContext(c as any);
  const secure = parseTrustedRootList(getEnv(envCtx, SECURE_ENCLAVE_TRUSTED_ROOT_ENV));
  const tpm = parseTrustedRootList(getEnv(envCtx, TPM_AK_TRUSTED_ROOT_ENV));
  return {
    secure_enclave: secure,
    tpm,
  };
}

async function fetchTrustedRootsFromSupabase(
  config: SupabaseRestConfig,
): Promise<TrustedRootsSnapshot> {
  const rows = await supabaseRestRequest<TrustedRootRow[]>(
    config,
    "attestation_trusted_roots",
    {
      query:
        "?select=platform,root_sha256,status,valid_from,valid_to&status=eq.active&limit=5000",
    },
  );

  return parseTrustedRootRows(rows ?? [], new Date());
}

export function parseTrustedRootList(raw: string | undefined): string[] {
  if (!raw) return [];

  const trimmed = raw.trim();
  if (!trimmed) return [];

  let values: string[] = [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        values = parsed.map((item) => String(item));
      }
    } catch {
      values = [];
    }
  }

  if (values.length === 0) {
    values = trimmed.split(/[\s,]+/).filter((item) => item.length > 0);
  }

  return dedupeSortedHashes(values);
}

export async function resolveAttestationTrustedRoots(
  c: { env?: Bindings } | { env?: { env?: Bindings } },
): Promise<{
  secureEnclaveTrustedRoots: string[];
  tpmAkTrustedRoots: string[];
  source: "kv" | "supabase" | "env";
}> {
  const cacheKV = resolveCacheKV(c);

  if (cacheKV) {
    try {
      const cached = await cacheKV.get(TRUSTED_ROOTS_KV_KEY, "json");
      if (isSnapshot(cached)) {
        return {
          secureEnclaveTrustedRoots: dedupeSortedHashes(cached.secure_enclave),
          tpmAkTrustedRoots: dedupeSortedHashes(cached.tpm),
          source: "kv",
        };
      }
    } catch (error) {
      console.warn("[attestation-trusted-roots] KV read failed", error);
    }
  }

  try {
    const supabaseConfig = getSupabaseRestConfig(c as any);
    if (supabaseConfig.url && supabaseConfig.key) {
      const snapshot = await fetchTrustedRootsFromSupabase(supabaseConfig);
      if (snapshot.secure_enclave.length > 0 || snapshot.tpm.length > 0) {
        if (cacheKV) {
          try {
            await cacheKV.put(TRUSTED_ROOTS_KV_KEY, JSON.stringify(snapshot), {
              expirationTtl: TRUSTED_ROOTS_KV_TTL_SECONDS,
            });
          } catch (error) {
            console.warn("[attestation-trusted-roots] KV write failed", error);
          }
        }

        return {
          secureEnclaveTrustedRoots: snapshot.secure_enclave,
          tpmAkTrustedRoots: snapshot.tpm,
          source: "supabase",
        };
      }
    }
  } catch (error) {
    console.warn("[attestation-trusted-roots] Supabase fetch failed", error);
  }

  const envSnapshot = parseTrustedRootsFromEnv(c);
  return {
    secureEnclaveTrustedRoots: envSnapshot.secure_enclave,
    tpmAkTrustedRoots: envSnapshot.tpm,
    source: "env",
  };
}

export function resolveRequiredTrustedRootEnv(options: {
  attestationLevel: string;
  secureEnclaveTrustedRoots: string[];
  tpmAkTrustedRoots: string[];
}): string | null {
  if (
    options.attestationLevel === "secure_enclave" &&
    options.secureEnclaveTrustedRoots.length === 0
  ) {
    return SECURE_ENCLAVE_TRUSTED_ROOT_ENV;
  }

  if (options.attestationLevel === "tpm" && options.tpmAkTrustedRoots.length === 0) {
    return TPM_AK_TRUSTED_ROOT_ENV;
  }

  return null;
}