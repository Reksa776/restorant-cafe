// Admin E2E: /admin/tables — per-table customer link, QR modal with
// Copy Link / Buka Link / Download QR, QR payload origin consistency.
import puppeteer from "puppeteer-core";
import { createConnection } from "mysql2/promise";

const BASE = "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const conn = await createConnection({ host: "localhost", port: 3306, user: "root", password: "", database: "restaurant_app" });
const [[table1]] = await conn.query("SELECT id, number, name FROM `Table` WHERE number = 1");

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", defaultViewport: { width: 1440, height: 950 }, args: ["--no-sandbox"] });
await browser.defaultBrowserContext().overridePermissions(BASE, ["clipboard-read", "clipboard-write"]);
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 250)));
let qrRequestBaseUrl = null;
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/qr")) {
    try { qrRequestBaseUrl = JSON.parse(req.postData() || "{}").baseUrl || null; } catch {}
  }
});

const waitText = async (text, timeout = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate((t) => (document.body.innerText || "").includes(t), text)) return true;
    await sleep(300);
  }
  return false;
};

// ---- Login as admin ----
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await page.type('input[type="email"]', "admin@restobahagia.com", { delay: 10 });
await page.type('input[type="password"]', "admin123", { delay: 10 });
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Masuk");
  if (btn) btn.click();
});
let loggedIn = false;
for (let i = 0; i < 40; i++) {
  if (page.url().includes("/admin")) { loggedIn = true; break; }
  await sleep(400);
}
check("Admin login", loggedIn, page.url());

// ---- /admin/tables ----
await page.goto(`${BASE}/admin/tables`, { waitUntil: "networkidle2" });
check("Tables page loads", await waitText("Table 01"));
const cardInfo = await page.evaluate(() => {
  const card = [...document.querySelectorAll('[data-slot="card"]')].find(
    (c) => (c.textContent || "").includes("Table 01") && c.querySelector("button")
  );
  if (!card) return null;
  const text = card.innerText;
  return {
    hasNumber: text.includes("Meja Nomor 1"),
    hasCapacity: text.includes("Kapasitas"),
    link: [...card.querySelectorAll("p")].find((p) => /localhost:3000\/t\/1/.test(p.textContent || ""))?.textContent || "",
    buttons: [...card.querySelectorAll("button")].map((b) => (b.textContent || "").trim().replace(/\s+/g, " ")),
    hasStatus: /Tersedia|Terisi|Maintenance/.test(text),
  };
});
check("Card shows meja number + capacity + status", cardInfo && cardInfo.hasNumber && cardInfo.hasCapacity && cardInfo.hasStatus, JSON.stringify(cardInfo && { hasNumber: cardInfo.hasNumber, hasCapacity: cardInfo.hasCapacity, hasStatus: cardInfo.hasStatus }));
check("Card shows customer link {origin}/t/1", !!cardInfo && /http:\/\/localhost:3000\/t\/1/.test(cardInfo.link), cardInfo?.link);
check("Card has QR + Copy Link actions", !!cardInfo && cardInfo.buttons.some((b) => b.includes("QR")) && cardInfo.buttons.some((b) => b.includes("Copy Link")), JSON.stringify(cardInfo?.buttons));

// ---- Open QR modal for Table 01 ----
await page.evaluate(() => {
  const card = [...document.querySelectorAll('[data-slot="card"]')].find(
    (c) => (c.textContent || "").includes("Table 01") && c.querySelector("button")
  );
  if (!card) return;
  const btn = [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("QR"));
  if (btn) btn.click();
});
check("QR modal opens with generated image", await waitText("Buka Link", 20000));
await sleep(800);
const modal = await page.evaluate(() => {
  const root = document.querySelector('[role="dialog"]') || document.body;
  const imgs = [...root.querySelectorAll("img")].filter((i) => (i.src || "").startsWith("data:image/png"));
  const qr = imgs[imgs.length - 1];
  const links = [...root.querySelectorAll("a")];
  const openLink = links.find((a) => (a.textContent || "").includes("Buka Link"));
  const dlBtn = [...root.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Download QR"));
  return {
    hasQrImg: !!qr,
    qrSrcLen: qr ? qr.src.length : 0,
    modalText: root.innerText.slice(-1200),
    openHref: openLink ? openLink.href : null,
    openTarget: openLink ? openLink.target : null,
    hasDlBtn: !!dlBtn,
  };
});
check("Modal shows QR PNG", modal.hasQrImg && modal.qrSrcLen > 1000, `srcLen=${modal.qrSrcLen}`);
check("Modal shows full customer link", /http:\/\/localhost:3000\/t\/1/.test(modal.modalText));
check("Buka Link points to full URL (new tab)", modal.openHref === `${BASE}/t/1` && modal.openTarget === "_blank", `href=${modal.openHref}`);
check("Download QR button available in modal", modal.hasDlBtn, "");
check("QR endpoint received baseUrl = admin origin", qrRequestBaseUrl === BASE || qrRequestBaseUrl === `${BASE}/`, `baseUrl=${qrRequestBaseUrl}`);
await page.screenshot({ path: "shots/admin-table-qr-modal.png" });

// ---- Copy Link ----
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("Copy Link"));
  if (btn) btn.click();
});
await sleep(600);
let clip = "";
try { clip = await page.evaluate(() => navigator.clipboard.readText()); } catch (e) { clip = "ERR:" + String(e).slice(0, 80); }
check("Copy Link puts full URL on clipboard", clip === `${BASE}/t/1`, `clipboard=${clip}`);

// ---- Open Link opens the customer page ----
const popupPromise = new Promise((resolve) => page.once("popup", (p) => resolve(p)));
await page.evaluate(() => {
  const a = [...document.querySelectorAll("a")].find((x) => (x.textContent || "").includes("Buka Link"));
  if (a) a.click();
});
const popup = await Promise.race([popupPromise, sleep(15000).then(() => null)]);
await sleep(2000);
const popupUrl = popup ? popup.url() : null;
check("Buka Link opens /t/1 customer page", popupUrl !== null && popupUrl.includes("/t/1"), `popup=${popupUrl}`);
if (popup) {
  const popText = await popup.evaluate(() => document.body.innerText);
  check("Customer page shows Meja 1 + welcome", popText.includes("Selamat Datang") && popText.includes("Meja 1"));
  await popup.close();
}

// ---- QR persisted server-side ----
const [[dbRow]] = await conn.query("SELECT qrCode FROM `Table` WHERE id = ?", [table1.id]);
check("QR data URL persisted to table row", !!dbRow.qrCode && dbRow.qrCode.startsWith("data:image/png"), `len=${dbRow.qrCode?.length ?? 0}`);

// ---- Screenshot whole tables page ----
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Tutup"); if (b) b.click(); });
await sleep(500);
await page.screenshot({ path: "shots/admin-tables-page.png" });

await browser.close();
await conn.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks PASSED ====`);
if (failed.length) console.log("FAILED:", failed.map((f) => f.name).join(" | "));
