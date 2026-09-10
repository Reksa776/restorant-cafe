import puppeteer from "puppeteer-core";
const BASE = "http://localhost:3001";
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const page = await browser.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#email", { timeout: 15000 });
await page.type("#email", "admin@restobahagia.com");
await page.type("#password", "admin123");
await page.click('button[type="submit"]');
await new Promise(r => setTimeout(r, 3000));
await page.goto(`${BASE}/admin/reports/purchases`, { waitUntil: "domcontentloaded" });
await new Promise(r => setTimeout(r, 3000));
const info = await page.evaluate(() => {
  const triggers = Array.from(document.querySelectorAll('[data-slot="select-trigger"]'));
  return {
    count: triggers.length,
    texts: triggers.map(t => (t.textContent || "").trim()),
    bodyHasBranch: document.body.innerText.includes("Semua Cabang"),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
