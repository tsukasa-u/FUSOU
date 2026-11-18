import Page from "../../../pages/dashboard/api-keys.astro";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { pageState } from "../../storybook-page-state";

export default {
  title: "Pages/dashboard/api-keys",
  component: Page,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = {
  args: {
    "storybook": true
  },
  parameters: pageState(),
};

export const Empty = {
  args: {
    storybook: true,
  },
  parameters: pageState({ scenario: "empty" }),
};

export const RequestError = {
  args: {
    storybook: true,
  },
  parameters: pageState({ scenario: "error" }),
};

export const CreateKey = {
  args: {
    storybook: true,
  },
  parameters: pageState({ scenario: "empty" }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Create New Key" }));
    await waitFor(() => {
      expect(canvas.getByText("API Key Created")).toBeVisible();
    });
  },
};
