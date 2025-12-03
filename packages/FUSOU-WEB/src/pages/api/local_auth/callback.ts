import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "@/utility/supabaseServer";

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const authCode = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const localState = url.searchParams.get("local_state");
  const storedState = cookies.get("oauth_state")?.value;
  const provider = cookies.get("sb-provider")?.value;
  const incomingState = state ?? localState;

  if (!authCode) {
    return new Response("No code provided", { status: 400 });
  }

  if (!incomingState || incomingState !== storedState) {
    return new Response("Invalid state", { status: 400 });
  }

  cookies.delete("oauth_state", { path: "/" });
  cookies.delete("sb-provider", { path: "/" });

  const supabase = createSupabaseServerClient(cookies);
  const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  const {
    access_token,
    refresh_token,
    provider_token,
    provider_refresh_token,
  } = data.session;

  if (provider_token && provider_refresh_token) {
    cookies.set("sb-provider-token", provider_token, {
      path: "/",
      httpOnly: true,
      secure: import.meta.env.PROD,
      sameSite: "lax",
    });
    cookies.set("sb-provider-refresh-token", provider_refresh_token, {
      path: "/",
      httpOnly: true,
      secure: import.meta.env.PROD,
      sameSite: "lax",
    });
  } else {
    console.warn("Provider tokens missing in session; skipping persistence");
  }

  cookies.set("sb-access-token", access_token, {
    path: "/",
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: "lax",
  });
  cookies.set("sb-refresh-token", refresh_token, {
    path: "/",
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: "lax",
  });

  return redirect("/returnLocalApp");
};
