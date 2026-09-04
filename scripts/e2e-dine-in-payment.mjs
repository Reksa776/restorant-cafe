// PHASE — DINE-IN PAYMENT METHOD: QRIS + KASIR
//
// Real Chrome E2E against the dev server (localhost:3000):
//  - KASIR flow: QR → guest count → menu → checkout shows ONLY QRIS/Kasir
//    (no tax/service rows) → order + UNPAID KASIR payment row atomically →
//    admin gets ORDER_CREATED realtime → sees "Bayar di Kasir" +
//    "Tandai Sudah Dibayar" → PAID + paidAt + PAYMENT_STATUS_CHANGED
//    realtime → no double payment → customer refresh shows PAID.
//  - QRIS flow: checkout default QRIS → gateway request (amount =
//    grandTotal) → PENDING QRIS payment + QrImage when the gateway accepts
//    → customer lands on the APP's own /payment/<order> page (QR image,
//    countdown, polling — never a raw iPaymu redirect; graceful recovery on
//    the order page when the gateway is unreachable) → webhook pipeline
//    (signed iPaymu callback) → PAID on the payment page too, realtime to
//    admin, amount mismatch rejected, duplicate payment idempotent.
//  - TAKEAWAY/DELIVERY regression: legacy gateway flow unchanged, no
//    QRIS/Kasir selector, paymentMethod rejected server-side.
//
// NOTE: the QRIS leg completes LIVE against the iPaymu sandbox when the
// configured credentials accept /payment/direct (they do in this
// environment since the buyer phone/email fallback fix). When the gateway
// is unreachable or rejects, the app must still fall back to the order page
// with payment UNPAID and offer recovery actions — both branches are
// asserted below. The webhook handler is driven with a REAL HMAC signature
// (same algorithm the provider validates).
import puppeteer from "puppeteer-core";
import { createConnection } from "mysql2/promise";
import crypto from "node:crypto";
import fs from "node:fs";
import QRCode from "qrcode";

const BASE = "http://localhost:3000";
// Cross-platform Chrome discovery: CHROME_PATH env > common macOS/Windows
// locations (this repo is developed on both).
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].filter(Boolean);
const CHROME = chromeCandidates.find((p) => fs.existsSync(p)) || chromeCandidates[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

// ---------------------------------------------------------------
// .env helpers (never printed)
// ---------------------------------------------------------------
function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  return env;
}
const ENV = loadEnv();
const IPAYMU_VA = ENV.IPAYMU_VA || "";

// The app reads DATABASE_URL from .env; default to the legacy local MySQL
// (docker at 3306) when .env is missing/unparseable.
let dbConfig = {
  host: "localhost",
  port: 3306,
  user: "root",
  password: "",
  database: "restaurant_app",
};
const dbUrlMatch = (ENV.DATABASE_URL || "").match(
  /^mysql:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/(.+)$/
);
if (dbUrlMatch) {
  dbConfig = {
    host: dbUrlMatch[3],
    port: Number(dbUrlMatch[4]),
    user: dbUrlMatch[1],
    password: dbUrlMatch[2],
    database: dbUrlMatch[5],
  };
}
const conn = await createConnection(dbConfig);

const q = async (sql, args) => (await conn.query(sql, args))[0];

// ---------------------------------------------------------------
// DB fixtures
// ---------------------------------------------------------------
const tag = Date.now().toString().slice(-7);
const customerNameKasir = `E2EPAY-K ${tag}`;
const customerNameQris = `E2EPAY-Q ${tag}`;

const [t1] = await q("SELECT id, restaurantId, number FROM `Table` WHERE number = 1");
const [t2] = await q("SELECT id, restaurantId, number FROM `Table` WHERE number = 2");
const restaurantId = t1.restaurantId;

// Products WITHOUT active option groups are direct-add ("+ Tambah").
const plainProds = await q(
  `SELECT p.id, p.name, p.price FROM Product p
   WHERE p.isActive = 1 AND p.isAvailable = 1
     AND NOT EXISTS (SELECT 1 FROM ProductOptionGroup g
                     WHERE g.productId = p.id AND g.isActive = 1)
   ORDER BY p.name LIMIT 2`
);
const plain1 = plainProds[0];
const plain2 = plainProds[1];
// A customizable product to prove customization still works in checkout.
const [caffe] = await q(
  "SELECT p.id, p.name, p.price FROM Product p WHERE p.name = 'Minuman Caffe 1' AND p.isActive = 1 AND p.isAvailable = 1 LIMIT 1"
);
const caffeOptions = await q(
  `SELECT o.name, o.priceAdjustment FROM ProductOption o
   JOIN ProductOptionGroup g ON o.optionGroupId = g.id
   WHERE g.productId = ? AND o.isActive = 1 AND g.isActive = 1`,
  [caffe.id]
);
if (!t1 || !t2 || !plain1 || !plain2 || !caffe) {
  console.log("DB fixtures missing — cannot run E2E");
  process.exit(1);
}
console.log("Fixtures:", JSON.stringify({
  table1: t1.number, table2: t2.number,
  plain1: plain1.name, plain2: plain2.name,
  caffe: caffe.name, caffeOptions: caffeOptions.map((o) => o.name),
}));

// Make sure the tables used by the test are free.
await q("UPDATE `Table` SET status='AVAILABLE' WHERE id IN (?, ?)", [t1.id, t2.id]);

// Clear leftovers of previous runs (same naming tag pattern).
const leftoverCusts = await q("SELECT id FROM Customer WHERE name LIKE 'E2EPAY-%'");
if (leftoverCusts.length) {
  const custIds = leftoverCusts.map((c) => c.id);
  const leftOrders = await q("SELECT id FROM `Order` WHERE customerId IN (?)", [custIds]);
  if (leftOrders.length) {
    const orderIds = leftOrders.map((o) => o.id);
    await q("DELETE FROM Payment WHERE orderId IN (?)", [orderIds]);
    await q("DELETE FROM `Order` WHERE id IN (?)", [orderIds]);
  }
  await q("DELETE FROM Customer WHERE id IN (?)", [custIds]);
}

// ---------------------------------------------------------------
// Browser plumbing
// ---------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: 1280, height: 900 },
  args: ["--no-sandbox"],
});
const errorsByPage = new Map();
const newPage = async (tagName) => {
  const p = await browser.newPage();
  errorsByPage.set(tagName, []);
  p.on("pageerror", (e) => errorsByPage.get(tagName).push("pageerror: " + String(e).slice(0, 160)));
  p.on("console", (m) => {
    if (m.type() === "error") errorsByPage.get(tagName).push("console: " + m.text().slice(0, 160));
  });
  return p;
};
async function waitOn(page, fn, timeout = 20000, label = "", ...args) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await page.evaluate(fn, ...args);
      if (v) return true;
    } catch {}
    await sleep(300);
  }
  return false;
}
const waitText = (page, text, timeout = 20000) =>
  waitOn(page, (t) => (document.body.innerText || "").includes(t), timeout, `text ${text}`, text);
// Poll a DB predicate until true (no page involved).
const waitDb = async (fn, timeout = 15000, label = "") => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await fn()) return true;
    } catch {}
    await sleep(300);
  }
  return false;
};
// Wait until an order number is known (Node side) AND the page sits on
// /order/<number> (browser side).
const waitOrderPage = async (page, getOrderNumber, timeout = 25000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const num = getOrderNumber();
    if (num) {
      const onPage = await page
        .evaluate((n) => location.pathname.startsWith(`/order/${n}`), num)
        .catch(() => false);
      if (onPage) return true;
    }
    await sleep(300);
  }
  return false;
};
// Same, but for the app's own QRIS payment page /payment/<number>.
const waitPaymentPage = async (page, getOrderNumber, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const num = getOrderNumber();
    if (num) {
      const onPage = await page
        .evaluate((n) => location.pathname.startsWith(`/payment/${n}`), num)
        .catch(() => false);
      if (onPage) return true;
    }
    await sleep(300);
  }
  return false;
};
// True when the payment page shows the QRIS <img> (data URI or https URL).
const paymentPageHasQr = () => {
  const img = document.querySelector("img[alt='QRIS']");
  return !!img && img.src.length > 0 &&
    (img.src.startsWith("data:image") || img.src.startsWith("http"));
};

// ---------------------------------------------------------------
// ADMIN login (shared session for A + G)
// ---------------------------------------------------------------
const A = await newPage("admin-orders");
await A.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
await A.type('input[type="email"]', "admin@restobahagia.com", { delay: 5 });
await A.type('input[type="password"]', "admin123", { delay: 5 });
await A.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Masuk");
  if (b) b.click();
});
const adminLoggedIn = await waitOn(A, () => location.pathname.startsWith("/admin"), 20000, "login");
if (!adminLoggedIn) {
  await A.goto(`${BASE}/admin/orders`, { waitUntil: "domcontentloaded", timeout: 60000 });
}
await A.goto(`${BASE}/admin/orders`, { waitUntil: "domcontentloaded", timeout: 60000 });
await waitText(A, "Pesanan", 30000);

const G = await newPage("admin-payments");
await G.goto(`${BASE}/admin/payments`, { waitUntil: "domcontentloaded", timeout: 60000 });
await waitText(G, "Daftar Pembayaran", 30000);

// ============================================================
// FLOW A — DINE-IN KASIR (table 1)
// ============================================================
const anonK = await browser.createBrowserContext();
const K = await anonK.newPage();
K.on("pageerror", (e) => console.log("[K pageerror]", String(e).slice(0, 160)));
let kasirOrderNumber = null;
let kasirOrderId = null;

K.on("response", async (res) => {
  try {
    if (res.url().endsWith("/public/orders") && res.request().method() === "POST") {
      const j = await res.json();
      if (j?.data?.orderNumber) {
        kasirOrderNumber = j.data.orderNumber;
        const rows = await q("SELECT id FROM `Order` WHERE orderNumber = ?", [j.data.orderNumber]);
        if (rows[0]) kasirOrderId = rows[0].id;
      }
    }
  } catch {}
});

// ---- TEST1: QR → guest count → menu ----
await K.goto(`${BASE}/t/1`, { waitUntil: "networkidle2" });
check("TEST1 QR landing shows Meja 1 + welcome", await waitText(K, "Selamat Datang") && await waitText(K, "Meja 1"));
await K.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "+");
  if (b) b.click(); // 1 → 2
});
await sleep(250);
check("TEST1 visitor count = 2", (await K.evaluate(() => document.querySelector('input[type="number"]').value)) === "2");
await K.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Mulai Pesan"));
  if (b) b.click();
});
check("TEST1 navigates to menu", await waitText(K, "Makanan") && K.url().includes("/menu"));
const tableCtx = await K.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem("table_context"));
  } catch {
    return null;
  }
});
check("TEST1 table context persisted (table 1, 2 pax)", !!tableCtx && tableCtx.tableNumber === 1 && tableCtx.visitorCount === 2 && tableCtx.tableId === t1.id, JSON.stringify(tableCtx));

// ---- TEST2: add products (plain direct-add + customized modal) ----
const addPlain = async (page, name) => {
  await page.evaluate((pname) => {
    const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === pname);
    let el = h3 && h3.parentElement;
    while (el && el !== document.body) {
      const btn = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("+ Tambah"));
      if (btn) {
        btn.click();
        return;
      }
      el = el.parentElement;
    }
  }, name);
  await sleep(900);
};
await addPlain(K, plain1.name);
await addPlain(K, plain2.name);

// Customized caffe — pick the first priced option to prove customizations.
await K.evaluate((pname) => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === pname);
  let el = h3 && h3.parentElement;
  while (el && el !== document.body) {
    const btn = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Pilih Produk"));
    if (btn) {
      btn.click();
      return;
    }
    el = el.parentElement;
  }
}, caffe.name);
check("TEST2 customization modal opens", await waitText(K, "Tambah ke Keranjang"));
const optToPick = caffeOptions.find((o) => Number(o.priceAdjustment) > 0) || caffeOptions[0];
await K.evaluate((optName) => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent && x.textContent.trim().startsWith(optName));
  if (b) b.click();
}, optToPick.name);
await sleep(300);
await K.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent && x.textContent.includes("Tambah ke Keranjang"));
  if (b) b.click();
});
await sleep(1200);
const kCart = await K.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem("restaurant_cart")).items.map((i) => ({ n: i.name, q: i.quantity }));
  } catch {
    return [];
  }
});
check("TEST2 three items in cart (2 plain + customized)", kCart.length === 3 && kCart.some((i) => i.n === caffe.name), JSON.stringify(kCart));

// ---- TEST3/5: checkout ----
await K.goto(`${BASE}/checkout`, { waitUntil: "networkidle2" });
await waitText(K, "Meja 1");
check("TEST3 checkout shows table + visitors", (await K.evaluate(() => document.body.innerText)).includes("2 pengunjung"));
let kBody = await K.evaluate(() => document.body.innerText);
check("TEST3 checkout lists only picked items", [plain1.name, plain2.name, caffe.name].every((n) => kBody.includes(n)));
check("TEST3 customization summary visible", kBody.includes(optToPick.name), optToPick.name);
check("TEST5 no Pajak / Service Charge / PPN on DINE-IN checkout",
  !["Pajak", "Tax", "Service Charge", "Biaya pelayanan", "PPN", "PPn"].some((w) => kBody.includes(w)),
  "");
await K.screenshot({ path: "shots/payment-kasir-checkout.png" });

// ---- TEST4: only QRIS + Kasir ----
const selectorOk =
  kBody.includes("Metode Pembayaran") &&
  kBody.includes("Bayar menggunakan QRIS") &&
  kBody.includes("Bayar langsung di kasir");
const noForbidden = ![
  "Virtual Account", "Transfer Bank", "E-Wallet", "Bayar di tempat",
  "COD", "OVO", "DANA", "GoPay", "Kartu Kredit",
].some((w) => kBody.includes(w));
check("TEST4 checkout shows QRIS + Kasir only", selectorOk && noForbidden, "");

// ---- TEST6: pick Kasir ----
await K.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Bayar langsung di kasir"));
  if (b) b.click();
});
await sleep(350);
const kasirSelected = await K.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const kasir = btns.find((b) => (b.textContent || "").includes("Bayar langsung di kasir"));
  return kasir && kasir.getAttribute("aria-pressed") === "true";
});
check("TEST6 Kasir method selected (aria-pressed)", !!kasirSelected);
const submitLabel = await K.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Konfirmasi Pesanan"));
  return btn ? btn.textContent.trim() : "";
});
check("TEST6 submit label = Konfirmasi Pesanan", submitLabel.includes("Konfirmasi Pesanan"), submitLabel);
await K.type('input[placeholder*="Masukkan nama"]', customerNameKasir, { delay: 5 });
await K.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Konfirmasi Pesanan"));
  if (b) b.click();
});

// ---- TEST7/8: order + UNPAID KASIR payment ----
const kasirDone = await waitOrderPage(K, () => kasirOrderNumber);
check("TEST7 order created & redirected to order page", kasirDone && !!kasirOrderNumber, `order=${kasirOrderNumber}`);
check("TEST7 customer sees kasir message", await waitText(K, "Silakan lakukan pembayaran di kasir."));
const kOrders = await q("SELECT * FROM `Order` WHERE orderNumber = ?", [kasirOrderNumber]);
const kOrder = kOrders[0];
const kPayments = await q("SELECT * FROM Payment WHERE orderId = ? ORDER BY createdAt DESC", [kOrder.id]);
check("TEST8 DB: exactly one order (no duplicate)", kOrders.length === 1, `rows=${kOrders.length}`);
check("TEST8 DB: payment UNPAID + method KASIR (single row)",
  kPayments.length === 1 &&
    kPayments[0].method === "KASIR" &&
    kPayments[0].status === "UNPAID" &&
    kPayments[0].provider === null,
  JSON.stringify(kPayments.map((p) => ({ m: p.method, s: p.status }))));
check("TEST8 DB: order DINE_IN table1 visitor=2 UNPAID totals tax=0 service=0",
  kOrder.orderType === "DINE_IN" &&
    kOrder.tableId === t1.id &&
    Number(kOrder.visitorCount) === 2 &&
    kOrder.paymentStatus === "UNPAID" &&
    Number(kOrder.tax) === 0 &&
    Number(kOrder.serviceCharge) === 0 &&
    Number(kOrder.grandTotal) === Number(kOrder.subtotal),
  JSON.stringify({ sub: kOrder.subtotal, tax: kOrder.tax, svc: kOrder.serviceCharge, grand: kOrder.grandTotal }));
check("TEST8 DB: KASIR payment amount = grandTotal (= subtotal)",
  Number(kPayments[0].amount) === Number(kOrder.grandTotal),
  `amount=${kPayments[0].amount} grand=${kOrder.grandTotal}`);

// ---- TEST9/10: admin realtime + sees cashier action ----
check("TEST9 ORDER_CREATED → admin orders page (no refresh)", await waitText(A, kasirOrderNumber, 30000), kasirOrderNumber);
const adminCardShowsCashier = await waitOn(
  A,
  (num) => {
    const cards = [...document.querySelectorAll('[data-slot="card"]')];
    const card = cards.find((c) => (c.textContent || "").includes(num));
    if (!card) return false;
    const t = card.textContent || "";
    return t.includes("Bayar di Kasir") && t.includes("Tandai Sudah Dibayar");
  },
  30000,
  "cashier info on card",
  kasirOrderNumber
);
check("TEST10 admin sees 'Bayar di Kasir' + 'Tandai Sudah Dibayar'", !!adminCardShowsCashier, "");

// ---- TEST11: admin clicks mark paid ----
const clicked = await A.evaluate((num) => {
  const cards = [...document.querySelectorAll('[data-slot="card"]')];
  const card = cards.find((c) => (c.textContent || "").includes(num));
  if (!card) return false;
  const btn = [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Tandai Sudah Dibayar"));
  if (!btn) return false;
  btn.click();
  return true;
}, kasirOrderNumber);
check("TEST11 admin clicked 'Tandai Sudah Dibayar'", !!clicked);

// ---- TEST12: payment PAID + order status untouched ----
const paidDb = await waitDb(async () => {
  const p = await q("SELECT status, paidAt FROM Payment WHERE orderId = ?", [kOrder.id]);
  return p.length === 1 && p[0].status === "PAID" && p[0].paidAt !== null;
}, 15000, "kasir payment PAID in DB");
check("TEST12 DB: KASIR payment PAID + paidAt stored", !!paidDb, "");
const afterPaid = await q("SELECT paymentStatus, status FROM `Order` WHERE id = ?", [kOrder.id]);
check("TEST12 order.paymentStatus = PAID (order.status still PENDING — not mixed)",
  afterPaid[0].paymentStatus === "PAID" && afterPaid[0].status === "PENDING",
  JSON.stringify(afterPaid[0]));
const cardPaidUi = await waitOn(
  A,
  (num) => {
    const cards = [...document.querySelectorAll('[data-slot="card"]')];
    const card = cards.find((c) => (c.textContent || "").includes(num));
    if (!card) return false;
    const t = card.textContent || "";
    return t.includes("Lunas") && !t.includes("Tandai Sudah Dibayar");
  },
  25000,
  "card shows Lunas & button gone",
  kasirOrderNumber
);
check("TEST12 card now Lunas, 'Tandai Sudah Dibayar' button gone (realtime)", !!cardPaidUi, "");

// ---- TEST13: payments page PAID live (PAYMENT_STATUS_CHANGED) ----
const paymentRowPaid = await waitOn(
  G,
  (num) => {
    const body = document.body.innerText || "";
    const blocks = [...document.querySelectorAll("div")].filter((d) => (d.textContent || "").includes(num) && (d.textContent || "").length < 900);
    return blocks.some((b) => (b.textContent || "").includes("PAID") || (b.textContent || "").includes("Lunas"));
  },
  25000,
  "payment row PAID on payments page",
  kasirOrderNumber
);
check("TEST13 admin payments page shows PAID/Lunas (no refresh)", !!paymentRowPaid, "");

// ---- TEST14: no double payment (second attempt → 409, single audit) ----
const again = await A.evaluate(
  async (pid) => {
    const res = await fetch(`/api/payments/${pid}/mark-paid`, { method: "POST" });
    let j = null;
    try {
      j = await res.json();
    } catch {}
    return { status: res.status, message: j?.message ?? null };
  },
  kPayments[0].id
);
const afterAgain = await q("SELECT status FROM Payment WHERE orderId = ?", [kOrder.id]);
const kAuditCount = await q("SELECT COUNT(*) n FROM PaymentTransaction WHERE paymentId = ?", [kPayments[0].id]);
check("TEST14 second mark-paid blocked (409 'Payment already completed', single PAID row + single audit)",
  again.status === 409 &&
    again.message === "Payment already completed" &&
    afterAgain.length === 1 &&
    afterAgain[0].status === "PAID" &&
    kAuditCount[0].n === 1,
  JSON.stringify(again));
const dupKasirAttempt = await K.evaluate(
  async (num) => {
    const res = await fetch("/api/public/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNumber: num, method: "KASIR" }),
    });
    return { status: res.status };
  },
  kasirOrderNumber
);
const kPaymentsAfter = await q("SELECT id FROM Payment WHERE orderId = ?", [kOrder.id]);
check("TEST14 customer cannot create a second KASIR payment on PAID order",
  dupKasirAttempt.status >= 400 && kPaymentsAfter.length === 1, `status=${dupKasirAttempt.status}`);

// ---- TEST15: customer refresh keeps correct state ----
await K.reload({ waitUntil: "networkidle2" });
await sleep(1500);
const kRefreshed = await K.evaluate(() => document.body.innerText || "");
check("TEST15 refresh: customer sees PAID + Kasir method",
  kRefreshed.includes("Pembayaran berhasil") && kRefreshed.includes("Kasir"),
  "");

// ============================================================
// FLOW B — DINE-IN QRIS (table 2)
// ============================================================
const anonQ = await browser.createBrowserContext();
const Q = await anonQ.newPage();
Q.on("pageerror", (e) => console.log("[Q pageerror]", String(e).slice(0, 160)));
let qrisOrderNumber = null;
let qrisOrderId = null;
let qrisPayResponse = null; // { status, data } of the payment attempt

Q.on("response", async (res) => {
  try {
    const u = res.url();
    if (u.endsWith("/public/orders") && res.request().method() === "POST") {
      const j = await res.json();
      if (j?.data?.orderNumber) {
        qrisOrderNumber = j.data.orderNumber;
        const rows = await q("SELECT id FROM `Order` WHERE orderNumber = ?", [qrisOrderNumber]);
        if (rows[0]) qrisOrderId = rows[0].id;
      }
    }
    if (u.endsWith("/public/payments") && res.request().method() === "POST") {
      try {
        qrisPayResponse = { status: res.status(), body: await res.json() };
      } catch {
        qrisPayResponse = { status: res.status(), body: null };
      }
    }
  } catch {}
});

await Q.goto(`${BASE}/t/2`, { waitUntil: "networkidle2" });
await waitText(Q, "Meja 2");
await Q.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Mulai Pesan"));
  if (b) b.click();
});
await waitText(Q, "Makanan");
await addPlain(Q, plain1.name);
await addPlain(Q, plain2.name);
await Q.goto(`${BASE}/checkout`, { waitUntil: "networkidle2" });
await waitText(Q, "Meja 2");

// ---- TEST16: QRIS default selected ----
let qBody = await Q.evaluate(() => document.body.innerText);
check("TEST16 QRIS flow starts at checkout",
  qBody.includes("Metode Pembayaran") && qBody.includes("QRIS") && qBody.includes("Bayar langsung di kasir"));
const qrisDefault = await Q.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Bayar menggunakan QRIS"));
  return b && b.getAttribute("aria-pressed") === "true";
});
check("TEST16 QRIS is the default method (aria-pressed)", !!qrisDefault);
const qrisSubmitLabel = await Q.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent && x.textContent.includes("Konfirmasi & Bayar"));
  return b ? b.textContent.trim() : "";
});
check("TEST16 submit = Konfirmasi & Bayar", qrisSubmitLabel.includes("Konfirmasi & Bayar"), qrisSubmitLabel);
await Q.type('input[placeholder*="Masukkan nama"]', customerNameQris, { delay: 5 });
await Q.screenshot({ path: "shots/payment-qris-checkout.png" });
await Q.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent && x.textContent.includes("Konfirmasi & Bayar"));
  if (b) b.click();
});

// ---- TEST16b/17: order created; redirect target decided by gateway ----
// QRIS customers now land on the APP's payment page (/payment/<order>) —
// never on the raw iPaymu page. Only a gateway failure falls back to the
// order page (with recovery actions).
const qrisOnPaymentPage = await waitPaymentPage(Q, () => qrisOrderNumber, 30000);
let qrisOnOrderPage = false;
if (!qrisOnPaymentPage && qrisOrderNumber) {
  qrisOnOrderPage = await Q
    .evaluate((n) => location.pathname.startsWith(`/order/${n}`), qrisOrderNumber)
    .catch(() => false);
}
check("TEST16 order created via QRIS flow → app payment page (or order page on gateway failure)",
  (qrisOnPaymentPage || qrisOnOrderPage) && !!qrisOrderNumber,
  `order=${qrisOrderNumber} onPayment=${qrisOnPaymentPage}`);
// Gateway result decides the branch: when it rejects, the app must fall back
// to the order page with payment still UNPAID; when it accepts, a PENDING
// QRIS row with QrImage/QrString exists.
const qOrders = await q("SELECT * FROM `Order` WHERE orderNumber = ?", [qrisOrderNumber]);
const qOrder = qOrders[0];
const qPayRows = await q("SELECT * FROM Payment WHERE orderId = ?", [qOrder.id]);
const gatewayFailed = qrisPayResponse && qrisPayResponse.status >= 400;
if (gatewayFailed) {
  check("TEST16 QRIS gateway unavailable → order page + recovery actions (graceful)",
    await waitText(Q, "Bayar QRIS") &&
      await waitText(Q, "Bayar di Kasir") &&
      qrisOnOrderPage,
    `payStatus=${qrisPayResponse.status}`);
} else {
  // Credentials working: a PENDING QRIS payment exists with QR data (the
  // page must already be sitting on /payment/<order> from the redirect).
  check("TEST16 QRIS payment created (PENDING + QrImage)",
    qPayRows.length === 1 && qPayRows[0].status === "PENDING" &&
      !!qPayRows[0].qrImage && !!qPayRows[0].paymentUrl,
    JSON.stringify({ n: qPayRows.length, s: qPayRows[0]?.status, hasQr: !!qPayRows[0]?.qrImage }));
  if (!qrisOnPaymentPage) {
    await Q.goto(`${BASE}/payment/${qrisOrderNumber}`, { waitUntil: "networkidle2" });
  }
  await sleep(1500);
  const payBody = await Q.evaluate(() => document.body.innerText || "");
  check("TEST16 payment page header 'Pembayaran Pesanan' + order number",
    payBody.includes("Pembayaran Pesanan") && payBody.includes(qrisOrderNumber), "");
  check("TEST16 payment page total = order grandTotal",
    payBody.includes("Rp" + Number(qOrder.grandTotal).toLocaleString("id-ID")),
    `grand=${qOrder.grandTotal}`);
  check("TEST16 payment page shows QR image from iPaymu (img[alt=QRIS])",
    await waitOn(Q, paymentPageHasQr, 15000, "qr img"));
  check("TEST16 payment page shows 'Menunggu pembayaran...' status",
    (await Q.evaluate(() => document.body.innerText || "")).includes("Menunggu pembayaran"), "");
  // Back to the order page so the shared pending-resume checks below run there.
  await Q.goto(`${BASE}/order/${qrisOrderNumber}`, { waitUntil: "networkidle2" });
}
check("TEST17 QRIS order totals: tax=0 service=0 grandTotal=subtotal (payment amount source)",
  qOrders.length === 1 &&
    qOrder.orderType === "DINE_IN" &&
    qOrder.tableId === t2.id &&
    Number(qOrder.tax) === 0 &&
    Number(qOrder.serviceCharge) === 0 &&
    Number(qOrder.grandTotal) === Number(qOrder.subtotal),
  JSON.stringify({ sub: qOrder.subtotal, grand: qOrder.grandTotal, tax: qOrder.tax }));
check("TEST17 single order row (no duplicate on submit/refresh)",
  qOrders.length === 1 && Number(qOrder.visitorCount) === 1, `rows=${qOrders.length}`);

// Item-level recompute: server unit prices must match DB product/option math.
const qItems = await q("SELECT productId, quantity, unitPrice FROM OrderItem WHERE orderId = ?", [qOrder.id]);
const deepParse = (v) => {
  let out = v;
  while (typeof out === "string") {
    try {
      out = JSON.parse(out);
    } catch {
      break;
    }
  }
  return out;
};
let itemsRecomputeOk = qItems.length > 0;
let recomputed = 0;
for (const it of qItems) {
  const [prod] = await q("SELECT price FROM Product WHERE id = ?", [it.productId]);
  const [oi] = await q("SELECT customizations FROM OrderItem WHERE id = ?", [
    (await q("SELECT id FROM OrderItem WHERE orderId = ? AND productId = ? LIMIT 1", [qOrder.id, it.productId]))[0].id,
  ]);
  const cust = deepParse(oi.customizations);
  const sel = (cust?.selections || []).reduce((s, x) => s + Number(x.priceAdjustment || 0), 0);
  const addons = (cust?.addons || []).reduce((s, x) => s + Number(x.price || 0) * Number(x.quantity || 1), 0);
  const expectedUnit = Number(prod.price) + sel + addons;
  recomputed += expectedUnit * it.quantity;
  if (Number(it.unitPrice) !== expectedUnit) itemsRecomputeOk = false;
}
check("TEST17 server recomputed item prices from DB (selections/addons)",
  itemsRecomputeOk && Number(qOrder.subtotal) === recomputed,
  `subtotal=${qOrder.subtotal} recomputed=${recomputed}`);

// ---- TEST18: QRIS webhook pipeline → PAID ----
// Mirror the DB write the gateway flow performs after a successful sandbox
// response (createPayment only stores rows after provider success). If the
// gateway DID succeed above, the real row is reused instead.
let qrisPayment = qPayRows[0] || null;
if (!qrisPayment) {
  // Mirror exactly what the payment service writes after a successful
  // gateway response (PENDING + providerRef + paymentUrl + qrImage + qrString
  // + amount=grandTotal) and keep the order's payment-status mirror in sync
  // the same way createPayment does. qrImage is a real renderable data URI so
  // the payment page has something to display in the offline branch.
  const qrDataUri = await QRCode.toDataURL(`QRIS-E2E-${tag}`, { width: 240, margin: 1 });
  await q(
    `INSERT INTO Payment (id, restaurantId, orderId, status, amount, method, provider, providerRef, paymentUrl, qrImage, qrString, expiresAt, createdAt, updatedAt)
     VALUES (UUID(), ?, ?, 'PENDING', ?, 'QRIS', 'ipaymu', ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), NOW(), NOW())`,
    [restaurantId, qOrder.id, qOrder.grandTotal, qrisOrderNumber, `${BASE}/payment/callback?ref=${qrisOrderNumber}`, qrDataUri, `QRIS-E2E-${tag}`]
  );
  await q("UPDATE `Order` SET paymentStatus = 'PENDING' WHERE id = ?", [qOrder.id]);
  qrisPayment = (await q("SELECT * FROM Payment WHERE orderId = ? ORDER BY createdAt DESC LIMIT 1", [qOrder.id]))[0];
}
check("TEST18 QRIS payment row PENDING with amount = grandTotal",
  Number(qrisPayment.amount) === Number(qOrder.grandTotal) && qrisPayment.status === "PENDING", `amount=${qrisPayment.amount}`);
const expectedQrisAmount = Number(qOrder.grandTotal);

// Duplicate QRIS payment request while PENDING → idempotent rejection (409),
// no second row ever created.
{
  const dup = await Q.evaluate(async (num) => {
    const res = await fetch("/api/public/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNumber: num, method: "QRIS" }),
    });
    return { status: res.status };
  }, qrisOrderNumber);
  const qPayCount = await q("SELECT COUNT(*) n FROM Payment WHERE orderId = ?", [qOrder.id]);
  check("TEST18 duplicate QRIS payment is idempotent (409, single row)",
    dup.status === 409 && qPayCount[0].n === 1, `status=${dup.status} rows=${qPayCount[0].n}`);
}

// Payment page while PENDING: QR visible + countdown (never "Menunggu" past
// expiry — expiresAt is 24h out so the countdown is shown).
await Q.goto(`${BASE}/payment/${qrisOrderNumber}`, { waitUntil: "networkidle2" });
await sleep(1500);
const payPendingOk = await waitOn(Q, () => {
  const img = document.querySelector("img[alt='QRIS']");
  const hasQr =
    !!img && img.src.length > 0 &&
    (img.src.startsWith("data:image") || img.src.startsWith("http"));
  const t = document.body.innerText || "";
  return hasQr && t.includes("Menunggu pembayaran") && t.includes("Pembayaran berlaku hingga");
}, 15000, "payment page pending UI");
check("TEST18 payment page: QR + 'Menunggu pembayaran' + countdown", !!payPendingOk, "");
await Q.goto(`${BASE}/order/${qrisOrderNumber}`, { waitUntil: "networkidle2" });

// Customer refresh while payment pending → resume UI visible.
await Q.reload({ waitUntil: "networkidle2" });
await sleep(1500);
const qResumeBody = await Q.evaluate(() => document.body.innerText || "");
check("TEST18 refresh on PENDING QRIS → 'Menunggu pembayaran' + resume button",
  qResumeBody.includes("Menunggu pembayaran") && qResumeBody.includes("Bayar Sekarang"),
  "");

// Signed webhook helpers (same algorithm as ipaymu.provider.validateWebhook).
const makePayload = (ref, status, total) => {
  const p = { reference_id: ref, trx_id: `TRX-${tag}`, status, total: String(total), amount: String(total) };
  const sorted = {};
  Object.keys(p).sort().forEach((k) => (sorted[k] = p[k]));
  const escaped = JSON.stringify(sorted).replace(/\//g, "\\/");
  return { sortedJson: escaped, payload: p };
};
const sign = (sortedJson) => crypto.createHmac("sha256", IPAYMU_VA).update(sortedJson, "utf8").digest("hex");
const postWebhook = async (payload, sig) => {
  const res = await fetch(`${BASE}/api/webhooks/ipaymu`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-signature": sig },
    body: JSON.stringify(payload),
  });
  let j = null;
  try {
    j = await res.json();
  } catch {}
  return { status: res.status, body: j };
};

// Wrong amount must be rejected and leave the payment PENDING.
{
  const { sortedJson, payload } = makePayload(qrisOrderNumber, "berhasil", expectedQrisAmount + 1000);
  const wrong = await postWebhook(payload, sign(sortedJson));
  const stillPending = (await q("SELECT status FROM Payment WHERE id = ?", [qrisPayment.id]))[0];
  check("TEST18 webhook amount mismatch rejected (payment stays PENDING)",
    wrong.status >= 400 && stillPending.status === "PENDING", `status=${wrong.status}`);
}

// Correct amount + berhasil → PAID, paidAt, order paymentStatus PAID.
{
  const { sortedJson, payload } = makePayload(qrisOrderNumber, "berhasil", expectedQrisAmount);
  const ok = await postWebhook(payload, sign(sortedJson));
  const p = (await q("SELECT status, paidAt FROM Payment WHERE id = ?", [qrisPayment.id]))[0];
  const o = (await q("SELECT paymentStatus, status FROM `Order` WHERE id = ?", [qOrder.id]))[0];
  const txRows = await q("SELECT provider, status, amount FROM PaymentTransaction WHERE paymentId = ?", [qrisPayment.id]);
  check("TEST18 QRIS webhook → PAID + paidAt (order.status untouched)",
    ok.status === 200 && p.status === "PAID" && p.paidAt !== null && o.paymentStatus === "PAID" && o.status === "PENDING",
    `webhook=${ok.status}`);
  check("TEST18 amount paid = grandTotal & transaction recorded",
    txRows.length === 1 && Number(txRows[0].amount) === expectedQrisAmount && txRows[0].status === "PAID",
    JSON.stringify(txRows.map((r) => ({ a: r.amount, s: r.status }))));

  // Re-sending the same callback is idempotent (no double processing).
  const again = await postWebhook(payload, sign(sortedJson));
  const pAfter = (await q("SELECT status FROM Payment WHERE id = ?", [qrisPayment.id]))[0];
  const txAfter = await q("SELECT id FROM PaymentTransaction WHERE paymentId = ?", [qrisPayment.id]);
  check("TEST18 duplicate webhook is idempotent (single PAID, no extra txn)",
    again.status === 200 && pAfter.status === "PAID" && txAfter.length === 1, `txn=${txAfter.length}`);
}

// ---- TEST19: admin sees QRIS payment update in realtime ----
const qrisPaidOnG = await waitOn(
  G,
  (num) => {
    const body = document.body.innerText || "";
    return body.includes(num);
  },
  1000,
  "qris order on payments page"
);
// The QRIS payment row was created/seeded AFTER G loaded; refresh list once,
// then rely on the PAYMENT_STATUS_CHANGED event for the PAID flip.
if (!qrisPaidOnG) {
  await G.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Refresh") || (x.textContent || "").trim() === "Refresh");
    if (b) b.click();
  });
}
const qrisRowPaid = await waitOn(
  G,
  (num) => {
    const divs = [...document.querySelectorAll("div")].filter((d) => {
      const t = d.textContent || "";
      return t.includes(num) && t.length < 900;
    });
    return divs.some((d) => (d.textContent || "").includes("PAID") || (d.textContent || "").includes("Lunas"));
  },
  20000,
  "QRIS row PAID on payments page",
  qrisOrderNumber
);
check("TEST19 QRIS PAID visible on admin payments page (realtime)", !!qrisRowPaid, "");

// Customer sees PAID after webhook (order page polls).
await Q.reload({ waitUntil: "networkidle2" });
await sleep(1500);
const qPaidBody = await Q.evaluate(() => document.body.innerText || "");
check("TEST18 customer order page shows QRIS PAID", qPaidBody.includes("Pembayaran berhasil") && qPaidBody.includes("QRIS"), "");

// The payment page itself reflects PAID (server-driven, not client claims).
await Q.goto(`${BASE}/payment/${qrisOrderNumber}`, { waitUntil: "networkidle2" });
await sleep(1000);
const qPaidPayBody = await Q.evaluate(() => document.body.innerText || "");
check("TEST18 payment page shows 'Pembayaran Berhasil' after webhook",
  qPaidPayBody.includes("Pembayaran Berhasil"), "");

// ============================================================
// FLOW C — TAKEAWAY / DELIVERY regression
// ============================================================
const anonT = await browser.createBrowserContext();
const T = await anonT.newPage();
const mkOrder = async (orderType, method) => {
  const created = await T.evaluate(
    async ({ orderType, method, productId, tag }) => {
      const body = {
        customerName: `E2EPAY-${orderType} ${tag}`,
        orderType,
        items: [{ productId, quantity: 1 }],
      };
      if (method) body.paymentMethod = method;
      const res = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let j = null;
      try {
        j = await res.json();
      } catch {}
      return { status: res.status, orderNumber: j?.data?.orderNumber || null };
    },
    { orderType, method: method || null, productId: plain1.id, tag }
  );
  return created;
};
const attemptLegacyPayment = async (orderNumber) => {
  return await T.evaluate(async (num) => {
    const res = await fetch("/api/public/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNumber: num }),
    });
    return { status: res.status };
  }, orderNumber);
};

// TEST20 TAKEAWAY
await T.goto(`${BASE}/menu`, { waitUntil: "networkidle2" });
await waitText(T, "Makanan", 45000);
await addPlain(T, plain1.name);
await T.goto(`${BASE}/checkout`, { waitUntil: "networkidle2" });
await sleep(1500);
// Select TAKEAWAY (no table context) — no payment method selector allowed.
await T.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Takeaway"));
  if (b) b.click();
});
await sleep(400);
let tBody = await T.evaluate(() => document.body.innerText || "");
check("TEST20 TAKEAWAY checkout: no QRIS/Kasir selector (legacy flow preserved)",
  !tBody.includes("Bayar menggunakan QRIS") && !tBody.includes("Bayar langsung di kasir") && !tBody.includes("Bayar langsung di kasir"),
  "");
check("TEST20 TAKEAWAY checkout still shows legacy iPaymu note + tax rows",
  tBody.includes("Pajak (10%)") && tBody.includes("Pembayaran diproses oleh iPaymu"),
  "");
// DINE-IN tab (no table context) DOES show the QRIS/Kasir selector.
await T.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Dine In"));
  if (b) b.click();
});
await sleep(400);
tBody = await T.evaluate(() => document.body.innerText || "");
check("TEST20 DINE-IN selector appears when DINE-IN tab active",
  tBody.includes("Bayar menggunakan QRIS") && tBody.includes("Bayar langsung di kasir"),
  "");

const twOrder = await mkOrder("TAKEAWAY", null);
check("TEST20 TAKEAWAY order created (legacy, no paymentMethod)",
  twOrder.status === 201 && !!twOrder.orderNumber, `status=${twOrder.status} order=${twOrder.orderNumber}`);
const twPay = await attemptLegacyPayment(twOrder.orderNumber);
// Order state is read AFTER the payment attempt so paymentStatus reflects
// the attempt (PENDING on success / UNPAID on rejection).
const twRows = await q("SELECT paymentStatus, orderType FROM `Order` WHERE orderNumber = ?", [twOrder.orderNumber]);
const twPayRows = await q("SELECT method, provider, status, amount FROM Payment WHERE orderId = (SELECT id FROM `Order` WHERE orderNumber = ?)", [twOrder.orderNumber]);
const twGrand = (await q("SELECT grandTotal FROM `Order` WHERE orderNumber = ?", [twOrder.orderNumber]))[0].grandTotal;
// Legacy TAKEAWAY flow: no method sent, VA channel, amount = grandTotal. When
// the gateway accepts, exactly one PENDING row is stored; when it rejects,
// no row and the order stays UNPAID (recovery on the order page).
check("TEST20 TAKEAWAY legacy payment attempt: PENDING row (amount=grandTotal) or clean rejection, no duplicates",
  twRows.length === 1 && twRows[0].orderType === "TAKEAWAY" &&
    ((twPay.status === 200 && twPayRows.length === 1 && twPayRows[0].provider === "ipaymu" && twPayRows[0].method === null && twPayRows[0].status === "PENDING" && Number(twPayRows[0].amount) === Number(twGrand) && twRows[0].paymentStatus === "PENDING") ||
     (twPay.status >= 400 && twPayRows.length === 0 && twRows[0].paymentStatus === "UNPAID")),
  `payStatus=${twPay.status} payRows=${twPayRows.length}`);
const twKasirRejected = await mkOrder("TAKEAWAY", "KASIR");
check("TEST20 TAKEAWAY + paymentMethod=KASIR rejected server-side",
  twKasirRejected.status >= 400, `status=${twKasirRejected.status}`);

// TEST21 DELIVERY
const dlOrder = await mkOrder("DELIVERY", null);
check("TEST21 DELIVERY order created (legacy, no paymentMethod)",
  dlOrder.status === 201 && !!dlOrder.orderNumber, `status=${dlOrder.status}`);
const dlPay = await attemptLegacyPayment(dlOrder.orderNumber);
const dlRows = await q("SELECT paymentStatus, orderType FROM `Order` WHERE orderNumber = ?", [dlOrder.orderNumber]);
const dlPayRows = await q("SELECT method, provider, status, amount FROM Payment WHERE orderId = (SELECT id FROM `Order` WHERE orderNumber = ?)", [dlOrder.orderNumber]);
const dlGrand = (await q("SELECT grandTotal FROM `Order` WHERE orderNumber = ?", [dlOrder.orderNumber]))[0].grandTotal;
check("TEST21 DELIVERY legacy payment attempt: PENDING row (amount=grandTotal) or clean rejection, no duplicates",
  dlRows.length === 1 && dlRows[0].orderType === "DELIVERY" &&
    ((dlPay.status === 200 && dlPayRows.length === 1 && dlPayRows[0].provider === "ipaymu" && dlPayRows[0].method === null && dlPayRows[0].status === "PENDING" && Number(dlPayRows[0].amount) === Number(dlGrand) && dlRows[0].paymentStatus === "PENDING") ||
     (dlPay.status >= 400 && dlPayRows.length === 0 && dlRows[0].paymentStatus === "UNPAID")),
  `payStatus=${dlPay.status} payRows=${dlPayRows.length}`);

// ============================================================
// FLOW D — admin /payments page button (Tandai Dibayar) for KASIR
// ============================================================
const [t3] = await q("SELECT id FROM `Table` WHERE number = 3");
await q("UPDATE `Table` SET status='AVAILABLE' WHERE id = ?", [t3.id]);
const dCreated = await T.evaluate(
  async ({ tableId, productId, tag }) => {
    const res = await fetch("/api/public/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: `E2EPAY-PAGE ${tag}`,
        orderType: "DINE_IN",
        tableId,
        visitorCount: 1,
        paymentMethod: "KASIR",
        items: [{ productId, quantity: 1 }],
      }),
    });
    let j = null;
    try {
      j = await res.json();
    } catch {}
    return { status: res.status, orderNumber: j?.data?.orderNumber || null, payment: j?.data?.payment || null };
  },
  { tableId: t3.id, productId: plain1.id, tag }
);
const dRows = await q("SELECT id, paymentStatus FROM `Order` WHERE orderNumber = ?", [dCreated.orderNumber]);
const dOrderId = dRows[0].id;
check("FLOW D KASIR order via API returns payment row",
  dCreated.status === 201 && !!dCreated.payment && dCreated.payment.status === "UNPAID" && dCreated.payment.method === "KASIR" && dRows[0].paymentStatus === "UNPAID",
  JSON.stringify(dCreated.payment));
// Payments page: reload so the row is visible, assert Kasir + button.
await G.reload({ waitUntil: "domcontentloaded" });
await waitText(G, "Daftar Pembayaran", 30000);
const gRowHasAction = await waitOn(
  G,
  (num) => {
    const rows = [...document.querySelectorAll("div")].filter((d) => {
      const t = d.textContent || "";
      return t.includes(num) && t.includes("Kasir") && t.length < 900;
    });
    return rows.some((d) => (d.textContent || "").includes("Tandai Dibayar"));
  },
  20000,
  "payments page kasir row action",
  dCreated.orderNumber
);
check("FLOW D admin payments page shows 'Tandai Dibayar' for KASIR row", !!gRowHasAction, "");
const gClicked = await G.evaluate((num) => {
  const rows = [...document.querySelectorAll("div")].filter((d) => {
    const t = d.textContent || "";
    return t.includes(num) && t.includes("Kasir") && t.length < 900;
  });
  for (const row of rows) {
    const btn = [...row.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Tandai Dibayar"));
    if (btn) {
      btn.click();
      return true;
    }
  }
  return false;
}, dCreated.orderNumber);
check("FLOW D admin clicked payments-page 'Tandai Dibayar'", !!gClicked);
const dPaid = await waitDb(async () => {
  const p = await q("SELECT status, paidAt FROM Payment WHERE orderId = ?", [dOrderId]);
  return p.length === 1 && p[0].status === "PAID" && p[0].paidAt !== null;
}, 15000, "payments-page mark paid in DB");
check("FLOW D KASIR payment PAID via payments page", !!dPaid, "");
const dRowPaid = await waitOn(
  G,
  (num) => {
    const rows = [...document.querySelectorAll("div")].filter((d) => {
      const t = d.textContent || "";
      return t.includes(num) && t.includes("Kasir") && t.length < 900;
    });
    return rows.some((d) => (d.textContent || "").includes("PAID") && !(d.textContent || "").includes("Tandai Dibayar"));
  },
  20000,
  "payments page row PAID + button gone",
  dCreated.orderNumber
);
check("FLOW D payments page row PAID, button gone (no double pay UI)", !!dRowPaid, "");

// ============================================================
// FLOW E — payment page edge cases
// ============================================================
// E1: unknown order → GET payment-status API 404 + page not-found state.
{
  const notFound = await Q.evaluate(async () => {
    const res = await fetch("/api/public/payments/ORD-NOT-EXIST-404");
    return { status: res.status };
  });
  check("FLOW E invalid order → payment status API 404", notFound.status === 404, `status=${notFound.status}`);
  await Q.goto(`${BASE}/payment/ORD-NOT-EXIST-404`, { waitUntil: "domcontentloaded" });
  check("FLOW E payment page shows 'Pesanan Tidak Ditemukan'", await waitText(Q, "Pesanan Tidak Ditemukan", 15000));
}

// E2: order created WITHOUT a payment → graceful "belum dibuat" state, and
// the payment page must stay READ-only (no payment row is ever created by
// merely opening it).
let npOrderNumber = null;
{
  const created = await T.evaluate(
    async ({ tableId, productId, tag }) => {
      const res = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: `E2EPAY-NOPAY ${tag}`,
          orderType: "DINE_IN",
          tableId,
          visitorCount: 1,
          items: [{ productId, quantity: 1 }],
        }),
      });
      let j = null;
      try {
        j = await res.json();
      } catch {}
      return { status: res.status, orderNumber: j?.data?.orderNumber || null };
    },
    { tableId: t1.id, productId: plain1.id, tag }
  );
  npOrderNumber = created.orderNumber;
  check("FLOW E DINE-IN order without payment created",
    created.status === 201 && !!created.orderNumber, `status=${created.status}`);
  await Q.goto(`${BASE}/payment/${created.orderNumber}`, { waitUntil: "domcontentloaded" });
  check("FLOW E payment page: 'Pembayaran Belum Dibuat' + 'Lihat Pesanan' action",
    await waitText(Q, "Pembayaran Belum Dibuat", 15000) && await waitText(Q, "Lihat Pesanan", 5000));
  const npRows = await q(
    "SELECT COUNT(*) n FROM Payment WHERE orderId = (SELECT id FROM `Order` WHERE orderNumber = ?)",
    [created.orderNumber]
  );
  check("FLOW E opening payment page creates no payment row (read-only)", npRows[0].n === 0, `rows=${npRows[0].n}`);
}

// ============================================================
// FLOW F — QRIS (EXPIRED/FAILED) → KASIR switch fallback
// ============================================================
// Business rules under test:
//  - the old QRIS row is NEVER modified/converted — history is preserved
//  - a NEW KASIR UNPAID row is created on the SAME order (amount=grandTotal)
//  - switch allowed only when the latest payment is EXPIRED / FAILED (or a
//    stale PENDING past expiresAt, which becomes EXPIRED atomically)
//  - QRIS PAID / cancelled orders are rejected (409)
//  - duplicate requests are idempotent (existing KASIR row reused)
//  - admin marks the KASIR row paid → payment PAID, order PAID + PROCESSING
const switchOrderIds = [];
const postSwitch = async (page, num) =>
  await page.evaluate(async (n) => {
    const res = await fetch(`/api/public/payments/${n}/switch-to-cashier`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    let j = null;
    try {
      j = await res.json();
    } catch {}
    return { status: res.status, data: j?.data || null, message: j?.message || null };
  }, num);

const createSwitchOrder = async (label) => {
  const created = await T.evaluate(
    async ({ tableId, productId, name }) => {
      const res = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          orderType: "DINE_IN",
          tableId,
          visitorCount: 1,
          items: [{ productId, quantity: 1 }],
        }),
      });
      let j = null;
      try {
        j = await res.json();
      } catch {}
      return { status: res.status, orderNumber: j?.data?.orderNumber || null };
    },
    { tableId: t1.id, productId: plain1.id, name: `E2EPAY-SW ${label} ${tag}` }
  );
  const rows = await q("SELECT id, grandTotal FROM `Order` WHERE orderNumber = ?", [
    created.orderNumber,
  ]);
  return { number: created.orderNumber, id: rows[0].id, grandTotal: rows[0].grandTotal };
};
// Seed a QRIS payment row directly (deterministic terminal states; the real
// creation flow + webhook pipeline are covered by FLOW B above). Timestamps
// are JS-computed UTC literals — SQL NOW() would tie with the later KASIR row
// (same second) and make createdAt ordering ambiguous.
const dbStamp = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const seedQrisRow = async (orderId, status, { pastExpiry = false } = {}) => {
  const [o] = await q("SELECT grandTotal FROM `Order` WHERE id = ?", [orderId]);
  // 5s in the past so the later switch-created KASIR row always sorts newest.
  const createdAt = dbStamp(new Date(Date.now() - 5000));
  const expiresAt = dbStamp(
    new Date(Date.now() + (pastExpiry ? -3600000 : 3600000))
  );
  await q(
    "INSERT INTO Payment (id, restaurantId, orderId, status, amount, method, provider, providerRef, paymentUrl, expiresAt, createdAt, updatedAt) VALUES (UUID(), ?, ?, ?, ?, 'QRIS', 'ipaymu', ?, ?, ?, ?, ?)",
    [restaurantId, orderId, status, o.grandTotal, `QRIS-${status}-${tag}`, `${BASE}/payment/callback`, expiresAt, createdAt, createdAt]
  );
};

// ---- F1: QRIS EXPIRED → payment page actions → switch → admin marks paid ----
{
  const f1 = await createSwitchOrder("EXP");
  switchOrderIds.push(f1.id);
  await seedQrisRow(f1.id, "EXPIRED", { pastExpiry: true });
  await q("UPDATE `Order` SET paymentStatus = 'EXPIRED' WHERE id = ?", [f1.id]);

  // Payment page shows the QRIS fallback actions (not a dead end).
  await Q.goto(`${BASE}/payment/${f1.number}`, { waitUntil: "networkidle2" });
  await sleep(1500);
  const f1TerminalUi = await waitOn(
    Q,
    () => {
      const t = document.body.innerText || "";
      return (
        t.includes("Pembayaran Kedaluwarsa") &&
        t.includes("Pembayaran QRIS tidak dapat digunakan.") &&
        t.includes("Generate QR Baru") &&
        t.includes("Bayar ke Kasir")
      );
    },
    15000,
    "payment page QRIS fallback actions"
  );
  check("FLOW F QRIS EXPIRED page: 'tidak dapat digunakan' + Generate QR Baru + Bayar ke Kasir", !!f1TerminalUi, "");

  // Switch → KASIR on the SAME order.
  const f1Switch = await postSwitch(Q, f1.number);
  check("FLOW F switch EXPIRED → KASIR (200, UNPAID, amount=grandTotal)",
    f1Switch.status === 200 &&
      f1Switch.data?.paymentMethod === "KASIR" &&
      f1Switch.data?.status === "UNPAID" &&
      Number(f1Switch.data?.amount) === Number(f1.grandTotal) &&
      String(f1Switch.data?.reference || "").startsWith("CASH-"),
    `status=${f1Switch.status} ref=${f1Switch.data?.reference}`);

  const f1PayRows = await q(
    "SELECT id, method, status, amount, providerRef, provider FROM Payment WHERE orderId = ? ORDER BY createdAt ASC",
    [f1.id]
  );
  const f1Order = (await q("SELECT paymentStatus, status FROM `Order` WHERE id = ?", [f1.id]))[0];
  check("FLOW F history preserved: QRIS EXPIRED (row 1) + KASIR UNPAID (row 2), same order",
    f1PayRows.length === 2 &&
      f1PayRows[0].method === "QRIS" && f1PayRows[0].status === "EXPIRED" &&
      f1PayRows[1].method === "KASIR" && f1PayRows[1].status === "UNPAID" &&
      f1PayRows[1].provider === null &&
      Number(f1PayRows[1].amount) === Number(f1.grandTotal) &&
      f1Order.paymentStatus === "UNPAID",
    JSON.stringify(f1PayRows.map((p) => ({ m: p.method, s: p.status, a: p.amount }))));
  const f1KasirId = f1PayRows[1].id;

  // Customer order page shows the cashier banner with the order number.
  await Q.goto(`${BASE}/order/${f1.number}`, { waitUntil: "networkidle2" });
  const f1Banner = await waitText(Q, "Silakan lakukan pembayaran di kasir.", 15000) &&
    await waitText(Q, "Tunjukkan nomor pesanan ini kepada kasir.", 5000);
  check("FLOW F order page: cashier banner + 'Tunjukkan nomor pesanan'", !!f1Banner, "");

  // Duplicate request → idempotent (same paymentId, no second row).
  const f1Dup = await postSwitch(Q, f1.number);
  const f1RowsAfter = await q("SELECT COUNT(*) n FROM Payment WHERE orderId = ?", [f1.id]);
  check("FLOW F duplicate switch is idempotent (same paymentId, single KASIR row)",
    f1Dup.status === 200 &&
      f1Dup.data?.paymentId === f1KasirId &&
      f1RowsAfter[0].n === 2 &&
      f1Dup.data?.alreadyExisted === true,
    `status=${f1Dup.status} rows=${f1RowsAfter[0].n}`);

  // Admin: card shows the cashier action (realtime) → mark paid.
  const f1CardVisible = await waitText(A, f1.number, 30000);
  check("FLOW F admin sees switched order", !!f1CardVisible, f1.number);
  const f1CardAction = await waitOn(
    A,
    (num) => {
      const cards = [...document.querySelectorAll('[data-slot="card"]')];
      const card = cards.find((c) => (c.textContent || "").includes(num));
      if (!card) return false;
      const t = card.textContent || "";
      return t.includes("Bayar di Kasir") && t.includes("Tandai Sudah Dibayar");
    },
    25000,
    "admin card cashier action for switched order",
    f1.number
  );
  check("FLOW F admin card: 'Bayar di Kasir' + 'Tandai Sudah Dibayar'", !!f1CardAction, "");
  const f1Clicked = await A.evaluate((num) => {
    const cards = [...document.querySelectorAll('[data-slot="card"]')];
    const card = cards.find((c) => (c.textContent || "").includes(num));
    if (!card) return false;
    const btn = [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Tandai Sudah Dibayar"));
    if (!btn) return false;
    btn.click();
    return true;
  }, f1.number);
  check("FLOW F admin clicked 'Tandai Sudah Dibayar'", !!f1Clicked);

  // KASIR → PAID + order paymentStatus PAID; switched order advances to
  // PROCESSING (cash in hand). The QRIS row must remain EXPIRED untouched.
  const f1Paid = await waitDb(async () => {
    const p = await q("SELECT status, paidAt FROM Payment WHERE id = ?", [f1KasirId]);
    return p.length === 1 && p[0].status === "PAID" && p[0].paidAt !== null;
  }, 15000, "switched KASIR payment PAID");
  const f1After = await q("SELECT paymentStatus, status FROM `Order` WHERE id = ?", [f1.id]);
  const f1RowsAfter2 = await q("SELECT method, status FROM Payment WHERE orderId = ? ORDER BY createdAt ASC", [f1.id]);
  check("FLOW F mark paid: KASIR PAID, order paymentStatus PAID + status PROCESSING, QRIS history EXPIRED",
    !!f1Paid &&
      f1After[0].paymentStatus === "PAID" &&
      f1After[0].status === "PROCESSING" &&
      f1RowsAfter2[0].method === "QRIS" && f1RowsAfter2[0].status === "EXPIRED" &&
      f1RowsAfter2[1].method === "KASIR" && f1RowsAfter2[1].status === "PAID",
    JSON.stringify({ order: f1After[0], pays: f1RowsAfter2.map((p) => p.status) }));
}

// ---- F2: QRIS FAILED → switch to cashier (same-order, history preserved) ----
{
  const f2 = await createSwitchOrder("FAIL");
  switchOrderIds.push(f2.id);
  await seedQrisRow(f2.id, "FAILED");
  await q("UPDATE `Order` SET paymentStatus = 'FAILED' WHERE id = ?", [f2.id]);
  const f2Switch = await postSwitch(Q, f2.number);
  const f2Rows = await q("SELECT method, status FROM Payment WHERE orderId = ? ORDER BY createdAt ASC", [f2.id]);
  check("FLOW F switch FAILED → KASIR (200; rows: QRIS FAILED + KASIR UNPAID)",
    f2Switch.status === 200 &&
      f2Rows.length === 2 &&
      f2Rows[0].method === "QRIS" && f2Rows[0].status === "FAILED" &&
      f2Rows[1].method === "KASIR" && f2Rows[1].status === "UNPAID",
    `status=${f2Switch.status}`);
}

// ---- F3: stale PENDING (expiresAt passed, no webhook) → auto-EXPIRED + switch ----
{
  const f3 = await createSwitchOrder("STALE");
  switchOrderIds.push(f3.id);
  await seedQrisRow(f3.id, "PENDING", { pastExpiry: true });
  await q("UPDATE `Order` SET paymentStatus = 'PENDING' WHERE id = ?", [f3.id]);
  const f3Switch = await postSwitch(Q, f3.number);
  const f3Rows = await q("SELECT method, status FROM Payment WHERE orderId = ? ORDER BY createdAt ASC", [f3.id]);
  check("FLOW F stale PENDING auto-EXPIRED before switching to KASIR",
    f3Switch.status === 200 &&
      f3Rows.length === 2 &&
      f3Rows[0].method === "QRIS" && f3Rows[0].status === "EXPIRED" &&
      f3Rows[1].method === "KASIR" && f3Rows[1].status === "UNPAID",
    `status=${f3Switch.status} rows=${JSON.stringify(f3Rows.map((p) => [p.method, p.status]))}`);
}

// ---- F4: QRIS PAID → switch rejected (409), no new row ----
{
  const f4 = await createSwitchOrder("PAID");
  switchOrderIds.push(f4.id);
  await q(
    "INSERT INTO Payment (id, restaurantId, orderId, status, amount, method, provider, providerRef, paidAt, createdAt, updatedAt) VALUES (UUID(), ?, ?, 'PAID', (SELECT grandTotal FROM `Order` WHERE id = ?), 'QRIS', 'ipaymu', ?, NOW(), NOW(), NOW())",
    [restaurantId, f4.id, f4.id, `QRIS-PAID-${tag}`]
  );
  await q("UPDATE `Order` SET paymentStatus = 'PAID' WHERE id = ?", [f4.id]);
  const f4Switch = await postSwitch(Q, f4.number);
  const f4Rows = await q("SELECT method, status FROM Payment WHERE orderId = ?", [f4.id]);
  check("FLOW F QRIS PAID → switch rejected (409, no KASIR row)",
    f4Switch.status === 409 && f4Rows.length === 1 && f4Rows[0].method === "QRIS",
    `status=${f4Switch.status} message=${f4Switch.message}`);
}

// ---- F5: cancelled order → switch rejected (409), no new row ----
{
  const f5 = await createSwitchOrder("CANCEL");
  switchOrderIds.push(f5.id);
  await seedQrisRow(f5.id, "EXPIRED", { pastExpiry: true });
  await q("UPDATE `Order` SET status = 'CANCELLED', paymentStatus = 'EXPIRED' WHERE id = ?", [f5.id]);
  const f5Switch = await postSwitch(Q, f5.number);
  const f5Rows = await q("SELECT COUNT(*) n FROM Payment WHERE orderId = ?", [f5.id]);
  check("FLOW F cancelled order → switch rejected (409, no KASIR row)",
    f5Switch.status === 409 && f5Rows[0].n === 1, `status=${f5Switch.status}`);
}

// ---- F6: non-DINE_IN (TAKEAWAY legacy VA) → switch rejected (400) ----
{
  const created = await T.evaluate(
    async ({ productId, name }) => {
      const res = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          orderType: "TAKEAWAY",
          items: [{ productId, quantity: 1 }],
        }),
      });
      let j = null;
      try {
        j = await res.json();
      } catch {}
      return { status: res.status, orderNumber: j?.data?.orderNumber || null };
    },
    { productId: plain1.id, name: `E2EPAY-SW TWA ${tag}` }
  );
  const f6Rows = await q("SELECT id FROM `Order` WHERE orderNumber = ?", [created.orderNumber]);
  if (f6Rows[0]) switchOrderIds.push(f6Rows[0].id);
  const f6Switch = await postSwitch(Q, created.orderNumber);
  const f6PayRows = await q("SELECT COUNT(*) n FROM Payment WHERE orderId = (SELECT id FROM `Order` WHERE orderNumber = ?)", [created.orderNumber]);
  check("FLOW F TAKEAWAY (legacy) → switch rejected 400, no payment created",
    created.status === 201 && f6Switch.status === 400 && f6PayRows[0].n === 0,
    `switch=${f6Switch.status}`);
}

// ============================================================
// FLOW G — CASHIER PAYMENT FORM on /admin/orders/[orderNumber]
// ============================================================
// Drives the full cashier workflow end-to-end:
//  - order detail page reached like a QR scan would (admin/orders/<num>)
//  - "Proses Pembayaran Kasir" dialog: amountDue shown, amountReceived input,
//    change auto-calculated, insufficient amount rejected with the exact
//    message and the confirm button disabled
//  - exact payment (change Rp0) and payment with change (Rp20.000)
//  - server audit row (amountDue/amountReceived/changeAmount/processedAt)
//  - duplicate completion blocked (409 "Payment already completed")
//  - realtime: admin payments page flips to PAID without a manual refresh
//  - QR: customer order page carries a scannable QR of the order number and
//    the admin pages expose the "Scan QR Pesanan" entry points
const gOrderIds = [];
const rupiahId = (n) => `Rp${n.toLocaleString("id-ID")}`;
const createCashierOrder = async (label) => {
  const created = await T.evaluate(
    async ({ tableId, productId, name }) => {
      const res = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          orderType: "DINE_IN",
          tableId,
          visitorCount: 1,
          paymentMethod: "KASIR",
          items: [{ productId, quantity: 1 }],
        }),
      });
      let j = null;
      try {
        j = await res.json();
      } catch {}
      return { status: res.status, orderNumber: j?.data?.orderNumber || null };
    },
    { tableId: t1.id, productId: plain1.id, name: `E2EPAY-CASH ${label} ${tag}` }
  );
  const rows = await q("SELECT id, grandTotal FROM `Order` WHERE orderNumber = ?", [
    created.orderNumber,
  ]);
  return { number: created.orderNumber, id: rows[0].id, grandTotal: rows[0].grandTotal };
};
const fillCashierReceived = async (page, value) => {
  await page.evaluate((v) => {
    const el = document.querySelector("#cashier-received");
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
};
const submitEnabled = (page) =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent || "").includes("Konfirmasi Pembayaran")
    );
    return b ? !b.disabled : false;
  });
const clickButtonWithText = async (page, text) => {
  return await page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent || "").includes(t)
    );
    if (!b) return false;
    b.click();
    return true;
  }, text);
};
const readAuditRaw = async (paymentId) => {
  const rows = await q("SELECT rawData FROM PaymentTransaction WHERE paymentId = ?", [paymentId]);
  if (!rows.length) return null;
  let rd = rows[0].rawData;
  if (typeof rd === "string") {
    try {
      rd = JSON.parse(rd);
    } catch {
      return null;
    }
  }
  return rd;
};

// ---- G1: insufficient rejected → exact payment succeeds ----
{
  const g1 = await createCashierOrder("EXACT");
  gOrderIds.push(g1.id);
  const due = Number(g1.grandTotal);

  // Admin list exposes the scanner entry point.
  await A.goto(`${BASE}/admin/orders`, { waitUntil: "networkidle2" });
  await waitText(A, "Scan QR Pesanan", 20000);

  // Navigate exactly like a successful QR scan would.
  await A.goto(`${BASE}/admin/orders/${g1.number}`, { waitUntil: "networkidle2" });
  check("FLOW G order page (QR-scan destination) shows order + cashier action",
    await waitText(A, g1.number, 20000) &&
      await waitText(A, "Proses Pembayaran Kasir", 10000) &&
      await waitText(A, "Pindai Pesanan Lain", 10000));

  // Customer order page carries the scannable QR.
  await Q.goto(`${BASE}/order/${g1.number}`, { waitUntil: "networkidle2" });
  const customerQr = await waitOn(
    Q,
    () => {
      const img = document.querySelector('img[alt^="QR pesanan"]');
      return !!img && img.src.startsWith("data:image");
    },
    15000,
    "customer QR pesanan"
  );
  check("FLOW G customer order page shows QR pesanan (data URI)", !!customerQr, "");

  await A.goto(`${BASE}/admin/orders/${g1.number}`, { waitUntil: "networkidle2" });
  await waitText(A, "Proses Pembayaran Kasir", 15000);
  await clickButtonWithText(A, "Proses Pembayaran Kasir");
  check("FLOW G payment dialog opens with amount fields",
    await waitOn(A, () => !!document.querySelector("#cashier-received"), 10000, "dialog") &&
      (await A.evaluate(() => document.body.innerText || "")).includes("Total Tagihan"));

  // Insufficient amount → exact rejection message + disabled confirm.
  const low = due > 5000 ? due - 5000 : 1;
  await fillCashierReceived(A, low);
  const rejectedMsg = await waitText(A, "Uang yang diterima kurang dari total tagihan", 8000);
  const disabledLow = await submitEnabled(A);
  const stillUnpaid = (await q("SELECT status FROM Payment WHERE orderId = ?", [g1.id]))[0];
  check("FLOW G insufficient amount rejected (message shown, button disabled, payment UNPAID)",
    rejectedMsg && !disabledLow && stillUnpaid.status === "UNPAID",
    `due=${due} low=${low}`);

  // Exact amount → enabled, success + receipt (Kembalian Rp0).
  await fillCashierReceived(A, due);
  const enabledExact = await waitOn(
    A,
    () => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        (x.textContent || "").includes("Konfirmasi Pembayaran")
      );
      return b ? !b.disabled : false;
    },
    8000,
    "submit enabled"
  );
  check("FLOW G exact amount enables confirm", !!enabledExact, "");
  await clickButtonWithText(A, "Konfirmasi Pembayaran");
  const g1Receipt = await waitText(A, "Pembayaran Berhasil", 25000);
  check("FLOW G exact payment → receipt 'Pembayaran Berhasil' + Kembalian Rp0",
    g1Receipt &&
      (await waitText(A, rupiahId(due), 15000)) &&
      (await waitText(A, "Rp0", 15000)));
  await clickButtonWithText(A, "Selesai");
  check("FLOW G order page reflects lunas after dialog closes",
    await waitText(A, "Pesanan sudah lunas", 15000));

  const g1Pay = (await q("SELECT id, status, paidAt FROM Payment WHERE orderId = ?", [g1.id]))[0];
  const g1Order = (await q("SELECT paymentStatus, status FROM `Order` WHERE id = ?", [g1.id]))[0];
  const g1Hist = await q("SELECT status, notes FROM OrderStatusHistory WHERE orderId = ?", [g1.id]);
  const g1Raw = await readAuditRaw(g1Pay.id);
  check("FLOW G DB: KASIR PAID + audit (exact) + order PAID/PROCESSING + history",
    g1Pay.status === "PAID" && g1Pay.paidAt !== null &&
      g1Order.paymentStatus === "PAID" && g1Order.status === "PROCESSING" &&
      g1Hist.some((h) => h.status === "PROCESSING" && (h.notes || "").includes("diterima")) &&
      g1Raw &&
      Number(g1Raw.amountDue) === due &&
      Number(g1Raw.amountReceived) === due &&
      Number(g1Raw.changeAmount) === 0 &&
      !!g1Raw.processedAt,
    JSON.stringify({ pay: g1Pay.status, order: g1Order, raw: g1Raw }));

  // Duplicate completion → 409, no extra transaction row.
  const dup = await A.evaluate(async (pid) => {
    const res = await fetch(`/api/payments/${pid}/mark-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountReceived: 999999 }),
    });
    let j = null;
    try {
      j = await res.json();
    } catch {}
    return { status: res.status, message: j?.message ?? null };
  }, g1Pay.id);
  const g1Audits = await q("SELECT COUNT(*) n FROM PaymentTransaction WHERE paymentId = ?", [g1Pay.id]);
  check("FLOW G duplicate payment blocked (409 'Payment already completed', single audit)",
    dup.status === 409 && dup.message === "Payment already completed" && g1Audits[0].n === 1,
    JSON.stringify(dup));
}

// ---- G2: payment with change (received = due + 20000) ----
{
  const g2 = await createCashierOrder("CHANGE");
  gOrderIds.push(g2.id);
  const due = Number(g2.grandTotal);
  const received = due + 20000;

  await A.goto(`${BASE}/admin/orders/${g2.number}`, { waitUntil: "networkidle2" });
  await waitText(A, "Proses Pembayaran Kasir", 15000);
  await clickButtonWithText(A, "Proses Pembayaran Kasir");
  await waitOn(A, () => !!document.querySelector("#cashier-received"), 10000, "dialog");
  await fillCashierReceived(A, received);
  // change preview updates live before submitting
  const changePreview = await waitText(A, rupiahId(20000), 8000);
  check("FLOW G change auto-calculated (Kembalian Rp20.000)", changePreview, "");
  await clickButtonWithText(A, "Konfirmasi Pembayaran");
  check("FLOW G payment-with-change receipt",
    await waitText(A, "Pembayaran Berhasil", 25000) &&
      await waitText(A, rupiahId(received), 15000) &&
      await waitText(A, rupiahId(20000), 15000));
  await clickButtonWithText(A, "Selesai");

  const g2Pay = (await q("SELECT id, status FROM Payment WHERE orderId = ?", [g2.id]))[0];
  const g2Order = (await q("SELECT paymentStatus, status FROM `Order` WHERE id = ?", [g2.id]))[0];
  const g2Raw = await readAuditRaw(g2Pay.id);
  check("FLOW G DB: payment-with-change audit (due/received/change) + order PAID/PROCESSING",
    g2Pay.status === "PAID" &&
      g2Order.paymentStatus === "PAID" && g2Order.status === "PROCESSING" &&
      g2Raw &&
      Number(g2Raw.amountDue) === due &&
      Number(g2Raw.amountReceived) === received &&
      Number(g2Raw.changeAmount) === 20000,
    JSON.stringify(g2Raw));

  // Realtime: admin payments page reflects KASIR PAID without a manual refresh
  // (driven by PAYMENT_STATUS_CHANGED over SSE).
  const g2PaidRealtime = await waitOn(
    G,
    (num) => {
      const divs = [...document.querySelectorAll("div")].filter((d) => {
        const t = d.textContent || "";
        return t.includes(num) && t.includes("Kasir") && t.length < 900;
      });
      return divs.some((d) => (d.textContent || "").includes("PAID"));
    },
    25000,
    "G2 PAID realtime on payments page",
    g2.number
  );
  check("FLOW G realtime: admin payments page shows KASIR PAID (no refresh)", !!g2PaidRealtime, "");
}

// ============================================================
// Cleanup: reset tables + remove test-created rows
// ============================================================
const cleanupOrderIds = [kOrder.id, qOrder.id];
cleanupOrderIds.push(...switchOrderIds, ...gOrderIds);
if (typeof dOrderId !== "undefined" && dOrderId) cleanupOrderIds.push(dOrderId);
for (const num of [twOrder.orderNumber, dlOrder.orderNumber, npOrderNumber].filter(Boolean)) {
  const rows = await q("SELECT id FROM `Order` WHERE orderNumber = ?", [num]);
  if (rows[0]) cleanupOrderIds.push(rows[0].id);
}
if (cleanupOrderIds.length) {
  await conn.query("DELETE FROM Payment WHERE orderId IN (?)", [cleanupOrderIds]);
  await conn.query("DELETE FROM `Order` WHERE id IN (?)", [cleanupOrderIds]);
}
await conn.query("DELETE FROM Customer WHERE name LIKE 'E2EPAY-%'", []);
await conn.query("UPDATE `Table` SET status='AVAILABLE' WHERE id IN (?, ?)", [t1.id, t2.id]);

// Console/page-error sweep (ignore HMR noise + the intentionally-triggered
// 409/422 fetch failures our own negative tests assert on).
const pageErrors = [...errorsByPage.entries()]
  .map(([tagName, list]) => [
    tagName,
    list.filter(
      (e) =>
        !e.includes("_next/hmr") &&
        !e.includes("WebSocket connection") &&
        !e.includes("status of 409") &&
        !e.includes("status of 422")
    ),
  ])
  .filter(([, list]) => list.length > 0);
check("No console/page errors on admin pages", pageErrors.length === 0, pageErrors.length ? JSON.stringify(pageErrors) : "");

await browser.close();
await conn.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks PASSED ====`);
if (failed.length) console.log("FAILED:", failed.map((f) => f.name).join(" | "));
process.exit(failed.length ? 1 : 0);
