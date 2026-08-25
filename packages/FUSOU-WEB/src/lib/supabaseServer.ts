import {
  createEnvContext,
  getEnv,
  resolveSupabaseConfig,
  type EnvContext,
} from "@/server/utils";
import { createClient } from "@supabase/supabase-js";

type CookieStore = {
  get: (key: string) => { value: string } | undefined;
  set: (key: string, value: string, options?: Record<string, unknown>) => void;
  delete: (key: string, options?: Record<string, unknown>) => void;
};

type SupabaseServerOptions = {
  storageKey?: string;
};

const cookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: true,
  secure: import.meta.env.PROD,
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

const createCookieStorage = (cookies: CookieStore) => {
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
  cookies: CookieStore,
  runtimeEnv?: Record<string, unknown>,
  options: SupabaseServerOptions = {},
) => {
  // Create env context from runtime env or use buildtime env
  const envCtx: EnvContext = createEnvContext({ env: runtimeEnv ?? {} });

  const supabaseConfig = resolveSupabaseConfig(envCtx);
  const supabaseUrl = supabaseConfig.url;
  const publishableKey = supabaseConfig.publishableKey;

  if (!supabaseUrl) {
    throw new Error("PUBLIC_SUPABASE_URL is not set");
  }

  if (!publishableKey) {
    throw new Error("PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set");
  }

  return createClient(supabaseUrl, publishableKey, {
    auth: {
      flowType: "pkce",
      storage: createCookieStorage(cookies),
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: false,
      ...(options.storageKey ? { storageKey: options.storageKey } : {}),
    },
  });
};

export const createSupabaseAdminClient = (
  runtimeEnv?: Record<string, unknown>,
) => {
  const envCtx: EnvContext = createEnvContext({ env: runtimeEnv ?? {} });
  const supabaseUrl = getEnv(envCtx, "PUBLIC_SUPABASE_URL");
  const serviceKey = getEnv(envCtx, "SUPABASE_SECRET_KEY");

  if (!supabaseUrl) {
    throw new Error("PUBLIC_SUPABASE_URL is not set");
  }

  if (!serviceKey) {
    throw new Error("SUPABASE_SECRET_KEY is not set");
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};
