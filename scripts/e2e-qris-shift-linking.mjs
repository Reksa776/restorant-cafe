// ============================================================
// QRIS SHIFT LINKING REGRESSION — runtime E2E on port 3001 ONLY.
//
// Verifies the fix: createKasirQrisPayment() now links the QRIS
// payment to the cashier's OPEN shift via shiftId.
//
//   T1  CASH Kasir + OPEN shift → Payment.shiftId = OPEN shift
//   T2  QRIS Kasir + OPEN shift → Payment.method=QRIS, shiftId = OPEN shift
//   T3  Customer Direct QRIS → Payment.shiftId = NULL (unchanged)
//   T4  Kasir QRIS without shift → 409 SHIFT_NOT_OPEN
//   T5  Multi-branch: Branch A shift → QRIS → shiftId = Shift A (not B)
//   T6  Idempotency: retry QRIS creation doesn't duplicate or change shift
//
// Server must be running on 127.0.0.1:3001.
// ============================================================
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:3001";
const PROJECT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TAG = `qsl-${Date.now().toString().slice(-7)}`;

function loadEnv() {
  const env = {};
  const raw = fs.readFileSync(path.join(PROJECT, ".env"), "utf8");
  const keep = new Set(["DATABASE_URL", "IPAYMU_VA", "IPAYMU_API_KEY"]);
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
  const payRows = await q(`SELECT id,status,method,providerRef,shiftId,branchId,restaurantId FROM payment WHERE orderId=? ORDER BY createdAt DESC`, [orderId]);
  const orderRow = (await q(`SELECT paymentStatus,status,branchId,restaurantId FROM \`order\` WHERE id=?`, [orderId]))[0];
  return { payRows, order: orderRow };
};

async function main() {
  if (!VA) throw new Error("IPAYMU_VA required (source .env)");

  // ---------- login ----------
  const admin = makeApi();
  const asess = await admin.login("admin@restobahagia.com", "admin123");
  const restaurantId = asess.restaurantId;
  const adminBranchId = asess.branches?.[0]?.id || null;
  check("env: admin login + branch context", !!restaurantId && !!adminBranchId, `branch=${adminBranchId}`);
  admin.setBranch(adminBranchId);

  const kasir = makeApi();
  const ksess = await kasir.login("kasir@restobahagia.com", "kasir123");
  const kasirId = ksess.userId;
  const kasirBranchId = ksess.branches?.[0]?.id || null;
  check("env: kasir login + single-assignment branch", !!kasirId && !!kasirBranchId, `branch=${kasirBranchId}`);
  kasir.setBranch(kasirBranchId);

  // Deterministic start: close any open shifts
  await q(`UPDATE cashiershift SET status='CLOSED' WHERE userId=? AND status='OPEN'`, [kasirId]);
  const openNow = await q(`SELECT COUNT(*) c FROM cashiershift WHERE userId=? AND status='OPEN'`, [kasirId]);
  check("env: no OPEN shift for kasir (deterministic start)", Number(openNow[0].c) === 0, `open=${openNow[0].c}`);

  const shiftInsert = async (branchId, label) => {
    const id = `sh${crypto.randomBytes(6).toString("hex")}`;
    await q(`INSERT INTO cashiershift (id,restaurantId,branchId,userId,status,shiftNumber,openingCash,openedAt,createdAt,updatedAt)
             VALUES (?,?,?,?,'OPEN',?,0,NOW(6),NOW(6),NOW(6))`, [id, restaurantId, branchId, kasirId, `SH-${TAG}-${label}`]);
    created.shifts.push(id);
    return id;
  };

  const prod = (await q(
    `SELECT p.id,p.price FROM product p
     JOIN branchproduct bp ON bp.productId=p.id AND bp.branchId=?
     WHERE p.restaurantId=? AND p.isActive=1 AND p.isAvailable=1 AND bp.isAvailable=1 AND bp.stock>0
     ORDER BY p.price ASC LIMIT 1`, [kasirBranchId, restaurantId]))[0];
  if (!prod) throw new Error("no orderable product");

  const mkCustomer = async (label) => {
    const custId = `sc-${crypto.randomBytes(8).toString("hex")}`;
    await q(`INSERT INTO customer (id,restaurantId,name,phone,isActive,createdAt,updatedAt) VALUES (?,?,?,?,1,NOW(6),NOW(6))`,
      [custId, restaurantId, `QRIS-Shift ${TAG}`, `guest-${TAG}-${label}`]);
    created.customers.push(custId);
    return custId;
  };

  const mkOrder = async (label, orderType = "DINE_IN") => {
    const custId = await mkCustomer(label);
    const r = await admin.post("/api/orders", { customerId: custId, orderType, items: [{ productId: prod.id, quantity: 1 }] });
    if (r.status !== 201) throw new Error(`mkOrder failed ${label}: ${JSON.stringify(r.json)}`);
    const o = r.json.data;
    const dbo = (await q(`SELECT id,grandTotal,branchId,restaurantId,orderNumber FROM \`order\` WHERE id=?`, [o.id]))[0];
    created.orders.push(dbo.id);
    created.orderNums.push(dbo.orderNumber);
    return dbo;
  };

  // ============================================================
  // T1. CASH Kasir + OPEN shift → Payment.shiftId = OPEN shift
  // ============================================================
  {
    const o = await mkOrder("T1");
    const shiftId = await shiftInsert(o.branchId, "T1");

    const c = await kasir.post("/api/payments", { orderId: o.id, method: "KASIR" });
    check("T1 CASH: createPayment(KASIR) 201", c.status === 201 && c.json.data.status === "UNPAID", `create=${c.status}`);

    const mark = await kasir.post(`/api/payments/${c.json.data.id}/mark-paid`, { amountReceived: o.grandTotal });
    check("T1 CASH: mark-paid 200", mark.status === 200, `mark=${mark.status}`);

    const st = await stateOf(o.id);
    const cash = st.payRows.find((p) => p.method === "KASIR");
    check("T1 CASH: DB Payment.shiftId = OPEN shift",
      cash?.status === "PAID" && cash?.shiftId === shiftId,
      `shiftId=${cash?.shiftId} expected=${shiftId} match=${cash?.shiftId === shiftId}`);
    check("T1 CASH: order PAID",
      st.order?.paymentStatus === "PAID",
      `order=${st.order?.paymentStatus}`);
  }

  // ============================================================
  // T2. QRIS Kasir + OPEN shift → Payment.method=QRIS, shiftId = OPEN shift
  // ============================================================
  {
    const o = await mkOrder("T2");
    const shiftId = await shiftInsert(o.branchId, "T2");

    const qr = await kasir.post("/api/payments", { orderNumber: o.orderNumber, method: "QRIS" });
    check("T2 QRIS Kasir: payment created PENDING",
      qr.status === 200 && qr.json?.data?.payment?.status === "PENDING",
      `create=${qr.status} status=${qr.json?.data?.payment?.status}`);

    // Verify shiftId is set on the PENDING payment in DB
    const st = await stateOf(o.id);
    const qris = st.payRows.find((p) => p.method === "QRIS" && p.status === "PENDING");
    check("T2 QRIS Kasir: DB Payment.method = QRIS",
      qris?.method === "QRIS",
      `method=${qris?.method}`);
    check("T2 QRIS Kasir: DB Payment.shiftId = OPEN shift",
      qris?.shiftId === shiftId,
      `shiftId=${qris?.shiftId} expected=${shiftId} match=${qris?.shiftId === shiftId}`);
    check("T2 QRIS Kasir: DB Payment.branchId = correct branch",
      qris?.branchId === kasirBranchId,
      `branchId=${qris?.branchId} expected=${kasirBranchId}`);

    // Complete the payment via webhook
    const wh = await postWebhook({ reference_id: o.orderNumber, trx_id: `TRX-T2-${TAG}`, status: "berhasil", total: String(o.grandTotal), amount: String(o.grandTotal) });
    check("T2 QRIS Kasir: webhook accepted", wh.status === 200, `http=${wh.status}`);

    const st2 = await stateOf(o.id);
    const qrisPaid = st2.payRows.find((p) => p.method === "QRIS");
    check("T2 QRIS Kasir: DB QRIS PAID + shiftId preserved after webhook",
      qrisPaid?.status === "PAID" && qrisPaid?.shiftId === shiftId,
      `status=${qrisPaid?.status} shiftId=${qrisPaid?.shiftId} match=${qrisPaid?.shiftId === shiftId}`);
    check("T2 QRIS Kasir: order PAID",
      st2.order?.paymentStatus === "PAID",
      `order=${st2.order?.paymentStatus}`);
  }

  // ============================================================
  // T3. Customer Direct QRIS → Payment.shiftId = NULL (unchanged)
  // ============================================================
  {
    const o = await mkOrder("T3");

    // Customer QRIS: POST /api/payments with orderId (no method) → gateway flow
    const c = await admin.post("/api/payments", { orderId: o.id });
    check("T3 Customer Direct QRIS: payment created PENDING",
      c.status === 201 && c.json?.data?.status === "PENDING",
      `create=${c.status} status=${c.json?.data?.status}`);

    const st = await stateOf(o.id);
    const custQris = st.payRows.find((p) => p.status === "PENDING" || p.status === "PAID");
    check("T3 Customer Direct QRIS: DB Payment.shiftId = NULL",
      custQris?.shiftId === null || custQris?.shiftId === undefined,
      `shiftId=${custQris?.shiftId} (should be null)`);

    // Complete via webhook
    const wh = await postWebhook({ reference_id: o.orderNumber, trx_id: `TRX-T3-${TAG}`, status: "berhasil", total: String(o.grandTotal), amount: String(o.grandTotal) });
    check("T3 Customer Direct QRIS: webhook accepted", wh.status === 200, `http=${wh.status}`);

    const st2 = await stateOf(o.id);
    const custPaid = st2.payRows.find((p) => p.status === "PAID");
    check("T3 Customer Direct QRIS: DB Payment.shiftId = NULL after PAID",
      custPaid?.shiftId === null || custPaid?.shiftId === undefined,
      `shiftId=${custPaid?.shiftId} (should be null)`);
    check("T3 Customer Direct QRIS: order PAID",
      st2.order?.paymentStatus === "PAID",
      `order=${st2.order?.paymentStatus}`);
  }

  // ============================================================
  // T4. Kasir QRIS without shift → 409 SHIFT_NOT_OPEN
  // ============================================================
  {
    const o = await mkOrder("T4");
    // Ensure no open shift
    await q(`UPDATE cashiershift SET status='CLOSED' WHERE userId=? AND status='OPEN'`, [kasirId]);

    const qr = await kasir.post("/api/payments", { orderNumber: o.orderNumber, method: "QRIS" });
    check("T4 no-shift QRIS: 409 SHIFT_NOT_OPEN",
      qr.status === 409 && qr.json?.error === "SHIFT_NOT_OPEN",
      `http=${qr.status} code=${qr.json?.error}`);

    const st = await stateOf(o.id);
    const qrisCount = st.payRows.filter((p) => p.method === "QRIS").length;
    check("T4 no-shift QRIS: NO QRIS payment row recorded",
      qrisCount === 0,
      `qrisCount=${qrisCount}`);
  }

  // ============================================================
  // T5. Multi-branch: Branch A shift → QRIS → shiftId = Shift A (not B)
  // ============================================================
  {
    // Get all branches for this kasir
    const branches = await q(`SELECT branchId FROM userbranch WHERE userId=?`, [kasirId]);
    const branchIds = branches.map((b) => b.branchId);

    if (branchIds.length >= 2) {
      const branchA = branchIds[0];
      const branchB = branchIds[1];

      // Create orders in each branch
      const custA = await mkCustomer("T5A");
      const rA = await admin.post("/api/orders", { customerId: custA, orderType: "DINE_IN", items: [{ productId: prod.id, quantity: 1 }] });
      const orderA = (await q(`SELECT id,grandTotal,branchId,orderNumber FROM \`order\` WHERE id=?`, [rA.json.data.id]))[0];
      created.orders.push(orderA.id);

      // Open shift for branch A
      kasir.setBranch(branchA);
      const shiftA = await shiftInsert(branchA, "T5A");

      // Create QRIS for branch A order
      const qrA = await kasir.post("/api/payments", { orderNumber: orderA.orderNumber, method: "QRIS" });
      const stA = await stateOf(orderA.id);
      const qrisA = stA.payRows.find((p) => p.method === "QRIS");

      check("T5 multi-branch: QRIS shiftId = Shift A (correct branch)",
        qrisA?.shiftId === shiftA,
        `shiftId=${qrisA?.shiftId} expected=${shiftA} match=${qrisA?.shiftId === shiftA}`);
      check("T5 multi-branch: QRIS branchId = Branch A",
        qrisA?.branchId === branchA,
        `branchId=${qrisA?.branchId} expected=${branchA}`);

      // Restore branch context
      kasir.setBranch(kasirBranchId);
    } else {
      check("T5 multi-branch: SKIP (kasir has only 1 branch)", true, "single branch");
    }
  }

  // ============================================================
  // T6. Idempotency: retry QRIS creation doesn't duplicate or change shift
  // ============================================================
  {
    const o = await mkOrder("T6");
    const shiftId = await shiftInsert(o.branchId, "T6");

    // First QRIS creation
    const qr1 = await kasir.post("/api/payments", { orderNumber: o.orderNumber, method: "QRIS" });
    check("T6 idempotency: first QRIS creation PENDING",
      qr1.status === 200 && qr1.json?.data?.payment?.status === "PENDING",
      `create=${qr1.status}`);

    // Second QRIS creation (should return existing PENDING, not create new)
    const qr2 = await kasir.post("/api/payments", { orderNumber: o.orderNumber, method: "QRIS" });
    check("T6 idempotency: retry returns existing PENDING (not new)",
      qr2.status === 200 && qr2.json?.data?.payment?.id === qr1.json?.data?.payment?.id,
      `retry=${qr2.status} sameId=${qr2.json?.data?.payment?.id === qr1.json?.data?.payment?.id}`);

    // Verify shiftId is set on the payment
    const st = await stateOf(o.id);
    const qrisPayments = st.payRows.filter((p) => p.method === "QRIS");
    check("T6 idempotency: exactly 1 QRIS payment (no duplicate)",
      qrisPayments.length === 1,
      `qrisCount=${qrisPayments.length}`);

    check("T6 idempotency: shiftId = OPEN shift (preserved on retry)",
      qrisPayments[0]?.shiftId === shiftId,
      `shiftId=${qrisPayments[0]?.shiftId} expected=${shiftId}`);
  }

  // ---------- summary ----------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"=".repeat(48)}`);
  console.log(`TOTAL: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`);
  failed.forEach((f) => console.log(`  FAILED: ${f.name} (${f.extra})`));

  // ---------- cleanup ----------
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
