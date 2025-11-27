import type { APIRoute } from "astro";
import { jwtVerify, createRemoteJWKSet } from "jose"; // 修正3: 標準ライブラリを使用

// 環境変数の型定義
type CloudflareEnv = {
  ASSET_PAYLOAD_BUCKET?: R2BucketBinding;
  PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  MAX_SNAPSHOT_BYTES?: string | number;
};

// R2の型定義（簡易版）
type R2BucketBinding = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | Blob | string,
    options?: { httpMetadata?: Record<string, string> }
  ): Promise<any>;
};

export const prerender = false;

// JWKSセットのキャッシュ用変数
// createRemoteJWKSetは内部でキャッシュとローテーションを管理します
let JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

// 定数
const MAX_BODY_SIZE = 2 * 1024 * 1024; // 修正2: 入力JSONの上限 (2MB)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals?.runtime?.env as unknown as CloudflareEnv | undefined;
  
  // 必須変数のチェック
  const bucket = env?.ASSET_PAYLOAD_BUCKET;
  const supabaseUrl = env?.PUBLIC_SUPABASE_URL;
  const supabaseKey = env?.SUPABASE_SERVICE_ROLE_KEY;
  const maxStoredBytes = Number(env?.MAX_SNAPSHOT_BYTES ?? 2500000); // 保存用上限 (2.5MB)

  if (!bucket || !supabaseUrl || !supabaseKey) {
    console.error("Missing environment variables");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  // --- 修正3: joseライブラリを使用した堅牢なJWT検証 ---
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return new Response(JSON.stringify({ error: "Missing Authorization" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  let userId: string; // 認証済みユーザーID

  try {
    // JWKSを初期化 (初回のみ)
    if (!JWKS) {
      JWKS = createRemoteJWKSet(
        new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
      );
    }

    // 検証実行 (期限切れ、署名不正などを全てチェック)
    const { payload } = await jwtVerify(token, JWKS, {
      algorithms: ["RS256"], // アルゴリズム固定で脆弱性回避
    });

    if (!payload.sub) throw new Error("No subject in token");
    userId = payload.sub; // これが信頼できるユーザーID
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  // --- 修正2: DoS対策 (入力サイズ制限) ---
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_SIZE) {
    return new Response(
      JSON.stringify({ error: "Request payload too large" }),
      {
        status: 413,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      }
    );
  }

  // JSONパース
  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  // --- 修正1: 認可 (IDOR対策) ---
  // ボディに含まれるowner_idが悪意ある値でも、強制的にトークンのuserIdで上書きする
  // これにより「他人のID」への書き込みを物理的に不可能にする
  const owner_id = userId; 

  const { tag, payload, version: clientVersion, is_public } = body;

  if (!tag || !payload) {
    return new Response(
      JSON.stringify({ error: "tag and payload are required" }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      }
    );
  }

  // データの圧縮とハッシュ化処理
  const text = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  let compressed: Uint8Array;
  try {
    const cs = new CompressionStream("gzip");
    const stream = new Response(data).body!.pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    compressed = new Uint8Array(buf);
  } catch (err) {
    // 圧縮失敗時は生データを使うか、エラーにするか。ここでは安全側に倒してエラー推奨
    return new Response(JSON.stringify({ error: "Compression failed" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  // 圧縮後のサイズチェック
  if (compressed.byteLength > maxStoredBytes) {
    return new Response(
      JSON.stringify({
        error: "Compressed payload too large",
        size: compressed.byteLength,
      }),
      {
        status: 413,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      }
    );
  }

  // ハッシュ計算 (SHA-256)
  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(compressed).buffer
  );
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const version = clientVersion ? Number(clientVersion) : Date.now();
  
  // Path Traversal防止のため、tagもencodeURIComponentを通す(元コード通りでOK)
  const key = `fleets/${owner_id}/${encodeURIComponent(tag)}/${version}-${hashHex}.json.gz`;

  // R2へ保存
  try {
    await bucket.put(key, compressed, {
      httpMetadata: {
        contentType: "application/json",
        contentEncoding: "gzip",
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: "Failed to store payload in R2",
        detail: String(err),
      }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      }
    );
  }

  // Supabaseへメタデータ保存
  const meta = {
    owner_id, // ここは強制的にuserIdが入っている
    tag,
    title: body.title || null,
    r2_key: key,
    size_bytes: compressed.byteLength,
    version,
    is_public: !!is_public,
    updated_at: new Date().toISOString(),
  };

  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/fleets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseKey}`, // Service Role Keyを使用
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(meta),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(
        JSON.stringify({ error: "Failed to upsert metadata", detail: text }),
        {
          status: 502,
          headers: { ...CORS_HEADERS, "content-type": "application/json" },
        }
      );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "Supabase upsert failed", detail: String(err) }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      }
    );
  }

  return new Response(
    JSON.stringify({ ok: true, owner_id, tag, version, r2_key: key }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    }
  );
};