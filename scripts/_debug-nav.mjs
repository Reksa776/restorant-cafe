import puppeteer from "puppeteer-core";
const BASE = "http://localhost:3001";
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 200)); });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 200)));
page.on("requestfailed", (r) => console.log("REQFAIL:", r.url().slice(0, 120), r.failure()?.errorText));
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#email", { timeout: 15000 });
await page.type("#email", "admin@restobahagia.com");
await page.type("#password", "admin123");
await page.click('button[type="submit"]');
await new Promise(r => setTimeout(r, 3000));
for (const p of ["/admin/inventory", "/admin/reports", "/admin/reports/products", "/admin/reports/payments"]) {
  const t0 = Date.now();
  try {
    await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    console.log(`NAV OK ${p} in ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`NAV FAIL ${p}: ${e.message.slice(0, 120)}`);
  }
  await new Promise(r => setTimeout(r, 2500));
}
await browser.close();