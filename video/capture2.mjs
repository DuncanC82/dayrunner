import { chromium } from "playwright-core"; import fs from "fs";
const EXE = process.env.HOME + "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const S = JSON.parse(fs.readFileSync("./.sessions.json")); const BASE = "https://duncanc82.github.io/dayrunner/"; const KEY = "sb-tylttoheoazyvbuixrrk-auth-token";
const browser = await chromium.launch({ executablePath: EXE, headless: true });
async function ctxFor(sess) { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" }); await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [KEY, JSON.stringify(sess)]); return ctx; }
async function shot(page, name, wait = 900) { await page.waitForTimeout(wait); await page.screenshot({ path: `shots/${name}.png` }); console.log("shot", name); }
if (false) {
  await page.goto(BASE + "#/app"); await page.waitForSelector("h1:has-text('Remarkables')"); await page.waitForTimeout(2500);
  const btn = page.locator(".exc button:has-text('Resolved')").first(); await btn.hover(); await shot(page, "03_exception_hover", 300); await btn.click(); await shot(page, "04_exception_resolved", 1500);
  await ctx.close(); }
{ const ctx = await ctxFor(S.charter); const page = await ctx.newPage();
  await page.goto(BASE + "#/app/guide"); await page.waitForTimeout(3000);
  const rd = page.locator("button:has-text('Re-draft driver briefs')").first(); if (await rd.count()) { await rd.click(); await page.waitForTimeout(6000); }
  await shot(page, "11_runsheet_charter_briefs");
  const sel = page.locator("select").first(); const opts = await sel.locator("option").allTextContents(); console.log("options", opts);
  const tourOpt = opts.find(o => /Southern Circuit/i.test(o)); if (tourOpt) { await sel.selectOption({ label: tourOpt }); await page.waitForTimeout(2500); await shot(page, "12_daysheet_charter"); }
  await ctx.close(); }
await browser.close();
