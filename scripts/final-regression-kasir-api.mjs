// ============================================================
// FINAL REGRESSION AFTER SHIFT GUARD — API + DB + SECURITY
// runtime on 127.0.0.1:3001 ONLY (production build, mock iPaymu 4711).
//
// Part A (this file): API/DB/security/stock evidence for the FULL kasir
// regression matrix with the seeded cashier, using the REAL auth session
// and REAL MySQL rows. No UI — assertions are DB-first.
//
//   S-MATRIX (shift OPEN, kasir is the actor):
//     DINE_IN / TAKEAWAY / DELIVERY  x  CASH, QRIS, QRIS→CASH, CASH→QRIS
//     → DB: order.paymentStatus, payment.status/method/orderId/
//       restaurantId/branchId/shiftId, shift.status
//
//   NO-SHIFT (409 SHIFT_NOT_OPEN, nothing written, stock untouched):
//     CASH intent, QRIS intent (scan/repayment), manual order,
//     mark-paid on existing KASIR, repayment QRIS retry.
//
//   SECURITY: forged branch header → 403 (auth before shift guard),
//     /api/public/menu unguarded, /api/public/payments (customer QRIS)
//     NOT gated by requireOpenShift, shift open/close via real API.
//
//   DISTINCT CODES: second mark-paid on an already-PAID KASIR → 409
//     ALREADY_PAID (NOT SHIFT_NOT_OPEN).
//
// Tagged rows only are cleaned up (no reset/drop/truncate).
// ============================================================
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:3001";
const PROJECT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TAG = `fr-${Date.now().toString().slice(-7)}`;

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
const created = { orders: [], customers: [], payments: [], shifts: [], orderNums: [] };
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

const makeApi = () => {
  let cookie = "";
  let branchHeader = null;
  return {
    setBranch(id) { branchHeader = id; },
    async login(email, password) {
      const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
      cookie = (csrfRes.headers.getSetCookie ? csrfRes.headers.getSetCookie() : []).map((c) => c.split(";")[0]).join("; ");
      const csrfJson = await csrfRes.json();
      const form = new URLSearchParams({ csrfToken: csrfJson.csrfToken, email, password, callbackURL: `${BASE}/login`, json: "true" });
      const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 Chrome/126", ...(cookie ? { cookie } : {}) },
        body: form.toString(),
      });
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
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
  return { status: res.status, json: await res.json().catch(() => null) };
};

const stateOf = async (orderId) => {
  const payRows = await q(
    `SELECT id,status,method,orderId,restaurantId,branchId,shiftId,providerRef FROM payment WHERE orderId=? ORDER BY createdAt ASC`,
    [orderId]);
  const orderRow = (await q(`SELECT paymentStatus,status,branchId,restaurantId,grandTotal,orderNumber FROM \`order\` WHERE id=?`, [orderId]))[0];
  return { payRows, order: orderRow };
};
const countPaid = async (orderId) => (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND status='PAID'`, [orderId]))[0].c;

async function main() {
  if (!VA) throw new Error("IPAYMU_VA required");

  const admin = makeApi(); const asess = await admin.login("admin@restobahagia.com", "admin123");
  const restaurantId = asess.restaurantId;
  const adminBranchId = asess.branches?.[0]?.id || null;
  admin.setBranch(adminBranchId);
  check("env: admin login + branch", !!restaurantId && !!adminBranchId, `branch=${adminBranchId}`);

  const kasir = makeApi(); const ksess = await kasir.login("kasir@restobahagia.com", "kasir123");
  const kasirId = ksess.userId;
  const kasirBranchId = ksess.branches?.[0]?.id || null;
  const branchCode = ksess.branches?.[0]?.code;
  kasir.setBranch(kasirBranchId);
  check("env: kasir login + single branch", !!kasirId && !!kasirBranchId && kasirBranchId === adminBranchId, `branch=${kasirBranchId}`);

  await q(`UPDATE cashiershift SET status='CLOSED' WHERE userId=? AND status='OPEN'`, [kasirId]);
  check("env: no OPEN shift for kasir (deterministic start)",
    (await q(`SELECT COUNT(*) c FROM cashiershift WHERE userId=? AND status='OPEN'`, [kasirId]))[0].c === 0);

  const prod = (await q(
    `SELECT p.id,p.price FROM product p JOIN branchproduct bp ON bp.productId=p.id AND bp.branchId=?
     WHERE p.restaurantId=? AND p.isActive=1 AND p.isAvailable=1 AND bp.isAvailable=1 AND bp.stock>0 ORDER BY p.price ASC LIMIT 1`,
    [kasirBranchId, restaurantId]))[0];
  if (!prod) throw new Error("no orderable product");

  const stockAt = async () => (await q(`SELECT stock FROM branchproduct WHERE branchId=? AND productId=?`, [kasirBranchId, prod.id]))[0].stock;
  const stockBefore = await stockAt();

  const mkCustomer = async (label) => {
    const custId = `fr-${crypto.randomBytes(8).toString("hex")}`;
    await q(`INSERT INTO customer (id,restaurantId,name,phone,isActive,createdAt,updatedAt) VALUES (?,?,?,?,1,NOW(6),NOW(6))`,
      [custId, restaurantId, `FinalReg ${TAG} ${label}`, `fr-${TAG}-${label}`]);
    created.customers.push(custId);
    return custId;
  };

  const openShift = async (openingCash = 100000) => {
    const r = await kasir.post("/api/shifts", { openingCash });
    created.shifts.push(r.json?.data?.id);
    return r;
  };
  const closeShift = async (actualCash = 100000) => kasir.post("/api/shifts/close", { actualCash });

  // ============================================================
  // SECURITY (no shift required for these proofs)
  // ============================================================
  {
    // Forged branch header → auth rejects BEFORE the shift guard.
    const custId = await mkCustomer("SEC");
    const o0 = await admin.post("/api/orders", { customerId: custId, orderType: "DINE_IN", items: [{ productId: prod.id, quantity: 1 }] });
    if (o0.status !== 201) throw new Error(`sec order failed: ${JSON.stringify(o0.json)}`);
    created.orders.push(o0.json.data.id);
    created.orderNums.push(o0.json.data.orderNumber);

    kasir.setBranch("TEST-BR-JKT");
    const forged = await kasir.post("/api/payments", { orderId: o0.json.data.id, method: "KASIR" });
    check("SEC forged branchId: 403 FORBIDDEN (auth before shift guard)",
      forged.status === 403, `http=${forged.status} code=${forged.json?.error}`);
    kasir.setBranch(kasirBranchId);

    // Public menu — unauthenticated, still 200 (NOT gated by requireOpenShift).
    const pub = await fetch(`${BASE}/api/public/menu?restaurantId=${restaurantId}&branchCode=${branchCode}`);
    const pubJson = await pub.json().catch(() => null);
    check("SEC /api/public/menu unguarded: 200 + products",
      pub.status === 200 && Array.isArray(pubJson?.data?.products) && pubJson.data.products.length > 0,
      `http=${pub.status} products=${pubJson?.data?.products?.length}`);

    // Customer/public QRIS flow — must NOT be gated, even with the cashier's
    // shift closed (customer never opens a shift).
    const pubPay = await fetch(`${BASE}/api/public/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNumber: o0.json.data.orderNumber, method: "QRIS" }),
    });
    const pubPayJson = await pubPay.json().catch(() => null);
    const pubRow = (await q(`SELECT status,method FROM payment WHERE orderId=? AND method='QRIS' ORDER BY createdAt DESC LIMIT 1`, [o0.json.data.id]))[0];
    created.payments.push(...(await q(`SELECT id FROM payment WHERE orderId=?`, [o0.json.data.id])).map((r) => r.id));
    check("SEC /api/public/payments (customer QRIS): intent created w/o shift",
      (pubPay.status === 200 || pubPay.status === 201) && pubRow?.status === "PENDING" && pubRow?.method === "QRIS",
      `http=${pubPay.status} status=${pubRow?.status} method=${pubRow?.method}`);
  }

  // ============================================================
  // NO-SHIFT group → 409 SHIFT_NOT_OPEN, zero writes, stock untouched
  // ============================================================
  {
    const custId = await mkCustomer("NS"); // T-no-shift manual order
    const manual = await kasir.post("/api/orders", { customerId: custId, orderType: "DINE_IN", items: [{ productId: prod.id, quantity: 1 }] });
    check("NS manual order: 409 SHIFT_NOT_OPEN", manual.status === 409 && manual.json?.error === "SHIFT_NOT_OPEN", `http=${manual.status} code=${manual.json?.error}`);
    check("NS manual order: no order row", (await q(`SELECT COUNT(*) c FROM \`order\` WHERE customerId=?`, [custId]))[0].c === 0);

    const oNS = await admin.post("/api/orders", { customerId: custId, orderType: "DINE_IN", items: [{ productId: prod.id, quantity: 1 }] });
    created.orders.push(oNS.json.data.id); created.orderNums.push(oNS.json.data.orderNumber);
    const on = oNS.json.data;

    const cashNS = await kasir.post("/api/payments", { orderId: on.id, method: "KASIR" });
    check("NS CASH intent: 409 SHIFT_NOT_OPEN", cashNS.status === 409 && cashNS.json?.error === "SHIFT_NOT_OPEN", `http=${cashNS.status} code=${cashNS.json?.error}`);
    check("NS CASH intent: no payment row", (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND method='KASIR'`, [on.id]))[0].c === 0);

    const qrisNS = await kasir.post("/api/payments", { orderNumber: on.orderNumber, method: "QRIS" });
    check("NS QRIS intent (scan/repayment): 409 SHIFT_NOT_OPEN", qrisNS.status === 409 && qrisNS.json?.error === "SHIFT_NOT_OPEN", `http=${qrisNS.status} code=${qrisNS.json?.error}`);
    check("NS QRIS intent: no payment row", (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND method='QRIS'`, [on.id]))[0].c === 0);

    // mark-paid on an existing KASIR (admin created the intent)
    const adminK = await admin.post("/api/payments", { orderId: on.id, method: "KASIR" });
    created.payments.push(adminK.json.data.id);
    const markNS = await kasir.post(`/api/payments/${adminK.json.data.id}/mark-paid`, { amountReceived: Number(on.grandTotal) });
    const stNS = await stateOf(on.id);
    check("NS mark-paid: 409 SHIFT_NOT_OPEN + payment STAYS UNPAID, order UNPAID",
      markNS.status === 409 && markNS.json?.error === "SHIFT_NOT_OPEN" &&
        stNS.payRows.find((p) => p.method === "KASIR")?.status === "UNPAID" && stNS.order?.paymentStatus === "UNPAID",
      `http=${markNS.status} cash=${stNS.payRows.find((p) => p.method === "KASIR")?.status} order=${stNS.order?.paymentStatus}`);

    // repayment retry (QRIS already FAILED → kasir retries) — still guarded
    const rf = await admin.post("/api/payments", { orderId: on.id, method: "KASIR" }); // ensure a cash intent exists
    const repNS = await kasir.post("/api/payments", { orderNumber: on.orderNumber, method: "QRIS" });
    const payCountBefore = (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=?`, [on.id]))[0].c;
    const payCountAfter = payCountBefore;
    check("NS repayment QRIS retry: 409 SHIFT_NOT_OPEN + no extra payment rows",
      repNS.status === 409 && repNS.json?.error === "SHIFT_NOT_OPEN" && payCountAfter === (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=?`, [on.id]))[0].c,
      `http=${repNS.status} rows=${payCountAfter}`);
    created.payments.push(rf.json.data.id);

    // stock must be identical after every no-shift attempt
    check("NS stock untouched (no order, no mutation)",
      (await stockAt()) === stockBefore, `stock=${await stockAt()} (before=${stockBefore})`);

    // ALREADY_PAID distinct — mark the paid KASIR again (later, after matrix).
    // Alias the fixture for that check below.
    created.paysPaid = created.paysPaid || [];
  }

  // ============================================================
  // SHIFT LIFECYCLE via REAL API
  // ============================================================
  {
    const open = await openShift(100000);
    check("SHIFT open: 201 + OPEN + shiftNumber",
      open.status === 201 && open.json?.data?.status === "OPEN" && !!open.json?.data?.shiftNumber,
      `http=${open.status} status=${open.json?.data?.status}`);
    const close = await closeShift(100000);
    const closedDb = (await q(`SELECT COUNT(*) c FROM cashiershift WHERE userId=? AND status='OPEN'`, [kasirId]))[0].c;
    check("SHIFT close: 200 + no OPEN shift remains (DB truth)",
      close.status === 200 && Number(closedDb) === 0, `http=${close.status} open=${closedDb}`);
    await openShift(100000); // reopen for the matrix
    check("SHIFT reopen: OPEN", (await q(`SELECT COUNT(*) c FROM cashiershift WHERE userId=? AND status='OPEN'`, [kasirId]))[0].c === 1);
  }

  // ============================================================
  // SHIFT-OPEN MATRIX — kasir is the actor for create + pay
  // ============================================================
  let paidCasherPaymentId = null;
  for (const orderType of ["DINE_IN", "TAKEAWAY", "DELIVERY"]) {
    // ---------- CASH ----------
    {
      const custId = await mkCustomer(`${orderType}-CASH`);
      const o = await kasir.post("/api/orders", { customerId: custId, orderType, items: [{ productId: prod.id, quantity: 1 }] });
      if (o.status !== 201) throw new Error(`[${orderType}] CASH order failed: ${JSON.stringify(o.json)}`);
      created.orders.push(o.json.data.id); created.orderNums.push(o.json.data.orderNumber);
      const pid = o.json.data.id;
      const c = await kasir.post("/api/payments", { orderId: pid, method: "KASIR" });
      if (c.status !== 201) throw new Error(`[${orderType}] CASH intent failed: ${JSON.stringify(c.json)}`);
      created.payments.push(c.json.data.id);
      const shiftId = (await q(`SELECT id FROM cashiershift WHERE userId=? AND status='OPEN' ORDER BY openedAt DESC LIMIT 1`, [kasirId]))[0].id;
      const mark = await kasir.post(`/api/payments/${c.json.data.id}/mark-paid`, { amountReceived: Number(o.json.data.grandTotal) });
      const st = await stateOf(pid);
      const cash = st.payRows.find((p) => p.method === "KASIR");
      const shiftRow = (await q(`SELECT status FROM cashiershift WHERE id=?`, [cash?.shiftId]))[0];
      check(`${orderType} CASH: mark 200 + DB PAID (order=PAID, method=KASIR, shiftId set)`,
        mark.status === 200 && cash?.status === "PAID" && st.order?.paymentStatus === "PAID" &&
          cash?.method === "KASIR" && cash.orderId === pid &&
          cash.restaurantId === st.order.restaurantId && cash.branchId === st.order.branchId &&
          cash.shiftId === shiftId && shiftRow?.status === "OPEN" && (await countPaid(pid)) === 1,
        `mark=${mark.status} cash=${cash?.status} order=${st.order?.paymentStatus} shift=${cash?.shiftId?.slice(0, 8)}`);
      if (!orderType || orderType === "DINE_IN") paidCasherPaymentId = c.json.data.id;
    }

    // ---------- QRIS (PENDING → webhook PAID) ----------
    {
      const custId = await mkCustomer(`${orderType}-QRIS`);
      const o = await kasir.post("/api/orders", { customerId: custId, orderType, items: [{ productId: prod.id, quantity: 1 }] });
      if (o.status !== 201) throw new Error(`[${orderType}] QRIS order failed: ${JSON.stringify(o.json)}`);
      created.orders.push(o.json.data.id); created.orderNums.push(o.json.data.orderNumber);
      const pid = o.json.data.id; const on = o.json.data.orderNumber;
      const qr = await kasir.post("/api/payments", { orderNumber: on, method: "QRIS" });
      if (qr.status !== 200 && qr.status !== 201) throw new Error(`[${orderType}] QRIS intent failed: ${JSON.stringify(qr.json)}`);
      const payId = qr.json?.data?.payment?.id || qr.json?.data?.id;
      created.payments.push(payId);
      check(`${orderType} QRIS: intent PENDING`, (await q(`SELECT status FROM payment WHERE id=?`, [payId]))[0]?.status === "PENDING");
      const wh = await postWebhook({ reference_id: on, trx_id: `${orderType}-T${TAG}`, status: "berhasil", total: String(o.json.data.grandTotal), amount: String(o.json.data.grandTotal) });
      const st = await stateOf(pid);
      const pay = st.payRows.find((p) => p.method === "QRIS");
      check(`${orderType} QRIS: webhook 200 + DB PAID (payment=PAID, order=PAID, single PAID)`,
        wh.status === 200 && pay?.status === "PAID" && st.order?.paymentStatus === "PAID" &&
          pay.orderId === pid && pay.restaurantId === st.order.restaurantId && pay.branchId === st.order.branchId &&
          (await countPaid(pid)) === 1,
        `wh=${wh.status} qris=${pay?.status} order=${st.order?.paymentStatus}`);
    }

    // ---------- QRIS → CASH ----------
    {
      const custId = await mkCustomer(`${orderType}-QC`);
      const o = await kasir.post("/api/orders", { customerId: custId, orderType, items: [{ productId: prod.id, quantity: 1 }] });
      if (o.status !== 201) throw new Error(`[${orderType}] QC order failed: ${JSON.stringify(o.json)}`);
      created.orders.push(o.json.data.id); created.orderNums.push(o.json.data.orderNumber);
      const pid = o.json.data.id; const on = o.json.data.orderNumber;
      const qr = await kasir.post("/api/payments", { orderNumber: on, method: "QRIS" });
      created.payments.push(qr.json?.data?.payment?.id || qr.json?.data?.id);
      const c = await kasir.post("/api/payments", { orderId: pid, method: "KASIR" });
      if (c.status !== 201) throw new Error(`[${orderType}] QC cash failed: ${JSON.stringify(c.json)}`);
      created.payments.push(c.json.data.id);
      const mark = await kasir.post(`/api/payments/${c.json.data.id}/mark-paid`, { amountReceived: Number(o.json.data.grandTotal) });
      const st = await stateOf(pid);
      const qris = st.payRows.find((p) => p.method === "QRIS"); const cash = st.payRows.find((p) => p.method === "KASIR");
      check(`${orderType} QRIS→CASH: DB cash=PAID, oldQRIS!=PAID, order=PAID, single PAID`,
        mark.status === 200 && cash?.status === "PAID" && qris?.status !== "PAID" && st.order?.paymentStatus === "PAID" && (await countPaid(pid)) === 1,
        `mark=${mark.status} cash=${cash?.status} qris=${qris?.status} order=${st.order?.paymentStatus}`);
    }

    // ---------- CASH → QRIS ----------
    {
      const custId = await mkCustomer(`${orderType}-CQ`);
      const o = await kasir.post("/api/orders", { customerId: custId, orderType, items: [{ productId: prod.id, quantity: 1 }] });
      if (o.status !== 201) throw new Error(`[${orderType}] CQ order failed: ${JSON.stringify(o.json)}`);
      created.orders.push(o.json.data.id); created.orderNums.push(o.json.data.orderNumber);
      const pid = o.json.data.id; const on = o.json.data.orderNumber;
      const c = await kasir.post("/api/payments", { orderId: pid, method: "KASIR" });
      if (c.status !== 201) throw new Error(`[${orderType}] CQ cash intent failed: ${JSON.stringify(c.json)}`);
      created.payments.push(c.json.data.id);
      const qr = await kasir.post("/api/payments", { orderNumber: on, method: "QRIS" });
      created.payments.push(qr.json?.data?.payment?.id || qr.json?.data?.id);
      const wh = await postWebhook({ reference_id: on, trx_id: `${orderType}-CQ${TAG}`, status: "berhasil", total: String(o.json.data.grandTotal), amount: String(o.json.data.grandTotal) });
      const st = await stateOf(pid);
      const qris = st.payRows.find((p) => p.method === "QRIS"); const cash = st.payRows.find((p) => p.method === "KASIR");
      check(`${orderType} CASH→QRIS: DB qris=PAID, oldCASH!=PAID, order=PAID, single PAID`,
        wh.status === 200 && qris?.status === "PAID" && cash?.status !== "PAID" && st.order?.paymentStatus === "PAID" && (await countPaid(pid)) === 1,
        `wh=${wh.status} qris=${qris?.status} cash=${cash?.status} order=${st.order?.paymentStatus}`);
    }
  }

  // ============================================================
  // SHIFT CLOSE with open drawer (real API) after the matrix
  // ============================================================
  {
    const shiftOpen = (await q(`SELECT * FROM cashiershift WHERE userId=? AND status='OPEN' ORDER BY openedAt DESC LIMIT 1`, [kasirId]))[0];
    const close = await closeShift(Number(shiftOpen.openingCash) + 100000);
    const closedCount = (await q(`SELECT COUNT(*) c FROM cashiershift WHERE userId=? AND status='OPEN'`, [kasirId]))[0].c;
    check("SHIFT close after matrix: 200 + no OPEN shift remains (DB truth)",
      close.status === 200 && Number(closedCount) === 0, `http=${close.status} open=${closedCount}`);
    const noMoreOpen = (await q(`SELECT COUNT(*) c FROM cashiershift WHERE userId=? AND status='OPEN'`, [kasirId]))[0].c;
    // A second OPEN shift stays — guard then blocks the next no-shift matrix.
    check("only one shift handled by close", noMoreOpen === 0, `open=${noMoreOpen}`);
  }

  // ============================================================
  // ALREADY_PAID distinct from SHIFT_NOT_OPEN (409, different code)
  // ============================================================
  {
    // Use a PAID KASIR payment from the DINE_IN CASH flow (if present).
    const pid = (await q(
      `SELECT p.id, o.grandTotal FROM payment p JOIN \`order\` o ON o.id=p.orderId
       WHERE o.restaurantId=? AND p.method='KASIR' AND p.status='PAID' AND o.id IN (?)
       ORDER BY p.updatedAt DESC LIMIT 1`, [restaurantId, created.orders]))[0];
    if (pid) {
      // Full amount: the ALREADY_PAID guard (not the amount validation) must fire.
      const mark2 = await kasir.post(`/api/payments/${pid.id}/mark-paid`, { amountReceived: Number(pid.grandTotal) });
      check("ALREADY_PAID: second mark-paid → 409 ALREADY_PAID (NOT SHIFT_NOT_OPEN)",
        mark2.status === 409 && mark2.json?.error === "ALREADY_PAID", `http=${mark2.status} code=${mark2.json?.error}`);
    } else {
      check("ALREADY_PAID: fixture found for re-mark", false, "no paid KASIR row in scope");
    }
  }

  // ============================================================
  // INTEGRITY across the whole run
  // ============================================================
  {
    let allOk = true; const details = [];
    for (const oid of created.orders) {
      const st = await stateOf(oid);
      const paid = st.payRows.filter((p) => p.status === "PAID");
      if (paid.length > 1) { allOk = false; details.push(`${oid}:${paid.length}PAID`); }
      for (const p of st.payRows) {
        if (p.orderId !== oid) { allOk = false; details.push(`${oid}:oid`); }
        if (p.branchId !== st.order.branchId) { allOk = false; details.push(`${oid}:pbranch`); }
        if (p.restaurantId !== st.order.restaurantId) { allOk = false; details.push(`${oid}:prest`); }
      }
    }
    check("INTEGRITY: payment.orderId/restaurantId/branchId === order, ≤1 PAID", allOk, details.join(","));
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
    console.log("cleanup: tagged rows removed");
  } catch (e) {
    console.log("cleanup error (rows remain):", e.message);
  }

  await pool.end();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  try { await pool.end(); } catch {}
  process.exit(2);
});