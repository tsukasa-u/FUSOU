import { onCleanup } from "solid-js";
import { safeTauriListen } from "./tauri";

export const location_route = () => {
  const unlisten_launch = safeTauriListen("set-main-page-launch", () => {
    window.location.href = "/";
  });
  const unlisten_update = safeTauriListen("set-main-page-update", () => {
    window.location.href = "/update";
  });

  onCleanup(() => {
    unlisten_launch();
    unlisten_update();
  });
};
