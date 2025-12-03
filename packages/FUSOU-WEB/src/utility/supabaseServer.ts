import { createClient } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY =
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY ||
  import.meta.env.SUPABASE_SERVICE_KEY ||
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  throw new Error("PUBLIC_SUPABASE_URL is not set");
}

if (!SERVICE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY/PUBLIC_SUPABASE_ANON_KEY) is not set"
  );
}

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

export const createSupabaseServerClient = (cookies: AstroCookies) => {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: {
      flowType: "pkce",
      storage: createCookieStorage(cookies),
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: false,
    },
  });
};
