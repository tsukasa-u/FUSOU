import { createEffect } from "solid-js";
import { location_route } from "../utility/location";

function NotFound() {
  createEffect(location_route);

  return (
    <>
      <div class="flex">
        <div class="flex-1" />
        <div class="flex justify-center items-center h-dvh max-w-5xl">
          <img
            class="inline-block"
            src="/src/assets/pages/not_found/error.jpg"
            alt="Not Found"
          />
          <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-3/5">
            <h1 class="text-9xl font-bold text-red-600 w-lg text-center">
              404
            </h1>
            <h1 class="text-6xl font-bold mt-4 w-lg text-center">
              Page Not Found
            </h1>
            <div class="h-8" />
            <p class="max-w-lg text-center">
              By the way, how to get here? This page is not linked from
              anywhere.
              <br /> If you found a broken link, please report it to the
              administrator.
            </p>
            <div class="h-8" />
            <div class="flex justify-center">
              <a
                href="/"
                class="btn btn-link no-underline hover:underline text-green-600"
              >
                Back to App Page
              </a>
            </div>
          </div>
        </div>
        <div class="flex-1" />
      </div>
    </>
  );
}

export default NotFound;
