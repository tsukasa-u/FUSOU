import "../src/assets/app.css";
import {
  getStorybookPageApiResponse,
  STORYBOOK_PROJECT_API_ORIGIN,
  STORYBOOK_SAMPLE_FLEET,
  STORYBOOK_SAMPLE_FLEET_TAG,
  STORYBOOK_SAMPLE_FLEET_UPLOADED,
  STORYBOOK_SAMPLE_VIEWER_WORKSPACE,
} from "../src/stories/storybook-page-fixtures";
import type {
  PageMockScenario,
  StorybookPageState,
} from "../src/stories/storybook-page-state";
import { workspaceStore } from "../src/features/simulator/viewer-workspace";
import "./preview.css";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Preview } from "@storybook-astro/framework";

const nativeFetch = window.fetch.bind(window);
const pageQueryKeys = [
  "tab",
  "detail_id",
  "dataset_id",
  "battle_index",
  "period_tag",
  "table_version",
  "q",
  "map_filter",
  "result_filter",
  "start_date",
  "end_date",
  "master_id",
  "cumulative",
  "all_periods",
  "mode",
  "version",
  "group",
  "endpoint",
  "reason",
  "return_to",
  "app_origin",
  "oauth_flow",
  "association_error",
  "fleet",
  "source",
  "tutorial",
  "hide_tutorial",
  "no_tutorial",
  "tutorial_modal",
  "tutorial_auto",
  "auto_tutorial",
];
let currentPageScenario: PageMockScenario | "components" = "components";

window.fetch = async (input, init) => {
  const requestUrl =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
  const url = new URL(requestUrl, window.location.origin);
  const { pathname } = url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

  if (pathname.startsWith("/api/asset-sync/")) {
    return nativeFetch(
      new URL(`${pathname}${url.search}`, STORYBOOK_PROJECT_API_ORIGIN),
      init,
    );
  }

  if (currentPageScenario !== "components") {
    const pageResponse = getStorybookPageApiResponse(
      pathname,
      url.searchParams,
      method,
      currentPageScenario,
    );
    if (pageResponse) {
      return new Response(JSON.stringify(pageResponse.body), {
        status: pageResponse.status,
        headers: { "content-type": "application/json" },
      });
    }
  }

  let mockData: unknown;

  if (pathname === "/api/master-data/json") {
    const response = getStorybookPageApiResponse(
      pathname,
      url.searchParams,
      method,
      "populated",
    );
    if (response) {
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }
  } else if (pathname === "/api/master-data/synergy-data") {
    mockData = { effect_rules: [], cross_rules: [] };
  } else if (pathname === "/api/soku-speed-observed/speed-upgrade") {
    mockData = { ok: true, data: {} };
  } else if (pathname === "/api/ship-growth/summary") {
    mockData = { ok: true, periods: [], cumulative_available: false };
  } else if (pathname === "/api/ship-growth/exp") {
    mockData = { ok: true, exp: [] };
  } else if (
    pathname === "/api/ship-growth/bounds" ||
    pathname === "/api/ship-growth/cumulative"
  ) {
    mockData = { ok: true, bounds: [], caps: [] };
  } else if (pathname === "/api/ship-growth/all-periods") {
    mockData = { ok: true, entries: [] };
  } else if (pathname === "/api/api-keys") {
    mockData =
      method === "POST"
        ? { success: true, api_key: { key: "storybook-api-key" } }
        : { success: true, api_keys: [] };
  } else if (pathname === "/api/api-keys/devices") {
    mockData = { success: true, devices: [] };
  } else if (pathname === "/api/api-keys/usage") {
    mockData = { success: true, usage: { remaining: 1000 } };
  } else if (pathname === "/api/fleet/snapshots/list") {
    mockData = {
      ok: true,
      tags: [
        {
          tag: STORYBOOK_SAMPLE_FLEET_TAG,
          uploaded: STORYBOOK_SAMPLE_FLEET_UPLOADED,
          size: JSON.stringify(STORYBOOK_SAMPLE_FLEET).length,
        },
      ],
    };
  } else if (pathname.startsWith("/api/fleet/snapshot/")) {
    mockData = { ok: true, snapshot: STORYBOOK_SAMPLE_FLEET };
  } else if (pathname === "/api/battle-data/global/summary") {
    mockData = {
      periods: [{ period_tag: "latest", table_version: "storybook" }],
    };
  } else if (pathname === "/api/battle-data/global/overview") {
    mockData = { battles: [] };
  } else if (pathname === "/api/battle-data/global/drops") {
    mockData = { battles: [], mst_ships: [] };
  } else if (pathname === "/api/battle-data/global/records") {
    mockData = { records: [] };
  } else if (pathname === "/api/battle-data/detail") {
    mockData = { success: true, battle: {} };
  } else if (pathname === "/api/battle-data/detail-env") {
    mockData = {
      success: true,
      env_uuid: "storybook",
      period_tag: "latest",
      battles: {},
    };
  }

  if (mockData !== undefined) {
    return new Response(JSON.stringify(mockData), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (
    pathname === "/api/asset-sync/weapon-icons" ||
    pathname === "/api/asset-sync/ship-type-icons"
  ) {
    return new Response(null, { status: 204 });
  }

  return nativeFetch(input, init);
};

const hidePageNavigation: NonNullable<Preview["decorators"]>[number] = (
  Story,
  context,
) => {
  const isPageStory = context.title.startsWith("Pages/");
  const pageState = context.parameters["fusouPageState"] as
    | StorybookPageState
    | undefined;
  currentPageScenario = isPageStory
    ? pageState?.scenario ?? "populated"
    : "components";
  const isSimulatorTabManagerStory =
    context.title === "Components/features/simulator/solid/SimulatorTabManager";

  if (isPageStory || isSimulatorTabManagerStory) {
    const url = new URL(window.location.href);
    if (isPageStory) {
      for (const key of pageQueryKeys) url.searchParams.delete(key);
      const storyQuery = { ...(pageState?.query ?? {}) };
      const hasTutorialOverride = [
        "tutorial",
        "hide_tutorial",
        "no_tutorial",
        "tutorial_modal",
        "tutorial_auto",
        "auto_tutorial",
      ].some((key) => key in storyQuery);
      if (!hasTutorialOverride) storyQuery["tutorial_auto"] = "0";
      for (const [key, value] of Object.entries(storyQuery)) {
        url.searchParams.set(key, value);
      }
      window.history.replaceState(window.history.state, "", url);
    }

    sessionStorage.removeItem("__fusouPendingApiPaste");
    sessionStorage.removeItem("__fusouSharedSnapshot");
    if (
      pageState?.simulatorPayload === "fleet"
    ) {
      sessionStorage.setItem(
        "__fusouPendingApiPaste",
        JSON.stringify(STORYBOOK_SAMPLE_FLEET),
      );
    }
  }

  if (context.title === "Pages/simulator") {
    workspaceStore.set(
      pageState?.viewerWorkspace === "sample"
        ? STORYBOOK_SAMPLE_VIEWER_WORKSPACE
        : { activeId: null, entries: [] },
    );
  } else if (isSimulatorTabManagerStory) {
    workspaceStore.set(STORYBOOK_SAMPLE_VIEWER_WORKSPACE);
  }

  document.documentElement.classList.toggle(
    "storybook-page-canvas",
    isPageStory,
  );
  return Story();
};

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    hidePageNavigation,
    withThemeByDataAttribute({
      themes: {
        light: "light",
        dark: "dark",
      },
      defaultTheme: "light",
      attributeName: "data-theme",
    }),
  ],
};

export default preview;
