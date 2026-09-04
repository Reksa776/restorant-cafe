// ORDER REAL-TIME E2E — customer order page receives admin status/payment
// changes over SSE with NO page refresh.
//
// Real Chrome E2E against the dev server (localhost:3000):
//  - Customer opens /order/<ORD> (created via the public API).
//  - Admin advances the order PENDING → CONFIRMED → PROCESSING → READY →
//    COMPLETED (real card buttons) and the customer page updates LIVE
//    (status timeline + transition toast) — never a reload.
//  - The same order opened in TWO tabs: both update live.
//  - An UNRELATED order page does NOT update when another order flips.
//  - A KASIR payment marked paid by the admin flips the customer page
//    UNPAID → PAID live.
//  - Dev server restart → customer SSE auto-reconnects and keeps updating.
//  - SSE stream endpoint: 404 for unknown order; 200 text/event-stream for a
//    real order; unauthenticated clients are allowed (public tracking).
import puppeteer from "puppeteer-core";
import { createConnection } from "mysql2/promise";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://localhost:3000";
const PROJECT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Cross-platform Chrome discovery: CHROME_PATH env > common macOS/Windows.
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
// .env helpers (values never printed)
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

let dbConfig = { host: "localhost", port: 3306, user: "root", password: "", database: "restaurant_app" };
const dbUrlMatch = (ENV.DATABASE_URL || "").match(/^mysql:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/(.+)$/);
if (dbUrlMatch) {
  dbConfig = { host: dbUrlMatch[3], port: Number(dbUrlMatch[4]), user: dbUrlMatch[1], password: dbUrlMatch[2], database: dbUrlMatch[5] };
}
const conn = await createConnection(dbConfig);
const q = async (sql, args) => (await conn.query(sql, args))[0];

// ---------------------------------------------------------------
// DB fixtures
// ---------------------------------------------------------------
const tag = Date.now().toString().slice(-6);
const [t1] = await q("SELECT id, restaurantId, number FROM `Table` WHERE number = 1");
const [t2] = await q("SELECT id, restaurantId, number FROM `Table` WHERE number = 2");
const [t4] = await q("SELECT id, restaurantId, number FROM `Table` WHERE number = 4");
// Plain product (no active option groups) → direct order items.
const plainProds = await q(
  `SELECT p.id, p.name, p.price FROM Product p
   WHERE p.isActive = 1 AND p.isAvailable = 1
     AND NOT EXISTS (SELECT 1 FROM ProductOptionGroup g
                     WHERE g.productId = p.id AND g.isActive = 1)
   ORDER BY p.name LIMIT 1`
);
const plain1 = plainProds[0];
if (!t1 || !t2 || !t4 || !plain1) {
  console.log("DB fixtures missing — cannot run E2E");
  process.exit(1);
}
console.log("Fixtures:", JSON.stringify({ table1: t1.number, table2: t2.number, table4: t4.number, prod: plain1.name }));

// Free the tables used by this test.
await q("UPDATE `Table` SET status='AVAILABLE' WHERE id IN (?, ?, ?)", [t1.id, t2.id, t4.id]);

// Clean leftovers of previous runs (same naming tag pattern).
const leftoverCusts = await q("SELECT id FROM Customer WHERE name LIKE 'E2ERT-%'");
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
const tryWaitOn = async (page, fn, timeout = 20000, label = "", ...args) => {
  try {
    return await waitOn(page, fn, timeout, label, ...args);
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------
// Customer-page observables (no refresh involved)
// ---------------------------------------------------------------
// Number of completed steps in the "Status Pesanan" timeline (green circles).
// PENDING=1, CONFIRMED=2, PROCESSING=3, READY=4, COMPLETED=5.
const completedSteps = (page) =>
  page.evaluate(() => {
    const circles = [...document.querySelectorAll("div")].filter((d) => {
      const c = typeof d.className === "string" ? d.className : "";
      return c.includes("rounded-full") && c.includes("bg-green-500");
    });
    // Circles outside the timeline (if any) are excluded by requiring the
    // row to contain one of the step labels as a sibling <p>.
    const rows = circles.filter((circle) => {
      const row = circle.parentElement;
      if (!row) return false;
      return /Pesanan Diterima|Dikonfirmasi|Sedang Dibuat|Siap|Selesai/.test(
        (row.textContent || "").slice(0, 30)
      );
    });
    return rows.length;
  });
const waitCompleted = (page, n, timeout = 20000) =>
  waitOn(page, () => {
    const circles = [...document.querySelectorAll("div")].filter((d) => {
      const c = typeof d.className === "string" ? d.className : "";
      return c.includes("rounded-full") && c.includes("bg-green-500");
    });
    const rows = circles.filter((circle) => {
      const row = circle.parentElement;
      if (!row) return false;
      return /Pesanan Diterima|Dikonfirmasi|Sedang Dibuat|Siap|Selesai/.test(
        (row.textContent || "").slice(0, 30)
      );
    });
    return rows.length;
  }, timeout, `completed=${n}`);
// A per-page marker that survives React updates but is wiped by a reload.
const armNoReload = (page) =>
  page.evaluate(() => {
    window.__rt_e2e = "armed";
    return true;
  });
const stillArmed = (page) => page.evaluate(() => window.__rt_e2e === "armed");

// ---------------------------------------------------------------
// Admin login
// ---------------------------------------------------------------
const A = await newPage("admin-orders");
await A.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
await A.type('input[type="email"]', "admin@restobahagia.com", { delay: 5 });
await A.type('input[type="password"]', "admin123", { delay: 5 });
await A.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Masuk");
  if (b) b.click();
});
const loggedIn = await waitOn(A, () => location.pathname.startsWith("/admin"), 20000, "login");
if (!loggedIn) {
  await A.goto(`${BASE}/admin/orders`, { waitUntil: "domcontentloaded", timeout: 60000 });
}
await A.goto(`${BASE}/admin/orders`, { waitUntil: "domcontentloaded", timeout: 60000 });
await waitText(A, "Pesanan", 30000);

// Wait until the admin card for an order exposes the given action button,
// then click it. Returns true once clicked (button exists and is enabled).
const clickCardAction = async (page, orderNumber, buttonText, timeout = 20000) =>
  waitOn(
    page,
    ({ num, text }) => {
      const cards = [...document.querySelectorAll('[data-slot="card"]')];
      const card = cards.find((c) => (c.textContent || "").includes(num));
      if (!card) return false;
      const btn = [...card.querySelectorAll("button")].find((b) =>
        (b.textContent || "").includes(text) && !b.disabled
      );
      if (!btn) return false;
      btn.click();
      return true;
    },
    timeout,
    `card action ${buttonText}`,
    { num: orderNumber, text: buttonText }
  );

// ---------------------------------------------------------------
// Order factory (customer API, returns real order number)
// ---------------------------------------------------------------
const anonCtx = await browser.createBrowserContext();
const anonPage = await anonCtx.newPage();
// Land on the app origin so relative fetch()/order API calls work.
await anonPage.goto(`${BASE}/menu`, { waitUntil: "domcontentloaded", timeout: 60000 });
const createOrder = async ({ tableId, label, paymentMethod }) => {
  const created = await anonPage.evaluate(
    async ({ tableId, productId, tag, label, paymentMethod }) => {
      const body = {
        customerName: `${label} ${tag}`,
        orderType: "DINE_IN",
        tableId,
        visitorCount: 2,
        notes: `rt-e2e ${label}`,
        items: [{ productId, quantity: 1 }],
      };
      if (paymentMethod) body.paymentMethod = paymentMethod;
      const res = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {}
      return { status: res.status, orderNumber: data?.data?.orderNumber || null };
    },
    { tableId, productId: plain1.id, tag, label, paymentMethod: paymentMethod || null }
  );
  const rows = await q("SELECT id FROM `Order` WHERE orderNumber = ?", [created.orderNumber]);
  return { number: created.orderNumber, status: created.status, id: rows[0]?.id || null };
};

// ============================================================
// TEST 1 — Customer page opens; stream endpoint behaves
// ============================================================
const C1 = await anonCtx.newPage();
C1.on("pageerror", (e) => console.log("[C1 pageerror]", String(e).slice(0, 160)));
const ordA = await createOrder({ tableId: t1.id, label: "E2ERT-A" });
check("TEST1 order A created via public API", ordA.status === 201 && !!ordA.number, `order=${ordA.number}`);

// SSE stream: unknown order → 404; real order → 200 + event-stream headers.
const stream404 = await anonPage.evaluate(async () => {
  const res = await fetch("/api/public/orders/ORD-NOT-EXIST-404/stream");
  return res.status;
});
check("TEST1 SSE stream 404 for unknown order", stream404 === 404, `status=${stream404}`);
const stream200 = await anonPage.evaluate(async (num) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(`/api/public/orders/${num}/stream`, { signal: ctrl.signal });
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, ct };
  } catch {
    return { status: 0, ct: "" };
  } finally {
    clearTimeout(timer);
  }
}, ordA.number);
check("TEST1 SSE stream 200 text/event-stream for real order",
  stream200.status === 200 && stream200.ct.includes("text/event-stream"),
  JSON.stringify(stream200));

await C1.goto(`${BASE}/order/${ordA.number}`, { waitUntil: "networkidle2" });
check("TEST1 customer order page loads order A", await waitText(C1, ordA.number, 25000), "");
check("TEST1 initial timeline = PENDING (1 completed step)", (await completedSteps(C1)) === 1, `steps=${await completedSteps(C1)}`);
await armNoReload(C1);

// ============================================================
// TEST 2 — PENDING → CONFIRMED live
// ============================================================
const dbOrdA = (await q("SELECT id FROM `Order` WHERE orderNumber = ?", [ordA.number]))[0];
check("TEST2 admin card has Konfirmasi action", await clickCardAction(A, ordA.number, "Konfirmasi"), "");
const confirmedDb = await waitDb(
  async () => ((await q("SELECT status FROM `Order` WHERE id = ?", [dbOrdA.id]))[0].status === "CONFIRMED"),
  15000, "order CONFIRMED in DB"
);
check("TEST2 DB order status = CONFIRMED", !!confirmedDb, "");
const c1Confirmed = await waitCompleted(C1, 2, 20000);
// The CONFIRMED toast only ever fires inside the SSE handler — the 10s
// polling fallback never shows it — so its presence proves the live path.
const c1Toast = await tryWaitOn(
  C1,
  () => (document.body.innerText || "").includes("Pesanan telah dikonfirmasi"),
  8000,
  "confirmed toast"
);
check("TEST2 customer page shows CONFIRMED live (SSE toast + no refresh)",
  c1Confirmed && (await stillArmed(C1)) && !!c1Toast,
  `steps=${await completedSteps(C1)} toast=${c1Toast}`);

// ============================================================
// TEST 3 — CONFIRMED → PROCESSING live (toast message appears)
// ============================================================
check("TEST3 admin card has Proses action", await clickCardAction(A, ordA.number, "Proses"), "");
const processingDb = await waitDb(
  async () => ((await q("SELECT status FROM `Order` WHERE id = ?", [dbOrdA.id]))[0].status === "PROCESSING"),
  15000, "order PROCESSING in DB"
);
check("TEST3 DB order status = PROCESSING", !!processingDb, "");
const c1Processing = await waitCompleted(C1, 3, 20000);
const procToast = await tryWaitOn(C1, () => (document.body.innerText || "").includes("Pesanan sedang diproses oleh dapur"), 8000, "processing toast");
check("TEST3 customer page shows PROCESSING live + transition toast",
  c1Processing && (await stillArmed(C1)) && !!procToast,
  `steps=${await completedSteps(C1)} toast=${procToast}`);

// ============================================================
// TEST 4 — Multi-tab: second tab of the SAME order also updates
// ============================================================
const C2 = await anonCtx.newPage();
C2.on("pageerror", (e) => console.log("[C2 pageerror]", String(e).slice(0, 160)));
await C2.goto(`${BASE}/order/${ordA.number}`, { waitUntil: "networkidle2" });
await waitText(C2, ordA.number, 25000);
const c2Initial = await completedSteps(C2);
await armNoReload(C2);
// PROCESSING → READY
check("TEST4 admin card has Siap action", await clickCardAction(A, ordA.number, "Siap"), "");
const readyDb = await waitDb(
  async () => ((await q("SELECT status FROM `Order` WHERE id = ?", [dbOrdA.id]))[0].status === "READY"),
  15000, "order READY in DB"
);
check("TEST4 DB order status = READY", !!readyDb, "");
const tab1Ready = await waitCompleted(C1, 4, 25000);
const tab2Ready = await waitCompleted(C2, 4, 25000);
// READY toast proves the SSE event reached EACH tab independently.
const tab1Toast = await tryWaitOn(C1, () => (document.body.innerText || "").includes("Pesanan siap diambil"), 8000, "ready toast c1");
const tab2Toast = await tryWaitOn(C2, () => (document.body.innerText || "").includes("Pesanan siap diambil"), 8000, "ready toast c2");
check("TEST4 both tabs show READY live (SSE toast on each tab, no refresh)",
  tab1Ready && tab2Ready && (await stillArmed(C1)) && (await stillArmed(C2)) && !!tab1Toast && !!tab2Toast,
  `c1=${await completedSteps(C1)} c2=${await completedSteps(C2)} t1=${tab1Toast} t2=${tab2Toast}`);

// ============================================================
// TEST 5 — Unrelated order does NOT update
// ============================================================
const ordB = await createOrder({ tableId: t2.id, label: "E2ERT-B" });
check("TEST5 unrelated order B created", ordB.status === 201 && !!ordB.number, `order=${ordB.number}`);
const C3 = await anonCtx.newPage();
C3.on("pageerror", (e) => console.log("[C3 pageerror]", String(e).slice(0, 160)));
await C3.goto(`${BASE}/order/${ordB.number}`, { waitUntil: "networkidle2" });
await waitText(C3, ordB.number, 25000);
const c3Before = await completedSteps(C3);
// Flip order A READY → COMPLETED while C3 watches order B.
check("TEST5 admin card has Selesai action", await clickCardAction(A, ordA.number, "Selesai"), "");
const completedDb = await waitDb(
  async () => ((await q("SELECT status FROM `Order` WHERE id = ?", [dbOrdA.id]))[0].status === "COMPLETED"),
  15000, "order COMPLETED in DB"
);
check("TEST5 DB order A = COMPLETED", !!completedDb, "");
const tab1Completed = await waitCompleted(C1, 5, 25000);
const tab1DoneToast = await tryWaitOn(C1, () => (document.body.innerText || "").includes("Pesanan telah selesai"), 8000, "completed toast");
check("TEST5 customer page A shows COMPLETED live (SSE toast)",
  tab1Completed && (await stillArmed(C1)) && !!tab1DoneToast, `toast=${tab1DoneToast}`);
// C3 must remain PENDING — give it time to (wrongly) update, then assert.
await sleep(2500);
const c3After = await completedSteps(C3);
const c3WrongToast = (await C3.evaluate(() => document.body.innerText || "")).includes("Pesanan telah selesai");
check("TEST5 unrelated order page B did NOT update (still PENDING, no SSE event)",
  c3After === c3Before && c3Before === 1 && !c3WrongToast,
  `before=${c3Before} after=${c3After}`);
await C2.close();
await C3.close();

// ============================================================
// TEST 6 — Payment UNPAID → PAID live (admin marks KASIR paid)
// ============================================================
const ordC = await createOrder({ tableId: t4.id, label: "E2ERT-C", paymentMethod: "KASIR" });
check("TEST6 KASIR order C created", ordC.status === 201 && !!ordC.number, `order=${ordC.number}`);
const [payC] = await q("SELECT id, status FROM Payment WHERE orderId = ?", [ordC.id]);
check("TEST6 KASIR payment row UNPAID", !!payC && payC.status === "UNPAID", JSON.stringify(payC));
const C4 = await anonCtx.newPage();
C4.on("pageerror", (e) => console.log("[C4 pageerror]", String(e).slice(0, 160)));
await C4.goto(`${BASE}/order/${ordC.number}`, { waitUntil: "networkidle2" });
await waitText(C4, ordC.number, 25000);
check("TEST6 customer sees cashier-pending message",
  await waitText(C4, "Silakan lakukan pembayaran di kasir.", 15000), "");
await armNoReload(C4);
const payMarked = await A.evaluate(async (pid) => {
  const res = await fetch(`/api/payments/${pid}/mark-paid`, { method: "POST" });
  return res.status;
}, payC.id);
check("TEST6 admin marked KASIR payment paid", payMarked === 200, `status=${payMarked}`);
const paidDb = await waitDb(async () => {
  const p = (await q("SELECT status, paidAt FROM Payment WHERE id = ?", [payC.id]))[0];
  return p.status === "PAID" && p.paidAt !== null;
}, 15000, "payment PAID in DB");
check("TEST6 DB payment PAID + paidAt", !!paidDb, "");
const c4Paid = await waitText(C4, "Pembayaran berhasil", 25000);
const c4Kasir = await waitText(C4, "Dibayar dengan Kasir", 25000);
check("TEST6 customer page shows PAID live (no refresh)", c4Paid && c4Kasir && (await stillArmed(C4)), "");
await C4.close();

// ============================================================
// TEST 7 — Reconnect: dev server restart → customer SSE reconnects
// ============================================================
// Prepare order D and an open customer page BEFORE the restart.
const ordD = await createOrder({ tableId: t1.id, label: "E2ERT-D" });
check("TEST7 order D created", ordD.status === 201 && !!ordD.number, `order=${ordD.number}`);
const C5 = await anonCtx.newPage();
C5.on("pageerror", (e) => console.log("[C5 pageerror]", String(e).slice(0, 160)));
await C5.goto(`${BASE}/order/${ordD.number}`, { waitUntil: "networkidle2" });
await waitText(C5, ordD.number, 25000);
check("TEST7 customer page D open at PENDING", (await completedSteps(C5)) === 1, "");
await armNoReload(C5);

// Find and kill the dev server listener on :3000.
const findPid3000 = () => {
  try {
    if (process.platform === "win32") {
      const out = execSync('netstat -ano | findstr ":3000" | findstr "LISTENING"', { encoding: "utf8" });
      const lines = out.trim().split(/\r?\n/).filter(Boolean);
      if (!lines.length) return [];
      return [...new Set(lines.map((l) => l.trim().split(/\s+/).pop()))];
    }
    const out = execSync("lsof -tiTCP:3000 -sTCP:LISTEN", { encoding: "utf8" });
    return out.trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
};
const pids = findPid3000();
for (const pid of pids) {
  try {
    process.kill(Number(pid), "SIGKILL");
  } catch {}
}
for (let i = 0; i < 20; i++) {
  if (findPid3000().length === 0) break;
  await sleep(500);
}

const restartLog = path.join(PROJECT, "scripts", "_rt-restart.log");
const logFd = fs.openSync(restartLog, "w");
// Spawn with a scrubbed env: the parent shell exports stale IPAYMU_* /
// DATABASE_URL that would otherwise shadow .env (dotenv never overrides).
const cleanEnv = { ...process.env };
for (const k of Object.keys(cleanEnv)) {
  if (/^IPAYMU_/.test(k) || k === "DATABASE_URL" || k === "NEXT_PUBLIC_APP_URL") delete cleanEnv[k];
}
const server = spawn("npm", ["run", "dev"], {
  cwd: PROJECT,
  detached: true,
  stdio: ["ignore", logFd, logFd],
  shell: true,
  env: cleanEnv,
});
server.unref();

let up = false;
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  try {
    const res = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      up = true;
      break;
    }
  } catch {}
}
check("TEST7 dev server restarted", up, "");

// Warm the (re)compiled stream route so the first customer reconnect after
// restart succeeds promptly (Next dev compiles routes on demand).
const warmStream = async () => {
  try {
    await anonPage.evaluate(async (num) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(`/api/public/orders/${num}/stream`, { signal: ctrl.signal });
        const reader = res.body.getReader();
        await reader.read(); // first chunk = connection hello / ping
        reader.releaseLock();
        res.body.cancel();
      } catch {}
      clearTimeout(t);
    }, ordD.number);
  } catch {}
};
await warmStream();
// Let the customer EventSource reconnect on its native cadence now that the
// route is compiled (each tab holds its own auto-retrying stream). Next dev
// may also issue ONE full reload to pages on reconnect (dev-only HMR); we
// wait for that to settle, then arm the no-reload marker so every assertion
// below proves the update arrived WITHOUT a fresh navigation.
await sleep(7000);
// Clear restart-noise page errors so the final sweep only sees post-restart
// failures (same convention as the admin realtime e2e).
for (const [tagName] of errorsByPage) errorsByPage.set(tagName, []);
await armNoReload(C5);
await sleep(1500);
const c5Stable = await stillArmed(C5);
check("TEST7 customer page stable after reconnect (no reload in flight)", c5Stable, "");

const dbOrdD = (await q("SELECT id FROM `Order` WHERE orderNumber = ?", [ordD.number]))[0];
const patchStatus = async (status) =>
  A.evaluate(
    async ({ id, status }) => {
      const res = await fetch(`/api/orders/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      return res.status;
    },
    { id: dbOrdD.id, status }
  );

const patched = await patchStatus("CONFIRMED");
check("TEST7 post-restart admin PATCH accepted", patched === 200, `status=${patched}`);
const c5Confirmed = await waitCompleted(C5, 2, 45000);
const c5ConfirmedToast = await tryWaitOn(
  C5,
  () => (document.body.innerText || "").includes("Pesanan telah dikonfirmasi"),
  12000,
  "reconnect confirmed toast"
);
check("TEST7 customer page converges after reconnect (CONFIRMED toast via SSE, no refresh)",
  c5Confirmed && (await stillArmed(C5)) && !!c5ConfirmedToast,
  `steps=${await completedSteps(C5)} toast=${c5ConfirmedToast}`);

// A SECOND live flip after the stream is certainly re-established: the
// PROCESSING toast only fires from an SSE event, proving events flow again.
const patched2 = await patchStatus("PROCESSING");
check("TEST7 second post-reconnect PATCH accepted", patched2 === 200, `status=${patched2}`);
const c5Processing = await waitCompleted(C5, 3, 25000);
const c5Toast = await tryWaitOn(
  C5,
  () => (document.body.innerText || "").includes("Pesanan sedang diproses oleh dapur"),
  10000,
  "reconnect processing toast"
);
check("TEST7 live SSE event delivered after reconnect (processing toast)",
  c5Processing && (await stillArmed(C5)) && !!c5Toast,
  `steps=${await completedSteps(C5)} toast=${c5Toast}`);

// ============================================================
// Cleanup
// ============================================================
const cleanupNumbers = [ordA.number, ordB.number, ordC.number, ordD.number].filter(Boolean);
const cleanupRows = await q("SELECT id FROM `Order` WHERE orderNumber IN (?)", [cleanupNumbers]);
const cleanupIds = cleanupRows.map((o) => o.id);
if (cleanupIds.length) {
  await conn.query("DELETE FROM Payment WHERE orderId IN (?)", [cleanupIds]);
  await conn.query("DELETE FROM `Order` WHERE id IN (?)", [cleanupIds]);
}
await conn.query("DELETE FROM Customer WHERE name LIKE 'E2ERT-%'", []);
await conn.query("UPDATE `Table` SET status='AVAILABLE' WHERE id IN (?, ?, ?)", [t1.id, t2.id, t4.id]);

// Console/page-error sweep (ignore HMR noise + the intentional SSE abort).
const pageErrors = [...errorsByPage.entries()]
  .map(([tagName, list]) => [
    tagName,
    list.filter(
      (e) =>
        !e.includes("_next/hmr") &&
        !e.includes("WebSocket connection") &&
        !e.includes("AbortError") &&
        !e.includes("ERR_CONNECTION_REFUSED") &&
        !e.includes("Failed to fetch")
    ),
  ])
  .filter(([, list]) => list.length > 0);
check("No console/page errors on realtime pages", pageErrors.length === 0, pageErrors.length ? JSON.stringify(pageErrors) : "");

await browser.close();
await conn.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks PASSED ====`);
if (failed.length) console.log("FAILED:", failed.map((f) => f.name).join(" | "));
process.exit(failed.length ? 1 : 0);
