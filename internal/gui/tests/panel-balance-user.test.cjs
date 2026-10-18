// Run with Node's test runner and Playwright on the module path; see README.md.
// Two balances under one provider (sub2api's accounts WaWa and YunDou,
// broven/magpie-sub2api#4): the menu bar panel's Usage tab titled a
// balance's card with its provider's name alone, so both read "sub2api".
// Each card now names its account under the provider's logo and name, by
// the name the user gave it before the account itself, as an account's
// card does; a balance without a user stays its provider's name alone.
// Hide accounts blurs the name on the card. Every language, Chromium and
// WebKit; no backend, the API is faked here.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");

const assets = path.resolve(__dirname, "../assets");
const quotas = [
  { provider: "sub2api-a", name: "sub2api", icon: "generic", user: "WaWa", windows: [], balance: "$12.30" },
  { provider: "sub2api-a", name: "sub2api", icon: "generic", user: "yundou@example.com", alias: "YunDou", windows: [], balance: "$4.56" },
  { provider: "deepseek", name: "DeepSeek", icon: "deepseek-color", windows: [], balance: "¥88.00" },
];
const LANGS = ["en", "zh", "zh-TW", "ja", "de"];

function serve(lang) {
  const settings = { theme: "light", lang, tray: "panel", quotaLeft: false, currency: "usd" };
  return async (route) => {
    const url = new URL(route.request().url());
    const json = (data) => route.fulfill({ json: data });
    if (url.pathname === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"light",web:false};` });
    if (url.pathname === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: [], profiles: [], settings });
    if (url.pathname === "/api/settings") return json(settings);
    if (url.pathname === "/api/usage/quotas") return json(quotas);
    if (url.pathname === "/api/groups") return json({ groups: [], models: [] });
    if (url.pathname === "/api/plugins") return json({ plugins: [] });
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    try { await route.fulfill({ body: await fs.readFile(file), contentType }); } catch { await route.fulfill({ status: 404, body: "" }); }
  };
}

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  for (const lang of LANGS) {
    test(`${engine} ${lang}: two balances under one provider each name their account`, async (t) => {
      const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
      const page = await (await browser.newContext({ viewport: { width: 440, height: 600 }, reducedMotion: "reduce" })).newPage();
      t.after(async () => {
        if (process.env.ARTIFACT_DIR) {
          await fs.mkdir(process.env.ARTIFACT_DIR, { recursive: true });
          await page.screenshot({ path: path.join(process.env.ARTIFACT_DIR, `${engine}-${lang}-panel-balance-user.png`) });
        }
        await browser.close();
      });
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", serve(lang));
      await page.goto("http://magpie.test/?mode=panel");
      await page.evaluate(() => setPanelTab("usage"));
      await page.locator("#panelQuota .pq-card.bal").nth(2).waitFor();
      const cards = await page.locator("#panelQuota .pq-card.bal").evaluateAll((cs) => cs.map((c) => ({
        name: c.querySelector(".pq-bn").textContent,
        user: c.querySelector(".pq-user")?.textContent ?? null,
        amount: c.querySelector(".pq-amt").textContent,
      })));
      assert.deepEqual(cards, [
        { name: "sub2api", user: "WaWa", amount: "$12.30" },
        { name: "sub2api", user: "YunDou", amount: "$4.56" },
        { name: "DeepSeek", user: null, amount: "¥88.00" },
      ]);
      // the account's name is on the card, not cut off
      const cut = await page.locator("#panelQuota .pq-card.bal .pq-user").evaluateAll((us) => us.filter((u) => u.scrollWidth > u.clientWidth).length);
      assert.equal(cut, 0);
      assert.deepEqual(errors, []);
    });
  }

  test(`${engine}: Hide accounts blurs a balance's account on its card`, async (t) => {
    const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
    t.after(() => browser.close());
    const ctx = await browser.newContext({ viewport: { width: 440, height: 600 }, reducedMotion: "reduce" });
    await ctx.addInitScript(() => { try { localStorage.setItem("magpie.maskEmails", "1"); } catch {} });
    const page = await ctx.newPage();
    page.setDefaultTimeout(5000);
    await page.route("**/*", serve("en"));
    await page.goto("http://magpie.test/?mode=panel");
    await page.evaluate(() => setPanelTab("usage"));
    await page.waitForFunction(() => [...document.querySelectorAll("#panelQuota .pq-card.bal .pq-user .pii")].map((e) => e.dataset.raw).join() === "WaWa,YunDou");
    const shown = await page.locator("#panelQuota .pq-card.bal .pq-user").allTextContents();
    assert.ok(shown.every((s) => s !== "WaWa" && s !== "YunDou"), shown.join());
  });
}
