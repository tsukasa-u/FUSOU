// vite.config.ts
import { defineConfig } from "file:///C:/Users/ogu-h/Documents/Github/FUSOU/node_modules/.pnpm/vite@5.3.4_@types+node@20.14.11_lightningcss@1.23.0/node_modules/vite/dist/node/index.js";
import { qwikVite } from "file:///C:/Users/ogu-h/Documents/Github/FUSOU/node_modules/.pnpm/@builder.io+qwik@1.7.0_@types+node@20.14.11_lightningcss@1.23.0_undici@6.19.2/node_modules/@builder.io/qwik/optimizer.mjs";
var vite_config_default = defineConfig({
  // prevent vite from obscuring rust errors
  clearScreen: false,
  // Tauri expects a fixed port, fail if that port is not available
  server: {
    strictPort: true
    // watch: {
    //   ignored: ["**/src-tauri/tests/struct_names"],
    // },
  },
  // to access the Tauri environment variables set by the CLI with information about the current target
  envPrefix: ["VITE_", "TAURI_PLATFORM", "TAURI_ARCH", "TAURI_FAMILY", "TAURI_PLATFORM_VERSION", "TAURI_PLATFORM_TYPE", "TAURI_DEBUG"],
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_PLATFORM == "windows" ? "chrome105" : "safari13",
    // don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG
  },
  plugins: [
    qwikVite({
      csr: true
    }),
    {
      name: "ignore-changes",
      handleHotUpdate({ file, server }) {
        if (file.endsWith("tests/struct_names")) {
          return [];
        }
      }
    }
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxvZ3UtaFxcXFxEb2N1bWVudHNcXFxcR2l0aHViXFxcXEZVU09VXFxcXEZVU09VLUFQUFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcVXNlcnNcXFxcb2d1LWhcXFxcRG9jdW1lbnRzXFxcXEdpdGh1YlxcXFxGVVNPVVxcXFxGVVNPVS1BUFBcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L1VzZXJzL29ndS1oL0RvY3VtZW50cy9HaXRodWIvRlVTT1UvRlVTT1UtQVBQL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcbmltcG9ydCB7IHF3aWtWaXRlIH0gZnJvbSBcIkBidWlsZGVyLmlvL3F3aWsvb3B0aW1pemVyXCI7XG4vLyBpbXBvcnQgdHNjb25maWdQYXRocyBmcm9tICd2aXRlLXRzY29uZmlnLXBhdGhzJztcbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICAgIC8vIHByZXZlbnQgdml0ZSBmcm9tIG9ic2N1cmluZyBydXN0IGVycm9yc1xuICAgIGNsZWFyU2NyZWVuOiBmYWxzZSxcbiAgICAvLyBUYXVyaSBleHBlY3RzIGEgZml4ZWQgcG9ydCwgZmFpbCBpZiB0aGF0IHBvcnQgaXMgbm90IGF2YWlsYWJsZVxuICAgIHNlcnZlcjoge1xuICAgICAgICBzdHJpY3RQb3J0OiB0cnVlLFxuICAgICAgICAvLyB3YXRjaDoge1xuICAgICAgICAvLyAgIGlnbm9yZWQ6IFtcIioqL3NyYy10YXVyaS90ZXN0cy9zdHJ1Y3RfbmFtZXNcIl0sXG4gICAgICAgIC8vIH0sXG4gICAgfSxcbiAgICAvLyB0byBhY2Nlc3MgdGhlIFRhdXJpIGVudmlyb25tZW50IHZhcmlhYmxlcyBzZXQgYnkgdGhlIENMSSB3aXRoIGluZm9ybWF0aW9uIGFib3V0IHRoZSBjdXJyZW50IHRhcmdldFxuICAgIGVudlByZWZpeDogW1wiVklURV9cIiwgXCJUQVVSSV9QTEFURk9STVwiLCBcIlRBVVJJX0FSQ0hcIiwgXCJUQVVSSV9GQU1JTFlcIiwgXCJUQVVSSV9QTEFURk9STV9WRVJTSU9OXCIsIFwiVEFVUklfUExBVEZPUk1fVFlQRVwiLCBcIlRBVVJJX0RFQlVHXCJdLFxuICAgIGJ1aWxkOiB7XG4gICAgICAgIC8vIFRhdXJpIHVzZXMgQ2hyb21pdW0gb24gV2luZG93cyBhbmQgV2ViS2l0IG9uIG1hY09TIGFuZCBMaW51eFxuICAgICAgICB0YXJnZXQ6IHByb2Nlc3MuZW52LlRBVVJJX1BMQVRGT1JNID09IFwid2luZG93c1wiID8gXCJjaHJvbWUxMDVcIiA6IFwic2FmYXJpMTNcIixcbiAgICAgICAgLy8gZG9uJ3QgbWluaWZ5IGZvciBkZWJ1ZyBidWlsZHNcbiAgICAgICAgbWluaWZ5OiAhcHJvY2Vzcy5lbnYuVEFVUklfREVCVUcgPyBcImVzYnVpbGRcIiA6IGZhbHNlLFxuICAgICAgICAvLyBwcm9kdWNlIHNvdXJjZW1hcHMgZm9yIGRlYnVnIGJ1aWxkc1xuICAgICAgICBzb3VyY2VtYXA6ICEhcHJvY2Vzcy5lbnYuVEFVUklfREVCVUcsXG4gICAgfSxcbiAgICBwbHVnaW5zOiBbXG4gICAgICAgIHF3aWtWaXRlKHtcbiAgICAgICAgICAgIGNzcjogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdpZ25vcmUtY2hhbmdlcycsXG4gICAgICAgICAgICBoYW5kbGVIb3RVcGRhdGUoeyBmaWxlLCBzZXJ2ZXIgfSkge1xuICAgICAgICAgICAgICAgIGlmIChmaWxlLmVuZHNXaXRoKCd0ZXN0cy9zdHJ1Y3RfbmFtZXMnKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICBdXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBNlUsU0FBUyxvQkFBb0I7QUFDMVcsU0FBUyxnQkFBZ0I7QUFHekIsSUFBTyxzQkFBUSxhQUFhO0FBQUE7QUFBQSxFQUV4QixhQUFhO0FBQUE7QUFBQSxFQUViLFFBQVE7QUFBQSxJQUNKLFlBQVk7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUloQjtBQUFBO0FBQUEsRUFFQSxXQUFXLENBQUMsU0FBUyxrQkFBa0IsY0FBYyxnQkFBZ0IsMEJBQTBCLHVCQUF1QixhQUFhO0FBQUEsRUFDbkksT0FBTztBQUFBO0FBQUEsSUFFSCxRQUFRLFFBQVEsSUFBSSxrQkFBa0IsWUFBWSxjQUFjO0FBQUE7QUFBQSxJQUVoRSxRQUFRLENBQUMsUUFBUSxJQUFJLGNBQWMsWUFBWTtBQUFBO0FBQUEsSUFFL0MsV0FBVyxDQUFDLENBQUMsUUFBUSxJQUFJO0FBQUEsRUFDN0I7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNMLFNBQVM7QUFBQSxNQUNMLEtBQUs7QUFBQSxJQUNULENBQUM7QUFBQSxJQUNEO0FBQUEsTUFDSSxNQUFNO0FBQUEsTUFDTixnQkFBZ0IsRUFBRSxNQUFNLE9BQU8sR0FBRztBQUM5QixZQUFJLEtBQUssU0FBUyxvQkFBb0IsR0FBRztBQUNyQyxpQkFBTyxDQUFDO0FBQUEsUUFDWjtBQUFBLE1BQ0o7QUFBQSxJQUNKO0FBQUEsRUFDSjtBQUNKLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
