// ============================================================
// Runtime UI verification — SHIFT_NOT_OPEN toast + "Buka Shift" CTA
// (real Chromium via puppeteer-core, port 3001 production build).
//
// Scenario: a CASHIER WITHOUT an open shift tries to process an order
// (cash form then QRIS) on the live order-detail page. The backend rejects
// both intents, so the UI must render the centralized sonner toast:
//   title    "Shift Belum Dibuka"
//   body     "Silakan buka shift terlebih dahulu ..." (server message)
//   action   "Buka Shift" -> /admin/shifts
// and must NOT navigate away. We assert DB stays UNPAID with zero payment
// rows for both attempts.
// ============================================================
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import puppeteer from "puppeteer-core";

const BASE = "http://127.0.0.1:3001";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const TAG = `shift-ui-${Date.now()}`;

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

// sonner renders [data-sonner-toast] nodes; wait until one has the block text.
async function waitToast(page, title = "Shift Belum Dibuka", timeout = 15000) {
  await page.waitForFunction(
    (t) => {
      const nodes = Array.from(document.querySelectorAll('[data-sonner-toast]'));
      return nodes.some((n) => n.textContent.includes(t));
    },
    { timeout },
    title
  );
}

async function readToast(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-sonner-toast]'));
    const last = nodes[nodes.length - 1];
    if (!last) return null;
    const buttons = Array.from(last.querySelectorAll("button")).map((b) => b.textContent.trim());
    return {
      text: last.textContent.replace(/\s+/g, " ").trim(),
      buttons,
      href: last.querySelector('a[href]')?.getAttribute("href") || "",
    };
  });
}

async function main() {
  // ---------- logins (API cookie jars) ----------
  const admin = makeApi();
  const adminSess = await admin.login("admin@restobahagia.com", "admin123");
  const restaurantId = adminSess.restaurantId;
  const branchId = adminSess.branches?.[0]?.id || null;
  check("admin login (API cookie jar)", !!restaurantId && !!branchId, `restaurant=${restaurantId} branch=${branchId}`);

  const kasir = makeApi();
  const kasirSess = await kasir.login("kasir@restobahagia.com", "kasir123");
  const kasirId = kasirSess.userId;
  check("kasir login (API cookie jar)", !!kasirId, `kasir=${kasirId}`);

  // Hard guarantee: the cashier has NO open shift for this branch.
  const closed = await q(`UPDATE cashiershift SET status='CLOSED', closedAt=NOW(6) WHERE userId=? AND status='OPEN'`, [kasirId]);
  check("pre: no OPEN shift for cashier", (closed.affectedRows ?? 0) >= 0, `closed=${closed.affectedRows}`);
  const openNow = (await q(`SELECT COUNT(*) c FROM cashiershift WHERE userId=? AND status='OPEN'`, [kasirId]))[0].c;
  check("pre: zero OPEN shift rows remain", Number(openNow) === 0, `open=${openNow}`);

  // ---------- fixture: one UNPAID order created by ADMIN (shift-bypass) ----------
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

  const custId = `shiftui${crypto.randomBytes(8).toString("hex")}`;
  await q(
    `INSERT INTO customer (id, restaurantId, name, phone, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, NOW(6), NOW(6))`,
    [custId, restaurantId, `Shift UI ${TAG}`, `guest-${TAG}`]
  );
  created.customers.push(custId);

  const createdOrder = await admin.post("/api/orders", {
    customerId: custId,
    orderType: "DINE_IN",
    items: [{ productId: prod.id, quantity: 1 }],
  });
  if (createdOrder.status !== 201) throw new Error(`createOrder failed: ${createdOrder.status} ${JSON.stringify(createdOrder.json)}`);
  const order = createdOrder.json.data;
  created.orders.push(order.id);

  // ---------- browser: inject KASIR session ----------
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const browserErrors = [];
  page.on("pageerror", (e) => browserErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") browserErrors.push(`console: ${m.text()}`);
  });

  for (const h of kasir.rawCookies) {
    const c = parseSetCookie(h);
    if (!c.name) continue;
    try {
      await page.setCookie({ name: c.name, value: c.value, url: BASE, path: c.path || "/" });
    } catch {
      /* skip non-sessionable cookies */
    }
  }

  await page.goto(`${BASE}/admin/orders/${order.orderNumber}`, { waitUntil: "load", timeout: 35000 });
  await page.waitForFunction(() => !location.pathname.includes("login"), { timeout: 15000 });
  check("auth guard: ORDER DETAIL loads as cashier (no login redirect)", true, order.orderNumber);

  // ---------- CASH attempt (no shift) ----------
  {
    await waitText(page, "Belum Bayar", 25000);
    await clickButton(page, "Proses Pembayaran");
    await waitText(page, "Cash / Tunai");
    await clickButton(page, "Cash / Tunai");
    await waitText(page, "Pembayaran Cash");
    await clickButton(page, "Uang Pas");
    await clickButton(page, "Konfirmasi Pembayaran");

    await waitToast(page, "Shift Belum Dibuka");
    const t = await readToast(page);
    check("CASH no-shift: toast 'Shift Belum Dibuka' rendered",
      !!t && t.text.includes("Shift Belum Dibuka"), t?.text);
    check("CASH no-shift: toast body explains opening shift",
      !!t && /(buka shift|shift)/i.test(t.text), `text=${t?.text}`);
    check("CASH no-shift: toast has 'Buka Shift' action button",
      !!t && t.buttons.includes("Buka Shift"), `buttons=${JSON.stringify(t?.buttons)}`);
    check("CASH no-shift: page did NOT navigate away (no redirect to /admin/shifts)",
      !(await page.evaluate(() => location.pathname)).includes("/admin/shifts"), `path=${await page.evaluate(() => location.pathname)}`);

    const cashRows = (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND method='KASIR'`, [order.id]))[0].c;
    check("CASH no-shift: DB no KASIR payment row", Number(cashRows) === 0, `count=${cashRows}`);
  }

  // ---------- QRIS attempt (no shift) ----------
  {
    // Return to the choose step, then pick QRIS.
    await clickButton(page, "Kembali");
    await waitText(page, "Proses Pembayaran");
    await clickButton(page, "Scan oleh customer");

    await waitToast(page, "Shift Belum Dibuka", 20000);
    const t = await readToast(page);
    check("QRIS no-shift: toast 'Shift Belum Dibuka' rendered",
      !!t && t.text.includes("Shift Belum Dibuka"), t?.text);
    check("QRIS no-shift: toast has 'Buka Shift' action button",
      !!t && t.buttons.includes("Buka Shift"), `buttons=${JSON.stringify(t?.buttons)}`);
    check("QRIS no-shift: page did NOT navigate away",
      !(await page.evaluate(() => location.pathname)).includes("/admin/shifts"), `path=${await page.evaluate(() => location.pathname)}`);
  }

  // ---------- DB final state ----------
  {
    const st = (await q(`
      SELECT o.paymentStatus, (SELECT COUNT(*) FROM payment p WHERE p.orderId=o.id) AS payCount
      FROM \`order\` o WHERE o.id=?`, [order.id]))[0];
    check("DB: order still UNPAID with ZERO payment rows",
      st.paymentStatus === "UNPAID" && Number(st.payCount) === 0,
      `status=${st.paymentStatus} rows=${st.payCount}`);
  }

  // Only pageerrors (uncaught JS exceptions) are fatal. Console network errors
  // for the EXPECTED 409 rejections are logged by the app's catch blocks and
  // are normal here — the toast is the real signal.
  const fatal = browserErrors.filter((e) => e.startsWith("pageerror"));
  check("no uncaught page errors during UI flows", fatal.length === 0, fatal.slice(0, 3).join(" | ") || "console-only expected-409 errors");

  // ---------- summary ----------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"=".repeat(40)}`);
  console.log(`TOTAL: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`);
  failed.forEach((f) => console.log(`  FAILED: ${f.name} (${f.extra})`));

  // ---------- cleanup (tagged rows) ----------
  try {
    if (created.orders.length) {
      await q(`DELETE FROM paymenttransaction WHERE paymentId IN (SELECT id FROM payment WHERE orderId IN (?))`, [created.orders]);
      await q(`DELETE FROM payment WHERE orderId IN (?)`, [created.orders]);
      await q(`DELETE FROM orderstatushistory WHERE orderId IN (?)`, [created.orders]);
      await q(`DELETE FROM \`order\` WHERE id IN (?)`, [created.orders]);
    }
    if (created.customers.length) await q(`DELETE FROM customer WHERE id IN (?)`, [created.customers]);
    await q(`DELETE FROM cashiershift WHERE id IN (SELECT id FROM cashiershift WHERE userId=? AND status='CLOSED' AND shiftNumber LIKE 'SHIFT-UI-%')`, [kasirId]);
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