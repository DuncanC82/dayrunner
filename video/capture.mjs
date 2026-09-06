import { chromium } from "playwright-core"; import fs from "fs";
const EXE = process.env.HOME + "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const S = JSON.parse(fs.readFileSync("./.sessions.json")); const BASE = "https://duncanc82.github.io/dayrunner/";
const KEY = "sb-tylttoheoazyvbuixrrk-auth-token"; fs.mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({ executablePath: EXE, headless: true });
async function ctxFor(sess) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
  await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [KEY, JSON.stringify(sess)]);
  return ctx;
}
async function shot(page, name, opts = {}) { await page.waitForTimeout(opts.wait ?? 800); await page.screenshot({ path: `shots/${name}.png` }); console.log("shot", name); }
async function scrollTo(page, text) { const h = page.locator(`h2:has-text("${text}")`).first(); await h.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -24)); }

// ---- fleet demo (Remarkables) ----
{
  const ctx = await ctxFor(S.fleet); const page = await ctx.newPage();
  await page.goto(BASE + "#/app"); await page.waitForSelector("h1:has-text('Remarkables')", { timeout: 30000 }); await page.waitForTimeout(2500);
  await page.mouse.move(700, 300);
  await shot(page, "01_day_top");
  await scrollTo(page, "Decide before the day"); await shot(page, "02_exceptions");
  // resolve the first exception by picking an option (button/span in .exc .opts)
  const firstOpt = page.locator(".exc .opts button, .exc .opts span").first();
  if (await firstOpt.count()) { await firstOpt.hover(); await shot(page, "03_exception_hover", { wait: 300 }); await firstOpt.click(); await shot(page, "04_exception_resolved", { wait: 1200 }); }
  await scrollTo(page, "Allocation"); await shot(page, "05_allocation");
  await scrollTo(page, "Guest messages"); await shot(page, "06_messages");
  const approve = page.locator("button:has-text('Approve all')").first();
  if (await approve.count()) { await approve.click(); await shot(page, "07_messages_approved", { wait: 1500 }); }
  await page.goto(BASE + "#/app/guide"); await page.waitForTimeout(3000); await shot(page, "10_runsheet_fleet");
  await ctx.close();
}
// ---- charter demo (Kea) ----
{
  const ctx = await ctxFor(S.charter); const page = await ctx.newPage();
  await page.goto(BASE + "#/app"); await page.waitForSelector("h1", { timeout: 30000 }); await page.waitForTimeout(2500);
  await scrollTo(page, "Supplier confirmations"); await shot(page, "08_suppliers");
  const whole = page.locator("button:has-text('Whole tour')").first(); if (await whole.count()) { await whole.click(); await shot(page, "09_suppliers_whole_tour", { wait: 1200 }); }
  await page.goto(BASE + "#/app/guide"); await page.waitForTimeout(3000); await shot(page, "11_daysheet_charter");
  await page.goto(BASE + "#/app/tours"); await page.waitForTimeout(3000); await shot(page, "12_tours");
  await ctx.close();
}
await browser.close();
