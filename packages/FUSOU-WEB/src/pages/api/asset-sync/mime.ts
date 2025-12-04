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

export function isSafeContentType(value?: string): value is string {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("image/") ||
    normalized === "application/json" ||
    normalized === "text/plain" ||
    normalized === "text/plain; charset=utf-8" ||
    normalized === "application/octet-stream" ||
    normalized === "application/zip" ||
    normalized === "application/gzip"
  );
}
