import type { Preview } from "@storybook/web-components-vite";
import "../src/index.css";
import { withThemeByDataAttribute } from "@storybook/addon-themes";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;

export const decorators = [
  withThemeByDataAttribute({
    themes: {
      light: "light",
      dark: "dark",
      retro: "retro",
    },
    defaultTheme: "light",
    attributeName: "data-mode",
  }),
];
