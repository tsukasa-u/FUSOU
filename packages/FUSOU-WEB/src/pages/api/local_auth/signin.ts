import type { APIRoute } from "astro";
import { supabase } from "@/utility/supabase";
import type { Provider } from "@supabase/supabase-js";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();

  const url_origin = import.meta.env.PUBLIC_SITE_URL;
  // const url_origin = process.env.PUBLIC_SITE_URL;

  const provider = formData.get("provider")?.toString();

  const validProviders = ["google"];

  if (provider && validProviders.includes(provider)) {
    if (provider == "google") {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          scopes: "https://www.googleapis.com/auth/drive.file",
          redirectTo: `${url_origin}/api/local_auth/callback`,
          queryParams: {
            prompt: "consent",
            access_type: "offline",
          },
        },
      });

      if (error) {
        return new Response(error.message, { status: 500 });
      }
      cookies.set("sb-provider", provider, {
        path: "/",
      });

      return redirect(data.url);
    } else {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider as Provider,
        options: {
          redirectTo: `${url_origin}/api/local_auth/callback`,
        },
      });

      if (error) {
        return new Response(error.message, { status: 500 });
      }

      return redirect(data.url);
    }
  }

  return redirect("/returnLocalApp");
};
