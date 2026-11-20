import Page from "../../../pages/battles/index.astro";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { pageState } from "../../storybook-page-state";

export default {
  title: "Pages/battles",
  component: Page,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = {
  args: {},
  parameters: pageState(),
};

export const Detail = {
  args: {},
  parameters: pageState({
    query: {
      tab: "detail",
      detail_id: "storybook-sortie-001",
      battle_index: "0",
      period_tag: "2026-02-13",
      table_version: "0.7.0",
    },
  }),
};

export const MapFlow = {
  args: {},
  parameters: pageState({ query: { tab: "map-flow" } }),
};

export const Statistics = {
  args: {},
  parameters: pageState({ query: { tab: "stats" } }),
};

export const Drops = {
  args: {},
  parameters: pageState({ query: { tab: "drops" } }),
};

export const RankSFilter = {
  args: {},
  parameters: pageState({ query: { result_filter: "S" } }),
};

export const Empty = {
  args: {},
  parameters: pageState({ scenario: "empty" }),
};

export const RequestError = {
  args: {},
  parameters: pageState({ scenario: "error" }),
};

export const TutorialGuide = {
  args: {},
  parameters: pageState(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "操作説明を開く" }),
    );
    await waitFor(() => {
      expect(canvas.getByRole("dialog")).toBeVisible();
    });
  },
};

export const LegacyStatsRoute = {
  args: {},
  parameters: {
    ...pageState({ query: { tab: "stats" } }),
    docs: {
      description: {
        story: "The legacy /battles/stats route resolves to the Statistics state.",
      },
    },
  },
};

export const LegacyMapFlowRoute = {
  args: {},
  parameters: {
    ...pageState({ query: { tab: "map-flow" } }),
    docs: {
      description: {
        story: "The legacy /battles/map-flow route resolves to the MapFlow state.",
      },
    },
  },
};

export const LegacyBattleDetailRoute = {
  args: {},
  parameters: {
    ...pageState({
      query: {
        tab: "detail",
        detail_id: "storybook-sortie-001",
        battle_index: "0",
        period_tag: "2026-02-13",
        table_version: "0.7.0",
      },
    }),
    docs: {
      description: {
        story: "A legacy battle ID route resolves to this selected battle detail.",
      },
    },
  },
};
