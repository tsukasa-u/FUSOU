import type { APIRoute } from "astro";
import { supabase } from "@/utility/supabase";

export const POST: APIRoute = async ({ cookies, redirect }) => {
  await supabase.auth.signOut();
  cookies.delete("sb-access-token", { path: "/" });
  cookies.delete("sb-refresh-token", { path: "/" });
  cookies.delete("sb-provider-token", { path: "/" });
  cookies.delete("sb-provider-refresh-token", { path: "/" });
  cookies.delete("sb-provider", { path: "/" });
  cookies.delete("oauth_state", { path: "/" });
  return redirect("/signin");
};