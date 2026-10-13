import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";

/**
 * Returns true if the app is currently running inside Tauri IPC environment.
 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__,
    )
  );
}

/**
 * Safely subscribe to a Tauri event.
 * In non-Tauri environments (browser tests, Storybook, SSR), returns a no-op unlisten function.
 * Automatically handles race conditions where the component unmounts before listen resolves.
 */
export function safeTauriListen<T = unknown>(
  event: string,
  handler: (event: { payload: T }) => void,
): () => void {
  if (!isTauri()) {
    return () => {};
  }

  let disposed = false;
  let unlisten: UnlistenFn | undefined;

  listen<T>(event, (e) => {
    if (!disposed) handler(e);
  })
    .then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    })
    .catch((err) => {
      if (import.meta.env.DEV) {
        console.warn(`Failed to listen to ${event}:`, err);
      }
    });

  return () => {
    disposed = true;
    unlisten?.();
  };
}
