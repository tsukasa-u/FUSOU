const DEFAULT_BLOCKED_EXTENSIONS = ["mp3", "woff2", ".js"];

type BlocklistSource = string | undefined;

export function resolveBlockedExtensions(
  ...sources: BlocklistSource[]
): Set<string> {
  for (const source of sources) {
    const entries = parseBlockedList(source);
    if (entries.length > 0) {
      return new Set(entries);
    }
  }
  return new Set(DEFAULT_BLOCKED_EXTENSIONS);
}

export function hasBlockedExtension(
  candidates: Array<string | null | undefined>,
  blocked: Set<string>,
): boolean {
  if (blocked.size === 0) {
    return false;
  }
  return candidates.some((value) => {
    const ext = extractExtension(value);
    return ext ? blocked.has(ext) : false;
  });
}

function parseBlockedList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/^[.]+/, ""))
    .filter((item) => item.length > 0);
}

function extractExtension(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const last = normalized.lastIndexOf(".");
  if (last === -1 || last === normalized.length - 1) {
    return null;
  }
  return normalized.substring(last + 1);
}
