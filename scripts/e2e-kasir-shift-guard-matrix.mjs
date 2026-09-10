// ============================================================
// KASIR SHIFT-GUARD MATRIX — runtime E2E on port 3001 ONLY.
//
// Proves the "Kasir harus buka shift sebelum transaksi" guard end-to-end
// (backend API response + real MySQL state), per BAGIAN Q/R/T:
//
//   T1  No shift → manual order POST /api/orders      → 409 SHIFT_NOT_OPEN, no order row
//   T2  No shift → create KASIR payment               → 409 SHIFT_NOT_OPEN, no payment row
//   T3  No shift → create kasir QRIS (scan/repayment) → 409 SHIFT_NOT_OPEN, no payment row
//   T4  No shift → mark paid (existing KASIR form)    → 409 SHIFT_NOT_OPEN, stays UNPAID
//   T5  ADMIN without shift → KASIR payment + paid    → 200 (admin bypasses shift)
//   T6  With OPEN shift → CASH full flow              → payment PAID + shiftId, order PAID
//   T7  With OPEN shift → QRIS flow (mock+webhook)    → payment PAID, order PAID
//   T8  With OPEN shift → QRIS→CASH                   → QRIS CANCELLED, CASH PAID, order PAID
//   T9  With OPEN shift → CASH→QRIS (webhook)         → CASH CANCELLED, QRIS PAID, order PAID
//   T10 Late QRIS webhook AFTER cash PAID             → ignored, order STAYS PAID
//   T11 Branch/tenant integrity: paymentBranch=orderBranch,
//       paymentRestaurant=orderRestaurant, shiftBranch=orderBranch,
//       exactly ONE PAID payment per order.
//
// Server must already be running on 127.0.0.1:3001 with the gateway pointed
// at scripts/_mock-ipaymu.mjs (127.0.0.1:4711). No DB reset — tagged rows are
// cleaned up at the end.
// ============================================================
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:3001";
const PROJECT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TAG = `shift-${Date.now().toString().slice(-7)}`;

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

// API client with optional branch header (mirrors the real axios interceptor
// that always attaches x-branch-id from localStorage).
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
  const payRows = await q(`SELECT id,status,method,providerRef,shiftId,branchId,restaurantId FROM payment WHERE orderId=? ORDER BY createdAt DESC`, [orderId]);
  const orderRow = (await q(`SELECT paymentStatus,status,branchId,restaurantId FROM \`order\` WHERE id=?`, [orderId]))[0];
  return { payRows, order: orderRow };
};
const countPaidCash = async (orderId) => (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND method='KASIR' AND status='PAID'`, [orderId]))[0].c;

async function main() {
  if (!VA) throw new Error("IPAYMU_VA required (source .env)");

  // ---------- login ----------
  const admin = makeApi(); const asess = await admin.login("admin@restobahagia.com", "admin123");
  const restaurantId = asess.restaurantId;
  const adminBranchId = asess.branches?.[0]?.id || null;
  check("env: admin login + branch context", !!restaurantId && !!adminBranchId, `branch=${adminBranchId}`);
  admin.setBranch(adminBranchId);

  const kasir = makeApi(); const ksess = await kasir.login("kasir@restobahagia.com", "kasir123");
  const kasirId = ksess.userId;
  const kasirBranchId = ksess.branches?.[0]?.id || null;
  check("env: kasir login + single-assignment branch", !!kasirId && !!kasirBranchId, `branch=${kasirBranchId}`);
  kasir.setBranch(kasirBranchId);
  if (kasirBranchId !== adminBranchId) throw new Error("fixture mismatch: cashier branch != admin branch");

  // Deterministic "no open shift" for the seeded cashier.
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
      [custId, restaurantId, `ShiftGuard ${TAG}`, `guest-${TAG}-${label}`]);
    created.customers.push(custId);
    return custId;
  };

  // Admin creates orders (admin bypasses shift). Returns DB row.
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
  // T1. No shift → manual order (POST /api/orders) rejected, NO order row
  // ============================================================
  {
    const custId = await mkCustomer("T1");
    const r = await kasir.post("/api/orders", { customerId: custId, orderType: "DINE_IN", items: [{ productId: prod.id, quantity: 1 }] });
    check("T1 no-shift manual order: 409 SHIFT_NOT_OPEN",
      r.status === 409 && r.json?.error === "SHIFT_NOT_OPEN" && /shift/i.test(r.json?.message),
      `http=${r.status} code=${r.json?.error} msg=${r.json?.message}`);
    const cnt = await q(`SELECT COUNT(*) c FROM \`order\` WHERE customerId=?`, [custId]);
    check("T1 no-shift manual order: NO order row created", Number(cnt[0].c) === 0, `orders=${cnt[0].c}`);
  }

  // ============================================================
  // T2/T3/T4. No shift → scan payment intents rejected
  // ============================================================
  {
    const o = await mkOrder("T2"); // admin-created order (UNPAID)

    // T2 KASIR intent
    const c = await kasir.post("/api/payments", { orderId: o.id, method: "KASIR" });
    check("T2 no-shift createPayment(KASIR): 409 SHIFT_NOT_OPEN",
      c.status === 409 && c.json?.error === "SHIFT_NOT_OPEN", `http=${c.status} code=${c.json?.error}`);
    const kasirCountT2 = (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND method='KASIR'`, [o.id]))[0].c;
    check("T2 no-shift createPayment(KASIR): NO payment row recorded", Number(kasirCountT2) === 0, `count=${kasirCountT2}`);

    // T3 QRIS intent (scan → QRIS / repayment QRIS)
    const qr = await kasir.post("/api/payments", { orderNumber: o.orderNumber, method: "QRIS" });
    check("T3 no-shift createKasirQrisPayment: 409 SHIFT_NOT_OPEN",
      qr.status === 409 && qr.json?.error === "SHIFT_NOT_OPEN", `http=${qr.status} code=${qr.json?.error}`);
    const qrisCountT3 = (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND method='QRIS'`, [o.id]))[0].c;
    check("T3 no-shift createKasirQrisPayment: NO QRIS payment row recorded", Number(qrisCountT3) === 0, `count=${qrisCountT3}`);

    // T4 mark-paid on an existing KASIR form (admin created it → no shift needed to create)
    const adminK = await admin.post("/api/payments", { orderId: o.id, method: "KASIR" });
    const pid = adminK.json.data.id;
    const mark = await kasir.post(`/api/payments/${pid}/mark-paid`, { amountReceived: o.grandTotal });
    check("T4 no-shift mark-paid: 409 SHIFT_NOT_OPEN",
      mark.status === 409 && mark.json?.error === "SHIFT_NOT_OPEN" && /shift/i.test(mark.json?.message),
      `http=${mark.status} code=${mark.json?.error}`);
    const st = await stateOf(o.id);
    const cash = st.payRows.find((p) => p.method === "KASIR");
    check("T4 no-shift mark-paid: payment STAYS UNPAID, order UNPAID, nothing PAID",
      cash?.status === "UNPAID" && st.order?.paymentStatus === "UNPAID" &&
        !st.payRows.some((p) => p.status === "PAID"),
      `cash=${cash?.status} order=${st.order?.paymentStatus}`);
    created.payments.push(...st.payRows.map((p) => p.id));
  }

  // ============================================================
  // T5. ADMIN without any shift → KASIR receive + paid succeeds (bypass)
  // ============================================================
  {
    const o = await mkOrder("T5");
    const c = await admin.post("/api/payments", { orderId: o.id, method: "KASIR" });
    if (c.status === 201 || c.status === 200) {
      const mark = await admin.post(`/api/payments/${c.json.data.id}/mark-paid`, { amountReceived: o.grandTotal });
      check("T5 admin no-shift: mark-paid 200 (ADMIN bypasses shift)",
        mark.status === 200, `mark=${mark.status}`);
    } else {
      check("T5 admin no-shift: createPayment succeeds", false, `create=${c.status}`);
    }
    const st = await stateOf(o.id);
    const cashT5 = st.payRows.find((p) => p.method === "KASIR");
    check("T5 admin no-shift: DB CASH PAID + order PAID",
      cashT5?.status === "PAID" && st.order?.paymentStatus === "PAID",
      `cash=${cashT5?.status} order=${st.order?.paymentStatus}`);
    created.payments.push(...st.payRows.map((p) => p.id));
  }

  // ============================================================
  // T6. With OPEN shift → CASH full flow (drawer linked)
  // ============================================================
  let shiftId;
  {
    const o = await mkOrder("T6");
    shiftId = await shiftInsert(o.branchId, "T6");

    const c = await kasir.post("/api/payments", { orderId: o.id, method: "KASIR" });
    check("T6 shift: createPayment(KASIR) 201", c.status === 201 && c.json.data.status === "UNPAID", `create=${c.status}`);
    const mark = await kasir.post(`/api/payments/${c.json.data.id}/mark-paid`, { amountReceived: o.grandTotal });
    check("T6 shift: mark-paid 200 + payment linked to drawer",
      mark.status === 200 && mark.json?.data?.payment?.shiftId === shiftId,
      `mark=${mark.status} shift=${mark.json?.data?.payment?.shiftId === shiftId}`);
    const st = await stateOf(o.id);
    const cashT6 = st.payRows.find((p) => p.method === "KASIR");
    check("T6 shift: DB CASH PAID + order PAID + shiftId set + exactly 1 PAID cash",
      cashT6?.status === "PAID" && st.order?.paymentStatus === "PAID" &&
        cashT6?.shiftId === shiftId && (await countPaidCash(o.id)) === 1,
      `cash=${cashT6?.status} order=${st.order?.paymentStatus} count=${await countPaidCash(o.id)}`);
    created.payments.push(...st.payRows.map((p) => p.id));
  }

  // ============================================================
  // T7. With OPEN shift → QRIS flow (mock gateway + webhook)
  // ============================================================
  {
    const o = await mkOrder("T7");
    const qr = await kasir.post("/api/payments", { orderNumber: o.orderNumber, method: "QRIS" });
    check("T7 shift: kasir QRIS intent created PENDING", qr.status === 200 && qr.json?.data?.payment?.status === "PENDING", `create=${qr.status}`);
    const wh = await postWebhook({ reference_id: o.orderNumber, trx_id: `TRX7-${TAG}`, status: "berhasil", total: String(o.grandTotal), amount: String(o.grandTotal) });
    check("T7 shift: webhook accepted (200 valid HMAC)", wh.status === 200, `http=${wh.status}`);
    const st = await stateOf(o.id);
    const qrisT7 = st.payRows.find((p) => p.method === "QRIS");
    check("T7 shift: DB QRIS PAID + order PAID", qrisT7?.status === "PAID" && st.order?.paymentStatus === "PAID", `qris=${qrisT7?.status} order=${st.order?.paymentStatus}`);
    created.payments.push(...st.payRows.map((p) => p.id));
  }

  // ============================================================
  // T8. With OPEN shift → QRIS → CASH supersede
  // ============================================================
  {
    const o = await mkOrder("T8");
    await kasir.post("/api/payments", { orderNumber: o.orderNumber, method: "QRIS" });
    const c = await kasir.post("/api/payments", { orderId: o.id, method: "KASIR" });
    const mark = await kasir.post(`/api/payments/${c.json.data.id}/mark-paid`, { amountReceived: o.grandTotal });
    check("T8 shift QRIS→CASH: mark-paid 200", mark.status === 200, `mark=${mark.status}`);
    const st = await stateOf(o.id);
    const qrisT8 = st.payRows.find((p) => p.method === "QRIS"); const cashT8 = st.payRows.find((p) => p.method === "KASIR");
    check("T8 shift QRIS→CASH: DB QRIS CANCELLED, CASH PAID, order PAID",
      qrisT8?.status === "CANCELLED" && cashT8?.status === "PAID" && st.order?.paymentStatus === "PAID",
      `qris=${qrisT8?.status} cash=${cashT8?.status} order=${st.order?.paymentStatus}`);
    created.payments.push(...st.payRows.map((p) => p.id));

    // T10 Late QRIS webhook after the CASH PAID must NOT downgrade anything.
    const late = await postWebhook({ reference_id: o.orderNumber, trx_id: `TRX10-${TAG}`, status: "berhasil", total: String(o.grandTotal), amount: String(o.grandTotal) });
    check("T10 late webhook: endpoint accepts (200)", late.status === 200, `http=${late.status}`);
    const st2 = await stateOf(o.id);
    const qris10 = st2.payRows.find((p) => p.method === "QRIS"); const cash10 = st2.payRows.find((p) => p.method === "KASIR");
    check("T10 late webhook: CASH STAYS PAID, order STAYS PAID, QRIS NOT resurrected",
      cash10?.status === "PAID" && st2.order?.paymentStatus === "PAID" && qris10?.status === "CANCELLED" &&
        st2.payRows.filter((p) => p.status === "PAID").length === 1,
      `cash=${cash10?.status} order=${st2.order?.paymentStatus} qris=${qris10?.status}`);
    const ignored = await q(`SELECT COUNT(*) c FROM paymenttransaction WHERE paymentId=? AND status IN ('IGNORED_CANCELLED','IGNORED_STALE')`, [qris10.id]);
    check("T10 late webhook: ignored-callback audit row recorded", Number(ignored[0].c) >= 1, `ignored=${ignored[0].c}`);
  }

  // ============================================================
  // T9. With OPEN shift → CASH → QRIS supersede
  // ============================================================
  {
    const o = await mkOrder("T9");
    const c = await kasir.post("/api/payments", { orderId: o.id, method: "KASIR" });
    check("T9 shift CASH→QRIS: CASH intent UNPAID", c.status === 201 && c.json.data.status === "UNPAID", `create=${c.status}`);
    const qr = await kasir.post("/api/payments", { orderNumber: o.orderNumber, method: "QRIS" });
    check("T9 shift CASH→QRIS: QRIS intent PENDING (cash superseded)", qr.status === 200 && qr.json?.data?.payment?.status === "PENDING", `create=${qr.status}`);
    const st = await stateOf(o.id);
    const cashT9 = st.payRows.find((p) => p.method === "KASIR");
    const qrisPending = st.payRows.find((p) => p.method === "QRIS");
    check("T9 shift CASH→QRIS: UNPAID cash row superseded → CANCELLED",
      !cashT9 || cashT9.status === "CANCELLED", `cash=${cashT9?.status}`);
    const wh = await postWebhook({ reference_id: o.orderNumber, trx_id: `TRX9-${TAG}`, status: "berhasil", total: String(o.grandTotal), amount: String(o.grandTotal) });
    check("T9 shift CASH→QRIS: webhook accepted (200)", wh.status === 200, `http=${wh.status}`);
    const st2 = await stateOf(o.id);
    const qrisT9 = st2.payRows.find((p) => p.method === "QRIS");
    check("T9 shift CASH→QRIS: QRIS PAID + order PAID (reverse holds)",
      qrisT9?.status === "PAID" && st2.order?.paymentStatus === "PAID",
      `qris=${qrisT9?.status} order=${st2.order?.paymentStatus}`);
    created.payments.push(...st2.payRows.map((p) => p.id));
  }

  // ============================================================
  // T11. Integrity: branch/restaurant/shift consistency + no duplicate PAID
  // ============================================================
  {
    let allOk = true;
    const details = [];
    for (const oid of created.orders) {
      const st = await stateOf(oid);
      const paid = st.payRows.filter((p) => p.status === "PAID");
      if (paid.length > 1) { allOk = false; details.push(`${oid}:${paid.length}PAID`); }
      for (const p of st.payRows) {
        if (p.branchId !== st.order.branchId) { allOk = false; details.push(`${oid}:pbranch`); }
        if (p.restaurantId !== st.order.restaurantId) { allOk = false; details.push(`${oid}:prest`); }
      }
    }
    check("T11 integrity: every payment branch/restaurant matches order", allOk, details.join(","));

    const shiftRows = await q(`SELECT id,branchId FROM cashiershift WHERE id IN (?)`, [created.shifts]);
    const cashPayments = await q(
      `SELECT p.branchId paymentBranch, p.orderId, o.branchId orderBranch FROM payment p JOIN \`order\` o ON o.id=p.orderId WHERE p.orderId IN (?) AND p.method='KASIR' AND p.status='PAID'`,
      [created.orders]);
    const shiftOk = shiftRows.every((s) => cashPayments.every(
      (cp) => cp.orderId && shiftRows.filter((x) => x.id === s.id).length
    ));
    const linked = await q(
      `SELECT p.shiftId, p.branchId, s.branchId shiftBranch FROM payment p LEFT JOIN cashiershift s ON s.id=p.shiftId
       WHERE p.orderId IN (?) AND p.method='KASIR' AND p.status='PAID' AND p.shiftId IS NOT NULL`, [created.orders]);
    const linkOk = linked.every((l) => l.branchId === l.shiftBranch);
    check("T11 integrity: PAID KASIR payment.shiftId → shift.branchId === payment.branchId", linkOk,
      `linked=${linked.length}`);
  }

  // ---------- summary ----------
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