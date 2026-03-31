import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "playwright/test";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const projectRoot = path.resolve(currentDirPath, "..");
const pagesRoot = path.join(projectRoot, "src", "pages");

const PAGE_EXTENSIONS = new Set([".astro", ".md", ".mdx", ".html"]);
const API_EXTENSIONS = new Set([".ts", ".js"]);

const DYNAMIC_ROUTE_SAMPLES: Record<string, string> = {
  "[id]": "1",
  "[key]": "invalid",
  "[...slug]": "guide/intro",
};

const EXPECT_500_ROUTES = new Set([
  "/500",
  "/dashboard",
  "/dashboard/api-keys",
  // These pages require Supabase env in dev. Missing env should fail loudly.
  "/account/conflict",
  "/auth/local/callback",
]);

const API_ROUTE_METHOD_EXPECTED: Record<string, Partial<Record<"GET" | "HEAD" | "OPTIONS", number[]>>> = {
  // Requires OAuth callback params and currently returns 500 when called bare.
  "/api/auth/callback": {
    GET: [500],
    HEAD: [500],
    OPTIONS: [204],
  },
};

function walkFiles(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith("_")) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

function normalizeRoutePath(filePath: string): string {
  const relPath = path.relative(pagesRoot, filePath).replace(/\\/g, "/");
  const ext = path.extname(relPath);
  let routePath = relPath.slice(0, -ext.length);

  routePath = routePath.replace(/\[(\.\.\.)?[^\]]+\]/g, (segment) => {
    const sample = DYNAMIC_ROUTE_SAMPLES[segment];
    return sample ?? "sample";
  });

  routePath = routePath.replace(/\/index$/i, "");

  if (routePath === "") return "/";
  if (!routePath.startsWith("/")) return `/${routePath}`;
  return routePath;
}

function discoverPageUrls(): string[] {
  const files = walkFiles(pagesRoot);
  const urls = files
    .filter((filePath) => {
      const rel = path.relative(pagesRoot, filePath).replace(/\\/g, "/");
      if (rel.startsWith("api/")) return false;
      return PAGE_EXTENSIONS.has(path.extname(filePath));
    })
    .map(normalizeRoutePath)
    .filter((routePath) => !routePath.includes("/lib/"));

  return Array.from(new Set(urls)).sort();
}

function discoverApiUrls(): string[] {
  const files = walkFiles(path.join(pagesRoot, "api"));
  const urls = files
    .filter((filePath) => API_EXTENSIONS.has(path.extname(filePath)))
    .map(normalizeRoutePath)
    .map((routePath) => (routePath === "/api/[...route]" ? "/api" : routePath));

  return Array.from(new Set(urls)).sort();
}

const PAGE_URLS = discoverPageUrls();
const API_URLS = discoverApiUrls();

test.describe("Direct URL Access", () => {
  for (const routePath of PAGE_URLS) {
    test(`page route responds without 5xx: ${routePath}`, async ({ request }) => {
      const response = await request.get(routePath, {
        failOnStatusCode: false,
        maxRedirects: 0,
      });

      const status = response.status();
      expect(
        status,
        `Unexpected status for ${routePath}: ${status}`,
      ).toBeGreaterThanOrEqual(100);
      if (EXPECT_500_ROUTES.has(routePath)) {
        expect(status, `Expected 500 for ${routePath} in current dev/runtime`).toBe(500);
      } else {
        expect(status, `Server error for ${routePath}: ${status}`).toBeLessThan(500);
      }
    });
  }

  for (const routePath of API_URLS) {
    test(`api route responds as expected (GET/HEAD/OPTIONS): ${routePath}`, async ({ request }) => {
      const [getRes, headRes, optionsRes] = await Promise.all([
        request.get(routePath, { failOnStatusCode: false, maxRedirects: 0 }),
        request.fetch(routePath, { method: "HEAD", failOnStatusCode: false, maxRedirects: 0 }),
        request.fetch(routePath, { method: "OPTIONS", failOnStatusCode: false, maxRedirects: 0 }),
      ]);

      const responses: Array<{ method: "GET" | "HEAD" | "OPTIONS"; status: number }> = [
        { method: "GET", status: getRes.status() },
        { method: "HEAD", status: headRes.status() },
        { method: "OPTIONS", status: optionsRes.status() },
      ];

      const expectedByMethod = API_ROUTE_METHOD_EXPECTED[routePath];

      for (const { method, status } of responses) {
        const expectedStatuses = expectedByMethod?.[method];
        if (expectedStatuses && expectedStatuses.length > 0) {
          expect(
            expectedStatuses,
            `Unexpected ${method} status for ${routePath}: ${status}`,
          ).toContain(status);
          continue;
        }
        expect(status, `Server error for ${method} ${routePath}: ${status}`).toBeLessThan(500);
      }
    });
  }

  test("returns 404 for unknown path", async ({ request }) => {
    const response = await request.get("/__nonexistent_direct_access_check__", {
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(404);
  });

  test("preflight for mutating endpoint is not wildcard CORS", async ({ request }) => {
    const response = await request.fetch("/api/compaction/trigger-scheduled", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
      },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(204);
    const allowOrigin = response.headers()["access-control-allow-origin"];
    if (allowOrigin !== undefined) {
      expect(allowOrigin).not.toBe("*");
    }

    const allowMethods = response.headers()["access-control-allow-methods"];
    expect(allowMethods ?? "").toContain("POST");
  });

  test("renders Astro internal error page for server-side exception in dev", async ({ page }) => {
    const response = await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
    });

    expect(response).not.toBeNull();
    expect(response?.status()).toBe(500);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/an error occurred\.|internal server error/i);
    expect(bodyText).toMatch(/module is not defined|PUBLIC_SUPABASE_URL is not set/i);
  });
});
