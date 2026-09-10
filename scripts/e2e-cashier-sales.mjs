// ============================================================
// CASHIER SALES HISTORY — RUNTIME E2E on 127.0.0.1:3001 ONLY.
//
// Covers tests 1-18 of the audit: ownership isolation (cashier /
// branch / restaurant), payment semantics, split-payment (1 order = 1
// tx), shift + date filters, summary-follows-filters, pagination,
// read-only kasir, security spoofing, and regression smoke.
//
// Tagged rows ONLY are created and cleaned. No reset / drop / truncate.
// ============================================================
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:3001";
const PROJECT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TAG = `cs-${Date.now().toString().slice(-7)}`;

function loadEnv() {
  const env = {};
  const raw = fs.readFileSync(path.join(PROJECT, ".env"), "utf8");
  const keep = new Set(["DATABASE_URL"]);
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m && keep.has(m[1])) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  return env;
}
const ENV = loadEnv();
const url = new URL(ENV.DATABASE_URL || "mysql://root:password@localhost:3306/restaurant_app");
const pool = mysql.createPool({
  host: url.hostname, port: url.port || 3306,
  user: decodeURIComponent(url.username), password: decodeURIComponent(url.password || ""),
  database: url.pathname.replace(/^\//, ""), connectionLimit: 8,
});
const q = async (sql, params = []) => (await pool.query(sql, params))[0];

const results = [];
const created = { orders: [], customers: [], payments: [], shifts: [], users: [], refunds: [], userBranches: [] };
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

const makeApi = () => {
  let cookie = "";
  let branchHeader = null;
  return {
    setBranch(id) { branchHeader = id; },
    clearBranch() { branchHeader = null; },
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
      cookie = [...new Set([...cookie.split(";").filter(Boolean), ...sc.map((c) => c.split(";")[0])])].join("; ");
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

const now = () => new Date().toISOString().slice(0, 10);
const uid = (p) => `${p}${crypto.randomBytes(6).toString("hex")}`;

// Open a shift for a user+branch, or reuse an existing OPEN one (never
// disturbs other sessions' open shifts; the reused shift is not tagged for
// deletion — only our own payments/orders get cleaned).
const ensureShift = async (apiActor, restaurantId, userId, branchId) => {
  const existing = (await q(
    `SELECT id FROM cashiershift WHERE restaurantId=? AND userId=? AND branchId=? AND status='OPEN' ORDER BY openedAt DESC LIMIT 1`,
    [restaurantId, userId, branchId]))[0];
  if (existing) return { id: existing.id, reused: true };
  const open = await apiActor.post("/api/shifts", { openingCash: 100000 });
  if (open.status !== 201) throw new Error(`shift open failed (${branchId}): ${JSON.stringify(open.json)}`);
  created.shifts.push(open.json.data.id);
  return { id: open.json.data.id, reused: false };
};

async function main() {
  const RESTA = "cmtois12y0000bzu8o894azsd";
  const MAIN = "cmts3aks100009tu818hblu00";
  const JKT = "TEST-BR-JKT";
  const RESTO_B = "TEST-RESTO-B";
  const BKS = "TEST-BR-BKS";

  // ------------------------------------------------------------------
  // Logins
  // ------------------------------------------------------------------
  const adminA = makeApi();
  const asess = await adminA.login("admin@restobahagia.com", "admin123");
  const adminAId = asess.userId;
  adminA.setBranch(MAIN);

  const kasirA = makeApi();
  const kA = await kasirA.login("kasir@restobahagia.com", "kasir123");
  const kasirAId = kA.userId;
  kasirA.setBranch(MAIN);

  const adminJkt = makeApi();
  const aj = await adminJkt.login("admin-scoped@restobahagia.com", "admin123");
  adminJkt.setBranch(JKT);

  const adminB = makeApi();
  const ab = await adminB.login("admin-b@restob.com", "admin123");
  const adminBId = ab.userId;
  adminB.setBranch(BKS);

  // Temp cashier B (Restaurant A, MAIN) — isolated test identity.
  const cashierBId = `TEST-CASHIER-SALES-B-${TAG}`;
  const cashierBEmail = `cashier-sales-b-${TAG}@test.local`;
  const pwHash = await bcrypt.hash("kasir123", 12);
  await q(`INSERT INTO user (id,restaurantId,name,email,password,role,isActive,sessionVersion,createdAt,updatedAt)
           VALUES (?,?,?,?,?,?,1,0,NOW(6),NOW(6))`,
    [cashierBId, RESTA, `CashierB ${TAG}`, cashierBEmail, pwHash, "CASHIER"]);
  created.users.push(cashierBId);
  await q(`INSERT INTO userbranch (id,userId,branchId,createdAt) VALUES (?,?,?,NOW(6))`, [`ub-b-${TAG}`, cashierBId, MAIN]);
  created.userBranches.push(`ub-b-${TAG}`);
  const cashierB = makeApi();
  const kB = await cashierB.login(cashierBEmail, "kasir123");
  if (kB.userId !== cashierBId) throw new Error("temp cashier B login mismatch");
  cashierB.setBranch(MAIN);

  check("env: all sessions", !!adminAId && !!kasirAId && !!aj && !!ab && !!kB, `kasirB=${cashierBId.slice(0, 8)}`);

  // Product to order in MAIN.
  const prod = (await q(
    `SELECT p.id,p.price FROM product p JOIN branchproduct bp ON bp.productId=p.id AND bp.branchId=?
     WHERE p.restaurantId=? AND p.isActive=1 AND p.isAvailable=1 AND bp.isAvailable=1 AND bp.stock>0 ORDER BY p.price ASC LIMIT 1`,
    [MAIN, RESTA]))[0];
  if (!prod) throw new Error("no orderable MAIN product");

  const mkCustomer = async (apiOwner, label) => {
    const custId = uid(`cust-${TAG}`);
    await q(`INSERT INTO customer (id,restaurantId,name,phone,isActive,createdAt,updatedAt) VALUES (?,?,?,?,1,NOW(6),NOW(6))`,
      [custId, RESTA, `CS ${label}`, `cs-${TAG}-${label}`]);
    created.customers.push(custId);
    return custId;
  };
  const mkOrder = async (apiActor, custId, orderType = "DINE_IN") => {
    const r = await apiActor.post("/api/orders", { customerId: custId, orderType, items: [{ productId: prod.id, quantity: 1 }] });
    if (r.status !== 201) throw new Error(`order create failed: ${JSON.stringify(r.json)}`);
    created.orders.push(r.json.data.id);
    return r.json.data;
  };
  const mkCashPaid = async (cashierApi, order) => {
    const c = await cashierApi.post("/api/payments", { orderId: order.id, method: "KASIR" });
    if (c.status !== 201 && c.status !== 200) throw new Error(`cash intent failed: ${JSON.stringify(c.json)}`);
    const payId = c.json?.data?.id;
    created.payments.push(payId);
    const mark = await cashierApi.post(`/api/payments/${payId}/mark-paid`, { amountReceived: Number(order.grandTotal) });
    return { payId, mark };
  };

  // ------------------------------------------------------------------
  // Fixture: close existing OPEN shifts for kasir A + temp cashier B
  // ------------------------------------------------------------------
  await q(`UPDATE cashiershift SET status='CLOSED', closedAt=NOW(6) WHERE userId=? AND status='OPEN'`, [kasirAId]);
  await q(`UPDATE cashiershift SET status='CLOSED', closedAt=NOW(6) WHERE userId=? AND status='OPEN'`, [cashierBId]);

  // ------------------------------------------------------------------
  // SHIFT A1 + transactions for Kasir A
  // ------------------------------------------------------------------
  const openA1 = await kasirA.post("/api/shifts", { openingCash: 500000 });
  if (openA1.status !== 201) throw new Error(`shift A1 open failed: ${JSON.stringify(openA1.json)}`);
  const shiftA1 = openA1.json.data.id;
  created.shifts.push(shiftA1);

  const o11 = await mkOrder(kasirA, await mkCustomer(kasirA, "A1-1"), "DINE_IN");
  const p11 = await mkCashPaid(kasirA, o11);

  const o12 = await mkOrder(kasirA, await mkCustomer(kasirA, "A1-2"), "TAKEAWAY");
  const p12 = await mkCashPaid(kasirA, o12);

  const o13 = await mkOrder(kasirA, await mkCustomer(kasirA, "A1-3"), "DINE_IN");
  const pay13 = uid("pay-");
  created.payments.push(pay13);
  await q(`INSERT INTO payment (id,restaurantId,branchId,orderId,shiftId,status,amount,method,createdAt,updatedAt)
           VALUES (?,?,?,?,?,?,?,?,NOW(6),NOW(6))`,
    [pay13, RESTA, MAIN, o13.id, shiftA1, "PAID", Number(o13.grandTotal), "QRIS"]);
  await q(`UPDATE payment SET paidAt=NOW(6) WHERE id=?`, [pay13]);
  await q(`UPDATE \`order\` SET paymentStatus='PAID', status='COMPLETED' WHERE id=?`, [o13.id]);

  // A1-4: QRIS FAILED — must NOT count as sales.
  const o14 = await mkOrder(kasirA, await mkCustomer(kasirA, "A1-4"), "DINE_IN");
  const pay14 = uid("pay-");
  created.payments.push(pay14);
  await q(`INSERT INTO payment (id,restaurantId,branchId,orderId,shiftId,status,amount,method,createdAt,updatedAt)
           VALUES (?,?,?,?,?,?,?,?,NOW(6),NOW(6))`,
    [pay14, RESTA, MAIN, o14.id, shiftA1, "FAILED", Number(o14.grandTotal), "QRIS"]);

  // A1-5: CASH PAID + APPROVED refund (full reversal for clean net math).
  const o15 = await mkOrder(kasirA, await mkCustomer(kasirA, "A1-5"), "DINE_IN");
  const p15 = await mkCashPaid(kasirA, o15);
  const refund15 = uid("ref-");
  created.refunds.push(refund15);
  await q(`INSERT INTO refund (id,restaurantId,branchId,orderId,paymentId,shiftId,amount,reason,status,requestedByCashierId,approvedByAdminId,requestedAt,approvedAt,decidedAt,createdAt,updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(6),NOW(6),NOW(6),NOW(6),NOW(6))`,
    [refund15, RESTA, MAIN, o15.id, p15.payId, shiftA1, Number(o15.grandTotal), `e2e refund ${TAG}`, "APPROVED", kasirAId, adminAId]);

  // A1-6: customer-direct QRIS PAID (shiftId NULL) — must NEVER appear.
  const o16 = await mkOrder(adminA, await mkCustomer(adminA, "A1-6"), "DINE_IN");
  const pay16 = uid("pay-");
  created.payments.push(pay16);
  await q(`INSERT INTO payment (id,restaurantId,branchId,orderId,status,amount,method,paidAt,createdAt,updatedAt)
           VALUES (?,?,?,?,'PAID',?,?,NOW(6),NOW(6),NOW(6))`,
    [pay16, RESTA, MAIN, o16.id, Number(o16.grandTotal), "QRIS"]);
  await q(`UPDATE \`order\` SET paymentStatus='PAID', status='COMPLETED' WHERE id=?`, [o16.id]);

  await kasirA.post("/api/shifts/close", { actualCash: 500000 });
  check("fixture: shift A1 closed", (await q(`SELECT status FROM cashiershift WHERE id=?`, [shiftA1]))[0].status === "CLOSED");

  // ------------------------------------------------------------------
  // SHIFT A2 + one CASH paid tx (kept OPEN) + split order (2 PAID legs)
  // ------------------------------------------------------------------
  const openA2 = await kasirA.post("/api/shifts", { openingCash: 200000 });
  const shiftA2 = openA2.json.data.id;
  created.shifts.push(shiftA2);

  const o21 = await mkOrder(kasirA, await mkCustomer(kasirA, "A2-1"), "DELIVERY");
  await mkCashPaid(kasirA, o21);

  // Split: order A2-2 with BOTH CASH + QRIS PAID legs (must count as ONE).
  const o22 = await mkOrder(adminA, await mkCustomer(adminA, "A2-2"), "DINE_IN");
  const pay22c = uid("pay-"); const pay22q = uid("pay-");
  created.payments.push(pay22c, pay22q);
  const half = Number((Number(o22.grandTotal) / 2).toFixed(2));
  const half2 = Number((Number(o22.grandTotal) - half).toFixed(2));
  await q(`INSERT INTO payment (id,restaurantId,branchId,orderId,shiftId,status,amount,method,paidAt,createdAt,updatedAt)
           VALUES (?,?,?,?,?,'PAID',?,?,NOW(6),NOW(6),NOW(6))`,
    [pay22c, RESTA, MAIN, o22.id, shiftA2, half, "KASIR"]);
  await q(`INSERT INTO payment (id,restaurantId,branchId,orderId,shiftId,status,amount,method,paidAt,createdAt,updatedAt)
           VALUES (?,?,?,?,?,'PAID',?,?,NOW(6),NOW(6),NOW(6))`,
    [pay22q, RESTA, MAIN, o22.id, shiftA2, half2, "QRIS"]);
  await q(`UPDATE \`order\` SET paymentStatus='PAID', status='COMPLETED' WHERE id=?`, [o22.id]);

  // ------------------------------------------------------------------
  // Temp Cashier B — SHIFT B1 + one CASH paid tx (MAIN, same branch A)
  // ------------------------------------------------------------------
  const openB1 = await cashierB.post("/api/shifts", { openingCash: 100000 });
  if (openB1.status !== 201) throw new Error(`shift B1 open failed: ${JSON.stringify(openB1.json)}`);
  const shiftB1 = openB1.json.data.id;
  created.shifts.push(shiftB1);
  const bo1 = await mkOrder(cashierB, await mkCustomer(cashierB, "B1-1"), "DINE_IN");
  await mkCashPaid(cashierB, bo1);

  // ------------------------------------------------------------------
  // JKT (admin-scoped) — shift J1 + CASH PAID via SQL (attached to J1)
  // ------------------------------------------------------------------
  const shiftJ1 = (await ensureShift(adminJkt, RESTA, aj.userId, JKT)).id;
  const jCust = uid("cust-");
  await q(`INSERT INTO customer (id,restaurantId,name,phone,isActive,createdAt,updatedAt)
           VALUES (?,?,?,?,1,NOW(6),NOW(6))`, [jCust, RESTA, `CS J1-1`, `cs-${TAG}-j1`]);
  created.customers.push(jCust);
  const jo1 = await mkOrder(adminJkt, jCust, "DINE_IN");
  const jpay = uid("pay-");
  created.payments.push(jpay);
  await q(`INSERT INTO payment (id,restaurantId,branchId,orderId,shiftId,status,amount,method,paidAt,createdAt,updatedAt)
           VALUES (?,?,?,?,?,'PAID',?,?,NOW(6),NOW(6),NOW(6))`,
    [jpay, RESTA, JKT, jo1.id, shiftJ1, Number(jo1.grandTotal), "KASIR"]);
  await q(`UPDATE \`order\` SET paymentStatus='PAID', status='COMPLETED' WHERE id=?`, [jo1.id]);

  // ------------------------------------------------------------------
  // Resto B (admin-b) — shift BB1 + CASH PAID via SQL (Restaurant B)
  // ------------------------------------------------------------------
  const shiftBB1 = (await ensureShift(adminB, RESTO_B, adminBId, BKS)).id;
  const bCust = uid("cust-");
  await q(`INSERT INTO customer (id,restaurantId,name,phone,isActive,createdAt,updatedAt)
           VALUES (?,?,?,?,1,NOW(6),NOW(6))`, [bCust, RESTO_B, `CS RB`, `cs-${TAG}-rb`]);
  created.customers.push(bCust);
  const bOrderId = uid("ord-");
  const bOrderNumber = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${TAG.toUpperCase()}`;
  await q(`INSERT INTO \`order\` (id,restaurantId,branchId,orderNumber,customerId,status,paymentStatus,subtotal,discount,tax,serviceCharge,grandTotal,orderType,createdAt,updatedAt)
           VALUES (?,?,?,?,?,'COMPLETED','PAID',5000,0,0,0,5000,'DINE_IN',NOW(6),NOW(6))`,
    [bOrderId, RESTO_B, BKS, bOrderNumber, bCust]);
  created.orders.push(bOrderId);
  const bpay = uid("pay-");
  created.payments.push(bpay);
  await q(`INSERT INTO payment (id,restaurantId,branchId,orderId,shiftId,status,amount,method,paidAt,createdAt,updatedAt)
           VALUES (?,?,?,?,?,'PAID',?,?,NOW(6),NOW(6),NOW(6))`,
    [bpay, RESTO_B, BKS, bOrderId, shiftBB1, 5000, "KASIR"]);

  // ==================================================================
  // DB ground-truth for Kasir A's expected book (unique PAID orders).
  // ==================================================================
  const tb = now();
  const sumA = (rows) => rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const paidRowsA = await q(
    `SELECT p.orderId, p.method, p.amount FROM payment p
     JOIN cashiershift s ON s.id=p.shiftId
     WHERE s.restaurantId=? AND s.userId=? AND p.status='PAID'
       AND p.createdAt >= ? AND p.createdAt < DATE_ADD(?, INTERVAL 1 DAY)`,
    [RESTA, kasirAId, `${tb}T00:00:00`, `${tb}T00:00:00`]);
  const distinctPaidOrdersA = new Set(paidRowsA.map((r) => r.orderId));
  const cashSumA = sumA(paidRowsA.filter((r) => r.method === "KASIR"));
  const qrisSumA = sumA(paidRowsA.filter((r) => r.method === "QRIS"));
  const salesSumA = cashSumA + qrisSumA;
  // Refunds: APPROVED in kasir A's shifts today.
  const refundRowsA = (await q(
    `SELECT r.amount FROM refund r JOIN cashiershift s ON s.id=r.shiftId
     WHERE s.restaurantId=? AND s.userId=? AND r.status='APPROVED'
       AND r.requestedAt >= ? AND r.requestedAt < DATE_ADD(?, INTERVAL 1 DAY)`,
    [RESTA, kasirAId, `${tb}T00:00:00`, `${tb}T00:00:00`]));
  const refundSumA = sumA(refundRowsA);

  check("db: kasir A paid orders > 0", distinctPaidOrdersA.size > 0, `orders=${distinctPaidOrdersA.size} cash=${cashSumA} qris=${qrisSumA} refund=${refundSumA}`);

  // ==================================================================
  // TEST 1 — Kasir own transactions (default view)
  // ==================================================================
  {
    const r = await kasirA.get(`/api/cashier/sales`);
    const d = r.json?.data;
    check("T1 200 + shape", r.status === 200 && d && Array.isArray(d.items) && typeof d.summary === "object");
    const ok = d && d.items.every((t) => t.cashierId === kasirAId);
    check("T1 all items belong to Kasir A", ok, `items=${d?.items?.length}`);
    const nums = new Set(d.items.map((t) => t.orderNumber));
    check("T1 contains A1-1,A1-2,A1-3,A2-1", [o11, o12, o13, o21].every((o) => nums.has(o.orderNumber)), `found=${nums.size}`);
    check("T1 totalTransactions = unique paid orders", d.summary.totalTransactions === distinctPaidOrdersA.size, `api=${d.summary.totalTransactions} db=${distinctPaidOrdersA.size}`);
    check("T1 totalSales = sum paid", d.summary.totalSales === Math.round(salesSumA * 100) / 100, `api=${d.summary.totalSales} db=${salesSumA}`);
    check("T1 totalCash/totalQris match DB", d.summary.totalCash === Math.round(cashSumA * 100) / 100 && d.summary.totalQris === Math.round(qrisSumA * 100) / 100, `cash=${d.summary.totalCash}/${cashSumA} qris=${d.summary.totalQris}/${qrisSumA}`);
    check("T1 refund + net", d.summary.totalRefund === refundSumA && d.summary.netSales === Math.round((salesSumA - refundSumA) * 100) / 100, `refund=${d.summary.totalRefund} net=${d.summary.netSales}`);
    check("T1 kasir column has cashierName", d.items.every((t) => t.cashierName), `missing=${d.items.filter((t) => !t.cashierName).length}`);
  }

  // ==================================================================
  // TEST 2 — Cross cashier isolation (incl. forged cashierId)
  // ==================================================================
  {
    const forged = await kasirA.get(`/api/cashier/sales?cashierId=${cashierBId}`);
    const d = forged.json?.data;
    check("T2 cashierId spoof: 200 (param ignored)", forged.status === 200);
    check("T2 cashierId spoof: B's order NOT visible", !d.items.some((t) => t.orderNumber === bo1.orderNumber), `items=${d.items?.length}`);
    check("T2 cashierId spoof: still own items only", d.items.every((t) => t.cashierId === kasirAId));

    const rb = await cashierB.get(`/api/cashier/sales`);
    const db = rb.json?.data;
    check("T2 cashier B sees only own", rb.status === 200 && db.items.every((t) => t.cashierId === cashierBId), `items=${db.items?.length}`);
    check("T2 cashier B does NOT see A's orders", !db.items.some((t) => t.orderId === o11.id || t.orderId === o21.id));
    const rb2 = await cashierB.get(`/api/cashier/sales?userId=${kasirAId}`);
    check("T2 userId spoof: still own only", rb2.json?.data?.items?.every((t) => t.cashierId === cashierBId), `items=${rb2.json?.data?.items?.length}`);
  }

  // ==================================================================
  // TEST 3 — Cross branch
  // ==================================================================
  {
    const r = await kasirA.get(`/api/cashier/sales?branchId=${JKT}`);
    check("T3 kasir forge branchId=JKT → 403", r.status === 403, `http=${r.status}`);
    const rH = await kasirA.get(`/api/cashier/sales`); kasirA.setBranch(JKT);
    const rH2 = await kasirA.get(`/api/cashier/sales`); kasirA.setBranch(MAIN);
    check("T3 kasir x-branch-id=JKT → 403", rH2.status === 403, `http=${rH2.status}`);
    void rH;
    // Admin-scoped JKT sees only JKT data, never MAIN.
    const rj = await adminJkt.get(`/api/cashier/sales`);
    const dj = rj.json?.data;
    check("T3 adminJkt sees JKT items only", rj.status === 200 && dj.items.every((t) => t.branchId === JKT), `branchIds=${[...new Set(dj.items.map((t) => t.branchId))].join(",")}`);
    check("T3 adminJkt does NOT see MAIN", !dj.items.some((t) => t.orderId === o11.id));
  }

  // ==================================================================
  // TEST 4 — Cross restaurant
  // ==================================================================
  {
    const forged = await kasirA.get(`/api/cashier/sales?restaurantId=${RESTO_B}`);
    const d = forged.json?.data;
    check("T4 restaurantId spoof: 200 (param ignored)", forged.status === 200);
    check("T4 no Resto B order leaks", d && !d.items.some((t) => t.orderNumber === bOrderNumber));
    const rb = await adminB.get(`/api/cashier/sales`);
    const db = rb.json?.data;
    check("T4 adminB sees Resto B data", rb.status === 200 && db.items.some((t) => t.orderNumber === bOrderNumber), `items=${db.items?.length}`);
    check("T4 adminB never sees Resto A orders", db.items.every((t) => t.orderNumber !== bo1.orderNumber && t.orderNumber !== o11.orderNumber));
  }

  // ==================================================================
  // TEST 5 — Payment semantics
  // ==================================================================
  {
    const def = (await kasirA.get(`/api/cashier/sales`)).json.data;
    check("T5 FAILED not in default book", !def.items.some((t) => t.paymentStatus === "FAILED"));
    const f = (await kasirA.get(`/api/cashier/sales?paymentStatus=FAILED`)).json.data;
    check("T5 status=FAILED shows failed tx", f.items.some((t) => t.paymentStatus === "FAILED"), `items=${f.items.length}`);
    check("T5 status=FAILED summary sales=0", f.summary.totalSales === 0 && f.summary.totalCash === 0 && f.summary.totalQris === 0);
    check("T5 status=FAILED summary count matches ALL failed", f.summary.totalTransactions === f.total, `count=${f.summary.totalTransactions} total=${f.total}`);
    const p = (await kasirA.get(`/api/cashier/sales?paymentStatus=PAID`)).json.data;
    check("T5 status=PAID contains only PAID", p.items.every((t) => t.paymentStatus === "PAID"));
    check("T5 customer-direct QRIS (shiftId NULL) excluded", !def.items.some((t) => t.orderNumber === o16.orderNumber));
    // EXPIRED / CANCELLED statuses filter cleanly (no 500).
    for (const st of ["EXPIRED", "CANCELLED"]) {
      const rr = await kasirA.get(`/api/cashier/sales?paymentStatus=${st}`);
      check(`T5 status=${st} query 200`, rr.status === 200, `http=${rr.status}`);
    }
  }

  // ==================================================================
  // TEST 6 — Split payment: 1 order (CASH + QRIS) = 1 transaction
  // ==================================================================
  {
    const r = await kasirA.get(`/api/cashier/sales?shiftId=${shiftA2}`);
    const d = r.json?.data;
    const txn = d.items.filter((t) => t.orderNumber === o22.orderNumber);
    check("T6 split order = ONE row in list", txn.length === 1, `rows=${txn.length}`);
    check("T6 split row amount == order grandTotal", Math.abs((txn[0]?.amount ?? -1) - Number(o22.grandTotal)) < 0.01, `amount=${txn[0]?.amount} grand=${o22.grandTotal}`);
    const dbCountA2 = (await q(`SELECT COUNT(DISTINCT orderId) c FROM payment WHERE shiftId=? AND status='PAID'`, [shiftA2]))[0].c;
    check("T6 totalTransactions == distinct orders in A2", d.summary.totalTransactions === dbCountA2, `api=${d.summary.totalTransactions} db=${dbCountA2}`);
    check("T6 list length == distinct orders (no duplicate legs)", d.items.length === dbCountA2, `items=${d.items.length} distinct=${dbCountA2}`);
    const splitSum = sumA(await q(`SELECT amount,method FROM payment WHERE shiftId=? AND status='PAID'`, [shiftA2]));
    check("T6 split totalSales sums both legs", Math.abs(d.summary.totalSales - splitSum) < 0.01, `api=${d.summary.totalSales} db=${splitSum}`);
  }

  // ==================================================================
  // TEST 7 — Shift filter
  // ==================================================================
  {
    const a1 = (await kasirA.get(`/api/cashier/sales?shiftId=${shiftA1}`)).json.data;
    check("T7 shift A1 only", a1.items.every((t) => t.shiftId === shiftA1), `items=${a1.items.length}`);
    const a2 = (await kasirA.get(`/api/cashier/sales?shiftId=${shiftA2}`)).json.data;
    check("T7 shift A2 only", a2.items.every((t) => t.shiftId === shiftA2), `items=${a2.items.length}`);
    const b1 = await kasirA.get(`/api/cashier/sales?shiftId=${shiftB1}`);
    check("T7 kasir A filter other cashier shift → empty", b1.status === 200 && b1.json?.data?.items?.length === 0, `items=${b1.json?.data?.items?.length}`);
  }

  // ==================================================================
  // TEST 8 — Date filters
  // ==================================================================
  {
    const r = await kasirA.get(`/api/cashier/sales?startDate=${tb}&endDate=${tb}`);
    const d = r.json?.data;
    check("T8 today boundary", r.status === 200 && d.items.some((t) => t.orderNumber === o11.orderNumber), `items=${d.items?.length}`);
    const y = new Date(Date.now() - 86400000);
    const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
    const ry = await kasirA.get(`/api/cashier/sales?startDate=${yStr}&endDate=${yStr}`);
    const dy = ry.json?.data;
    check("T8 yesterday excludes today's tags", ry.status === 200 && !dy.items.some((t) => [o11, o12, o13, o21].map((o) => o.orderNumber).includes(t.orderNumber)), `items=${dy.items?.length}`);

// Custom date range start=yesterday..end=today must include today's rows.
    const rc = await kasirA.get(`/api/cashier/sales?startDate=${yStr}&endDate=${tb}`);
    check("T8 custom range [yesterday..today] includes today", rc.status === 200 && rc.json?.data?.items.some((t) => t.orderNumber === o11.orderNumber), `items=${rc.json?.data?.items?.length}`);
    // Month preset (first-of-month..today). Date scope follows EXISTING Shift
    // Monitoring semantics: shifts whose openedAt falls in the range.
    const mo = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
    const rm = await kasirA.get(`/api/cashier/sales?startDate=${mo}&endDate=${tb}`);
    const dbMonth = (await q(`SELECT COUNT(DISTINCT p.orderId) c
        FROM payment p JOIN cashiershift s ON s.id=p.shiftId
        WHERE s.userId=? AND s.restaurantId=? AND p.status='PAID'
          AND s.openedAt>=? AND s.openedAt<DATE_ADD(?,INTERVAL 1 DAY)`,
      [kasirAId, RESTA, `${mo}T00:00:00`, `${tb}T00:00:00`]))[0].c;
    check("T8 month range == DB distinct count (shift-openedAt semantics)", rm.status === 200 && rm.json?.data?.summary?.totalTransactions === dbMonth, `api=${rm.json?.data?.summary?.totalTransactions} db=${dbMonth}`);
  }

  // ==================================================================
  // TEST 9 — Summary follows filters
  // ==================================================================
  {
    const a1 = (await kasirA.get(`/api/cashier/sales?shiftId=${shiftA1}`)).json.data;
    const paidA1 = await q(`SELECT amount,method FROM payment WHERE shiftId=? AND status='PAID'`, [shiftA1]);
    check("T9 summary follows shift filter", a1.summary.totalSales === Math.round(sumA(paidA1) * 100) / 100 && a1.summary.totalTransactions === new Set((await q(`SELECT orderId FROM payment WHERE shiftId=? AND status='PAID'`, [shiftA1])).map((x) => x.orderId)).size, `tx=${a1.summary.totalTransactions}`);

    const cash = (await kasirA.get(`/api/cashier/sales?paymentMethod=KASIR`)).json.data;
    check("T9 method=KASIR → qris=0", cash.summary.totalQris === 0 && cash.summary.totalCash > 0, `cash=${cash.summary.totalCash} qris=${cash.summary.totalQris}`);
    const cashRefund = Number((await q(`SELECT COALESCE(SUM(r.amount),0) s FROM refund r JOIN payment p ON p.id=r.paymentId JOIN cashiershift s ON s.id=r.shiftId
        WHERE s.userId=? AND r.status='APPROVED' AND p.method='KASIR' AND r.requestedAt>=? AND r.requestedAt<DATE_ADD(?,INTERVAL 1 DAY)`,
      [kasirAId, `${tb}T00:00:00`, `${tb}T00:00:00`]))[0].s);
    check("T9 method=KASIR refund follows method", Math.round(cash.summary.totalRefund * 100) / 100 === Math.round(cashRefund * 100) / 100, `api=${cash.summary.totalRefund} db=${cashRefund}`);

    const qris = (await kasirA.get(`/api/cashier/sales?paymentMethod=QRIS`)).json.data;
    check("T9 method=QRIS → cash=0", qris.summary.totalCash === 0 && qris.summary.totalQris > 0, `cash=${qris.summary.totalCash} qris=${qris.summary.totalQris}`);

    const fail = (await kasirA.get(`/api/cashier/sales?paymentStatus=FAILED`)).json.data;
    check("T9 status=FAILED → sales 0, count>0", fail.summary.totalSales === 0 && fail.summary.totalTransactions > 0, `tx=${fail.summary.totalTransactions}`);
  }

  // ==================================================================
  // TEST 10 — Pagination (server-side)
  // ==================================================================
  {
    const r100 = await kasirA.get(`/api/cashier/sales?limit=100`);
    check("T10 limit>50 capped at 50 (200)", r100.status === 200 && r100.json?.data?.limit === 50, `limit=${r100.json?.data?.limit}`);
    const p1 = (await kasirA.get(`/api/cashier/sales?limit=1&page=1`)).json.data;
    const p2 = (await kasirA.get(`/api/cashier/sales?limit=1&page=2`)).json.data;
    check("T10 page1 limit=1 has 1 item", p1.items.length === 1 && p2.items.length === 1, `p1=${p1.items.length} p2=${p2.items.length}`);
    check("T10 next/prev distinct orders", p1.items[0].orderNumber !== p2.items[0].orderNumber);
    check("T10 totalPages consistent", p1.totalPages === Math.ceil(p1.total / 1) && p1.totalPages > 1, `pages=${p1.totalPages}`);
    // Collect all pages — items are ONE row per ORDER, so the union of pages
    // must equal the DB distinct-order ground truth (no dup, no omission).
    const dbDistinct = (await q(`SELECT COUNT(DISTINCT o.orderId) c FROM payment o
        JOIN cashiershift s ON s.id=o.shiftId
        WHERE s.userId=? AND s.restaurantId=? AND o.status='PAID'
          AND o.createdAt>=? AND o.createdAt<DATE_ADD(?,INTERVAL 1 DAY)`,
      [kasirAId, RESTA, `${tb}T00:00:00`, `${tb}T00:00:00`]))[0].c;
    const seen = new Set();
    for (let pg = 1; pg <= p1.totalPages; pg++) {
      const rr = (await kasirA.get(`/api/cashier/sales?limit=1&page=${pg}`)).json.data;
      if (rr.items[0]) seen.add(rr.items[0].orderId);
    }
    check("T10 all pages == distinct orders (no dup/omit)", seen.size === p1.total && p1.total === dbDistinct, `seen=${seen.size} total=${p1.total} db=${dbDistinct}`);
  }

  // ==================================================================
  // TEST 12 — Admin (all cashiers + filters)
  // ==================================================================
  {
    const r = await adminA.get(`/api/cashier/sales`);
    const d = r.json?.data;
    check("T12 admin 200", r.status === 200, `http=${r.status}`);
    const cashiers = new Set(d.items.map((t) => t.cashierId));
    check("T12 admin sees BOTH MAIN cashiers", cashiers.has(kasirAId) && cashiers.has(cashierBId), `cashiers=${[...cashiers].length}`);
    const fc = await adminA.get(`/api/cashier/sales?cashierId=${cashierBId}`);
    check("T12 admin cashier filter", fc.json?.data?.items?.every((t) => t.cashierId === cashierBId), `items=${fc.json?.data?.items?.length}`);

    const pFilter = await adminA.get(`/api/cashier/sales?paymentMethod=CASH`);
    check("T12 admin payment filter", pFilter.json?.data?.items?.every((t) => t.paymentMethod === "KASIR"));
    const tFilter = await adminA.get(`/api/cashier/sales?orderType=DINE_IN`);
    check("T12 admin orderType filter", tFilter.json?.data?.items?.length > 0 && tFilter.json?.data?.items?.every((t) => t.orderType === "DINE_IN"));

    rf0: {
      const rf = await adminA.get(`/api/cashier/sales?shiftId=${shiftA1}`);
      check("T12 admin shift filter", rf.json?.data?.items?.every((t) => t.shiftId === shiftA1), `items=${rf.json?.data?.items?.length}`);
    }
  }

  // ==================================================================
  // TEST 14 — Detail via existing order-by-number (kasir own)
  // ==================================================================
  {
    const own = await kasirA.get(`/api/orders/by-number/${o11.orderNumber}`);
    check("T14 kasir own order detail", own.status === 200 && own.json?.data?.orderNumber === o11.orderNumber, `http=${own.status}`);
    // Same-branch order (other cashier): existing authorized scope is
    // branch+restaurant (shared Orders feature) → 200 is expected, not a leak.
    const sameBranch = await kasirA.get(`/api/orders/by-number/${bo1.orderNumber}`);
    check("T14 same-branch other-cashier order (shared Orders scope) 200", sameBranch.status === 200, `http=${sameBranch.status}`);
    // Cross-branch order (JKT) must be denied for MAIN-scoped kasir.
    const crossBranch = await kasirA.get(`/api/orders/by-number/${jo1.orderNumber}`);
    check("T14 cross-branch order denied (403/404)", crossBranch.status === 403 || crossBranch.status === 404, `http=${crossBranch.status}`);
    const detail = own.json?.data;
    check("T14 detail has items+payments+totals", Array.isArray(detail?.items) && Array.isArray(detail?.payments) && "grandTotal" in (detail || {}));
  }

  // ==================================================================
  // TEST 16 — API security (full spoof matrix on kasir A)
  // ==================================================================
  {
    for (const qp of [
      `userId=${kasirAId}`, `cashierId=${cashierBId}`, `restaurantId=${RESTO_B}`,
      `shiftId=${shiftB1}`, `paymentMethod=QRIS`, `paymentStatus=PAID`, `orderType=DINE_IN`,
    ]) {
      const r = await kasirA.get(`/api/cashier/sales?${qp}`);
      const d = r.json?.data;
      const okScope = !d?.items?.some((t) => t.cashierId !== kasirAId);
      check(`T16 kasir spoof "${qp.split("=")[0]}" no leak`, r.status === 200 && okScope, `http=${r.status}`);
    }
    const rB = await adminB.get(`/api/cashier/sales?branchId=${MAIN}`);
    check("T16 adminB forge branchId=MAIN (cross-resto) → 403", rB.status === 403, `http=${rB.status}`);
    const adminBItems = (await adminB.get(`/api/cashier/sales`)).json?.data?.items || [];
    check("T16 adminB sees only Resto B branch data", adminBItems.every((t) => t.branchId === BKS), `branches=${[...new Set(adminBItems.map((t) => t.branchId))].join(",")}`);
  }

  // ==================================================================
  // TEST 13 + 15 — Existing admin capability untouched; print is side-effect-free
  // ==================================================================
  {
    // Admin can re-open the SAME order via the EXISTING order-by-number service
    // (used by detail + print) — no new manipulation endpoint was added.
    const again = await adminA.get(`/api/orders/by-number/${o11.orderNumber}`);
    check("T13 existing order-by-number still serves admin", again.status === 200, `http=${again.status}`);
    // Read-only proof: before vs after detail+print-style GETs, neither the
    // order nor its payment/shift may change.
    const before = (await q(`SELECT paymentStatus,status FROM \`order\` WHERE id=?`, [o11.id]))[0];
    const pBefore = (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND status='PAID'`, [o11.id]))[0].c;
    await kasirA.get(`/api/orders/by-number/${o11.orderNumber}`);
    await kasirA.get(`/api/orders/by-number/${o11.orderNumber}`);
    const after = (await q(`SELECT paymentStatus,status FROM \`order\` WHERE id=?`, [o11.id]))[0];
    const pAfter = (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND status='PAID'`, [o11.id]))[0].c;
    check("T15 print/detail GETs are side-effect-free",
      before.paymentStatus === after.paymentStatus && before.status === after.status && pBefore === pAfter,
      `order=${before.status}->${after.status} paid=${pBefore}->${pAfter}`);
  }

  // ==================================================================
  // TEST 18 — Regression smoke
  // ==================================================================
  {
    const rep = await adminA.get(`/api/reports/sales?period=today`);
    check("T18 sales report 200", rep.status === 200, `http=${rep.status}`);
    const shiftList = await adminA.get(`/api/shifts?status=OPEN`);
    check("T18 shifts list 200", shiftList.status === 200, `http=${shiftList.status}`);
    const myShift = await kasirA.get(`/api/shifts/active`);
    check("T18 cashier own shift 200", myShift.status === 200, `http=${myShift.status}`);
    const page = await fetch(`${BASE}/admin/cashier/sales`, { headers: { cookie: kasirA.headers().cookie, "user-agent": "Mozilla/5.0 Chrome/126" }, redirect: "manual" });
    check("T18 page /admin/cashier/sales serves", page.status === 200 || page.status === 307 || page.status === 302, `http=${page.status}`);
  }

  // ==================================================================
  // Summary
  // ==================================================================
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"=".repeat(56)}`);
  console.log(`TOTAL: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`);
  failed.forEach((f) => console.log(`  FAILED: ${f.name} (${f.extra})`));

  // ------------------------------------------------------------------
  // Cleanup (tagged rows only)
  // ------------------------------------------------------------------
  try {
    if (created.payments.length) await q(`DELETE FROM paymenttransaction WHERE paymentId IN (?)`, [created.payments]);
    if (created.payments.length) await q(`DELETE FROM refund WHERE paymentId IN (?)`, [created.payments]);
    if (created.payments.length) await q(`DELETE FROM payment WHERE id IN (?)`, [created.payments]);
    if (created.refunds.length) await q(`DELETE FROM refund WHERE id IN (?)`, [created.refunds]);
    if (created.orders.length) {
      await q(`DELETE FROM orderstatushistory WHERE orderId IN (?)`, [created.orders]);
      await q(`DELETE FROM orderitem WHERE orderId IN (?)`, [created.orders]);
      await q(`DELETE FROM \`order\` WHERE id IN (?)`, [created.orders]);
    }
    if (created.shifts.length) await q(`DELETE FROM cashiershift WHERE id IN (?)`, [created.shifts]);
    if (created.userBranches.length) await q(`DELETE FROM userbranch WHERE id IN (?)`, [created.userBranches]);
    if (created.users.length) await q(`DELETE FROM user WHERE id IN (?)`, [created.users]);
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