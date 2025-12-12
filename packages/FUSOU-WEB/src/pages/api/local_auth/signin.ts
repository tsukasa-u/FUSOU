import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "@/utility/supabaseServer";
import type { Provider } from "@supabase/supabase-js";
import {
  validateOrigin,
  validateRedirectUrl,
  sanitizeErrorMessage,
  TEMPORARY_COOKIE_OPTIONS,
} from "@/utility/security";
import { getEnvValue } from "@/server/utils";

export const POST: APIRoute = async ({
  request,
  cookies,
  redirect,
  locals,
}) => {
  const runtimeEnv = locals?.runtime?.env || {};
  const providedOrigin = getEnvValue("PUBLIC_SITE_URL", runtimeEnv)?.trim();
  if (!providedOrigin) {
    return new Response("Server misconfiguration: PUBLIC_SITE_URL is not set", {
      status: 500,
    });
  }

  // CSRF protection: Validate Origin/Referer header
  if (!validateOrigin(request, providedOrigin)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  const formData = await request.formData();
  const url_origin = providedOrigin;

  const provider = formData.get("provider")?.toString();

  const validProviders = ["google"];

  if (!provider) {
    return new Response("Authentication request invalid", { status: 400 });
  }

  if (!validProviders.includes(provider)) {
    return new Response("Authentication request invalid", { status: 400 });
  }

  const supabase = createSupabaseServerClient(cookies);

  // Construct callback URL without custom state - Supabase will add its own state
  const callbackUrl = new URL(`${url_origin}/api/local_auth/callback`);

  // Open Redirect protection: Validate callback URL
  if (!validateRedirectUrl(callbackUrl.toString(), providedOrigin)) {
    return new Response("Invalid callback URL", { status: 400 });
  }

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
      console.error("Supabase OAuth error:", error);
      return new Response(sanitizeErrorMessage(error), { status: 500 });
    }

    // Store provider for callback reference (local app-specific)
    cookies.set("sb-local-provider", provider, TEMPORARY_COOKIE_OPTIONS);

    // Supabase handles state internally with PKCE flow
    // No need to manually manage state cookies
    return redirect(data.url);
  } else {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: provider as Provider,
      options: {
        redirectTo: callbackUrl.toString(),
      },
    });

    if (error) {
      return new Response(sanitizeErrorMessage(error), { status: 500 });
    }

    // Store provider for callback reference (local app-specific)
    cookies.set("sb-local-provider", provider, TEMPORARY_COOKIE_OPTIONS);

    return redirect(data.url);
  }
};
