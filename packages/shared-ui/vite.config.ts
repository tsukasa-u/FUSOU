import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

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
    },
  },
  plugins: [tailwindcss()],
});
