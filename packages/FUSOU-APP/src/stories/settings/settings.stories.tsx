import { fn } from "storybook/test";

import { SettingsComponent } from "../../components/settings/settings.tsx";

export default {
  title: "components/settings/settings",
  component: SettingsComponent,
  tags: ["autodocs"],
  // Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
  args: { onClick: fn() },
};

export const WithDecorator = {
  args: {},
  decorators: [
    (Story: any, context: any) => {
      return <Story {...context.args} />;
    },
  ],
};
