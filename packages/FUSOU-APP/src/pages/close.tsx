import { createEffect, createSignal, Show } from "solid-js";
import { location_route } from "../utility/location";
import { supabase } from "../utility/supabase";

function Close() {
  createEffect(location_route);

  const [providerRefreshToken, setProviderRefreshToken] = createSignal("");
  const [accessToken, setAccessToken] = createSignal("");
  const [refreshToken, setRefreshToken] = createSignal("");

  const [logIn, setLogIn] = createSignal(false);

  createEffect(() => {
    supabase.auth.onAuthStateChange((event, session) => {
      console.log("Auth state changed:", event, session);
      if (event === "SIGNED_IN") {
        setLogIn(true);
        supabase.auth.getSession().then(async ({ data, error }) => {
          if (error) {
            console.error("Error getting session:", error);
          } else {
            setProviderRefreshToken(data.session?.provider_refresh_token);
            setAccessToken(data.session?.access_token);
            setRefreshToken(data.session?.refresh_token);
            // supabase.from('users').update({ refresh_token: data.session?.provider_refresh_token! }).eq('id', session?.user.id).then(({ data, error }) => {
            //   if (error) {
            //     console.error('Error updating refresh token:', error);
            //   } else {
            //     console.log('Refresh token updated successfully:', data);
            //   }
            // }
            // );
            supabase
              .from("users")
              .insert([
                {
                  id: data.session?.user.id,
                  user_unique_id: null,
                  provider_refresh_token: data.session?.provider_refresh_token,
                },
              ])
              .select()
              .then(({ data, error }) => {
                if (error) {
                  console.error("Error inserting refresh token:", error);
                  // supabase.from('users').select("*").then(({ data, error }) => {
                  //   if (error) {
                  //     console.error('Error selecting refresh token:', error);
                  //   } else {
                  //     console.log('Refresh token selected successfully:', data);
                  //   }
                  // });
                } else {
                  console.log("Refresh token inserted successfully:", data);
                }
              });
          }
        });
      } else if (event === "SIGNED_OUT") {
        setLogIn(false);
      }
    });
  });
  return (
    <>
      <div class="bg-base-200 h-screen">
        <div class="max-w-md justify-self-center bg-base-100 h-screen">
          <div class="p-10">
            <h1 class="text-3xl font-bold text-center">Auth</h1>
            <div class="h-4" />
            <div class="h-4" />

            <hr class="border-1 border-base-300" />
            <div class="h-4" />
            <div class="h-4" />

            <Show when={logIn()}>
              <h1 class="text-2xl text-center">You are logged in</h1>
              <div class="h-4" />
              <h1 class="text-2xl text-center">close to return app</h1>
              <div class="h-4" />
              <div class="h-4" />
              <a
                class="btn"
                href={
                  "fusou://auth?provider_refresh_token=" +
                  providerRefreshToken() +
                  "&provider=google&supabase_access_token=" +
                  accessToken() +
                  "&supabase_refresh_token=" +
                  refreshToken()
                }
              >
                In order to continue, please click here to launch the app
              </a>
            </Show>
          </div>
        </div>
      </div>
    </>
  );
}

export default Close;
