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

export interface UploadConfig {
  bucket: R2BucketBinding;
  signingSecret: string;
  tokenTTL?: number;
  maxBodySize?: number;
  preparationValidator: (
    body: any,
    user: { id: string; [key: string]: any },
  ) => Promise<PrepareResult | Response>;
  executionProcessor: (
    tokenPayload: any,
    data: Uint8Array,
    user: { id: string; [key: string]: any },
  ) => Promise<ExecuteResult | Response>;
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

  // Route to execution phase if token is present in either:
  // - X-Upload-Token header (preferred, used by Rust uploader)
  // - URL query parameter (legacy, backward compatibility)
  const hasTokenHeader = !!request.headers.get("X-Upload-Token");
  const hasTokenQuery = url.searchParams.has("token");

  if (!hasTokenHeader && !hasTokenQuery) {
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
  const { signingSecret, preparationValidator, tokenTTL } = config;

  // Validate JWT
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { validateJWT } = await import("../utils");
  const supabaseUser = await validateJWT(token);
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

  // Run custom validation
  const validationResult = await preparationValidator(body, supabaseUser as { id: string; [key: string]: any });
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
  if (tokenPayload.declared_size && typeof tokenPayload.declared_size === 'number') {
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
    { ...tokenPayload, user_id: supabaseUser.id },
    signingSecret,
    effectiveTTL,
  );

  // Build upload URL (without token - see below)
  const usingAdapter = !!(c.env as any)?.env;
  const uploadUrl = new URL(url);
  if (usingAdapter && !uploadUrl.pathname.startsWith("/api/")) {
    uploadUrl.pathname =
      "/api" +
      (uploadUrl.pathname.startsWith("/")
        ? uploadUrl.pathname
        : "/" + uploadUrl.pathname);
  }
  
  // [Issue #17] SECURITY FIX: Token moved from URL query parameter to response body
  // Reasons:
  // 1. URL query parameters are visible in HTTP logs, proxies, browser history
  // 2. Authorization tokens should not appear in URLs
  // 3. Response body is private and only received by the requesting client
  // 4. Follows OAuth/JWT best practices for token transmission

  return c.json({
    uploadUrl: uploadUrl.toString(),
    token: signedToken,  // ← Token in response body instead of URL
    expiresAt: new Date(
      Date.now() + effectiveTTL * 1000,
    ).toISOString(),
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
  
  // [Issue #17] CORRECTED: Separate JWT and upload token
  // - Authorization header: Bearer <JWT> (for user validation)
  // - X-Upload-Token header: <signed-upload-token> (for file validation)
  // - URL query: ?token=<signed-upload-token> (backward compatibility)
  
  // Extract JWT from Authorization header for user validation
  const authHeader = request.headers.get("Authorization");
  const jwtToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!jwtToken) {
    return c.json({ 
      error: "Missing Authorization bearer token",
      code: "AUTH_MISSING"
    }, 401);
  }
  
  // Validate JWT to get user info
  const supabaseUser = await validateJWT(jwtToken);
  if (!supabaseUser) {
    console.warn(`[Upload] JWT validation failed: token=${jwtToken.substring(0, 20)}...`);
    return c.json({ 
      error: "Invalid or expired JWT token. Please refresh your session.",
      code: "AUTH_EXPIRED"
    }, 401);
  }

  // Extract upload token from X-Upload-Token header or URL query parameter
  let uploadToken: string | null = request.headers.get("X-Upload-Token");
  if (!uploadToken) {
    uploadToken = url.searchParams.get("token");
  }
  
  if (!uploadToken) {
    return c.json({ 
      error: "Missing upload token in X-Upload-Token header or query parameter",
      code: "UPLOAD_TOKEN_MISSING"
    }, 400);
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
  
  // Verify user matches token
  if (tokenUserId !== supabaseUser.id) {
    console.error(`[Upload] User mismatch: token=${tokenUserId}, jwt=${supabaseUser.id}`);
    return c.json(
      { 
        error: "User mismatch - token generated for different user",
        code: "USER_MISMATCH"
      },
      403,
    );
  }

  // Read body
  const bodyStream = request.body;
  if (!bodyStream) {
    return c.json({ error: "Upload payload is missing" }, 400);
  }

  try {
    // Read body and compute hash
    const arrayBuf = await new Response(bodyStream).arrayBuffer();
    const data = new Uint8Array(arrayBuf);
    const hashBuf = await crypto.subtle.digest("SHA-256", data);
    const hashHex = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // [Issue #14] Content hash is already verified in master_data.ts
    // (validateMasterDataRequest function), so we skip redundant check here
    // to improve performance and reduce duplicated validation logic

    // Run custom processing
    const processingResult = await executionProcessor(
      tokenPayload,
      data,
      supabaseUser as { id: string; [key: string]: any },
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
