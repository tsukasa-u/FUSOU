import { onCleanup } from "solid-js";
import { safeTauriListen } from "./tauri";
import { APP_EVENTS } from "./app_events";

export const location_route = () => {
  const unlisten_launch = safeTauriListen(APP_EVENTS.SetMainPageLaunch, () => {
    window.location.href = "/";
  });
  const unlisten_update = safeTauriListen(APP_EVENTS.SetMainPageUpdate, () => {
    window.location.href = "/update";
  });

  onCleanup(() => {
    unlisten_launch();
    unlisten_update();
  });
};
