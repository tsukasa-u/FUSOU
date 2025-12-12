import { createClient } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";

// Note: These are fallback values. Runtime values from Cloudflare
// should be passed via createSupabaseServerClient parameters
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY =
  import.meta.env.SUPABASE_SECRET_KEY ||
  import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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
  const supabaseUrl = runtimeEnv?.PUBLIC_SUPABASE_URL || SUPABASE_URL;
  const serviceKey =
    runtimeEnv?.SUPABASE_SECRET_KEY ||
    runtimeEnv?.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    SERVICE_KEY;

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
