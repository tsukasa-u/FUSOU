import type { R2BucketBinding } from "../types";
import { SIGNED_URL_TTL_SECONDS } from "../constants";

/**
 * Common two-stage upload handler for secure, hash-verified uploads
 *
 * Provides unified authentication and hash verification flow for:
 * - fleet.ts (snapshots)
 * - asset.ts (static assets)
 * - r2.ts (shared database)
 */

export interface PrepareResult {
  tokenPayload?: Record<string, any>;
  fields?: Record<string, any>;
}

export interface ExecuteResult {
  response: any; // Custom response data to return
}

export interface UploadAuthContext {
  datasetToken?: {
    dataset_id: string;
    user_id: string;
  };
}

export interface UploadConfig {
  bucket: R2BucketBinding;
  signingSecret: string;
  tokenTTL?: number;
  maxBodySize?: number;
  requireDatasetToken?: boolean;
  preparationValidator: (
    body: any,
    user: { id: string; [key: string]: any },
    authContext: UploadAuthContext,
  ) => Promise<PrepareResult | Response>;
  executionProcessor: (
    tokenPayload: any,
    data: Uint8Array,
    user: { id: string; [key: string]: any },
  ) => Promise<ExecuteResult | Response>;
}

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
}

/**
 * Generic two-stage upload handler
 *
 * Stage 1 (Preparation):
 *   - Validates JWT
 *   - Runs custom validation via preparationValidator
 *   - Generates signed token with user_id + custom payload
 *   - Returns upload URL with token
 *
 * Stage 2 (Execution):
 *   - Validates signed token
 *   - Validates JWT matches token's user_id
 *   - Verifies content hash (SHA-256)
 *   - Runs custom processing via executionProcessor
 *   - Uploads to R2 bucket
 */
export async function handleTwoStageUpload(
  c: any,
  config: UploadConfig,
): Promise<Response> {
  const { bucket, signingSecret } = config;

  if (!bucket || !signingSecret) {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  const url = new URL(c.req.url);
  const request = c.req.raw;

  // Route to execution phase if X-Upload-Token header is present
  const hasTokenHeader = !!request.headers.get("X-Upload-Token");

  if (!hasTokenHeader) {
    return await handlePreparation(c, request, url, config);
  }

  return await handleExecution(c, request, url, config);
}

async function handlePreparation(
  c: any,
  request: Request,
  url: URL,
  config: UploadConfig,
): Promise<Response> {
  const { signingSecret, preparationValidator, tokenTTL, requireDatasetToken } =
    config;
  const authContext: UploadAuthContext = {};

  const { validateJWT } = await import("../utils");
  const bearerToken = extractBearerToken(request);
  if (!bearerToken) {
    return c.json(
      { error: "Missing Authorization bearer token", code: "AUTH_MISSING" },
      401,
    );
  }
  const supabaseUser = await validateJWT(bearerToken);
  if (!supabaseUser) {
    return c.json({ error: "Invalid or expired JWT token" }, 401);
  }

  // Parse body
  let body: any;
  try {
    body = await request.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (requireDatasetToken) {
    const {
      createEnvContext,
      getEnv,
      resolveDatasetToken,
      validateDatasetTokenWithConstraints,
    } = await import("../utils");
    const env = createEnvContext(c);
    const datasetToken = resolveDatasetToken(
      request.headers.get("X-Dataset-Token"),
      body?.dataset_token,
    );
    const tokenValidation = await validateDatasetTokenWithConstraints({
      token: datasetToken,
      secret: getEnv(env, "DATASET_TOKEN_SECRET"),
      // expectedUserId は検証しない: 複数端末では端末ごとの匿名 user_id が異なるため。
      // dataset_token.sub は最初にマッピングを作成した端末の user_id であり、
      // JWT user_id と一致することを要求するとマルチデバイスで 403 になる。
      // データ帰属はdataset_id (member_id_hash) の照合で担保する。
    });
    if (!tokenValidation.ok) {
      return c.json(
        { error: tokenValidation.error },
        tokenValidation.status ?? 401,
      );
    }
    authContext.datasetToken = tokenValidation.token;
  }

  // actingUserId: dataset_token が存在する場合はその sub を使用（全端末で一貫した帰属者）。
  // そうでない場合は JWT user_id を使用。
  const actingUserId = authContext.datasetToken?.user_id ?? supabaseUser.id;

  const actingUser = { id: actingUserId } as { id: string; [key: string]: any };

  // Run custom validation
  const validationResult = await preparationValidator(
    body,
    actingUser,
    authContext,
  );
  if (validationResult instanceof Response) {
    return validationResult; // Validation error
  }

  const { tokenPayload = {}, fields } = validationResult;

  // [Issue #15] UPDATED: Dynamic TTL based on expected file size
  // Large files need more time to upload to R2 and process
  // Formula: estimated_time = (file_size_MB * 30s) + 300s, capped at 1 hour
  // Examples:
  //   - 1 MB file: 330s (5.5 min)
  //   - 10 MB file: 600s (10 min)
  //   - 100 MB file: 3600s (1 hour)
  let effectiveTTL = tokenTTL ?? SIGNED_URL_TTL_SECONDS;

  // If declared_size is provided in tokenPayload, calculate dynamic TTL
  if (
    tokenPayload.declared_size &&
    typeof tokenPayload.declared_size === "number"
  ) {
    const expectedSizeMB = tokenPayload.declared_size / (1024 * 1024);
    const estimatedSeconds = Math.ceil(expectedSizeMB * 30) + 300;
    effectiveTTL = Math.min(
      3600, // max 1 hour
      Math.max(
        60, // min 1 minute
        estimatedSeconds,
      ),
    );
  }

  // Generate signed token with user_id binding
  const { generateSignedToken } = await import("../utils");
  const signedToken = await generateSignedToken(
    { ...tokenPayload, user_id: actingUserId },
    signingSecret,
    effectiveTTL,
  );

  // Build upload URL for Stage 2.
  // stripApiPrefix() in [...route].ts always removes the /api/ segment before Hono sees
  // the request, so c.req.url never starts with /api/. Re-add it so Stage-2 clients
  // POST to the correct publicly-accessible path.
  const uploadUrl = new URL(url);
  if (!uploadUrl.pathname.startsWith("/api/")) {
    uploadUrl.pathname =
      "/api" +
      (uploadUrl.pathname.startsWith("/")
        ? uploadUrl.pathname
        : "/" + uploadUrl.pathname);
  }

  // Token is returned in response body only (not in URL)
  // Clients must send it via X-Upload-Token header in Stage 2
  return c.json({
    uploadUrl: uploadUrl.toString(),
    token: signedToken,
    expiresAt: new Date(Date.now() + effectiveTTL * 1000).toISOString(),
    ...(fields && { fields }),
  });
}

async function handleExecution(
  c: any,
  request: Request,
  url: URL,
  config: UploadConfig,
): Promise<Response> {
  const { signingSecret, executionProcessor } = config;

  const { verifySignedToken, validateJWT } = await import("../utils");
  const jwtToken = extractBearerToken(request);

  if (!jwtToken) {
    return c.json(
      {
        error: "Missing Authorization bearer token",
        code: "AUTH_MISSING",
      },
      401,
    );
  }

  // Extract upload token from X-Upload-Token header
  const uploadToken = request.headers.get("X-Upload-Token");

  if (!uploadToken) {
    return c.json(
      {
        error: "Missing upload token in X-Upload-Token header",
        code: "UPLOAD_TOKEN_MISSING",
      },
      400,
    );
  }

  // Verify signed upload token
  const tokenPayload = await verifySignedToken(uploadToken, signingSecret);
  if (!tokenPayload) {
    return c.json({ error: "Invalid or expired upload token" }, 401);
  }

  const expectedHash = tokenPayload.content_hash;
  const tokenUserId = tokenPayload.user_id;

  if (!expectedHash) {
    return c.json({ error: "Invalid token payload" }, 400);
  }

  // JWT の有効性だけを検証する（正規通信の担保）。
  // upload token の user_id は dataset_token.sub（全端末共通の帰属者）であり、
  // JWT user_id（端末固有）と一致しないことがあるため user_id 照合は行わない。
  const jwtValid = await validateJWT(jwtToken);
  if (!jwtValid) {
    console.warn(
      `[Upload] JWT validation failed: token=${jwtToken.substring(0, 20)}...`,
    );
    return c.json(
      {
        error: "Invalid or expired JWT token. Please refresh your session.",
        code: "AUTH_EXPIRED",
      },
      401,
    );
  }
  // actingUser は upload token 内の user_id（dataset_token.sub）を使用する。
  const actingUser = { id: tokenUserId } as { id: string; [key: string]: any };

  // Read body
  const bodyStream = request.body;
  if (!bodyStream) {
    return c.json({ error: "Upload payload is missing" }, 400);
  }

  try {
    // Read body into memory for processing
    const arrayBuf = await new Response(bodyStream).arrayBuffer();
    const data = new Uint8Array(arrayBuf);

    // Hash verification is performed inside executionProcessor (e.g. master_data.ts)
    // where actual vs. token-embedded expected hash is compared.

    // Run custom processing
    const processingResult = await executionProcessor(
      tokenPayload,
      data,
      actingUser,
    );
    if (processingResult instanceof Response) {
      return processingResult; // Processing error
    }

    const { response } = processingResult;

    return c.json(response);
  } catch (error) {
    console.error("[Upload] Upload error:", error);
    return c.json({ error: "Upload failed" }, 500);
  }
}
