import type { Component } from "solid-js";

interface ErrorFallbackProps {
  error: any;
  reset: () => void;
}

export const ErrorFallback: Component<ErrorFallbackProps> = (props) => {
  return (
    <div class="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div class="max-w-md w-full  p-6">
        {/* <div class="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 dark:bg-red-900 rounded-full mb-4">
          <svg
            class="w-6 h-6 text-red-600 dark:text-red-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div> */}

        <h2 class="text-3xl font-bold text-center mb-2">
          Something went wrong
        </h2>

        <p class="text-center text-gray-600 dark:text-gray-400 mb-4">
          Sorry, an unexpected error occurred.
        </p>

        <div class="rounded-md p-4 mb-4 border-base-300 border-1">
          <p class="text-sm font-mono break-words">{props.error.message}</p>
        </div>

        <button
          onClick={() => props.reset()}
          class="w-full btn btn-primary border-primary-content border-1 font-medium py-2 px-4 rounded-md transition-colors duration-200"
        >
          Retry
        </button>

        <button
          onClick={() => (window.location.href = "/")}
          class="w-full btn btn-link no-underline hover:underline mt-2 text-gray-800 dark:text-gray-200 font-medium py-2 px-4 rounded-md transition-colors duration-200"
        >
          Go back home
        </button>
      </div>
    </div>
  );
};
