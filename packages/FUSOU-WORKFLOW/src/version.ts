export function normalizeTableVersion(version: string): string {
  const trimmed = version.trim();
  return /^\d+\.\d+$/.test(trimmed) ? `${trimmed}.0` : trimmed;
}

export function tableVersionAliases(version: string): string[] {
  const normalized = normalizeTableVersion(version);
  return normalized.endsWith(".0")
    ? [normalized, normalized.slice(0, -2)]
    : [normalized];
}
