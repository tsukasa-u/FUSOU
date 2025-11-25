import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

// import terser from "@rollup/plugin-terser";
// import { minifyTemplateLiterals } from "rollup-plugin-minify-template-literals";
import summary from "rollup-plugin-summary";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "index",
      fileName: "index",
      formats: ["es"],
    },
    cssCodeSplit: true,
    sourcemap: true,
    emptyOutDir: false,
    rollupOptions: {
      external: /^lit/,
      plugins: [
        // minifyTemplateLiterals(),
        // terser(),
        summary(),
      ],
    },
  },
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@ipc-bindings": resolve(__dirname, "../kc_api/bindings"),
      "@fusou-testdata-shared-ui": resolve(
        __dirname,
        "../../../FUSOU-TESTDATA/storybook/shared-ui"
      ),
    },
  },
});
