import { z } from "zod";

const RefreshSessionResponseSchema = z
  .object({ access_token: z.string().optional() })
  .passthrough();

/**
 * Automatically refreshes the access token if a 401 or 403 (Invalid or expired access token) occurs,
 * and retries the original request.
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const getAccessToken = () => window.__fusouAccessToken ?? null;
  const setAccessToken = (token: string) => {
    window.__fusouAccessToken = token;
  };

  const buildHeaders = (): HeadersInit => {
    const headers = new Headers(options.headers || {});
    const token = getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  };

  // Attempt the request
  let res = await fetch(url, {
    ...options,
    headers: buildHeaders(),
  });

  // If 401 or 403, we might have an expired token
  if (res.status === 401 || res.status === 403) {
    const isAuthError =
      res.status === 401 ||
      (await res
        .clone()
        .json()
        .then((data: unknown) => {
          if (!data || typeof data !== "object") return false;
          const error = (data as { error?: unknown }).error;
          return (
            typeof error === "string" &&
            error.includes("Invalid or expired access token")
          );
        })
        .catch(() => false));

    if (isAuthError) {
      // Try to refresh the session
      try {
        const refreshRes = await fetch("/api/auth/refresh_session", {
          method: "POST",
        });
        if (refreshRes.ok) {
          const refreshData = RefreshSessionResponseSchema.safeParse(
            await refreshRes.json(),
          );
          if (refreshData.success && refreshData.data.access_token) {
            // Update token and retry
            setAccessToken(refreshData.data.access_token);
            res = await fetch(url, {
              ...options,
              headers: buildHeaders(),
            });
          }
        }
      } catch (err) {
        console.error("Failed to refresh session automatically", err);
      }
    }
  }

  return res;
}
