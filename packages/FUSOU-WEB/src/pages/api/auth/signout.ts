import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "@/utility/supabaseServer";
import { validateOrigin } from "@/utility/security";
import { createEnvContext, getEnv } from "@/server/utils";
import { env } from "cloudflare:workers";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const envCtx = createEnvContext({ env });
  const siteUrl = getEnv(envCtx, "PUBLIC_SITE_URL")?.trim();
  if (!siteUrl) {
    return new Response("Server misconfiguration", { status: 500 });
  }

  if (!validateOrigin(request, siteUrl)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  const supabase = createSupabaseServerClient(cookies, env);
  await supabase.auth.signOut();

  const cookieNames = [
    "sb-access-token",
    "sb-refresh-token",
    "sb-provider-token",
    "sb-provider-refresh-token",
    "sb-provider",
    "oauth_state",
    "stored-sb-access-token",
    "stored-sb-refresh-token",
    "stored-sb-provider-token",
    "stored-sb-provider-refresh-token",
  ];

  for (const name of cookieNames) {
    cookies.delete(name, { path: "/" });
  }

  return redirect("/auth/signin");
};
