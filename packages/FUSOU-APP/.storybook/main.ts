import { mergeConfig } from "vite";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import type { StorybookConfig } from "storybook-solidjs-vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default <StorybookConfig>{
  framework: "storybook-solidjs-vite",
  addons: [
    "@storybook/addon-onboarding",
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-links",
    "@chromatic-com/storybook",
    "@storybook/addon-themes",
    {
      name: "@storybook/addon-vitest",
      options: {
        cli: false,
      },
    },
  ],
  stories: [
    "../**/stories/**/*.mdx",
    "../**/stories/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  async viteFinal(config) {
    return mergeConfig(config, {
      define: {
        "process.env": {},
      },
      resolve: {
        alias: {
          "shared-ui": resolve(__dirname, "../../shared-ui"),
        },
      },
    });
  },
  docs: {
    autodocs: true,
  },
  typescript: {
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      // 👇 Default prop filter, which excludes props from node_modules
      propFilter: (prop: any) =>
        prop.parent ? !/node_modules/.test(prop.parent.fileName) : true,
    },
  },
};
