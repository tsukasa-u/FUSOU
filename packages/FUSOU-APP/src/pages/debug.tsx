import { createEffect } from "solid-js";
import { location_route } from "../utility/location";
import { DebugApi } from "../components/debug_component/debug_api";
import { DebugApiProvider } from "../utility/provider";

function Debug() {
  createEffect(location_route);

  return (
    <>
      <div class="bg-base-200 min-h-lvh pb-8">
        <div class="flex items-center justify-between px-4 pt-3 pb-1 border-b border-base-300">
          <div class="flex items-center gap-2">
            <span class="badge badge-primary badge-xs">DEBUG</span>
            <span class="text-xs font-semibold">FUSOU Developer Tools</span>
          </div>
          <div class="flex items-center gap-2">
            <a href="/design-system" class="btn btn-xs btn-outline">
              Component Catalog
            </a>
            <a href="/app" class="btn btn-xs btn-ghost">
              App
            </a>
          </div>
        </div>
        <DebugApiProvider>
          <DebugApi />
        </DebugApiProvider>
      </div>
    </>
  );
}

export default Debug;
