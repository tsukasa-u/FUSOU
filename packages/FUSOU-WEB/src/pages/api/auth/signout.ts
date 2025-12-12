import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "@/utility/supabaseServer";

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const supabase = createSupabaseServerClient(cookies);
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
