export function parseAllowedHosts(value?: string): string[] {
  if (!value) return [];

  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (entry.startsWith("*.")) return entry;
      if (entry.includes("://")) {
        try {
          return new URL(entry).hostname.toLowerCase();
        } catch {
          return "";
        }
      }
      return entry;
    })
    .filter((entry) => entry.length > 0);
}

export function isAllowedHost(
  hostname: string,
  allowedHosts: ReadonlySet<string>,
): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (allowedHosts.has(normalized)) return true;

  for (const allowed of allowedHosts) {
    if (allowed.startsWith("*.") && normalized.endsWith(allowed.slice(1))) {
      return true;
    }
  }
  return false;
}
