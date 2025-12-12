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
