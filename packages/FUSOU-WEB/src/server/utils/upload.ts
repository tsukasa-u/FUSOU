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

  if (!url.searchParams.has("token")) {
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

  // Generate signed token with user_id binding
  const { generateSignedToken } = await import("../utils");
  const signedToken = await generateSignedToken(
    { ...tokenPayload, user_id: supabaseUser.id },
    signingSecret,
    tokenTTL ?? SIGNED_URL_TTL_SECONDS,
  );

  // Build upload URL with token
  const usingAdapter = !!(c.env as any)?.env;
  const uploadUrl = new URL(url);
  if (usingAdapter && !uploadUrl.pathname.startsWith("/api/")) {
    uploadUrl.pathname =
      "/api" +
      (uploadUrl.pathname.startsWith("/")
        ? uploadUrl.pathname
        : "/" + uploadUrl.pathname);
  }
  uploadUrl.searchParams.set("token", signedToken);

  return c.json({
    uploadUrl: uploadUrl.toString(),
    expiresAt: new Date(
      Date.now() + (tokenTTL ?? SIGNED_URL_TTL_SECONDS) * 1000,
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

  const token = url.searchParams.get("token");
  if (!token) {
    return c.json({ error: "Missing token parameter" }, 400);
  }

  // Verify signed token
  const { verifySignedToken, validateJWT } = await import("../utils");
  const tokenPayload = await verifySignedToken(token, signingSecret);
  if (!tokenPayload) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const expectedHash = tokenPayload.content_hash;
  const tokenUserId = tokenPayload.user_id;

  if (!expectedHash) {
    return c.json({ error: "Invalid token payload" }, 400);
  }

  // Validate JWT from request to ensure same user is uploading
  const authHeader = request.headers.get("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!bearerToken) {
    return c.json({ error: "Missing Authorization bearer token" }, 401);
  }

  const supabaseUser = await validateJWT(bearerToken);
  if (!supabaseUser) {
    return c.json({ error: "Invalid or expired JWT token" }, 401);
  }

  if (tokenUserId !== supabaseUser.id) {
    return c.json(
      { error: "User mismatch - cannot use another user's token" },
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

    // Verify hash matches expected
    if (hashHex !== expectedHash) {
      return c.json(
        { error: "Content hash mismatch - data was modified" },
        400,
      );
    }

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
