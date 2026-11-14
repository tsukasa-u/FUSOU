/**
 * Refreshes the cookie-backed session after an authentication error, then
 * retries the request using same-origin cookies.
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const fetchWithCookies = () =>
    fetch(url, { ...options, credentials: "same-origin" });

  // Attempt the request
  let res = await fetchWithCookies();

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
          credentials: "same-origin",
        });
        if (refreshRes.ok) {
          res = await fetchWithCookies();
        }
      } catch (err) {
        console.error("Failed to refresh session automatically", err);
      }
    }
  }

  return res;
}
