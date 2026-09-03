// E2E: DINE-IN checkout — show Meja + guest count, NO Pajak/Service rows,
// subtotal = total everywhere (UI, DB, iPaymu amount).
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
const [[table]] = await conn.query("SELECT id, restaurantId, number FROM `Table` WHERE number = 1");
const [[caffe]] = await conn.query("SELECT id, price FROM Product WHERE name = 'Minuman Caffe 1' AND isActive = 1");
const [[esteh]] = await conn.query("SELECT id, price FROM Product WHERE name = 'Es Teh' AND isActive = 1");

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", defaultViewport: { width: 1280, height: 900 }, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
let orderNumber = null, paymentAmount = null;
page.on("response", async (res) => {
  try {
    if (res.url().endsWith("/public/orders") && res.request().method() === "POST") {
      orderNumber = (await res.json())?.data?.orderNumber || null;
    }
    if (res.url().endsWith("/public/payments") && res.request().method() === "POST") {
      const j = await res.json();
      paymentAmount = j?.data?.amount ?? null;
    }
  } catch {}
});

const waitText = async (text, timeout = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate((t) => (document.body.innerText || "").includes(t), text)) return true;
    await sleep(300);
  }
  return false;
};

// --- QR landing (TEST1-2) ---
await page.goto(`${BASE}/t/1`, { waitUntil: "networkidle2" });
check("TEST1: /t/1 shows Meja 1 + welcome", await waitText("Selamat Datang") && await waitText("Meja 1"));
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].filter((x) => (x.textContent || "").trim() === "+")[0]; if (b) b.click(); });
await sleep(200);
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].filter((x) => (x.textContent || "").trim() === "+")[0]; if (b) b.click(); });
await sleep(200);
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].filter((x) => (x.textContent || "").trim() === "+")[0]; if (b) b.click(); });
await sleep(300);
check("TEST2: visitorCount set to 4", (await page.evaluate(() => document.querySelector('input[type="number"]').value)) === "4");
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Mulai Pesan")); if (b) b.click(); });

// --- Menu (TEST3-6) ---
check("TEST3: menu for table's restaurant", await waitText("Restoran Bahagia") && await waitText("Makanan"));
// plain Es Teh
await page.evaluate(() => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === "Es Teh");
  let el = h3 && h3.parentElement;
  while (el && el !== document.body) {
    const btn = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("+ Tambah"));
    if (btn) { btn.click(); return; }
    el = el.parentElement;
  }
});
await sleep(1000);
// customized Minuman Caffe 1 → Large + Extra Espresso + Extra Shot
await page.evaluate(() => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === "Minuman Caffe 1");
  let el = h3 && h3.parentElement;
  while (el && el !== document.body) {
    const btn = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Pilih Produk"));
    if (btn) { btn.click(); return; }
    el = el.parentElement;
  }
});
check("TEST5: customization modal opens", await waitText("Tambah ke Keranjang"));
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent && x.textContent.trim().startsWith("Large")); if (b) b.click(); });
await sleep(300);
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent && x.textContent.trim().startsWith("Extra Espresso")); if (b) b.click(); });
await sleep(300);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll("div")].filter((d) => d.textContent && d.textContent.includes("Extra Shot") && d.querySelector("button"));
  const row = rows[rows.length - 1];
  if (row) { const btn = row.querySelector("button"); if (btn) btn.click(); }
});
await sleep(300);
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent && x.textContent.includes("Tambah ke Keranjang")); if (b) b.click(); });
await sleep(1200);
const items = await page.evaluate(() => JSON.parse(localStorage.getItem("restaurant_cart")).items);
check("TEST6: customization stored in cart", items.length === 2 && items.some((i) => i.name === "Minuman Caffe 1" && i.selections?.some((s) => s.optionName === "Large") && i.addons?.some((a) => a.name === "Extra Shot")));

// --- Cart page: QR dine-in shows no tax rows ---
await page.goto(`${BASE}/cart`, { waitUntil: "networkidle2" });
await sleep(1200);
const cartBody = await page.evaluate(() => document.body.innerText);
check("Cart (dine-in) has NO Pajak/Service rows", !cartBody.includes("Pajak") && !cartBody.includes("Service Charge") && !cartBody.includes("Service"));
check("Cart total = subtotal Rp46.000", cartBody.includes("Rp46.000"));
await page.screenshot({ path: "shots/notax-cart.png" });

// --- Checkout (TEST7-8) ---
await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle2" });
await sleep(1500);
check("TEST7: checkout shows Meja 1 + 4 pengunjung", await waitText("Meja 1") && await waitText("4 pengunjung"));
let coBody = await page.evaluate(() => document.body.innerText);
check("TEST7: checkout shows only picked items", coBody.includes("Minuman Caffe 1") && coBody.includes("Es Teh"));
check("TEST7: no Pajak/Service/Biaya/PPN anywhere on checkout",
  !["Pajak", "Tax", "Service", "Biaya pelayanan", "Biaya layanan", "PPN"].some((w) => coBody.includes(w)));
check("TEST8: Subtotal Rp46.000 & Total Rp46.000 (not 52.900)",
  coBody.includes("Rp46.000") && !coBody.includes("52.900"));
await page.screenshot({ path: "shots/notax-checkout.png" });

// --- TEST12: refresh checkout keeps table info ---
await page.reload({ waitUntil: "networkidle2" });
await sleep(1500);
coBody = await page.evaluate(() => document.body.innerText);
check("TEST12: refresh keeps Meja 1 + 4 pengunjung", coBody.includes("Meja 1") && coBody.includes("4 pengunjung") && !coBody.includes("Pajak"));

// --- Submit (TEST9) ---
await page.type('input[placeholder*="Masukkan nama"]', "NoTax E2E", { delay: 10 });
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Konfirmasi & Bayar")); if (b) b.click(); });
let done = false;
for (let i = 0; i < 60 && !done; i++) {
  const cleared = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("restaurant_cart")).items.length === 0; } catch { return false; } });
  if (cleared && orderNumber) done = true;
  if (!done) await sleep(500);
}
check("TEST9: order submitted", done && !!orderNumber, `order=${orderNumber}`);

// --- TEST10/11: DB + payment amount ---
if (orderNumber) {
  const [orders] = await conn.query("SELECT subtotal, tax, serviceCharge, grandTotal, tableId, visitorCount, orderType FROM `Order` WHERE orderNumber = ?", [orderNumber]);
  const o = orders[0];
  check("TEST10: DB subtotal=46000, tax=0, service=0, grandTotal=46000",
    o && Number(o.subtotal) === 46000 && Number(o.tax) === 0 && Number(o.serviceCharge) === 0 && Number(o.grandTotal) === 46000,
    JSON.stringify({ subtotal: o?.subtotal, tax: o?.tax, service: o?.serviceCharge, grand: o?.grandTotal }));
  check("TEST10: tableId + visitorCount=4 + DINE_IN", o && o.tableId === table.id && Number(o.visitorCount) === 4 && o.orderType === "DINE_IN");
  check("TEST11: payment amount = 46000 (iPaymu)", paymentAmount !== null && Number(paymentAmount) === 46000, `paymentAmount=${paymentAmount}`);
  const [pay] = await conn.query("SELECT amount, provider FROM Payment WHERE orderId = (SELECT id FROM `Order` WHERE orderNumber = ?) ORDER BY createdAt DESC LIMIT 1", [orderNumber]);
  check("TEST11: Payment row amount 46000", pay.length === 1 && Number(pay[0].amount) === 46000, JSON.stringify(pay));
  // customization snapshot still saved
  const [it] = await conn.query("SELECT customizations FROM OrderItem WHERE orderId = (SELECT id FROM `Order` WHERE orderNumber = ?) LIMIT 1", [orderNumber]);
  const deepParse = (v) => { let out = v; while (typeof out === "string") { try { out = JSON.parse(out); } catch { break; } } return out; };
  const snap = deepParse(it[0]?.customizations);
  check("Customization snapshot preserved", snap && snap.productName && snap.basePrice !== undefined);
  await page.goto(`${BASE}/order/${orderNumber}`, { waitUntil: "networkidle2" });
  const odBody = await page.evaluate(() => document.body.innerText);
  check("Order detail: Total Rp46.000, no Pajak row", odBody.includes("Rp46.000") && !odBody.includes("Pajak (10%)"));
  await page.screenshot({ path: "shots/notax-order.png" });
}

await browser.close();
await conn.query("UPDATE `Table` SET status='AVAILABLE' WHERE number=1");
await conn.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks PASSED ====`);
if (failed.length) console.log("FAILED:", failed.map((f) => f.name).join(" | "));
