import type { APIRoute } from "astro";
import { SECURE_COOKIE_OPTIONS, validateOrigin } from "@/utility/security";
import { createEnvContext, getEnv } from "@/server/utils";
import { env as cfEnv } from "cloudflare:workers";

const COOKIE_OPTIONS = { ...SECURE_COOKIE_OPTIONS, sameSite: "lax" as const };

function readStoredTokenList(
  cookie: { json: () => unknown } | undefined,
): string[] {
  if (!cookie) return [];
  try {
    const parsed = cookie.json() as { data?: unknown };
    return Array.isArray(parsed.data)
      ? parsed.data.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const envCtx = createEnvContext({ env: cfEnv as any });
  const siteUrl = getEnv(envCtx, "PUBLIC_SITE_URL")?.trim();
  if (!siteUrl) {
    return new Response("Server misconfiguration", { status: 500 });
  }

  if (!validateOrigin(request, siteUrl)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  const formData = await request.formData();
  const indexStr = formData.get("index");

  if (indexStr === null) {
    return new Response("Missing index", { status: 400 });
  }

  const index = parseInt(indexStr.toString(), 10);
  if (isNaN(index)) {
    return new Response("Invalid index", { status: 400 });
  }

  // Retrieve stored token lists
  const storedAccessToken = cookies.get("stored-sb-access-token");
  const storedRefreshToken = cookies.get("stored-sb-refresh-token");
  const storedProviderToken = cookies.get("stored-sb-provider-token");
  const storedProviderRefreshToken = cookies.get(
    "stored-sb-provider-refresh-token",
  );

  if (!storedAccessToken || !storedRefreshToken) {
    return new Response("No stored sessions found", { status: 400 });
  }

  const accessTokenList = readStoredTokenList(storedAccessToken);
  const refreshTokenList = readStoredTokenList(storedRefreshToken);

  // Optional provider tokens
  const providerTokenList = storedProviderToken
    ? readStoredTokenList(storedProviderToken)
    : [];
  const providerRefreshTokenList = storedProviderRefreshToken
    ? readStoredTokenList(storedProviderRefreshToken)
    : [];

  // Validate index bounds (provider tokens are optional and may be shorter)
  if (
    index < 0 ||
    index >= accessTokenList.length ||
    index >= refreshTokenList.length
  ) {
    return new Response("Index out of bounds", { status: 400 });
  }

  // Get selected tokens
  const newAccessToken = accessTokenList[index];
  const newRefreshToken = refreshTokenList[index];
  const newProviderToken =
    index < providerTokenList.length ? providerTokenList[index] : "";
  const newProviderRefreshToken =
    index < providerRefreshTokenList.length
      ? providerRefreshTokenList[index]
      : "";

  // Update active cookies
  cookies.set("sb-access-token", newAccessToken, COOKIE_OPTIONS);
  cookies.set("sb-refresh-token", newRefreshToken, COOKIE_OPTIONS);

  if (newProviderToken) {
    cookies.set("sb-provider-token", newProviderToken, COOKIE_OPTIONS);
  } else {
    cookies.delete("sb-provider-token", { path: "/" });
  }

  if (newProviderRefreshToken) {
    cookies.set(
      "sb-provider-refresh-token",
      newProviderRefreshToken,
      COOKIE_OPTIONS,
    );
  } else {
    cookies.delete("sb-provider-refresh-token", { path: "/" });
  }

  return redirect("/dashboard");
};
