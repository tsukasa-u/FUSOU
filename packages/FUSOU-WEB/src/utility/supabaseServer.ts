import { getEnvValue } from "@/server/utils";
import { createClient } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";

const cookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: true,
  secure: import.meta.env.PROD,
  maxAge: 60 * 10, // 10 minutes is enough for PKCE exchange
};

const createCookieStorage = (cookies: AstroCookies) => {
  return {
    getItem(key: string) {
      return cookies.get(key)?.value ?? null;
    },
    setItem(key: string, value: string) {
      cookies.set(key, value, cookieOptions);
    },
    removeItem(key: string) {
      cookies.delete(key, { path: "/" });
    },
  };
};

export const createSupabaseServerClient = (
  cookies: AstroCookies,
  runtimeEnv?: Record<string, any>
) => {
  // Prefer Cloudflare runtime environment variables
  const supabaseUrl = getEnvValue("PUBLIC_SUPABASE_URL", runtimeEnv);
  const serviceKey =
    getEnvValue("SUPABASE_SECRET_KEY", runtimeEnv) ||
    getEnvValue("PUBLIC_SUPABASE_PUBLISHABLE_KEY", runtimeEnv);

  if (!supabaseUrl) {
    throw new Error("PUBLIC_SUPABASE_URL is not set");
  }

  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY (or PUBLIC_SUPABASE_PUBLISHABLE_KEY) is not set"
    );
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      flowType: "pkce",
      storage: createCookieStorage(cookies),
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: false,
    },
  });
};
