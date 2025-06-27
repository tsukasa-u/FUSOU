import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { onCleanup } from "solid-js";

export const location_route = () => {
  let unlisten_data: UnlistenFn;
  (async () => {
    unlisten_data = await listen("set-main-page-launch", () => {
      const regex = /http:\/\/localhost:[0-9]+\//i;
      const location_href = window.location.href;
      const found_url = location_href.match(regex);
      if (found_url) window.location.href = found_url!.toString();
    });
  })();

  onCleanup(() => {
    if (unlisten_data) unlisten_data();
  });
};
