import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { onCleanup } from "solid-js";

export const location_route = () => {
  let unlisten_data_launch: UnlistenFn;
  let unlisten_data_update: UnlistenFn;
  (async () => {
    unlisten_data_launch = await listen("set-main-page-launch", () => {
      // const regex = /http:\/\/localhost:[0-9]+\//i;
      // const location_href = window.location.href;
      // const found_url = location_href.match(regex);
      // if (found_url) window.location.href = found_url!.toString();
      window.location.href = "/";
    });
  })();
  (async () => {
    unlisten_data_update = await listen("set-main-page-update", () => {
      // const regex = /http:\/\/localhost:[0-9]+\//i;
      // const location_href = window.location.href;
      // const found_url = location_href.match(regex);
      // console.log("Navigating to update page:", found_url);
      // if (found_url) window.location.href = `${found_url!.toString()}update`;
      window.location.href = "/update";
    });
  })();

  onCleanup(() => {
    if (unlisten_data_launch) unlisten_data_launch();
    if (unlisten_data_update) unlisten_data_update();
  });
};
