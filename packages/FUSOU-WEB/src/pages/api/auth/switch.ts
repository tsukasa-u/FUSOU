import type { APIRoute } from "astro";
import { SECURE_COOKIE_OPTIONS } from "@/utility/security";

const COOKIE_OPTIONS = { ...SECURE_COOKIE_OPTIONS, sameSite: "lax" as const };

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
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
  const storedProviderRefreshToken = cookies.get("stored-sb-provider-refresh-token");

  if (!storedAccessToken || !storedRefreshToken) {
    return new Response("No stored sessions found", { status: 400 });
  }

  type storedToken = { data: string[] };
  const accessTokenList = (storedAccessToken.json() as storedToken).data;
  const refreshTokenList = (storedRefreshToken.json() as storedToken).data;
  
  // Optional provider tokens
  const providerTokenList = storedProviderToken 
    ? (storedProviderToken.json() as storedToken).data 
    : [];
  const providerRefreshTokenList = storedProviderRefreshToken 
    ? (storedProviderRefreshToken.json() as storedToken).data 
    : [];

  // Validate index bounds
  if (index < 0 || index >= accessTokenList.length || index >= refreshTokenList.length) {
    return new Response("Index out of bounds", { status: 400 });
  }

  // Get selected tokens
  const newAccessToken = accessTokenList[index];
  const newRefreshToken = refreshTokenList[index];
  const newProviderToken = providerTokenList[index] || "";
  const newProviderRefreshToken = providerRefreshTokenList[index] || "";

  // Update active cookies
  cookies.set("sb-access-token", newAccessToken, COOKIE_OPTIONS);
  cookies.set("sb-refresh-token", newRefreshToken, COOKIE_OPTIONS);
  
  if (newProviderToken) {
    cookies.set("sb-provider-token", newProviderToken, COOKIE_OPTIONS);
  } else {
    cookies.delete("sb-provider-token", { path: "/" });
  }

  if (newProviderRefreshToken) {
    cookies.set("sb-provider-refresh-token", newProviderRefreshToken, COOKIE_OPTIONS);
  } else {
    cookies.delete("sb-provider-refresh-token", { path: "/" });
  }

  return redirect("/dashboard");
};
