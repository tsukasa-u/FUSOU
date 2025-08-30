import { createEffect } from "solid-js";
import { location_route } from "../utility/location";
import { DebugApi } from "../components//debug_component/debug_api";
import { DebugApiProvider } from "../utility/provider";

function Debug() {
  createEffect(location_route);

  return (
    <>
      <div class="bg-base-200 h-lvh">
        <DebugApiProvider>
          <DebugApi />
        </DebugApiProvider>
      </div>
    </>
  );
}

export default Debug;
