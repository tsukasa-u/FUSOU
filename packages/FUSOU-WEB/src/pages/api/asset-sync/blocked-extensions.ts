const DEFAULT_BLOCKED_EXTENSIONS: string[] = [];
const DEFAULT_ALLOWED_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "json",
  ".mp3"
];

type ExtensionSource = string | undefined;

export function resolveAllowedExtensions(
  ...sources: ExtensionSource[]
): Set<string> {
  for (const source of sources) {
    const entries = parseList(source);
    if (entries.length > 0) {
      return new Set(entries);
    }
  }
  return new Set(DEFAULT_ALLOWED_EXTENSIONS);
}

export function violatesAllowList(
  candidates: Array<string | null | undefined>,
  allowList: Set<string>,
): boolean {
  if (allowList.size === 0) {
    return true;
  }
  return candidates.some((value) => {
    const ext = extractExtension(value);
    if (!ext) {
      return true;
    }
    return !allowList.has(ext);
  });
}

export function extractExtension(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const last = normalized.lastIndexOf(".");
  if (last === -1 || last === normalized.length - 1) {
    return null;
  }
  return normalized.substring(last + 1);
}

function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/^[.]+/, ""))
    .filter((item) => item.length > 0);
}
