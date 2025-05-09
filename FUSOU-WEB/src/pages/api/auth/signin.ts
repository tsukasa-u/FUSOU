import type { APIRoute } from "astro";
import { supabase } from "../../../lib/supabase";
import type { Provider } from "@supabase/supabase-js";
import { signIn } from "../../../lib/auth-client"

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();

  const url_origin = import.meta.env.PUBLIC_SITE_URL;

  const provider = formData.get("provider")?.toString();

  const validProviders = ["google"];

  if (provider && validProviders.includes(provider)) {
    if (provider == "google") {
      const { data, error } = await signIn(provider);

      // const { data, error } = await supabase.auth.signInWithOAuth({
      //   provider: 'google',
      //   options: {
      //     scopes: 'https://www.googleapis.com/auth/drive.file',
      //     redirectTo: `/api/auth/callback`,
      //   },
      // });

      if (error) {
        return new Response(error.message, { status: 500 });
      }

      return redirect(data!.url!);
    } else {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider as Provider,
        options: {
          redirectTo: `${url_origin}/api/auth/callback`,
        },
      });

      if (error) {
        return new Response(error.message, { status: 500 });
      }

      return redirect(data.url);
    }
  }

  // if (!email || !password) {
  //   return new Response("Email and password are required", { status: 400 });
  // }

  // const { data, error } = await supabase.auth.signInWithPassword({
  //   email,
  //   password,
  // });

  // if (error) {
  //   return new Response(error.message, { status: 500 });
  // }

  // const { access_token, refresh_token } = data.session;
  // cookies.set("sb-access-token", access_token, {
  //   path: "/",
  // });
  // cookies.set("sb-refresh-token", refresh_token, {
  //   path: "/",
  // });
  return redirect("/dashboard");
};