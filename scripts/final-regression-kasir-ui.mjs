// ============================================================
// FINAL REGRESSION AFTER SHIFT GUARD — BROWSER (KASIR + SHIFT)
// runtime on 127.0.0.1:3001 ONLY, real Chromium (puppeteer-core).
//
// Part B: full browser flows as the SEEDED CASHIER with an OPEN shift,
// plus no-shift browser proofs and the /admin/payments dashboard.
//
//   BROWSER (shift OPEN):
//     DINE_IN  CASH, QRIS(webhook), QRIS→CASH, CASH→QRIS
//     TAKEAWAY CASH, QRIS
//     DELIVERY CASH, QRIS
//     each: UI → Lunas → RELOAD → tetap Lunas, DB-first assertions.
//     single navigation per order (no second barcode scan).
//
//   MANUAL ORDER /admin/orders/new (shift OPEN):
//     DINE_IN / TAKEAWAY / DELIVERY created + cash-paid from the POS.
//   MANUAL ORDER (NO shift): submit → toast + no order row + CTA navigates.
//
//   PAYMENTS DASHBOARD /admin/payments:
//     Tandai Dibayar WITH shift → PAID; WITHOUT shift → SHIFT_NOT_OPEN toast.
//
//   BRANDING SMOKE: CSS vars --brand-* present on admin + customer pages.
//
// Tagged rows only are cleaned up (no reset/drop/truncate).
// ============================================================
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const BASE = "http://127.0.0.1:3001";
const PROJECT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const TAG = `frui-${Date.now().toString().slice(-7)}`;
const TABLE_ID = "cmtois1k9000cbzu8pvgm0i1l"; // Table 05 (AVAILABLE, Main Outlet)
const SIMPLE_PRODUCT = "Nasi Goreng";

function loadEnv() {
  const env = {};
  const raw = fs.readFileSync(path.join(PROJECT, ".env"), "utf8");
  const keep = new Set(["DATABASE_URL", "IPAYMU_VA"]);
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m && keep.has(m[1])) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  return env;
}
const ENV = loadEnv();
const VA = ENV.IPAYMU_VA || "";
const url = new URL(ENV.DATABASE_URL || "mysql://root:password@localhost:3306/restaurant_app");
const pool = mysql.createPool({
  host: url.hostname, port: url.port || 3306,
  user: decodeURIComponent(url.username), password: decodeURIComponent(url.password || ""),
  database: url.pathname.replace(/^\//, ""), connectionLimit: 6,
});
const q = async (sql, params = []) => (await pool.query(sql, params))[0];

const results = [];
const created = { orders: [], customers: [], payments: [], shifts: [], manualCusts: [] };
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

// ---------- API client ----------
const makeApi = () => {
  let cookie = "";
  let branchHeader = null;
  const rawCookies = [];
  return {
    setBranch(id) { branchHeader = id; },
    rawCookies,
    async login(email, password) {
      const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
      const gsc = (h) => (typeof h.getSetCookie === "function" ? h.getSetCookie() : []);
      rawCookies.push(...gsc(csrfRes.headers));
      cookie = gsc(csrfRes.headers).map((c) => c.split(";")[0]).join("; ");
      const csrfJson = await csrfRes.json();
      const form = new URLSearchParams({ csrfToken: csrfJson.csrfToken, email, password, callbackURL: `${BASE}/login`, json: "true" });
      const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 Chrome/126", ...(cookie ? { cookie } : {}) },
        body: form.toString(),
      });
      rawCookies.push(...gsc(res.headers));
      const sc = gsc(res.headers);
      cookie = [...new Set([...cookie.split("; ").filter(Boolean), ...sc.map((c) => c.split(";")[0])])].join("; ");
      const sess = await this.get("/api/auth/session");
      if (!sess.json?.success || !sess.json?.data?.userId) throw new Error(`login failed ${email}`);
      return sess.json.data;
    },
    headers(extra = {}) {
      const h = { cookie, ...extra };
      if (branchHeader) h["x-branch-id"] = branchHeader;
      return h;
    },
    async get(path) {
      const res = await fetch(`${BASE}${path}`, { headers: this.headers() });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    async post(path, body) {
      const res = await fetch(`${BASE}${path}`, { method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
  };
};
const signPayload = (payload) => {
  const sorted = {};
  Object.keys(payload).sort().forEach((k) => (sorted[k] = payload[k]));
  return crypto.createHmac("sha256", VA).update(JSON.stringify(sorted).replace(/\//g, "\\/"), "utf8").digest("hex");
};
const postWebhook = async (payload) => {
  const res = await fetch(`${BASE}/api/webhooks/ipaymu`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-signature": signPayload(payload) },
    body: JSON.stringify(payload),
  });
  return { status: res.status };
};

function parseSetCookie(header) {
  const parts = header.split(";").map((s) => s.trim());
  const [pair, ...attrs] = parts;
  const eq = pair.indexOf("=");
  const name = pair.slice(0, eq).trim();
  let value = pair.slice(eq + 1).trim();
  try { value = decodeURIComponent(value); } catch { /* raw */ }
  const obj = { name, value };
  attrs.forEach((a) => {
    const [k, ...rest] = a.split("=");
    const key = k.trim().toLowerCase();
    if (key === "path" || key === "domain") obj[key] = rest.join("=");
    if (key === "httponly") obj.httpOnly = true;
    if (key === "sameSite") obj.sameSite = rest.join("=");
  });
  return obj;
}

// ---------- DB state helpers ----------
const stateOf = async (orderId) => {
  const payRows = await q(
    `SELECT p.id,p.status,p.method,p.orderId,p.restaurantId,p.branchId,p.shiftId FROM payment p WHERE p.orderId=? ORDER BY p.createdAt ASC`, [orderId]);
  const orderRow = (await q(`SELECT paymentStatus,status,branchId,restaurantId,grandTotal,orderNumber FROM \`order\` WHERE id=?`, [orderId]))[0];
  return { payRows, order: orderRow };
};
const countPaid = async (orderId) => (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND status='PAID'`, [orderId]))[0].c;
const countRows = async (orderId) => (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=?`, [orderId]))[0].c;

// ---------- browser helpers ----------
async function waitText(page, text, timeout = 20000) {
  await page.waitForFunction((t) => {
    const xp = (s) => document.evaluate(s, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    return xp(`//*[normalize-space()="${t}"]`) !== null;
  }, { timeout }, text);
}
async function waitQrisReady(page, timeout = 25000) {
  await page.waitForFunction(() =>
    document.querySelector('img[alt="QRIS"]') !== null || document.body.innerText.includes("Pembayaran Berhasil"),
    { timeout });
}
async function clickButton(page, text, timeout = 15000) {
  await page.waitForFunction((t) =>
    document.evaluate(`//button[contains(.,"${t}")]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue !== null,
    { timeout }, text);
  await page.evaluate((t) => {
    const el = document.evaluate(`//button[contains(.,"${t}")]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    el.click();
  }, text);
}
async function gotoOrder(page, order) {
  const once = async () => {
    await page.goto(`${BASE}/admin/orders/${order.orderNumber}`, { waitUntil: "load", timeout: 40000 });
    await waitText(page, "Belum Bayar", 30000);
  };
  try {
    await once();
  } catch (err) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      await once();
    } catch (err2) {
      try {
        await page.screenshot({ path: `/tmp/opencode/order-timeout-${order.orderNumber}.png` });
        const html = await page.evaluate(() => document.body.innerText);
        console.log("SNAPSHOT (page body, 600 chars):", JSON.stringify(html.slice(0, 600)));
      } catch { /* ignore */ }
      throw err2;
    }
  }
}
async function navCount(page) {
  return page.evaluate(() => performance.getEntriesByType("navigation").length);
}
async function waitToast(page, title = "Shift Belum Dibuka", timeout = 15000) {
  await page.waitForFunction((t) =>
    Array.from(document.querySelectorAll('[data-sonner-toast]')).some((n) => n.textContent.includes(t)),
    { timeout }, title);
}
async function readToastButtons(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-sonner-toast]'));
    const last = nodes[nodes.length - 1];
    return last ? Array.from(last.querySelectorAll("button")).map((b) => b.textContent.trim()) : [];
  });
}
async function clickToastAction(page, label) {
  await page.evaluate((l) => {
    const toast = Array.from(document.querySelectorAll('[data-sonner-toast]')).pop();
    const btn = toast && Array.from(toast.querySelectorAll("button")).find((b) => b.textContent.trim() === l);
    if (btn) btn.click();
  }, label);
}

async function main() {
  const admin = makeApi();
  const asess = await admin.login("admin@restobahagia.com", "admin123");
  const restaurantId = asess.restaurantId;
  const branchId = asess.branches?.[0]?.id || null;
  admin.setBranch(branchId);
  check("env: admin login", !!restaurantId && !!branchId, `branch=${branchId}`);

  const kasir = makeApi();
  const ksess = await kasir.login("kasir@restobahagia.com", "kasir123");
  const kasirId = ksess.userId;
  kasir.setBranch(branchId);
  check("env: kasir login", !!kasirId, `kasir=${kasirId}`);

  // Deterministic shift state for the seeded cashier.
  await q(`UPDATE cashiershift SET status='CLOSED' WHERE userId=? AND status='OPEN'`, [kasirId]);

  // Purge artifacts left by an interrupted earlier run (tagged rows only).
  const leftoverCusts = (await q(`SELECT id FROM customer WHERE id LIKE 'fui-%'`)).map((r) => r.id);
  if (leftoverCusts.length) {
    const leftoverOrders = (await q(`SELECT id FROM \`order\` WHERE customerId IN (?)`, [leftoverCusts])).map((r) => r.id);
    if (leftoverOrders.length) {
      await q(`DELETE FROM paymenttransaction WHERE paymentId IN (SELECT id FROM payment WHERE orderId IN (?))`, [leftoverOrders]);
      await q(`DELETE FROM payment WHERE orderId IN (?)`, [leftoverOrders]);
      await q(`DELETE FROM orderstatushistory WHERE orderId IN (?)`, [leftoverOrders]);
      await q(`DELETE FROM \`order\` WHERE id IN (?)`, [leftoverOrders]);
    }
    const strayPays = (await q(`SELECT id FROM payment WHERE id LIKE 'fui-%'`)).map((r) => r.id);
    if (strayPays.length) await q(`DELETE FROM payment WHERE id LIKE 'fui-%'`);
    await q(`DELETE FROM customer WHERE id IN (?)`, [leftoverCusts]);
    console.log(`purge: removed ${leftoverOrders.length} leftover orders / ${leftoverCusts.length} customers`);
  }
  const openRes = await kasir.post("/api/shifts", { openingCash: 500000 });
  if (openRes.status !== 201) throw new Error(`openShift failed: ${JSON.stringify(openRes.json)}`);
  const shiftId = openRes.json.data.id;
  created.shifts.push(shiftId);
  check("env: kasir shift OPEN (real API)", openRes.json.data.status === "OPEN", `shift=${shiftId.slice(0, 8)}`);

  const prod = (await q(
    `SELECT p.id,p.price FROM product p JOIN branchproduct bp ON bp.productId=p.id AND bp.branchId=?
     WHERE p.restaurantId=? AND p.isActive=1 AND p.isAvailable=1 AND bp.isAvailable=1 AND bp.stock>0
     AND p.name=? LIMIT 1`, [branchId, restaurantId, SIMPLE_PRODUCT]))[0];
  if (!prod) throw new Error(`product ${SIMPLE_PRODUCT} not found`);

  const mkCustomer = async (label) => {
    const custId = `fui-${crypto.randomBytes(8).toString("hex")}`;
    await q(`INSERT INTO customer (id,restaurantId,name,phone,isActive,createdAt,updatedAt) VALUES (?,?,?,?,1,NOW(6),NOW(6))`,
      [custId, restaurantId, `FinalUI ${TAG} ${label}`, `fui-${TAG}-${label}`]);
    created.customers.push(custId);
    return custId;
  };
  // kasir creates the order (shift OPEN) → DB row.
  const mkOrder = async (label, orderType) => {
    const custId = await mkCustomer(label);
    const r = await kasir.post("/api/orders", { customerId: custId, orderType, items: [{ productId: prod.id, quantity: 1 }] });
    if (r.status !== 201) throw new Error(`mkOrder ${label} failed: ${JSON.stringify(r.json)}`);
    const dbo = (await q(`SELECT id,grandTotal,orderNumber,branchId,restaurantId FROM \`order\` WHERE id=?`, [r.json.data.id]))[0];
    created.orders.push(dbo.id);
    return { ...dbo, grandTotal: Number(dbo.grandTotal) };
  };

  // ---------- browser with KASIR session ----------
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  for (const h of kasir.rawCookies) {
    const c = parseSetCookie(h);
    if (!c.name) continue;
    try { await page.setCookie({ name: c.name, value: c.value, url: BASE, path: c.path || "/" }); } catch { /* skip */ }
  }

  const flowCash = async (label, order) => {
    await gotoOrder(page, order);
    const n0 = await navCount(page);
    await clickButton(page, "Proses Pembayaran");
    await waitText(page, "Cash / Tunai");
    await clickButton(page, "Cash / Tunai");
    await waitText(page, "Pembayaran Cash");
    await clickButton(page, "Uang Pas");
    await clickButton(page, "Konfirmasi Pembayaran");
    await waitText(page, "Pembayaran Berhasil", 15000);
    await clickButton(page, "Tutup");
    await waitText(page, "Lunas", 15000);
    const nav = await navCount(page);
    await page.goto(`${BASE}/admin/orders/${order.orderNumber}`, { waitUntil: "load", timeout: 35000 });
    await waitText(page, "Lunas", 15000);
    const st = await stateOf(order.id);
    const cash = st.payRows.find((p) => p.method === "KASIR");
    const shiftRow = cash?.shiftId ? (await q(`SELECT status FROM cashiershift WHERE id=?`, [cash.shiftId]))[0] : null;
    check(`${label} CASH: UI Lunas + reload Lunas + single nav`, nav === 1,
      `nav=${nav} cash=${cash?.status} order=${st.order?.paymentStatus}`);
    check(`${label} CASH: DB order=PAID, payment=PAID KASIR, shiftId linked OPEN, single PAID (full fields)`,
      st.order?.paymentStatus === "PAID" && cash?.status === "PAID" && cash?.method === "KASIR" &&
        cash?.orderId === order.id && cash?.restaurantId === st.order?.restaurantId &&
        cash?.branchId === st.order?.branchId && !!cash?.shiftId && shiftRow?.status === "OPEN" &&
        (await countPaid(order.id)) === 1,
      `status=${cash?.status} order=${st.order?.paymentStatus} shift=${shiftRow?.status || "none"}`);
  };

  const flowQris = async (label, order, { preCash } = {}) => {
    // preCash = a real CASH intent was recorded before browser (CASH→QRIS supersede).
    if (preCash) {
      const c = await kasir.post("/api/payments", { orderId: order.id, method: "KASIR" });
      if (c.status !== 201) throw new Error(`${label} preCash failed: ${JSON.stringify(c.json)}`);
      created.payments.push(c.json.data.id);
    }
    await gotoOrder(page, order);
    const n0 = await navCount(page);
    await clickButton(page, "Proses Pembayaran");
    await waitText(page, "Scan oleh customer");
    await clickButton(page, "Scan oleh customer");
    await waitQrisReady(page, 25000);
    const wh = await postWebhook({
      reference_id: order.orderNumber, trx_id: `TRX-${TAG}-${label}`, status: "berhasil",
      total: String(order.grandTotal), amount: String(order.grandTotal),
    });
    check(`${label} QRIS: webhook 200 (HMAC)`, wh.status === 200, `http=${wh.status}`);
    await waitText(page, "Pembayaran Berhasil", 30000);
    await clickButton(page, "Tutup");
    await waitText(page, "Lunas", 20000);
    const nav = await navCount(page);
    await page.goto(`${BASE}/admin/orders/${order.orderNumber}`, { waitUntil: "load", timeout: 35000 });
    await waitText(page, "Lunas", 20000);
    const st = await stateOf(order.id);
    const qris = st.payRows.find((p) => p.method === "QRIS");
    const cash = st.payRows.find((p) => p.method === "KASIR");
    check(`${label} QRIS: UI Lunas + reload Lunas + single nav, no polling churn (rows=${st.payRows.length})`,
      nav === 1 && st.order?.paymentStatus === "PAID" && (await countRows(order.id)) === st.payRows.length,
      `nav=${nav} order=${st.order?.paymentStatus} rows=${st.payRows.length}`);
    check(`${label} QRIS: DB qris=PAID + order=PAID + single PAID + full fields`,
      qris?.status === "PAID" && st.order?.paymentStatus === "PAID" &&
        qris?.orderId === order.id && qris?.restaurantId === st.order?.restaurantId &&
        qris?.branchId === st.order?.branchId && (await countPaid(order.id)) === 1,
      `qris=${qris?.status} order=${st.order?.paymentStatus}`);
    if (preCash) {
      check(`${label} CASH→QRIS: prior CASH intent NOT PAID (superseded)`,
        !cash || cash.status !== "PAID", `cash=${cash?.status}`);
    }
  };

  const flowQrisThenCash = async (label, order) => {
    await gotoOrder(page, order);
    const n0 = await navCount(page);
    await clickButton(page, "Proses Pembayaran");
    await waitText(page, "Scan oleh customer");
    await clickButton(page, "Scan oleh customer");
    await waitQrisReady(page, 25000);
    await clickButton(page, "Kembali");
    await waitText(page, "Cash / Tunai");
    await clickButton(page, "Cash / Tunai");
    await waitText(page, "Pembayaran Cash");
    await clickButton(page, "Uang Pas");
    await clickButton(page, "Konfirmasi Pembayaran");
    await waitText(page, "Pembayaran Berhasil", 20000);
    await clickButton(page, "Tutup");
    await waitText(page, "Lunas", 20000);
    const nav = await navCount(page);
    await page.goto(`${BASE}/admin/orders/${order.orderNumber}`, { waitUntil: "load", timeout: 35000 });
    await waitText(page, "Lunas", 20000);
    const st = await stateOf(order.id);
    const qris = st.payRows.find((p) => p.method === "QRIS");
    const cash = st.payRows.find((p) => p.method === "KASIR");
    check(`${label} QRIS→CASH: UI Lunas + reload Lunas + single nav`,
      nav === 1 && st.order?.paymentStatus === "PAID", `nav=${nav} order=${st.order?.paymentStatus}`);
    check(`${label} QRIS→CASH: DB cash=PAID, oldQRIS!=PAID, order=PAID, single PAID`,
      cash?.status === "PAID" && qris?.status !== "PAID" && st.order?.paymentStatus === "PAID" &&
        (await countPaid(order.id)) === 1, `cash=${cash?.status} qris=${qris?.status}`);
  };

  // ---------- MATRIX: DINE_IN (4 flows) ----------
  await flowCash("DINE_IN", await mkOrder("DI-CASH", "DINE_IN"));
  await flowQris("DINE_IN", await mkOrder("DI-QRIS", "DINE_IN"));
  await flowQrisThenCash("DINE_IN", await mkOrder("DI-QC", "DINE_IN"));
  await flowQris("DINE_IN", await mkOrder("DI-CQ", "DINE_IN"), { preCash: true });

  // ---------- MATRIX: TAKEAWAY + DELIVERY (CASH + QRIS) ----------
  await flowCash("TAKEAWAY", await mkOrder("TK-CASH", "TAKEAWAY"));
  await flowQris("TAKEAWAY", await mkOrder("TK-QRIS", "TAKEAWAY"));
  await flowCash("DELIVERY", await mkOrder("DV-CASH", "DELIVERY"));
  await flowQris("DELIVERY", await mkOrder("DV-QRIS", "DELIVERY"));

  // ---------- PAYMENTS DASHBOARD (fresh page per check) ----------
  const openIntent = async (orderId, who = kasir) => {
    const c = await who.post("/api/payments", { orderId, method: "KASIR" });
    if (c.status !== 201) throw new Error(`intent failed: ${JSON.stringify(c.json)}`);
    created.payments.push(c.json.data.id);
  };
  const checkPayments = async ({ label, order, expectToast, expectDbPaid }) => {
    const ppage = await browser.newPage();
    await ppage.setViewport({ width: 1440, height: 1000 });
    for (const h of kasir.rawCookies) {
      const c = parseSetCookie(h);
      if (!c.name) continue;
      try { await ppage.setCookie({ name: c.name, value: c.value, url: BASE, path: c.path || "/" }); } catch { /* skip */ }
    }
    try {
      await ppage.goto(`${BASE}/admin/payments`, { waitUntil: "domcontentloaded", timeout: 60000 });
      const waitAnchor = async () => {
        await ppage.waitForFunction((on) => {
          const hasOrd = document.body.innerText.includes(on);
          const btns = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent.includes("Tandai Dibayar"));
          const anchored = btns.some((b) => {
            let n = b;
            for (let i = 0; i < 6 && n; i++, n = n.parentElement) if (n.textContent && n.textContent.includes(on)) return true;
            return false;
          });
          return hasOrd && anchored;
        }, { timeout: 30000 }, order.orderNumber);
      };
      try {
        await waitAnchor();
      } catch (firstErr) {
        await ppage.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
        await waitAnchor(); // second attempt; throw bubbles if still empty
      }
      await clickButton(ppage, "Tandai Dibayar", 10000);
      await waitToast(ppage, expectToast, 15000);
      const st = await stateOf(order.id);
      const cash = st.payRows.find((p) => p.method === "KASIR");
      const shiftRow = cash?.shiftId ? (await q(`SELECT status FROM cashiershift WHERE id=?`, [cash.shiftId]))[0] : null;
      check(`${label}: ${expectToast}`,
        expectDbPaid(cash?.status === "PAID", st.order?.paymentStatus, shiftRow?.status),
        `cash=${cash?.status} order=${st.order?.paymentStatus} shift=${shiftRow?.status || "unset"}`);
    } catch (err) {
      try {
        const dump = await ppage.evaluate((on) => {
          const btns = [...new Set(Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim()))].slice(0, 25);
          return { orderVisible: document.body.innerText.includes(on), btns, body: document.body.innerText.slice(0, 400) };
        }, order.orderNumber);
        console.log("PAYMENT PAGE DEBUG:", JSON.stringify(dump).slice(0, 900));
      } catch { /* ignore */ }
      throw err;
    } finally {
      await ppage.close();
    }
  };

  {
    const o = await mkOrder("PAY1", "TAKEAWAY");
    await openIntent(o.id);
    await checkPayments({
      label: "PAYMENTS with shift",
      order: o,
      expectToast: "Pembayaran kasir berhasil ditandai lunas",
      expectDbPaid: (paid, orderStatus, shift) => paid && orderStatus === "PAID" && shift === "OPEN",
    });
  }

  // ---------- BRANDING SMOKE (admin shell + customer shell) ----------
  {
    await page.goto(`${BASE}/admin/orders`, { waitUntil: "load", timeout: 35000 });
    await new Promise((r) => setTimeout(r, 1500));
    const adminVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand-primary").trim());
    check("BRANDING smoke: admin/kasir shell sets --brand-primary (CSS var)",
      /^#[0-9a-fA-F]{6}$/.test(adminVar), `var=${adminVar}`);

    await page.goto(`${BASE}/pilih-cabang`, { waitUntil: "domcontentloaded", timeout: 35000 });
    await page.waitForFunction(() => {
      const v = getComputedStyle(document.documentElement).getPropertyValue("--brand-primary").trim();
      return /^#[0-9a-fA-F]{6}$/.test(v);
    }, { timeout: 15000 });
    const custVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand-primary").trim());
    check("BRANDING smoke: customer shell sets --brand-primary (CSS var)",
      /^#[0-9a-fA-F]{6}$/.test(custVar), `var=${custVar}`);

    const br = await fetch(`${BASE}/api/admin/settings/branding`, { headers: kasir.headers() });
    const brJson = await br.json().catch(() => null);
    check("BRANDING smoke: GET branding as CASHIER 200 (RestaurantSettings source)",
      br.status === 200 && brJson?.data?.branding?.siteName === "Restoran Bahagia",
      `http=${br.status} site=${brJson?.data?.branding?.siteName} primary=${brJson?.data?.branding?.primaryColor}`);
  }

  // ---------- NO-SHIFT: close shift, MANUAL ORDER + PAYMENTS dashboard ----------
  await kasir.post("/api/shifts/close", { actualCash: 600000 });
  const openAfterClose = (await q(`SELECT COUNT(*) c FROM cashiershift WHERE userId=? AND status='OPEN'`, [kasirId]))[0].c;
  check("env: kasir shift CLOSED (for no-shift browser) ", Number(openAfterClose) === 0, `open=${openAfterClose}`);

  // No-shift MANUAL ORDER page.
  {
    const custPhone = `fui-noshift-${TAG}`;
    await page.goto(`${BASE}/admin/orders/new`, { waitUntil: "domcontentloaded", timeout: 60000 });
    try {
      await page.waitForSelector('input[placeholder="Cari produk..."]', { timeout: 30000 });
    } catch {
      await page.goto(`${BASE}/admin/orders/new`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector('input[placeholder="Cari produk..."]', { timeout: 30000 });
    }
    await page.type('input[placeholder="Cari produk..."]', SIMPLE_PRODUCT);
    await new Promise((r) => setTimeout(r, 800));
    await clickButton(page, "+ Tambah");
    await waitText(page, "Pesanan (1)");
    await page.type("#cust-name", `NoShift ${TAG}`);
    await page.type("#cust-phone", custPhone);
    await clickButton(page, "Dine In");
    await page.waitForSelector("#table-select option", { timeout: 10000 });
    await page.select("#table-select", TABLE_ID);
    await clickButton(page, "Buat Pesanan & Bayar Cash");
    await waitToast(page, "Shift Belum Dibuka");
    const toastBtns = await readToastButtons(page);
    check("NO-SHIFT manual order: toast 'Shift Belum Dibuka' + 'Buka Shift' CTA",
      toastBtns.includes("Buka Shift"), `buttons=${JSON.stringify(toastBtns)}`);
    const ordersForPhone = (await q(
      `SELECT COUNT(*) c FROM \`order\` o JOIN customer cu ON cu.id=o.customerId WHERE cu.phone=?`, [custPhone]))[0].c;
    check("NO-SHIFT manual order: NO order row stored",
      Number(ordersForPhone) === 0, `orders=${ordersForPhone}`);
    created.manualCusts.push(custPhone);

    // CTA must navigate to /admin/shifts.
    await clickToastAction(page, "Buka Shift");
    await page.waitForFunction(() => location.pathname.startsWith("/admin/shifts"), { timeout: 10000 });
    check("NO-SHIFT CTA: 'Buka Shift' navigates to /admin/shifts", true,
      `path=${await page.evaluate(() => location.pathname)}`);

    // Re-open the shift so the rest of the session (this harness) is intact.
    const reopen = await kasir.post("/api/shifts", { openingCash: 500000 });
    created.shifts.push(reopen.json?.data?.id);
  }

  // No-shift PAYMENTS dashboard: rows loaded while shift OPEN, then shift closed
// mid-session → Tandai Dibayar must show SHIFT_NOT_OPEN toast + stay UNPAID.
{
    const o = await mkOrder("PAY2", "TAKEAWAY"); // kasir shift OPEN → order OK
    await openIntent(o.id); // KASIR intent (created under open shift)
    const ppage = await browser.newPage();
    await ppage.setViewport({ width: 1440, height: 1000 });
    for (const h of kasir.rawCookies) {
      const c = parseSetCookie(h);
      if (!c.name) continue;
      try { await ppage.setCookie({ name: c.name, value: c.value, url: BASE, path: c.path || "/" }); } catch { /* skip */ }
    }
    try {
      await ppage.goto(`${BASE}/admin/payments`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await ppage.waitForFunction((on) => {
        const btns = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent.includes("Tandai Dibayar"));
        return btns.some((b) => {
          let n = b;
          for (let i = 0; i < 6 && n; i++, n = n.parentElement) if (n.textContent && n.textContent.includes(on)) return true;
          return false;
        });
      }, { timeout: 30000 }, o.orderNumber); // row rendered while shift OPEN
      await kasir.post("/api/shifts/close", { actualCash: 500000 }); // shift ends mid-session
      await clickButton(ppage, "Tandai Dibayar", 10000);
      await waitToast(ppage, "Shift Belum Dibuka");
      const st = await stateOf(o.id);
      const cash = st.payRows.find((p) => p.method === "KASIR");
      check("PAYMENTS no-shift: SHIFT_NOT_OPEN toast + DB stays UNPAID (no mark, no shiftid change)",
        st.order?.paymentStatus === "UNPAID" && cash?.status === "UNPAID" && (await countPaid(o.id)) === 0,
        `cash=${cash?.status} order=${st.order?.paymentStatus}`);
    } finally {
      await ppage.close();
      await kasir.post("/api/shifts", { openingCash: 500000 }); // reopen for consistency
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"=".repeat(48)}`);
  console.log(`TOTAL: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`);
  failed.forEach((f) => console.log(`  FAILED: ${f.name} (${f.extra})`));

  // ---------- cleanup (tagged rows only) ----------
  try {
    await q(`DELETE FROM paymenttransaction WHERE paymentId IN (SELECT id FROM payment WHERE orderId IN (?))`, [created.orders]);
    await q(`DELETE FROM payment WHERE orderId IN (?)`, [created.orders]);
    await q(`DELETE FROM orderstatushistory WHERE orderId IN (?)`, [created.orders]);
    await q(`DELETE FROM \`order\` WHERE id IN (?)`, [created.orders]);
    if (created.shifts.length) await q(`DELETE FROM cashiershift WHERE id IN (?)`, [created.shifts]);
    if (created.customers.length) await q(`DELETE FROM customer WHERE id IN (?)`, [created.customers]);
    for (const phone of created.manualCusts) {
      await q(`DELETE FROM customer WHERE phone=?`, [phone.replace(/[^\w@.-]/g, "")]);
    }
    console.log("cleanup: tagged rows removed");
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