import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "@/utility/supabaseServer";
import { randomUUID } from "node:crypto";
import type { Provider } from "@supabase/supabase-js";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();

  const providedOrigin = import.meta.env.PUBLIC_SITE_URL?.trim();
  const url_origin = providedOrigin && providedOrigin.length > 0
    ? providedOrigin
    : new URL(request.url).origin;

  const provider = formData.get("provider")?.toString();
  const fallbackState = randomUUID();

  const validProviders = ["google"];

  if (provider && validProviders.includes(provider)) {
    const supabase = createSupabaseServerClient(cookies);

    const setStateCookie = (stateValue: string) => {
      cookies.set("oauth_state", stateValue, {
        path: "/",
        httpOnly: true,
        secure: import.meta.env.PROD,
        maxAge: 60 * 60,
        sameSite: "lax",
      });
    };

    const callbackUrl = new URL(`${url_origin}/api/auth/callback`);
    callbackUrl.searchParams.set("local_state", fallbackState);

    if (provider == "google") {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          scopes: "https://www.googleapis.com/auth/drive.file",
          redirectTo: callbackUrl.toString(),
          queryParams: {
            prompt: "consent",
            access_type: "offline",
          },
        },
      });

      if (error) {
        return new Response(error.message, { status: 500 });
      }

      const stateFromSupabase = data?.url
        ? new URL(data.url).searchParams.get("state")
        : null;
      const stateToPersist = stateFromSupabase ?? fallbackState;
      if (!stateFromSupabase) {
        console.warn("Supabase OAuth url missing state; using local fallback");
      }
      setStateCookie(stateToPersist);

      return redirect(data.url);
    } else {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider as Provider,
        options: {
          redirectTo: callbackUrl.toString(),
        },
      });

      if (error) {
        return new Response(error.message, { status: 500 });
      }

      const stateFromSupabase = data?.url
        ? new URL(data.url).searchParams.get("state")
        : null;
      const stateToPersist = stateFromSupabase ?? fallbackState;
      if (!stateFromSupabase) {
        console.warn("Supabase OAuth url missing state; using local fallback");
      }
      setStateCookie(stateToPersist);

      return redirect(data.url);
    }
  }

  return redirect("/dashboard");
};
