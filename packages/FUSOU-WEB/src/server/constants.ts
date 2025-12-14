// ========================
// 定数
// ========================

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const MAX_BODY_SIZE = 2 * 1024 * 1024;
export const CACHE_CONTROL = "public, max-age=31536000, immutable";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type",
};

export const SIGNED_URL_TTL_SECONDS = 120;
export const SNAPSHOT_TOKEN_TTL_SECONDS = 300;
export const CACHE_TTL_SECONDS = 6 * 60 * 60;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const SAFE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  bz2: "application/x-bzip2",
  xz: "application/x-xz",
  bin: "application/octet-stream",
  mp4: "video/mp4",
  webm: "video/webm",
  m4v: "video/x-m4v",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  ogv: "video/ogg",
  oga: "audio/ogg",
  pak: "application/octet-stream",
  dat: "application/octet-stream",
};

export const DEFAULT_ALLOWED_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "json",
  // 'mp3',
];

// ========================
// Compaction Service Configuration
// ========================
export const COMPACTION_CONFIG = {
  // Maximum number of fragments to compact in a single operation
  MAX_FRAGMENTS: 1000,
  // Maximum bytes to read/write in a single operation
  MAX_BYTES: 100 * 1024 * 1024, // 100 MB
  // Request timeout for compaction operations
  REQ_TIMEOUT_MS: 120 * 1000, // 2 minutes
};

// ========================
// R2 Signed URL Configuration
// ========================
export const R2_SIGNED_URL_CONFIG = {
  // Default expiration time for R2 signed URLs (in seconds)
  DEFAULT_EXPIRES_IN_SECONDS: 3600, // 1 hour
  // Maximum expiration time allowed for signed URLs
  MAX_EXPIRES_IN_SECONDS: 7 * 24 * 60 * 60, // 7 days
  // Minimum expiration time allowed
  MIN_EXPIRES_IN_SECONDS: 60, // 1 minute
};
