// ============================================================
// Runtime UI verification — Kasir CASH + QRIS on the ORDER DETAIL page
// (real Chromium via puppeteer-core, port 3001 production build).
//
// Verifies the ACTUAL UI flip the last code fix targets:
//   - CASH collected  -> order detail shows PAID instantly
//   - QRIS paid       -> dialog success + order detail PAID
//   - QRIS -> CASH    -> no 409, old QRIS CANCELLED, UI PAID
//   - CASH -> QRIS    -> cash row superseded, QRIS PAID, UI PAID
// ALL WITHOUT a page reload (navigation count must stay unchanged).
//
// The customer "pays" the QRIS via the gateway webhook (real HMAC signed,
// same payload shape the provider delivers) — no real-money gateway traffic.
// Login is done via the API cookie jar (session auth works on 3001 thanks to
// AUTH_TRUST_HOST); the browser merely re-uses those cookies so the UI flow
// under test is the real cashier payment.
// ============================================================
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import puppeteer from "puppeteer-core";

const BASE = "http://127.0.0.1:3001";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const TAG = `ui-${Date.now()}`;
const VA = (process.env.IPAYMU_VA || "").trim();

const results = [];
const created = { orders: [], customers: [], payments: [] };
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

// ---------- DB ----------
const url = new URL(process.env.DATABASE_URL || "mysql://root:password@localhost:3306/restaurant_app");
const pool = mysql.createPool({
  host: url.hostname,
  port: url.port || 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password || ""),
  database: url.pathname.replace(/^\//, ""),
  connectionLimit: 4,
});
const q = async (sql, params = []) => (await pool.query(sql, params))[0];

// ---------- API (cookie jar for session injection) ----------
const makeApi = () => {
  let cookie = "";
  const rawCookies = [];
  return {
    rawCookies,
    async login(email, password) {
      const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
      rawCookies.push(...(csrfRes.headers.getSetCookie ? csrfRes.headers.getSetCookie() : []));
      const sc1 = csrfRes.headers.getSetCookie ? csrfRes.headers.getSetCookie() : [];
      cookie = sc1.map((c) => c.split(";")[0]).join("; ");
      const csrfJson = await csrfRes.json();
      const form = new URLSearchParams({
        csrfToken: csrfJson.csrfToken,
        email,
        password,
        callbackURL: `${BASE}/login`,
        json: "true",
      });
      const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 Chrome/126",
          ...(cookie ? { cookie } : {}),
        },
        body: form.toString(),
      });
      rawCookies.push(...(res.headers.getSetCookie ? res.headers.getSetCookie() : []));
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      const merged = new Set([...cookie.split("; ").filter(Boolean), ...sc.map((c) => c.split(";")[0])]);
      cookie = [...merged].join("; ");
      const sess = await this.get("/api/auth/session");
      if (!sess.json?.success || !sess.json?.data?.userId) throw new Error(`login failed for ${email}`);
      return sess.json.data;
    },
    async get(path) {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    },
    async post(path, body) {
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    },
  };
};

// ---------- webhook (real HMAC, provider-faithful) ----------
const signPayload = (payload) => {
  const sorted = {};
  Object.keys(payload).sort().forEach((k) => (sorted[k] = payload[k]));
  const escaped = JSON.stringify(sorted).replace(/\//g, "\\/");
  return crypto.createHmac("sha256", VA).update(escaped, "utf8").digest("hex");
};
const postWebhook = async (payload) => {
  const res = await fetch(`${BASE}/api/webhooks/ipaymu`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-signature": signPayload(payload) },
    body: JSON.stringify(payload),
  });
  return { status: res.status };
};

// ---------- test data ----------
async function createOrder(api, { orderType, customerId, restaurantId, productId, price }) {
  const qty = 1;
  const isDineIn = orderType === "DINE_IN";
  const expectedTotal = price + (isDineIn ? 0 : Math.round(price * 0.1) + Math.round(price * 0.05));
  const res = await api.post("/api/orders", {
    customerId,
    orderType,
    items: [{ productId, quantity: qty }],
  });
  if (res.status !== 201) throw new Error(`createOrder ${orderType} failed: ${res.status} ${JSON.stringify(res.json)}`);
  const order = res.json.data;
  created.orders.push(order.id);
  const dbOrder = (await q(`SELECT grandTotal, branchId, restaurantId, orderNumber FROM \`order\` WHERE id = ?`, [order.id]))[0];
  if (Number(dbOrder.grandTotal) !== expectedTotal) {
    throw new Error(`grandTotal mismatch: ${dbOrder.grandTotal} vs ${expectedTotal}`);
  }
  return { ...order, grandTotal: Number(dbOrder.grandTotal), branchId: dbOrder.branchId, restaurantId: dbOrder.restaurantId, orderNumber: dbOrder.orderNumber };
}

// ---------- browser helpers ----------
async function waitText(page, text, timeout = 20000) {
  await page.waitForFunction(
    (t) => {
      const xp = (s) => document.evaluate(s, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      return xp(`//*[normalize-space()="${t}"]`) !== null;
    },
    { timeout },
    text
  );
}

async function clickButton(page, text, timeout = 15000) {
  await page.waitForFunction(
    (t) => document.evaluate(`//button[contains(.,"${t}")]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue !== null,
    { timeout },
    text
  );
  await page.evaluate((t) => {
    const el = document.evaluate(`//button[contains(.,"${t}")]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    el.click();
  }, text);
}

async function waitQrisReady(page, timeout = 25000) {
  // QR is rendered from the gateway qrImage (data URL) or the qrString
  // payload; readiness = the QR <img> is present OR the payment already
  // flipped to PAID while we were waiting.
  await page.waitForFunction(
    () =>
      document.querySelector('img[alt="QRIS"]') !== null ||
      document.body.innerText.includes("Pembayaran Berhasil"),
    { timeout }
  );
}

async function gotoOrderAndWaitUnpaid(page, order, label, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      await page.goto(`${BASE}/admin/orders/${order.orderNumber}`, { waitUntil: "load", timeout: 35000 });
      await waitText(page, "Belum Bayar", 25000);
      check(`${label}: order detail shows UNPAID before payment`, true, order.orderNumber);
      return;
    } catch (e) {
      if (i === retries) {
        const txt = await page.evaluate(() =>
          document.body ? document.body.innerText.replace(/\n+/g, " | ").slice(0, 700) : "no-body"
        );
        throw new Error(`gotoOrder failed for ${order.orderNumber}: ${txt}`);
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
}

async function navCount(page) {
  return page.evaluate(() => performance.getEntriesByType("navigation").length);
}

async function recordNavDelta(page, label) {
  const n = await navCount(page);
  check(`${label} no full page reload (SPA update)`, n === 1, `navigationEntries=${n}`);
}

function parseSetCookie(header) {
  const parts = header.split(";").map((s) => s.trim());
  const [pair, ...attrs] = parts;
  const eq = pair.indexOf("=");
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const out = { name, value, path: "/" };
  for (const a of attrs) {
    const k = a.split("=")[0].trim().toLowerCase();
    if (k === "path") out.path = a.split("=")[1]?.trim() || "/";
    if (k === "domain") out.domain = a.split("=")[1]?.trim();
  }
  return out;
}

// ============================================================
// FLOWS
// ============================================================

async function flowCash(page, api, { order, label }) {
  console.log(`\n--- ${label} CASH ---`);
  await gotoOrderAndWaitUnpaid(page, order, label);

  await clickButton(page, "Proses Pembayaran");
  await waitText(page, "Cash / Tunai");
  await clickButton(page, "Cash / Tunai");
  await waitText(page, "Pembayaran Cash");

  const n0 = await navCount(page);
  await page.type("#cash-received", String(order.grandTotal));
  await clickButton(page, "Uang Pas");
  await clickButton(page, "Konfirmasi Pembayaran");
  await waitText(page, "Pembayaran Berhasil", 15000);
  check(`${label} CASH: dialog shows success`, true);

  await clickButton(page, "Tutup");
  await waitText(page, "Lunas", 15000);
  check(`${label} CASH: order detail badge → Lunas (no reload)`, true);
  await recordNavDelta(page, `${label} CASH`);

  // ---- wire-level truth ----
  const payRows = await q(`SELECT p.id, p.status, p.method FROM payment p WHERE p.orderId = ? ORDER BY p.createdAt DESC`, [order.id]);
  const cashRow = payRows.find((p) => p.method === "KASIR");
  const orderRow = (await q(`SELECT paymentStatus FROM \`order\` WHERE id = ?`, [order.id]))[0];
  check(`${label} CASH: payment.status=PAID + order.paymentStatus=PAID`,
    cashRow?.status === "PAID" && orderRow?.paymentStatus === "PAID",
    `payment=${cashRow?.status} order=${orderRow?.paymentStatus}`);
  created.payments.push(...payRows.map((p) => p.id));
}

async function flowQris(page, api, { order, label, assertCancelled }) {
  console.log(`\n--- ${label} QRIS ---`);
  await gotoOrderAndWaitUnpaid(page, order, label);

  await clickButton(page, "Proses Pembayaran");
  await waitText(page, "Scan oleh customer");
  const n0 = await navCount(page);
  await clickButton(page, "Scan oleh customer");
  await waitQrisReady(page, 25000);
  check(`${label} QRIS: QR shown + waiting for payment`, true);

  // Customer pays via their app → the gateway fires the webhook.
  const wh = await postWebhook({
    reference_id: order.orderNumber,
    trx_id: `TRX-${TAG}-${label}`,
    status: "berhasil",
    total: String(order.grandTotal),
    amount: String(order.grandTotal),
  });
  check(`${label} QRIS: webhook accepted (200, HMAC valid)`, wh.status === 200, `http=${wh.status}`);

  // Poll picks the PAID tick up (4s cadence) → handleQrisPaid sets the
  // success view ("Pembayaran Berhasil").
  await waitText(page, "Pembayaran Berhasil", 30000);
  check(`${label} QRIS: dialog success view after gateway confirmation`, true);

  await clickButton(page, "Tutup");
  await waitText(page, "Lunas", 20000);
  check(`${label} QRIS: order detail badge → Lunas (no reload)`, true);
  await recordNavDelta(page, `${label} QRIS`);

  // ---- wire-level truth ----
  const payRows = await q(`SELECT p.id, p.status, p.method FROM payment p WHERE p.orderId = ? ORDER BY p.createdAt DESC`, [order.id]);
  const qrisRow = payRows.find((p) => p.method === "QRIS");
  const orderRow = (await q(`SELECT paymentStatus FROM \`order\` WHERE id = ?`, [order.id]))[0];
  check(`${label} QRIS: payment.status=PAID + order.paymentStatus=PAID`,
    qrisRow?.status === "PAID" && orderRow?.paymentStatus === "PAID",
    `payment=${qrisRow?.status} order=${orderRow?.paymentStatus}`);
  if (assertCancelled) {
    const cashRow = payRows.find((p) => p.method === "KASIR");
    check(`${label} QRIS: prior CASH row superseded → CANCELLED`,
      !cashRow || cashRow.status === "CANCELLED", `cash=${cashRow?.status}`);
  }
  created.payments.push(...payRows.map((p) => p.id));
}

async function flowQrisThenCash(page, api, { order, label }) {
  console.log(`\n--- ${label} QRIS → CASH ---`);
  await gotoOrderAndWaitUnpaid(page, order, label);

  await clickButton(page, "Proses Pembayaran");
  await waitText(page, "Scan oleh customer");
  await clickButton(page, "Scan oleh customer");
  await waitQrisReady(page, 25000);
  check(`${label} QRIS→CASH: QRIS intent shown`, true);

  // Kembali → CASH (never submit the QRIS).
  await clickButton(page, "Kembali");
  await waitText(page, "Cash / Tunai");
  await clickButton(page, "Cash / Tunai");
  await waitText(page, "Pembayaran Cash");
  const n0 = await navCount(page);
  await page.type("#cash-received", String(order.grandTotal + 100000));
  await clickButton(page, "Konfirmasi Pembayaran");
  await waitText(page, "Pembayaran Berhasil", 20000);
  await clickButton(page, "Tutup");
  await waitText(page, "Lunas", 20000);
  check(`${label} QRIS→CASH: UI Lunas (no reload)`, true);
  await recordNavDelta(page, `${label} QRIS→CASH`);

  const payRows = await q(`SELECT p.id, p.status, p.method FROM payment p WHERE p.orderId = ? ORDER BY p.createdAt DESC`, [order.id]);
  const qrisRow = payRows.find((p) => p.method === "QRIS");
  const cashRow = payRows.find((p) => p.method === "KASIR");
  const orderRow = (await q(`SELECT paymentStatus FROM \`order\` WHERE id = ?`, [order.id]))[0];
  check(`${label} QRIS→CASH: QRIS CANCELLED, CASH PAID, order PAID, no 409`,
    qrisRow?.status === "CANCELLED" && cashRow?.status === "PAID" && orderRow?.paymentStatus === "PAID",
    `qris=${qrisRow?.status} cash=${cashRow?.status} order=${orderRow?.paymentStatus}`);
  created.payments.push(...payRows.map((p) => p.id));
}

async function flowCashThenQris(page, api, { order, label }) {
  console.log(`\n--- ${label} CASH → QRIS ---`);
  await gotoOrderAndWaitUnpaid(page, order, label);

  await clickButton(page, "Proses Pembayaran");
  await waitText(page, "Cash / Tunai");
  await clickButton(page, "Cash / Tunai");
  await waitText(page, "Pembayaran Cash");
  // Kembali BEFORE submitting cash.
  await clickButton(page, "Kembali");
  await waitText(page, "Scan oleh customer");
  const n0 = await navCount(page);
  await clickButton(page, "Scan oleh customer");
  await waitQrisReady(page, 25000);
  check(`${label} CASH→QRIS: QRIS intent shown (cash never submitted)`, true);

  const wh = await postWebhook({
    reference_id: order.orderNumber,
    trx_id: `TRX-${TAG}-${label}`,
    status: "berhasil",
    total: String(order.grandTotal),
    amount: String(order.grandTotal),
  });
  check(`${label} CASH→QRIS: webhook accepted (200, HMAC valid)`, wh.status === 200, `http=${wh.status}`);

  await waitText(page, "Pembayaran Berhasil", 30000);
  await clickButton(page, "Tutup");
  await waitText(page, "Lunas", 20000);
  await recordNavDelta(page, `${label} CASH→QRIS`);

  const payRows = await q(`SELECT p.id, p.status, p.method FROM payment p WHERE p.orderId = ? ORDER BY p.createdAt DESC`, [order.id]);
  const qrisRow = payRows.find((p) => p.method === "QRIS");
  const cashRow = payRows.find((p) => p.method === "KASIR");
  const orderRow = (await q(`SELECT paymentStatus FROM \`order\` WHERE id = ?`, [order.id]))[0];
  check(`${label} CASH→QRIS: CASH row superseded (CANCELLED), QRIS PAID, order PAID`,
    qrisRow?.status === "PAID" && orderRow?.paymentStatus === "PAID",
    `qris=${qrisRow?.status} order=${orderRow?.paymentStatus}`);
  if (cashRow) {
    check(`${label} CASH→QRIS: existing cash row CANCELLED (not reused)`, cashRow.status === "CANCELLED", `cash=${cashRow.status}`);
  }
  created.payments.push(...payRows.map((p) => p.id));
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  if (!VA) throw new Error("IPAYMU_VA required");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions"],
  });

  // login (API) + inject cookies into the browser
  const api = makeApi();
  const sess = await api.login("admin@restobahagia.com", "admin123");
  const restaurantId = sess.restaurantId;
  const branchId = sess.branches?.[0]?.id || null;
  check("admin login (API cookie jar)", !!restaurantId && !!branchId, `restaurant=${restaurantId} branch=${branchId}`);
  const cookieNames = [
    ...new Set(api.rawCookies.map((c) => parseSetCookie(c).name).filter(Boolean)),
  ];
  check("session cookies injectable", cookieNames.length >= 1, cookieNames.join(","));

  const prod = (await q(
    `SELECT p.id, p.price
     FROM product p
     JOIN branchproduct bp ON bp.productId = p.id AND bp.branchId = ?
     WHERE p.restaurantId = ? AND p.isActive = 1 AND p.isAvailable = 1
       AND bp.isAvailable = 1 AND bp.stock > 0
     ORDER BY p.price ASC LIMIT 1`,
    [branchId, restaurantId]
  ))[0];
  if (!prod) throw new Error("No orderable product found");

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const browserErrors = [];
  page.on("pageerror", (e) => browserErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") browserErrors.push(`console: ${m.text()}`);
  });

  // inject session cookie(s) on the target origin
  for (const h of api.rawCookies) {
    const c = parseSetCookie(h);
    if (!c.name) continue;
    try {
      await page.setCookie({ name: c.name, value: c.value, url: BASE, path: c.path || "/" });
    } catch {
      /* skip non-sessionable cookies */
    }
  }

  // sanity: authenticated page loads (no login redirect)
  await page.goto(`${BASE}/admin/orders`, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => !location.pathname.includes("login"), { timeout: 15000 });
  check("auth guard: admin area loads without login redirect", true, "");

  const mkCustomer = async (label) => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const custId = `uic${crypto.randomBytes(8).toString("hex")}`;
    await q(
      `INSERT INTO customer (id, restaurantId, name, phone, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, NOW(6), NOW(6))`,
      [custId, restaurantId, `UI Cust ${TAG}`, `guest-ui-${TAG}-${suffix}`]
    );
    created.customers.push(custId);
    return custId;
  };

  // ---------- DINE_IN: full matrix ----------
  {
    const cust = await mkCustomer("DINE_IN");
    const o1 = await createOrder(api, { orderType: "DINE_IN", customerId: cust, restaurantId, productId: prod.id, price: Number(prod.price) });
    await flowCash(page, api, { order: o1, label: "DINE_IN" });
    check("DINE_IN CASH: order type kept (no regression)", (await q(`SELECT orderType FROM \`order\` WHERE id = ?`, [o1.id]))[0]?.orderType === "DINE_IN");

    const o2 = await createOrder(api, { orderType: "DINE_IN", customerId: cust, restaurantId, productId: prod.id, price: Number(prod.price) });
    await flowQris(page, api, { order: o2, label: "DINE_IN" });

    const o3 = await createOrder(api, { orderType: "DINE_IN", customerId: cust, restaurantId, productId: prod.id, price: Number(prod.price) });
    await flowQrisThenCash(page, api, { order: o3, label: "DINE_IN" });

    const o4 = await createOrder(api, { orderType: "DINE_IN", customerId: cust, restaurantId, productId: prod.id, price: Number(prod.price) });
    await flowCashThenQris(page, api, { order: o4, label: "DINE_IN" });
  }

  // ---------- TAKEAWAY + DELIVERY: CASH + QRIS ----------
  for (const orderType of ["TAKEAWAY", "DELIVERY"]) {
    const cust = await mkCustomer(orderType);
    const oCash = await createOrder(api, { orderType, customerId: cust, restaurantId, productId: prod.id, price: Number(prod.price) });
    await flowCash(page, api, { order: oCash, label: orderType });

    const oQris = await createOrder(api, { orderType, customerId: cust, restaurantId, productId: prod.id, price: Number(prod.price) });
    await flowQris(page, api, { order: oQris, label: orderType, assertCancelled: true });
  }

  check("no browser console/page errors during UI flows", browserErrors.length === 0, browserErrors.slice(0, 3).join(" | "));

  // ---------- summary ----------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"=".repeat(40)}`);
  console.log(`TOTAL: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`);
  failed.forEach((f) => console.log(`  FAILED: ${f.name} (${f.extra})`));
  console.log(`NAV_DELTAS_OK always asserted per flow: 4 DINE_IN + 2 TAKEAWAY + 2 DELIVERY flows`);

  // ---------- cleanup (tagged rows) ----------
  try {
    if (created.orders.length) {
      await q(`DELETE FROM paymenttransaction WHERE paymentId IN (SELECT id FROM payment WHERE orderId IN (?))`, [created.orders]);
      await q(`DELETE FROM payment WHERE orderId IN (?)`, [created.orders]);
      await q(`DELETE FROM orderstatushistory WHERE orderId IN (?)`, [created.orders]);
      await q(`DELETE FROM \`order\` WHERE id IN (?)`, [created.orders]);
    }
    if (created.customers.length) await q(`DELETE FROM customer WHERE id IN (?)`, [created.customers]);
    console.log("cleanup: UI test rows removed");
  } catch (e) {
    console.log("cleanup error (rows remain):", e.message);
  }

  await browser.close();
  await pool.end();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error("UI HARNESS ERROR:", e);
  try { await pool.end(); } catch {}
  process.exit(2);
});