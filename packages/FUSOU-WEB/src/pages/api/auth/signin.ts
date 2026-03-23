import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "@/utility/supabaseServer";
import type { Provider } from "@supabase/supabase-js";
import {
  validateOrigin,
  validateOriginDetailed,
  validateRedirectUrl,
  sanitizeErrorMessage,
} from "@/utility/security";
import { createEnvContext, getEnv } from "@/server/utils";

export const POST: APIRoute = async ({
  request,
  cookies,
  redirect,
  locals,
}) => {
  const envCtx = createEnvContext({ env: locals?.runtime?.env || {} });

  // Use configured canonical site URL as trusted origin anchor to prevent Host-header spoofing.
  // Do not fall back to request.url; fail loudly on misconfiguration.
  const siteUrl = getEnv(envCtx, "PUBLIC_SITE_URL")?.trim();
  if (!siteUrl) {
    console.error("[auth/signin] PUBLIC_SITE_URL is not configured");
    return new Response("Server misconfiguration", { status: 500 });
  }
  const canonicalOrigin = siteUrl;

  // CSRF protection: Validate Origin/Referer header against canonical origin (strict 1:1).
  const originResult = validateOriginDetailed(request, canonicalOrigin);
  if (!originResult.ok) {
    let requestUrlOrigin: string | null = null;
    try {
      requestUrlOrigin = new URL(request.url).origin;
    } catch {
      requestUrlOrigin = null;
    }

    console.error(
      "[auth/signin] origin validation failed",
      JSON.stringify(
        {
          reason: originResult.reason,
          canonicalOrigin,
          requestMethod: request.method,
          requestUrl: request.url,
          requestUrlOrigin,
          headers: {
            origin: request.headers.get("origin"),
            referer: request.headers.get("referer"),
            host: request.headers.get("host"),
            "x-forwarded-host": request.headers.get("x-forwarded-host"),
            "x-forwarded-proto": request.headers.get("x-forwarded-proto"),
            "cf-visitor": request.headers.get("cf-visitor"),
            "cf-ray": request.headers.get("cf-ray"),
            "sec-fetch-site": request.headers.get("sec-fetch-site"),
            "sec-fetch-mode": request.headers.get("sec-fetch-mode"),
            "sec-fetch-dest": request.headers.get("sec-fetch-dest"),
            "sec-fetch-user": request.headers.get("sec-fetch-user"),
          },
          parsed: {
            origin: originResult.parsedOrigin,
            refererOrigin: originResult.parsedRefererOrigin,
            allowedOrigins: originResult.allowedOrigins,
          },
          env: {
            PUBLIC_SITE_URL: siteUrl,
            CF_PAGES_BRANCH: getEnv(envCtx, "CF_PAGES_BRANCH"),
            CF_PAGES_URL: getEnv(envCtx, "CF_PAGES_URL"),
          },
        },
        null,
        2,
      ),
    );
    return new Response("Invalid request origin", { status: 403 });
  }

  const formData = await request.formData();
  const url_origin = canonicalOrigin;

  const provider = formData.get("provider")?.toString();

  const validProviders = ["google"];

  if (!provider) {
    return new Response("Authentication request invalid", { status: 400 });
  }

  if (!validProviders.includes(provider)) {
    return new Response("Authentication request invalid", { status: 400 });
  }

  const supabase = createSupabaseServerClient(cookies, envCtx.runtime);

  const callbackUrl = new URL(`${url_origin}/api/auth/callback`);

  // Open Redirect protection: Validate callback URL
  if (!validateRedirectUrl(callbackUrl.toString(), url_origin)) {
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
      return new Response(sanitizeErrorMessage(error), { status: 500 });
    }

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

    return redirect(data.url);
  }
};
