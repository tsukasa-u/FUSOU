import { createEnvContext, getEnv, type EnvContext } from "@/server/utils";
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
  // Create env context from runtime env or use buildtime env
  const envCtx: EnvContext = runtimeEnv
    ? createEnvContext({ env: runtimeEnv })
    : {
        runtime: {},
        buildtime: import.meta.env as Record<string, any>,
        isDev: import.meta.env.DEV,
      };
  
  const supabaseUrl = getEnv(envCtx, "PUBLIC_SUPABASE_URL");
  const serviceKey =
    getEnv(envCtx, "SUPABASE_SECRET_KEY") ||
    getEnv(envCtx, "PUBLIC_SUPABASE_PUBLISHABLE_KEY");

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
