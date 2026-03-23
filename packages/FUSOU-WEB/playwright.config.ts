import { defineConfig, devices } from "playwright/test";

function parseRequiredBaseUrl(raw: string | undefined): URL {
  if (!raw) {
    throw new Error(
      "PLAYWRIGHT_BASE_URL is required (example: http://127.0.0.1:4401)."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`PLAYWRIGHT_BASE_URL is invalid: ${raw}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      `PLAYWRIGHT_BASE_URL must use http/https protocol: ${parsed.protocol}`
    );
  }

  if (!parsed.port) {
    throw new Error(
      "PLAYWRIGHT_BASE_URL must include an explicit port (example: http://127.0.0.1:4401)."
    );
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error(
      `PLAYWRIGHT_BASE_URL must be an origin without path, got pathname: ${parsed.pathname}`
    );
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Boolean environment variable must be 'true' or 'false', got: ${value}`);
}

const baseUrl = parseRequiredBaseUrl(process.env.PLAYWRIGHT_BASE_URL);
const readinessPath = process.env.PLAYWRIGHT_READINESS_PATH ?? "/simulator";
const reuseExistingServer = parseBoolean(
  process.env.PLAYWRIGHT_REUSE_SERVER,
  !process.env.CI
);
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
  `pnpm astro dev --host ${baseUrl.hostname} --port ${baseUrl.port} --strictPort`;
const webServerReadyUrl = new URL(readinessPath, baseUrl.origin).toString();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: baseUrl.origin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: webServerCommand,
    url: webServerReadyUrl,
    timeout: 120_000,
    reuseExistingServer,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
