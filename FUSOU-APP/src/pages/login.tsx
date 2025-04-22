import { createEffect, Show } from "solid-js";
import { location_route } from "../utility/location";
import { supabase } from "../utility/supabase";
import { useAuth } from "../utility/provider";
import { useNavigate } from "@solidjs/router";
// import { invoke } from "@tauri-apps/api/core";

function Login() {
  createEffect(location_route);

  const [authData, setAuthData] = useAuth();

  const handleLogin = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/drive.file',
        redirectTo: `${window.location.origin}/close`,
        queryParams: {
          prompt: 'consent',
          access_type: 'offline',
        },
      },
    });
    if (error) {
      console.error('Error logging in:', error);
    } else {
      supabase.auth.getSession().then(({ data, error }) => {
        // console.log("session", data.session);
        if (error) {
          console.error('Error getting session:', error);
        } else {
          if (data.session !== null) {
            setAuthData({
              accessToken: data.session.provider_token,
              refreshToken: data.session.refresh_token,
            });
          }
        }
      });
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error logging out:', error);
    } else {
      // setAuthData({
      //   accessToken: null,
      //   userName: null,
      //   userImage: null,
      //   userMail: null,
      //   noAuth: true,
      //   logined: false,
      // })
    }
  };

  const navigate = useNavigate();

  return (
    <> 
      <div class="bg-base-200 h-screen">
        <div class="max-w-md justify-self-center bg-base-100 h-screen">
          <div class="p-10">
            <div class="flex">
              <Show when={document.referrer !== "" && !document.referrer.split("?")[0].endsWith("/")}>
                <button
                  class="btn btn-circle btn-ghost absolute top-4 left-4"
                  onclick={() => {
                    if (document.referrer.split("?")[0].endsWith("/app")) {
                      navigate("/app");
                    }
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 22 22" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12H3m0 0l6-6m-6 6l6 6m9" />
                  </svg>
                </button>
              </Show>
            </div>
            <h1 class="text-3xl font-bold text-center">Login</h1>
            <div class="h-4"></div>
            <div class="h-4"></div>
            <div class="h-4"></div>
            <div class="h-4"></div>

            <p class="text-center">Login to your account</p>
            <div class="h-4"></div>

            <button class="btn bg-white text-black border-[#e5e5e5] w-full" onClick={handleLogin}>
              <svg aria-label="Google logo" width="16" height="16" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g><path d="m0 0H512V512H0" fill="#fff"></path><path fill="#34a853" d="M153 292c30 82 118 95 171 60h62v48A192 192 0 0190 341"></path><path fill="#4285f4" d="m386 400a140 175 0 0053-179H260v74h102q-7 37-38 57"></path><path fill="#fbbc02" d="m90 341a208 200 0 010-171l63 49q-12 37 0 73"></path><path fill="#ea4335" d="m153 219c22-69 116-109 179-50l55-54c-78-75-230-72-297 55"></path></g></svg>
              Login with Google
            </button>

            <div class="h-16"></div>
            <div class="h-full"></div>
          </div>
        </div>
      </div>
    </>
  );
}

export default Login;
