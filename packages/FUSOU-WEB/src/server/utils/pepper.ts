/**
 * pepper / pid / 端末 Ed25519 鍵 / stateless challenge nonce ヘルパー。
 *
 * 役割:
 *   1. サーバー側だけが知る秘密 (pepper) で `pid = HMAC-SHA256(pepper, api_member_id)`
 *      を計算する。pid は `user_member_map.member_id_hash` カラムに格納される
 *      安定なデータ帰属キーで、クライアントから `api_member_id` を受け取って
 *      Worker 内で生成する。pepper はクライアントには絶対に渡さない。
 *   2. 端末が登録時に提示した Ed25519 公開鍵で署名検証する。
 *      register / refresh / revoke の各エンドポイントで、保存済み公開鍵に対する
 *      署名を検証することでリクエストの所有権を確認する。
 *   3. challenge エンドポイントは KV を使わず、HMAC(secret, "{device_id}|{bucket}")
 *      だけで決定的に nonce を生成する (stateless)。バケットは 5 分単位で、検証時は
 *      現在と直前のバケットを許容し境界跨ぎを 1 段だけ吸収する。
 *      ワンタイム消費は KV `challenge-used:{device_id}:{nonce}` で別途担保する。
 *
 * pepper ローテーション戦略 (Vault + runtime テーブル運用):
 *   - 秘密本体は Supabase Vault に `anon_sync_pepper_v<N>` 名で保管する。
 *   - 現行 / 受理対象 / version_epoch は `public.anon_sync_pepper_runtime` で管理する。
 *   - Worker は `public.get_anon_sync_pepper_bundle()` RPC を service_role 権限で
 *     呼び出して JSON を取得し、Bundle 全体を `PepperConfig` に変換する。
 *   - refresh 時は保存 pid を accept_versions 全世代で再計算して所属世代を特定し、
 *     旧世代だった場合は現行 pepper で再ハッシュして `user_member_map` を UPDATE する。
 *   - 詳細手順は docs/operations/web/ANON_SYNC_V2_PEPPER_SUPABASE_RUNTIME_GUIDE.md。
 */

/** nonce の有効 window (秒)。バケットの境界跨ぎを 1 段だけ許容するため検証時は今のと一つ前のバケットを試行する。 */
export const CHALLENGE_BUCKET_SECONDS = 300;

export type PepperEntry = {
  /** "v1", "v2" ... `user_member_map.salt_version` に格納する世代識別子 */
  readonly version: string;
  /** Wrangler secret から取得した HMAC 鍵 (32 文字以上を必須化) */
  readonly secret: string;
};

export type PepperConfig = {
  /** `user_member_map.salt_version` に書き込む現行バージョン */
  readonly current: PepperEntry;
  /**
   * `/refresh` 時に許容する全バージョン (current 含む)。
   * 設定順を優先度として扱うが、列挙数は常に小さいため線形検索で十分。
   */
  readonly accept: readonly PepperEntry[];
};

/**
 * Vault バンドル取得結果の構造化形。`PepperConfig` に変換する前の生 JSON 表現。
 */
export type PepperBundle = {
  readonly config: PepperConfig;
  /** runtime テーブルの `version_epoch`。診断ログ用 (秘密ではない)。 */
  readonly versionEpoch: number;
};

/** Recovery HMAC bundle は pepper bundle と同一スキーマを使う。 */
export type RecoveryEntry = PepperEntry;
export type RecoveryConfig = PepperConfig;
export type RecoveryBundle = PepperBundle;

/** RPC が返す JSON ペイロード形状 */
type PepperBundleRpcPayload = {
  current_version?: unknown;
  accept_versions?: unknown;
  version_epoch?: unknown;
  entries?: unknown;
};

/**
 * Vault バンドル取得の RPC 呼び出しを抽象化した関数型。
 * `anonymous-sync-v2.ts` からは `() => supabaseAdmin.rpc("get_anon_sync_pepper_bundle")`
 * を渡す。`@supabase/supabase-js` の `.rpc()` は Promise そのものではなく
 * `PostgrestFilterBuilder` (PromiseLike) を返すため、ここでは `PromiseLike` で
 * 受ける (await したときに `{ data, error }` に解決される)。
 */
export type PepperBundleRpcCaller = () =>
  | Promise<{ data: unknown; error: unknown }>
  | PromiseLike<{ data: unknown; error: unknown }>;

export type RecoveryBundleRpcCaller = PepperBundleRpcCaller;

/**
 * Worker isolate 単位の TTL キャッシュ。
 *
 * - 鍵: Supabase URL + service-role key の SHA-256 prefix (鍵そのものはログ・例外に
 *   絶対に出さない。プロセス内 Map のキーとしてのみ使う)
 * - TTL: {@link PEPPER_BUNDLE_CACHE_TTL_MS} = 60 秒
 *   Vault ローテーション中は `accept_versions` に新旧両方を含めて運用するため、
 *   60 秒の遅延ヒットが起きても旧世代 pid の解決は可能で安全。
 *   完全切り替え (accept から旧世代を外す) は十分なユーザー移行が完了したあとに
 *   行う前提で、最大 60 秒のラグを許容する。
 * - 取得失敗 (例外) はキャッシュしない (fail-closed)。
 */
const PEPPER_BUNDLE_CACHE_TTL_MS = 60_000;

type CacheEntry = {
  expiresAt: number;
  bundle: PepperBundle;
};

const pepperBundleCache = new Map<string, CacheEntry>();
const recoveryBundleCache = new Map<string, CacheEntry>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeVersionString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!/^v[0-9]+$/.test(trimmed)) return null;
  return trimmed;
}

function parseBundlePayload(raw: unknown): PepperBundle | null {
  if (!isPlainObject(raw)) {
    console.error("[pepper] RPC payload is not an object");
    return null;
  }
  const payload = raw as PepperBundleRpcPayload;

  const current = normalizeVersionString(payload.current_version);
  if (!current) {
    console.error("[pepper] RPC current_version invalid");
    return null;
  }

  if (!Array.isArray(payload.accept_versions)) {
    console.error("[pepper] RPC accept_versions is not an array");
    return null;
  }
  const acceptVersions: string[] = [];
  for (const v of payload.accept_versions) {
    const normalized = normalizeVersionString(v);
    if (!normalized) {
      console.error("[pepper] RPC accept_versions contains invalid entry");
      return null;
    }
    if (acceptVersions.includes(normalized)) {
      console.error("[pepper] RPC accept_versions contains duplicate entry");
      return null;
    }
    acceptVersions.push(normalized);
  }
  if (acceptVersions.length === 0) {
    console.error("[pepper] RPC accept_versions is empty");
    return null;
  }
  if (!acceptVersions.includes(current)) {
    console.error("[pepper] RPC current_version not in accept_versions");
    return null;
  }

  if (!Array.isArray(payload.entries)) {
    console.error("[pepper] RPC entries is not an array");
    return null;
  }
  if (payload.entries.length !== acceptVersions.length) {
    console.error("[pepper] RPC entries length mismatch with accept_versions");
    return null;
  }

  const entriesByVersion = new Map<string, PepperEntry>();
  for (const item of payload.entries) {
    if (!isPlainObject(item)) {
      console.error("[pepper] RPC entries element is not an object");
      return null;
    }
    const version = normalizeVersionString((item as { version?: unknown }).version);
    if (!version) {
      console.error("[pepper] RPC entries.version invalid");
      return null;
    }
    const secretValue = (item as { secret?: unknown }).secret;
    if (typeof secretValue !== "string" || secretValue.length < 32) {
      console.error("[pepper] RPC entries.secret missing or too short");
      return null;
    }
    if (entriesByVersion.has(version)) {
      console.error("[pepper] RPC entries contains duplicate version");
      return null;
    }
    entriesByVersion.set(version, { version, secret: secretValue });
  }

  const orderedEntries: PepperEntry[] = [];
  for (const version of acceptVersions) {
    const entry = entriesByVersion.get(version);
    if (!entry) {
      console.error("[pepper] RPC entries missing version", { version });
      return null;
    }
    orderedEntries.push(entry);
  }

  const currentEntry = entriesByVersion.get(current);
  if (!currentEntry) {
    console.error("[pepper] RPC current entry missing");
    return null;
  }

  const epochRaw = payload.version_epoch;
  const versionEpoch =
    typeof epochRaw === "number" && Number.isFinite(epochRaw) && epochRaw >= 0
      ? Math.floor(epochRaw)
      : 0;

  return {
    config: { current: currentEntry, accept: orderedEntries },
    versionEpoch,
  };
}

/**
 * キャッシュキーを生成する。
 *
 * Supabase URL と service-role key の組み合わせごとに独立したキャッシュを持つ。
 * 鍵そのものはログに出さないように、SHA-256 して先頭 16 hex 文字だけを利用する
 * (鍵長 64bit 相当。同一プロセス内での衝突は無視できる)。
 */
async function computeCacheKey(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  const data = utf8(`${supabaseUrl}|${serviceRoleKey}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest).slice(0, 8);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * テスト等で強制リセットする用。プロダクション運用では使わない。
 */
export function clearPepperBundleCache(): void {
  pepperBundleCache.clear();
}

/**
 * テスト等で recovery bundle キャッシュを強制リセットする用。
 */
export function clearRecoveryBundleCache(): void {
  recoveryBundleCache.clear();
}

/**
 * Supabase RPC `get_anon_sync_pepper_bundle` を呼び出して PepperConfig を取得する。
 *
 * - 60 秒の in-memory キャッシュをヒットすればそちらを返す
 * - RPC 失敗・スキーマ不一致は null を返し、呼び出し側で 500 を返却する
 * - 成功した bundle のみキャッシュに保存する (fail-closed)
 *
 * @param caller   `get_anon_sync_pepper_bundle` RPC を起動する関数。
 *                 通常は `() => supabaseAdmin.rpc("get_anon_sync_pepper_bundle")`
 *                 を渡す。`@supabase/supabase-js` の `.rpc()` は thenable だが
 *                 `await` で解決されれば `{ data, error }` として扱える。
 * @param identity 同一 Worker isolate 内でクライアントを再生成しても TTL を共有する
 *                 ためのキー。Supabase URL と service-role key から派生する。
 */
export async function resolvePepperConfigFromVault(
  caller: PepperBundleRpcCaller,
  identity: { supabaseUrl: string; serviceRoleKey: string },
): Promise<PepperBundle | null> {
  const now = Date.now();
  const cacheKey = await computeCacheKey(
    identity.supabaseUrl,
    identity.serviceRoleKey,
  );
  const cached = pepperBundleCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.bundle;
  }

  let response: { data: unknown; error: unknown };
  try {
    response = await caller();
  } catch (err) {
    console.error("[pepper] RPC threw exception:", err);
    return null;
  }

  if (response.error) {
    // Supabase error は内部に SQL EXCEPTION メッセージを含み、世代名や行内容が
    // 漏れる恐れがあるため、message のみログし詳細はマスクする。
    const errObj = response.error as { message?: unknown };
    const message =
      typeof errObj?.message === "string" ? errObj.message : "unknown";
    console.error("[pepper] RPC returned error:", { message });
    return null;
  }

  const bundle = parseBundlePayload(response.data);
  if (!bundle) {
    return null;
  }

  pepperBundleCache.set(cacheKey, {
    bundle,
    expiresAt: now + PEPPER_BUNDLE_CACHE_TTL_MS,
  });
  return bundle;
}

/**
 * Supabase RPC `get_anon_sync_recovery_bundle` を呼び出して RecoveryConfig を取得する。
 */
export async function resolveRecoveryConfigFromVault(
  caller: RecoveryBundleRpcCaller,
  identity: { supabaseUrl: string; serviceRoleKey: string },
): Promise<RecoveryBundle | null> {
  const now = Date.now();
  const cacheKey = await computeCacheKey(
    identity.supabaseUrl,
    identity.serviceRoleKey,
  );
  const cached = recoveryBundleCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.bundle;
  }

  let response: { data: unknown; error: unknown };
  try {
    response = await caller();
  } catch (err) {
    console.error("[recovery] RPC threw exception:", err);
    return null;
  }

  if (response.error) {
    const errObj = response.error as { message?: unknown };
    const message =
      typeof errObj?.message === "string" ? errObj.message : "unknown";
    console.error("[recovery] RPC returned error:", { message });
    return null;
  }

  const bundle = parseBundlePayload(response.data);
  if (!bundle) {
    return null;
  }

  recoveryBundleCache.set(cacheKey, {
    bundle,
    expiresAt: now + PEPPER_BUNDLE_CACHE_TTL_MS,
  });
  return bundle;
}

/** ArrayBuffer / Uint8Array を lowercase hex 文字列に変換 */
function bytesToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * SubtleCrypto は `BufferSource` を要求するが、TS 5.7+ の lib.dom 型では
 * `TextEncoder.encode()` の返り値が `Uint8Array<ArrayBufferLike>` で、`BufferSource`
 * (= `ArrayBuffer | ArrayBufferView`) に直接代入できない (`ArrayBufferLike` が
 * `SharedArrayBuffer` を含むため)。安全な `ArrayBuffer` にコピーして返す。
 */
function utf8(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** 任意の `Uint8Array` を SubtleCrypto に渡せる `ArrayBuffer` にコピー */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/**
 * `pid = HMAC-SHA256(pepper, api_member_id)` を計算して 64 文字 hex を返す。
 * `api_member_id` は KC サーバーが int として返す値だが、本関数は型に依存せず
 * 文字列化したものを HMAC 入力として扱う (`String(api_member_id)`)。
 */
export async function computePid(
  pepperSecret: string,
  apiMemberId: string | number,
): Promise<string> {
  const id = typeof apiMemberId === "number"
    ? String(apiMemberId)
    : apiMemberId.trim();
  if (id.length === 0) {
    throw new Error("computePid: api_member_id must be non-empty");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    utf8(pepperSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, utf8(id));
  return bytesToHex(sig);
}

/** `rid = HMAC-SHA256(recovery_secret, api_member_id)` を計算する。 */
export async function computeRecoveryId(
  recoverySecret: string,
  apiMemberId: string | number,
): Promise<string> {
  return computePid(recoverySecret, apiMemberId);
}

/**
 * 保存済み pid を `pepperConfig.accept` 全バージョンで再計算し、一致した世代を返す。
 * HMAC-SHA256 は決定的なので、accept 集合に含まれていれば必ず一意に解決される。
 * 一致しなければ null (古すぎる世代の pid か、別 api_member_id の可能性)。
 */
export async function detectPepperVersionFor(
  pepperConfig: PepperConfig,
  apiMemberId: string | number,
  storedPid: string,
): Promise<{ entry: PepperEntry; pidCandidate: string } | null> {
  const normalizedStored = storedPid.trim().toLowerCase();
  for (const entry of pepperConfig.accept) {
    const candidate = await computePid(entry.secret, apiMemberId);
    if (candidate === normalizedStored) {
      return { entry, pidCandidate: candidate };
    }
  }
  return null;
}

/**
 * 保存済み recovery_id_hash を `recoveryConfig.accept` 全世代で再計算し、一致世代を返す。
 */
export async function detectRecoveryVersionFor(
  recoveryConfig: RecoveryConfig,
  apiMemberId: string | number,
  storedRecoveryId: string,
): Promise<{ entry: RecoveryEntry; ridCandidate: string } | null> {
  const matched = await detectPepperVersionFor(
    recoveryConfig,
    apiMemberId,
    storedRecoveryId,
  );
  if (!matched) {
    return null;
  }
  return { entry: matched.entry, ridCandidate: matched.pidCandidate };
}

// ========================
// Ed25519 device key
// ========================

const ED25519_PUBKEY_BYTES = 32;
const ED25519_SIG_BYTES = 64;

/** base64 (standard / URL-safe どちらも) 文字列を Uint8Array に変換 */
export function decodeBase64ToBytes(value: string): Uint8Array | null {
  if (typeof value !== "string") return null;
  let normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (normalized.length === 0) return null;
  const padding = normalized.length % 4;
  if (padding === 1) return null; // 不正な長さ
  if (padding > 0) {
    normalized += "=".repeat(4 - padding);
  }
  try {
    const bin = atob(normalized);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

/**
 * Ed25519 公開鍵 (raw 32 bytes, base64) で署名を検証。
 * `attestationMessage` は呼び出し側で意味のあるドメインセパレータ付き文字列を渡す。
 * 例: register => `"register|" + api_member_id`
 *     refresh  => nonce そのもの
 *     revoke   => `"revoke|" + device_id + "|" + target_device_id + "|" + nonce`
 */
export async function verifyDeviceSig(options: {
  publicKeyB64: string;
  message: string;
  signatureB64: string;
}): Promise<boolean> {
  const pub = decodeBase64ToBytes(options.publicKeyB64);
  if (!pub || pub.length !== ED25519_PUBKEY_BYTES) return false;

  const sig = decodeBase64ToBytes(options.signatureB64);
  if (!sig || sig.length !== ED25519_SIG_BYTES) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(pub),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      toArrayBuffer(sig),
      utf8(options.message),
    );
  } catch (err) {
    console.warn("[pepper] verifyDeviceSig: import/verify failed", err);
    return false;
  }
}

// ========================
// Stateless challenge nonce
// ========================

/**
 * 5 分単位のバケット番号を返す (Unix epoch 秒 / 300)。
 */
function currentBucket(nowSeconds: number): number {
  return Math.floor(nowSeconds / CHALLENGE_BUCKET_SECONDS);
}

/** 単一バケット番号での nonce を HMAC で生成 */
async function nonceForBucket(
  secret: string,
  deviceId: string,
  bucket: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    utf8(`${deviceId}|${bucket}`),
  );
  return bytesToHex(sig);
}

/**
 * stateless challenge nonce を発行する。
 * - クライアントが受け取った nonce は 5 分以内に refresh で消費する必要がある
 * - 同一バケット内で複数回 challenge を呼んでも同じ nonce が返る (idempotent)
 */
export async function issueChallengeNonce(
  secret: string,
  deviceId: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ nonce: string; bucket: number; expiresAt: number }> {
  const bucket = currentBucket(nowSeconds);
  const nonce = await nonceForBucket(secret, deviceId, bucket);
  const expiresAt = (bucket + 1) * CHALLENGE_BUCKET_SECONDS;
  return { nonce, bucket, expiresAt };
}

/**
 * nonce が正しく発行されたものか検証する。
 * - 現バケット / 1 つ前のバケットを許容 (合計 ~5〜10 分の有効期間)
 * - ワンタイム性は KV `challenge-used:{device_id}:{nonce}` で担保する (本関数の外)
 */
export async function verifyChallengeNonce(
  secret: string,
  deviceId: string,
  nonce: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (typeof nonce !== "string" || !/^[a-f0-9]{64}$/.test(nonce)) return false;

  const bucket = currentBucket(nowSeconds);
  // 現在 → 直前 の順にチェック。constant-time 比較はノンスのみで秘密に直結しないため
  // 単純比較で十分 (KV 消費でリプレイは別途防ぐ)。
  for (const candidateBucket of [bucket, bucket - 1]) {
    const expected = await nonceForBucket(secret, deviceId, candidateBucket);
    if (expected === nonce) return true;
  }
  return false;
}
