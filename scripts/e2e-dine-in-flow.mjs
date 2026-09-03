// Dine-in order flow E2E (real Chrome against the dev server):
// QR(/t/1) → guest count → menu → plain + customized add → cart → checkout
// (only picked items + table info) → create order → DB verification.
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

const conn = await createConnection({
  host: "localhost", port: 3306, user: "root", password: "", database: "restaurant_app",
});
const [[table]] = await conn.query("SELECT id, restaurantId, number FROM `Table` WHERE number = 1");
const [[restaurant]] = await conn.query("SELECT id, name FROM Restaurant WHERE id = ?", [table.restaurantId]);
const [[caffe]] = await conn.query("SELECT id, name, price FROM Product WHERE name = 'Minuman Caffe 1' AND isActive = 1");
const [[esteh]] = await conn.query("SELECT id, name, price FROM Product WHERE name = 'Es Teh' AND isActive = 1");
const [[large]] = await conn.query(
  "SELECT o.id, o.priceAdjustment FROM ProductOption o JOIN ProductOptionGroup g ON o.optionGroupId = g.id WHERE o.name = 'Large' AND g.productId = ?",
  [caffe.id]
);
const [[extraEsp]] = await conn.query(
  "SELECT o.id, o.priceAdjustment FROM ProductOption o JOIN ProductOptionGroup g ON o.optionGroupId = g.id WHERE o.name = 'Extra Espresso' AND g.productId = ?",
  [caffe.id]
);
const [[shot]] = await conn.query("SELECT id, price FROM ProductAddon WHERE name = 'Extra Shot' AND productId = ?", [caffe.id]);
console.log("DB fixture:", JSON.stringify({
  table: table.number, restaurant: restaurant.name,
  caffe: Number(caffe.price), esteh: Number(esteh.price),
  large: Number(large.priceAdjustment), extraEspresso: Number(extraEsp.priceAdjustment), extraShot: Number(shot.price),
}));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  defaultViewport: { width: 1280, height: 900 },
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
let createdOrderNumber = null;
page.on("response", async (res) => {
  try {
    if (res.url().endsWith("/public/orders") && res.request().method() === "POST") {
      const j = await res.json();
      createdOrderNumber = j?.data?.orderNumber || null;
    }
  } catch {}
});

const waitText = async (text, timeout = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const has = await page.evaluate((t) => (document.body.innerText || "").includes(t), text);
    if (has) return true;
    await sleep(300);
  }
  return false;
};

// ---------------- TEST 1: Scan QR (open /t/1) ----------------
await page.goto(`${BASE}/t/1`, { waitUntil: "networkidle2" });
check("TEST1: QR → table landing recognizes Meja 1 + restaurant", await waitText("Selamat Datang") && await waitText(restaurant.name) && await waitText(`Meja 1`));
check("TEST1: Landing asks guest count", (await page.evaluate(() => document.body.innerText)).includes("Berapa orang yang makan?"));

// ---------------- TEST 2: guest count input ----------------
// minus at 1 must stay 1 (min 1, no 0/negative)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").trim() === "-");
  if (btns[0]) btns[0].click();
});
await sleep(400);
let countVal = await page.evaluate(() => document.querySelector('input[type="number"]').value);
check("TEST2: min 1 enforced (minus at 1 keeps 1)", countVal === "1", `count=${countVal}`);
// try typing 0 — must be rejected
await page.evaluate(() => {
  const input = document.querySelector('input[type="number"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "0");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(300);
countVal = await page.evaluate(() => document.querySelector('input[type="number"]').value);
check("TEST2: 0 rejected", countVal !== "0", `count=${countVal}`);
// plus x3 → 4
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").trim() === "+");
    if (btns[0]) btns[0].click();
  });
  await sleep(250);
}
countVal = await page.evaluate(() => document.querySelector('input[type="number"]').value);
check("TEST2: guestCount = 4", countVal === "4", `count=${countVal}`);
await page.screenshot({ path: "shots/dinein-1-landing.png" });

// ---------------- TEST 3: Mulai Pesan → menu with context ----------------
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Mulai Pesan"));
  if (btn) btn.click();
});
check("TEST3: navigates to /menu", await waitText("Makanan") && page.url().includes("/menu"));
const ctx = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("table_context")); } catch { return null; }
});
check("TEST3: table context persisted (table 1, 4 pax, restaurant)", ctx &&
  ctx.tableNumber === 1 && ctx.visitorCount === 4 && ctx.restaurantId === restaurant.id &&
  ctx.tableId === table.id, JSON.stringify(ctx));
const menuRestaurantName = await page.evaluate(() => {
  const h1 = document.querySelector("h1");
  return h1 ? h1.textContent.trim() : "";
});
check("TEST3: menu shows table's restaurant", menuRestaurantName === restaurant.name, menuRestaurantName);
await page.screenshot({ path: "shots/dinein-2-menu.png" });

// ---------------- TEST 4: plain product direct add ----------------
await page.evaluate(() => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === "Es Teh");
  let el = h3.parentElement;
  while (el && el !== document.body) {
    const btn = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("+ Tambah"));
    if (btn) { btn.click(); return; }
    el = el.parentElement;
  }
});
await sleep(1200);
let cartState = await page.evaluate(() => JSON.parse(localStorage.getItem("restaurant_cart")).items);
check("TEST4: Es Teh added directly (no modal)", cartState.length === 1 && cartState[0].name === "Es Teh" && cartState[0].quantity === 1, JSON.stringify(cartState.map((i) => ({ n: i.name, q: i.quantity }))));

// ---------------- TEST 5-7: customized product ----------------
await page.evaluate(() => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === "Minuman Caffe 1");
  let el = h3.parentElement;
  while (el && el !== document.body) {
    const btn = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Pilih Produk"));
    if (btn) { btn.click(); return; }
    el = el.parentElement;
  }
});
check("TEST5: 'Pilih Produk' opens modal", await waitText("Tambah ke Keranjang"));
const modalHas = await page.evaluate(() => {
  const t = document.body.innerText;
  return t.includes("Size") && t.includes("Sugar") && t.includes("Espresso") && t.includes("Extra Shot") && t.includes("Catatan");
});
check("TEST5: modal shows Size/Sugar/Espresso/Extra Shot/notes", modalHas);
// Large
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent && x.textContent.trim().startsWith("Large"));
  if (b) b.click();
});
await sleep(400);
// Extra Espresso
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent && x.textContent.trim().startsWith("Extra Espresso"));
  if (b) b.click();
});
await sleep(400);
// Extra Shot addon ON
await page.evaluate(() => {
  const rows = [...document.querySelectorAll("div")].filter((d) => d.textContent && d.textContent.includes("Extra Shot") && d.querySelector("button"));
  const row = rows[rows.length - 1];
  if (row) { const btn = row.querySelector("button"); if (btn) btn.click(); }
});
await sleep(400);
// notes
await page.evaluate(() => {
  const ta = document.querySelector("textarea");
  if (ta) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "Es batu sedikit");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await sleep(400);
const modalPrice = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent && b.textContent.includes("Tambah ke Keranjang"));
  return btn ? btn.textContent.trim() : "";
});
const expectedUnit = Number(caffe.price) + Number(large.priceAdjustment) + Number(extraEsp.priceAdjustment) + Number(shot.price);
check("TEST6: modal price = 38.000 (server math on client display)", modalPrice.includes(expectedUnit.toLocaleString("id-ID")), `${modalPrice} expected ${expectedUnit.toLocaleString("id-ID")}`);
await page.screenshot({ path: "shots/dinein-3-modal.png" });
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent && x.textContent.includes("Tambah ke Keranjang"));
  if (b) b.click();
});
await sleep(1500);
cartState = await page.evaluate(() => JSON.parse(localStorage.getItem("restaurant_cart")).items);
const caffeItem = cartState.find((i) => i.name === "Minuman Caffe 1");
check("TEST7: customized item in cart with selections+addon+notes+displayPrice", !!caffeItem &&
  caffeItem.selections?.some((s) => s.optionName === "Large") &&
  caffeItem.selections?.some((s) => s.optionName === "Extra Espresso") &&
  caffeItem.addons?.some((a) => a.name === "Extra Shot" && a.quantity === 1) &&
  caffeItem.notes === "Es batu sedikit" &&
  caffeItem.displayPrice === expectedUnit,
JSON.stringify({ sel: caffeItem?.selections?.map((s) => s.optionName), addons: caffeItem?.addons, notes: caffeItem?.notes, displayPrice: caffeItem?.displayPrice }));

// ---------------- TEST 12 part: refresh keeps context + cart ----------------
await page.reload({ waitUntil: "networkidle2" });
await sleep(2500);
const afterReload = await page.evaluate(() => {
  const ctx = JSON.parse(localStorage.getItem("table_context") || "null");
  const items = JSON.parse(localStorage.getItem("restaurant_cart")).items;
  const header = document.querySelector("h1");
  return { ctx, itemCount: items.reduce((s, i) => s + i.quantity, 0), header: header ? header.textContent : "" };
});
check("TEST12: refresh keeps table context + cart", afterReload.ctx?.visitorCount === 4 && afterReload.itemCount === 2 && afterReload.header === restaurant.name, JSON.stringify(afterReload));

// ---------------- TEST 8-9: checkout ----------------
await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle2" });
check("TEST8: checkout shows table info", await waitText("Meja 1") && await waitText("4 pengunjung"));
const checkoutBody = await page.evaluate(() => document.body.innerText);
check("TEST8: checkout lists ONLY picked items (Caffe + Es Teh)",
  checkoutBody.includes("Minuman Caffe 1") && checkoutBody.includes("Es Teh"));
check("TEST8: checkout does NOT list other products/categories or '+ Tambah'",
  !["Nasi Goreng", "Ayam Geprek", "Mie Ayam", "Kentang Goreng", "Es Jeruk", "asdasd", "+ Tambah", "Makanan", "MINUMAN"].some((x) => checkoutBody.includes(x)));
check("TEST8: checkout shows customization details", checkoutBody.includes("Size: Large") || (checkoutBody.includes("Large") && checkoutBody.includes("Extra Shot") && checkoutBody.includes("Es batu sedikit")));
await page.screenshot({ path: "shots/dinein-4-checkout.png" });

// fill customer name
await page.evaluate(() => {
  const input = document.querySelector('input[placeholder*="Masukkan nama"]');
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, `E2E DineIn ${Date.now()}`);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await sleep(400);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Konfirmasi & Bayar"));
  if (btn) btn.click();
});
// wait for order creation (cart cleared => redirect to payment / order page)
let submitted = false;
for (let i = 0; i < 60; i++) {
  const cleared = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("restaurant_cart")).items.length === 0; } catch { return true; }
  });
  if (cleared && createdOrderNumber) { submitted = true; break; }
  await sleep(500);
}
check("TEST10: order created via existing payment flow", submitted && !!createdOrderNumber, `orderNumber=${createdOrderNumber}`);

// ---------------- DB verification ----------------
if (createdOrderNumber) {
  const [orders] = await conn.query("SELECT id, tableId, visitorCount, orderType, subtotal, tax, serviceCharge, grandTotal FROM `Order` WHERE orderNumber = ?", [createdOrderNumber]);
  const o = orders[0];
  const expectedSubtotal = expectedUnit + Number(esteh.price);
  const expTax = Math.round(expectedSubtotal * 0.1);
  const expSC = Math.round(expectedSubtotal * 0.05);
  const expGrand = expectedSubtotal + expTax + expSC;
  check("Order stored: tableId + guestCount=4 + DINE_IN",
    o && o.tableId === table.id && Number(o.visitorCount) === 4 && o.orderType === "DINE_IN",
    JSON.stringify({ tableId: o?.tableId, visitorCount: o?.visitorCount, orderType: o?.orderType }));
  check("Order totals recomputed by server (client display only)",
    o && Number(o.subtotal) === expectedSubtotal && Number(o.tax) === expTax && Number(o.serviceCharge) === expSC && Number(o.grandTotal) === expGrand,
    `db=${JSON.stringify({ subtotal: o?.subtotal, tax: o?.tax, sc: o?.serviceCharge, grand: o?.grandTotal })} expected=${JSON.stringify({ expectedSubtotal, expTax, expSC, expGrand })}`);
  const [items] = await conn.query("SELECT productId, quantity, unitPrice, customizations FROM OrderItem WHERE orderId = ?", [o.id]);
  // customizations is a JSON column that the service stores pre-stringified,
  // so it can arrive double-encoded — parse until we reach a plain object.
  const deepParse = (v) => {
    let out = v;
    while (typeof out === "string") {
      try { out = JSON.parse(out); } catch { break; }
    }
    return out;
  };
  const itemRows = items.map((i) => ({ productId: i.productId, qty: i.quantity, unitPrice: Number(i.unitPrice), cust: deepParse(i.customizations) }));
  check("Order snapshot: item unit prices from DB",
    itemRows.length === 2 &&
    itemRows.some((r) => r.productId === caffe.id && r.unitPrice === expectedUnit && r.qty === 1) &&
    itemRows.some((r) => r.productId === esteh.id && r.unitPrice === Number(esteh.price) && r.qty === 1),
    JSON.stringify(itemRows.map((r) => ({ pid: r.productId, q: r.qty, up: r.unitPrice }))));
  const caffeSnap = itemRows.find((r) => r.productId === caffe.id)?.cust;
  check("Order snapshot: customizations JSON saved",
    caffeSnap && caffeSnap.productName === "Minuman Caffe 1" && Number(caffeSnap.basePrice) === Number(caffe.price) &&
    caffeSnap.selections.some((s) => s.optionName === "Large") &&
    caffeSnap.addons.some((a) => a.name === "Extra Shot") &&
    caffeSnap.notes === "Es batu sedikit",
    JSON.stringify(caffeSnap));

  // Order detail page renders for customer tracking
  await page.goto(`${BASE}/order/${createdOrderNumber}`, { waitUntil: "networkidle2" });
  const ordBody = await page.evaluate(() => document.body.innerText);
  check("Order detail page shows order + items", await waitText(createdOrderNumber) && ordBody.includes("Minuman Caffe 1"));
  await page.screenshot({ path: "shots/dinein-5-order.png" });
}

await browser.close();
await conn.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks PASSED ====`);
if (failed.length) console.log("FAILED:", failed.map((f) => f.name).join(" | "));
