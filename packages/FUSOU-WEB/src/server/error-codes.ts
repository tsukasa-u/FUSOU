/**
 * [Issue #20] 統一されたエラーコード定義
 * すべての API エンドポイントで一貫したエラー応答フォーマットを使用
 * 
 * エラーコード規約:
 * - AUTH_*: 認証・認可関連
 * - VALIDATION_*: バリデーション関連
 * - RESOURCE_*: リソース関連（D1/R2）
 * - PROCESSING_*: 処理関連
 * - SYSTEM_*: システム・インフラ関連
 */

export const ERROR_CODES = {
  // Authentication & Authorization
  AUTH_MISSING: {
    code: "AUTH_MISSING",
    message: "Missing authentication token",
    statusCode: 401,
  },
  AUTH_INVALID: {
    code: "AUTH_INVALID",
    message: "Invalid or expired authentication token",
    statusCode: 401,
  },
  AUTH_EXPIRED: {
    code: "AUTH_EXPIRED",
    message: "Authentication token has expired. Please refresh your session.",
    statusCode: 401,
  },
  USER_MISMATCH: {
    code: "USER_MISMATCH",
    message: "User mismatch - token generated for different user",
    statusCode: 403,
  },

  // Validation Errors
  VALIDATION_INVALID_JSON: {
    code: "VALIDATION_INVALID_JSON",
    message: "Invalid JSON in request body",
    statusCode: 400,
  },
  VALIDATION_MISSING_FIELD: {
    code: "VALIDATION_MISSING_FIELD",
    message: "Missing required field in request",
    statusCode: 400,
  },
  VALIDATION_INVALID_FORMAT: {
    code: "VALIDATION_INVALID_FORMAT",
    message: "Invalid format in request field",
    statusCode: 400,
  },
  VALIDATION_HASH_MISMATCH: {
    code: "VALIDATION_HASH_MISMATCH",
    message: "Content hash mismatch - data was modified",
    statusCode: 400,
  },

  // Token Payload Errors
  INVALID_TOKEN_PAYLOAD: {
    code: "INVALID_TOKEN_PAYLOAD",
    message: "Invalid token payload - missing required fields",
    statusCode: 400,
  },

  // Resource Errors (D1)
  RESOURCE_D1_CONFLICT: {
    code: "RESOURCE_D1_CONFLICT",
    message: "Record already exists - concurrent request detected",
    statusCode: 409,
  },
  RESOURCE_D1_NOT_FOUND: {
    code: "RESOURCE_D1_NOT_FOUND",
    message: "Requested record not found",
    statusCode: 404,
  },
  RESOURCE_D1_ERROR: {
    code: "RESOURCE_D1_ERROR",
    message: "Database operation failed",
    statusCode: 500,
  },

  // Resource Errors (R2)
  RESOURCE_R2_UPLOAD_FAILED: {
    code: "RESOURCE_R2_UPLOAD_FAILED",
    message: "Failed to upload file to object storage",
    statusCode: 500,
  },
  RESOURCE_R2_NOT_FOUND: {
    code: "RESOURCE_R2_NOT_FOUND",
    message: "Object not found in object storage",
    statusCode: 404,
  },
  RESOURCE_R2_PERMISSION_DENIED: {
    code: "RESOURCE_R2_PERMISSION_DENIED",
    message: "Permission denied for object storage operation",
    statusCode: 403,
  },
  RESOURCE_R2_ERROR: {
    code: "RESOURCE_R2_ERROR",
    message: "Object storage operation failed",
    statusCode: 500,
  },

  // Processing Errors
  PROCESSING_HASH_COMPUTATION: {
    code: "PROCESSING_HASH_COMPUTATION",
    message: "Failed to compute content hash",
    statusCode: 500,
  },
  PROCESSING_FAILED: {
    code: "PROCESSING_FAILED",
    message: "Request processing failed",
    statusCode: 500,
  },

  // System Errors
  SYSTEM_ERROR: {
    code: "SYSTEM_ERROR",
    message: "Internal server error",
    statusCode: 500,
  },
  SYSTEM_ENV_CONFIG: {
    code: "SYSTEM_ENV_CONFIG",
    message: "Server configuration error",
    statusCode: 500,
  },
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

/**
 * 標準化されたエラーレスポンスを生成
 */
export function createErrorResponse(
  errorCode: ErrorCode,
  details?: string
): {
  error: string;
  code: string;
  details?: string;
} {
  return {
    error: errorCode.message,
    code: errorCode.code,
    ...(details && { details }),
  };
}

/**
 * エラーコード定数からステータスコードを取得
 */
export function getStatusCode(errorCode: ErrorCode): number {
  return errorCode.statusCode;
}
