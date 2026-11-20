import { fileURLToPath } from "node:url";
import { react, solid } from "@storybook-astro/framework/integrations";
import { resolveLatestFusouVersion } from "../scripts/resolve-latest-fusou-version.mjs";

function rewriteAstroScriptSources(html: string) {
  return html.replace(
    /(<script\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/gi,
    (match, opening: string, source: string, closing: string) => {
      const decodedSource = source.replaceAll("&amp;", "&");
      let viteUrl: string;

      if (/^[A-Za-z]:[\\/]/.test(decodedSource)) {
        const pathEnd = decodedSource.search(/[?#]/);
        const filePath =
          pathEnd < 0 ? decodedSource : decodedSource.slice(0, pathEnd);
        const queryAndHash =
          pathEnd < 0 ? "" : decodedSource.slice(pathEnd);
        viteUrl = `/@fs/${filePath.replace(/\\/g, "/")}${queryAndHash}`;
      } else if (decodedSource.startsWith("file://")) {
        const fileUrl = new URL(decodedSource);
        const filePath = fileURLToPath(fileUrl).replace(/\\/g, "/");
        viteUrl = `/@fs/${filePath}${fileUrl.search}${fileUrl.hash}`;
      } else {
        return match;
      }

      return `${opening}${viteUrl.replace(/&/g, "&amp;")}${closing}`;
    },
  );
}

const config = {
  stories: ["../src/stories/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-themes",
  ],
  framework: {
    name: "@storybook-astro/framework",
    options: {
      integrations: [
        react({ include: ["**/react/**/*.{js,jsx,ts,tsx}"] }),
        solid({ include: ["**/solid/**", "**/storybook-fixtures.tsx"] }),
      ],
    },
  },
  docs: {
    autodocs: true,
  },
  viteFinal: async (config) => {
    return {
      ...config,
      plugins: [
        ...(config.plugins ?? []),
        {
          name: "fusou-storybook-astro-script-sources",
          configureServer(server) {
            return () => {
              const send = server.ws.send.bind(server.ws);
              server.ws.send = (event, payload, ...rest) => {
                if (
                  event === "astro:render:response" &&
                  typeof payload === "object" &&
                  payload !== null &&
                  "html" in payload &&
                  typeof payload.html === "string"
                ) {
                  return send(
                    event,
                    {
                      ...payload,
                      html: rewriteAstroScriptSources(payload.html),
                    },
                    ...rest,
                  );
                }

                return send(event, payload, ...rest);
              };
            };
          },
        },
      ],
      define: {
        ...config.define,
        __FUSOU_APP_VERSION__: JSON.stringify(resolveLatestFusouVersion()),
      },
    };
  },
};

export default config;
