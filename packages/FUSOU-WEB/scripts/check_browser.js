import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
const warnings = [];
page.on("console", msg => {
  if (msg.type() === "error") errors.push(msg.text());
  if (msg.type() === "warning") warnings.push(msg.text());
});
page.on("pageerror", err => errors.push("PAGEERROR: " + err.message));
page.on("requestfailed", req => {
  const url = req.url();
  if (!url.includes("hot-update") && !url.includes("livereload")) {
    errors.push("REQFAILED: " + (req.failure() && req.failure().errorText) + " " + url);
  }
});
await page.goto("http://localhost:4321/simulator", { waitUntil: "networkidle", timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));
console.log("ERRORS:", JSON.stringify(errors));
console.log("WARNINGS:", JSON.stringify(warnings.slice(0, 5)));
const statusText = await page.$eval('[data-testid="master-data-status"]', el => el.textContent).catch(() => null);
console.log("STATUS:", statusText);
await browser.close();
