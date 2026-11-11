import type { Component } from "solid-js";

interface ErrorFallbackProps {
  error: any;
  reset: () => void;
}

export const ErrorFallback: Component<ErrorFallbackProps> = (props) => {
  return (
    <div class="flex items-center justify-center min-h-screen bg-base-200 text-base-content p-4">
      <div class="max-w-md w-full p-6">
        <h2 class="text-2xl font-bold text-center mb-2">
          Something went wrong
        </h2>

        <p class="text-center text-base-content/70 mb-4">
          Sorry, an unexpected error occurred.
        </p>

        <div class="bg-base-100 rounded-box p-4 mb-4 border border-base-300">
          <p class="text-sm font-mono break-words">
            {props.error?.message ?? String(props.error ?? "Unknown error")}
          </p>
        </div>

        <button
          onClick={() => props.reset()}
          class="w-full btn btn-primary border-primary-content font-medium"
        >
          Retry
        </button>

        <button
          onClick={() => (window.location.href = "/")}
          class="w-full btn btn-link no-underline hover:underline mt-2 text-base-content font-medium"
        >
          Go back home
        </button>
      </div>
    </div>
  );
};
