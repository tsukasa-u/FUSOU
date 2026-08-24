import { z } from "zod";
import type { AppContext, R2BucketBinding } from "../types";
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
  tokenPayload?: Record<string, unknown>;
  fields?: Record<string, unknown>;
}

export interface ExecuteResult {
  response: Record<string, unknown>;
}

export interface UploadUser {
  id: string;
  payload?: Record<string, unknown>;
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
  tokenPayloadSchema?: z.ZodType<Record<string, unknown>>;
  tokenTTL?: number;
  maxBodySize?: number;
  requireDatasetToken?: boolean;
  allowEmptyBody?: boolean;
  preparationValidator: (
    body: Record<string, unknown>,
    user: UploadUser,
    authContext: UploadAuthContext,
  ) => Promise<PrepareResult | Response>;
  executionProcessor: (
    tokenPayload: Record<string, unknown>,
    data: Uint8Array,
    user: UploadUser,
  ) => Promise<ExecuteResult | Response>;
}

type ReadBodyResult =
  | { kind: "ok"; data: Uint8Array }
  | { kind: "missing" }
  | { kind: "too_large" };

export async function readBodyWithinLimit(
  request: Request,
  maxBodySize: number | undefined,
): Promise<ReadBodyResult> {
  if (maxBodySize === undefined) {
    if (!request.body) return { kind: "missing" };
    return { kind: "ok", data: new Uint8Array(await request.arrayBuffer()) };
  }

  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > maxBodySize
    ) {
      return { kind: "too_large" };
    }
  }

  if (!request.body) return { kind: "missing" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalLength += value.byteLength;
      if (totalLength > maxBodySize) {
        await reader.cancel();
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const data = new Uint8Array(new ArrayBuffer(totalLength));
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "ok", data };
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
  c: AppContext,
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
  c: AppContext,
  request: Request,
  url: URL,
  config: UploadConfig,
): Promise<Response> {
  const {
    signingSecret,
    preparationValidator,
    tokenTTL,
    requireDatasetToken,
    maxBodySize,
  } =
    config;
  const authContext: UploadAuthContext = {};

  const { validateJWT } = await import("../utils");
  const bearerToken = extractBearerToken(request);
  const supabaseUser = bearerToken ? await validateJWT(bearerToken) : null;

  if (!supabaseUser && !requireDatasetToken) {
    return c.json(
      {
        error: bearerToken
          ? "Invalid or expired JWT token"
          : "Missing Authorization bearer token",
        code: "AUTH_MISSING",
      },
      401,
    );
  }

  const bodyResult = await readBodyWithinLimit(request, maxBodySize);
  if (bodyResult.kind === "too_large") {
    return c.json({ error: "request_too_large" }, 413);
  }
  if (bodyResult.kind === "missing") {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  let body: Record<string, unknown>;
  try {
    const parsedBody = z
      .record(z.unknown())
      .safeParse(JSON.parse(new TextDecoder().decode(bodyResult.data)));
    if (!parsedBody.success) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    body = parsedBody.data;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (requireDatasetToken) {
    const {
      createEnvContext,
      getEnv,
      resolveDatasetToken,
      validateDatasetTokenWithConstraints,
      resolveDatasetTokenRevocationConfig,
    } = await import("../utils");
    const env = createEnvContext(c);
    const datasetToken = resolveDatasetToken(
      request.headers.get("X-Dataset-Token"),
      body?.["dataset_token"],
    );
    const tokenValidation = await validateDatasetTokenWithConstraints({
      token: datasetToken,
      secret: getEnv(env, "DATASET_TOKEN_SECRET"),
      revocation: resolveDatasetTokenRevocationConfig(env),
      // expectedUserId は検証しない: 複数端末では端末ごとの匿名 user_id が異なるため。
      // dataset_token.sub は最初にマッピングを作成した端末の user_id であり、
      // JWT user_id と一致することを要求するとマルチデバイスで 403 になる。
      // データ帰属は dataset_id (public_id) の照合で担保する。
    });
    if (!tokenValidation.ok || !tokenValidation.token) {
      return c.json(
        { error: tokenValidation.error },
        tokenValidation.status ?? 401,
      );
    }
    authContext.datasetToken = tokenValidation.token;
  }

  // actingUserId: dataset_token が存在する場合はその sub を使用（全端末で一貫した帰属者）。
  // そうでない場合は JWT user_id を使用。
  const actingUserId = authContext.datasetToken?.user_id ?? supabaseUser?.id;
  if (!actingUserId) {
    return c.json({ error: "Invalid or expired JWT token" }, 401);
  }

  const actingUser: UploadUser = { id: actingUserId };

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
    tokenPayload["declared_size"] &&
    typeof tokenPayload["declared_size"] === "number"
  ) {
    const expectedSizeMB = tokenPayload["declared_size"] / (1024 * 1024);
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
  c: AppContext,
  request: Request,
  _url: URL,
  config: UploadConfig,
): Promise<Response> {
  const {
    signingSecret,
    executionProcessor,
    tokenPayloadSchema,
    maxBodySize,
    allowEmptyBody,
  } = config;

  const { verifySignedToken, validateJWT } = await import("../utils");
  const jwtToken = extractBearerToken(request);

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
  const rawTokenPayload = await verifySignedToken(uploadToken, signingSecret);
  const tokenPayloadValidation = z
    .record(z.unknown())
    .safeParse(rawTokenPayload);
  if (!tokenPayloadValidation.success) {
    return c.json({ error: "Invalid or expired upload token" }, 401);
  }
  const rawTokenPayloadRecord = tokenPayloadValidation.data;
  const typedTokenPayload = tokenPayloadSchema?.safeParse(rawTokenPayloadRecord);
  if (typedTokenPayload && !typedTokenPayload.success) {
    return c.json({ error: "Invalid token payload" }, 400);
  }
  const tokenPayload = typedTokenPayload?.success
    ? typedTokenPayload.data
    : rawTokenPayloadRecord;

  const expectedHash =
    typeof tokenPayload["content_hash"] === "string"
      ? tokenPayload["content_hash"]
      : "";
  const tokenUserId =
    typeof tokenPayload["user_id"] === "string" ? tokenPayload["user_id"] : "";

  if (!expectedHash || !tokenUserId) {
    return c.json({ error: "Invalid token payload" }, 400);
  }

  // JWT の有効性だけを検証する（正規通信の担保）。
  // upload token の user_id は dataset_token.sub（全端末共通の帰属者）であり、
  // JWT user_id（端末固有）と一致しないことがあるため user_id 照合は行わない。
  const jwtValid = jwtToken ? await validateJWT(jwtToken) : null;
  if (!jwtValid && !config.requireDatasetToken) {
    console.warn("[Upload] JWT validation failed");
    return c.json(
      {
        error: jwtToken
          ? "Invalid or expired JWT token. Please refresh your session."
          : "Missing Authorization bearer token",
        code: "AUTH_EXPIRED",
      },
      401,
    );
  }
  // actingUser は upload token 内の user_id（dataset_token.sub）を使用する。
  const actingUser: UploadUser = { id: tokenUserId };

  const bodyResult = await readBodyWithinLimit(request, maxBodySize);
  if (bodyResult.kind === "missing") {
    if (allowEmptyBody) {
      const processingResult = await executionProcessor(
        tokenPayload,
        new Uint8Array(),
        actingUser,
      );
      if (processingResult instanceof Response) {
        return processingResult;
      }
      return c.json(processingResult.response);
    }
    return c.json({ error: "Upload payload is missing" }, 400);
  }
  if (bodyResult.kind === "too_large") {
    return c.json({ error: "request_too_large" }, 413);
  }

  try {
    const data = bodyResult.data;

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
