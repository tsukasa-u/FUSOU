import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { AppEventName } from "./app_events";

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
 * Safely invoke a Tauri command.
 * In non-Tauri environments (browser tests, Storybook, SSR), resolves to undefined.
 */
export async function safeTauriInvoke<T = void>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  if (!isTauri()) {
    return undefined;
  }

  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(`Failed to invoke ${cmd}:`, err);
    }
    return undefined;
  }
}

/**
 * Safely subscribe to a Tauri event.
 * In non-Tauri environments (browser tests, Storybook, SSR), returns a no-op unlisten function.
 * Automatically handles race conditions where the component unmounts before listen resolves.
 */
export function safeTauriListen<T = unknown>(
  event: AppEventName,
  handler: (event: { payload: T }) => void,
  onReady?: () => void,
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
        onReady?.();
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
