type ClientEnvName =
  | "PUBLIC_SUPABASE_URL"
  | "PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  | "PUBLIC_SITE_URL"
  | "PUBLIC_URL_SHORTER_BASE";

const clientEnv = import.meta.env as Record<string, string | undefined>;

export function getClientEnv(name: ClientEnvName): string {
  return (clientEnv[name] ?? "").trim();
}

export function getRequiredClientEnv(name: ClientEnvName): string {
  const value = getClientEnv(name);
  if (value) {
    return value;
  }

  throw new Error(`Missing required client environment variable: ${name}`);
}
