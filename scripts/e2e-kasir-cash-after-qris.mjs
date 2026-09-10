// ============================================================
// RUNTIME SERVER + DB verification — QRIS → close → CASH root-cause fix
// (port 3001 production build; real MySQL assertions on every step).
//
// Acceptance matrix (database is the single source of truth):
//   A. QRIS → close → CASH exact        → QRIS CANCELLED, CASH PAID, order PAID
//   B. Same as A with a CASHIER         → same + payment linked to their shift
//   C. Same as A with CASHIER NO shift  → 409 SHIFT_NOT_OPEN (honest), DB UNPAID
//   D. Reverse CASH → close → QRIS      → CASH CANCELLED, QRIS PAID (webhook), order PAID
//   E. LATE QRIS webhook AFTER cash PAID→ ignored, order STAYS PAID, no downgrade
//   F. amountReceived < grandTotal      → 400 VALIDATION, DB unchanged UNPAID
//   G. duplicate mark-paid              → 409 ALREADY_PAID, exactly ONE PAID cash
//   H. TAKEAWAY + DELIVERY full flow    → CASH PAID + order PAID
// Async audit-row assertions: cashier_payment txn written only when committed.
// ============================================================
import crypto from "node:crypto";
import mysql from "mysql2/promise";

const BASE = "http://127.0.0.1:3001";
const TAG = `audit-${Date.now()}`;
const VA = (process.env.IPAYMU_VA || "").trim();

const results = [];
const created = { orders: [], customers: [], payments: [], shifts: [] };
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

const url = new URL(process.env.DATABASE_URL || "mysql://root:password@localhost:3306/restaurant_app");
const pool = mysql.createPool({ host: url.hostname, port: url.port || 3306, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password || ""), database: url.pathname.replace(/^\//, ""), connectionLimit: 6 });
const q = async (sql, params = []) => (await pool.query(sql, params))[0];

const makeApi = () => {
  let cookie = "";
  const rawCookies = [];
  return {
    rawCookies,
    async login(email, password) {
      const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
      rawCookies.push(...(csrfRes.headers.getSetCookie ? csrfRes.headers.getSetCookie() : []));
      cookie = csrfRes.headers.getSetCookie ? csrfRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : "";
      const csrfJson = await csrfRes.json();
      const form = new URLSearchParams({ csrfToken: csrfJson.csrfToken, email, password, callbackURL: `${BASE}/login`, json: "true" });
      const res = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 Chrome/126", ...(cookie ? { cookie } : {}) }, body: form.toString() });
      rawCookies.push(...(res.headers.getSetCookie ? res.headers.getSetCookie() : []));
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      cookie = [...new Set([...cookie.split("; ").filter(Boolean), ...sc.map((c) => c.split(";")[0])])].join("; ");
      const sess = await this.get("/api/auth/session");
      if (!sess.json?.success || !sess.json?.data?.userId) throw new Error(`login failed ${email}`);
      return sess.json.data;
    },
    async get(path) { const res = await fetch(`${BASE}${path}`, { headers: { cookie } }); return { status: res.status, json: await res.json().catch(() => null) }; },
    async post(path, body) { const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body) }); return { status: res.status, json: await res.json().catch(() => null) }; },
  };
};

const signPayload = (payload) => {
  const sorted = {};
  Object.keys(payload).sort().forEach((k) => (sorted[k] = payload[k]));
  return crypto.createHmac("sha256", VA).update(JSON.stringify(sorted).replace(/\//g, "\\/"), "utf8").digest("hex");
};
const postWebhook = async (payload) => {
  const res = await fetch(`${BASE}/api/webhooks/ipaymu`, { method: "POST", headers: { "Content-Type": "application/json", "x-signature": signPayload(payload) }, body: JSON.stringify(payload) });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const stateOf = async (orderId) => {
  const payRows = await q(`SELECT id,status,method,providerRef,shiftId FROM payment WHERE orderId=? ORDER BY createdAt DESC`, [orderId]);
  const orderRow = (await q(`SELECT paymentStatus,status FROM \`order\` WHERE id=?`, [orderId]))[0];
  return { payRows, order: orderRow };
};
const countPaidCash = async (orderId) => (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND method='KASIR' AND status='PAID'`, [orderId]))[0].c;

async function main() {
  if (!VA) throw new Error("IPAYMU_VA required");
  const admin = makeApi(); const sess = await admin.login("admin@restobahagia.com", "admin123");
  const restaurantId = sess.restaurantId; const branchId = sess.branches?.[0]?.id || null;
  check("env: admin login + branch context", !!restaurantId && !!branchId, `restaurant=${restaurantId} branch=${branchId}`);

  const kasir = makeApi(); const ksess = await kasir.login("kasir@restobahagia.com", "kasir123");
  const kasirId = ksess.userId;
  // Clean any pre-existing open shift for this exact seeded cashier so the
  // no-shift scenario is deterministic.
  await q(`UPDATE cashiershift SET status='CLOSED' WHERE userId=? AND status='OPEN'`, [kasirId]);

  const prod = (await q(`SELECT p.id,p.price FROM product p JOIN branchproduct bp ON bp.productId=p.id AND bp.branchId=? WHERE p.restaurantId=? AND p.isActive=1 AND p.isAvailable=1 AND bp.isAvailable=1 AND bp.stock>0 ORDER BY p.price ASC LIMIT 1`, [branchId, restaurantId]))[0];
  if (!prod) throw new Error("no product");

  const mkOrder = async (api, label, orderType = "DINE_IN") => {
    const custId = `auc${crypto.randomBytes(8).toString("hex")}`;
    await q(`INSERT INTO customer (id, restaurantId, name, phone, isActive, createdAt, updatedAt) VALUES (?,?,?,?,1,NOW(6),NOW(6))`, [custId, restaurantId, `Audit ${TAG}`, `guest-${TAG}-${label}`]);
    created.customers.push(custId);
    const r = await api.post("/api/orders", { customerId: custId, orderType, items: [{ productId: prod.id, quantity: 1 }] });
    if (r.status !== 201) throw new Error(`mkOrder failed ${orderType}: ${JSON.stringify(r.json)}`);
    const o = r.json.data;
    const dbo = (await q(`SELECT id,grandTotal,branchId,orderNumber FROM \`order\` WHERE id=?`, [o.id]))[0];
    created.orders.push(dbo.id);
    return { id: dbo.id, grandTotal: Number(dbo.grandTotal), branchId: dbo.branchId, orderNumber: dbo.orderNumber, orderType };
  };

  const qrisIntent = async (api, order) => {
    const r = await api.post("/api/payments", { orderNumber: order.orderNumber, method: "QRIS" });
    if (r.status !== 200) throw new Error(`qrisIntent failed: ${JSON.stringify(r.json)}`);
    return r.json.data.payment;
  };
  const cashIntentThenMark = async (api, order, amountReceived, actorUserId = null) => {
    const c = await api.post("/api/payments", { orderId: order.id, method: "KASIR" });
    if (c.status !== 201 && c.status !== 200) return { create: c, markPaid: null };
    const mark = await api.post(`/api/payments/${c.json.data.id}/mark-paid`, { amountReceived });
    return { create: c, paymentId: c.json.data.id, markPaid: mark };
  };

  // ============================================================
  // A. DINE_IN: QRIS → close dialog → CASH exact (ADMIN)
  // ============================================================
  {
    const o = await mkOrder(admin, "A");
    const qr = await qrisIntent(admin, o);
    check("A QRIS→CASH: QRIS intent created PENDING", qr.status === "PENDING" && qr.method === "QRIS", `method=${qr.method} status=${qr.status}`);
    // (dialog closed — pure client state)
    const res = await cashIntentThenMark(admin, o, o.grandTotal);
    check("A QRIS→CASH: mark-paid returns 200", res.markPaid?.status === 200, `create=${res.create.status} mark=${res.markPaid?.status}`);
    const st = await stateOf(o.id);
    const qrisA = st.payRows.find((p) => p.method === "QRIS"); const cashA = st.payRows.find((p) => p.method === "KASIR");
    check("A QRIS→CASH: DB QRIS CANCELLED, CASH PAID, order PAID",
      qrisA?.status === "CANCELLED" && cashA?.status === "PAID" && st.order?.paymentStatus === "PAID",
      `qris=${qrisA?.status} cash=${cashA?.status} order=${st.order?.paymentStatus}`);
    const auditTxn = await q(`SELECT count(*) c FROM paymenttransaction WHERE paymentId=? AND type='cashier_payment' AND status='PAID'`, [cashA.id]);
    check("A QRIS→CASH: cashier_payment audit row committed server-side", Number(auditTxn[0].c) === 1, `txn=${auditTxn[0].c}`);
    created.payments.push(...st.payRows.map((p) => p.id));

    // E. LATE QRIS webhook AFTER the cash PAID — must be ignored, no downgrade.
    const late = await postWebhook({ reference_id: o.orderNumber, trx_id: `TRX-LATE-${TAG}`, status: "berhasil", total: String(o.grandTotal), amount: String(o.grandTotal) });
    check("E late-webhook: endpoint accepts (200, valid HMAC)", late.status === 200, `http=${late.status}`);
    const st2 = await stateOf(o.id);
    const qris2 = st2.payRows.find((p) => p.method === "QRIS"); const cash2 = st2.payRows.find((p) => p.method === "KASIR");
    check("E late-webhook: cash STAYS PAID, order STAYS PAID, QRIS NOT resurrected",
      cash2?.status === "PAID" && st2.order?.paymentStatus === "PAID" && qris2?.status === "CANCELLED",
      `cash=${cash2?.status} order=${st2.order?.paymentStatus} qris=${qris2?.status}`);
    const ignoredRows = await q(`SELECT count(*) c FROM paymenttransaction WHERE paymentId=? AND status IN ('IGNORED_CANCELLED','IGNORED_STALE')`, [qris2.id]);
    check("E late-webhook: wait ignored-callback audit row recorded", Number(ignoredRows[0].c) >= 1, `ignored=${ignoredRows[0].c}`);

    // G. duplicate mark-paid → ALREADY_PAID + exactly ONE paid cash payment
    const dup = await cashIntentThenMark(admin, o, o.grandTotal + 50000);
    const dupSecond = await admin.post(`/api/payments/${res.paymentId}/mark-paid`, { amountReceived: o.grandTotal });
    check("G duplicate: second mark-paid rejected with ALREADY_PAID (409)",
      dupSecond.status === 409 && dupSecond.json?.error === "ALREADY_PAID",
      `http=${dupSecond.status} code=${dupSecond.json?.error}`);
    check("G duplicate: exactly ONE PAID CASH payment row", (await countPaidCash(o.id)) === 1, `count=${await countPaidCash(o.id)}`);
  }

  // ============================================================
  // B. Same flow as CASHIER WITH an open shift
  // ============================================================
  {
    const o = await mkOrder(admin, "B");
    await qrisIntent(admin, o);
    const shiftId = `aus${crypto.randomBytes(8).toString("hex")}`;
    await q(`INSERT INTO cashiershift (id,restaurantId,branchId,userId,status,shiftNumber,openingCash,openedAt,createdAt,updatedAt) VALUES (?,?,?,?,'OPEN',?,0,NOW(6),NOW(6),NOW(6))`, [shiftId, restaurantId, o.branchId, kasirId, `RS-${TAG}-B`]);
    created.shifts.push(shiftId);
    const res = await cashIntentThenMark(kasir, o, o.grandTotal);
    check("B CASHIER+shift: mark-paid returns 200 and links drawer",
      res.markPaid?.status === 200 && res.markPaid?.json?.data?.payment?.shiftId === shiftId,
      `http=${res.markPaid?.status} shift=${res.markPaid?.json?.data?.payment?.shiftId}`);
    const st = await stateOf(o.id);
    const cashB = st.payRows.find((p) => p.method === "KASIR");
    check("B CASHIER+shift: DB CASH PAID + order PAID + payment.shiftId set",
      cashB?.status === "PAID" && st.order?.paymentStatus === "PAID" && cashB?.shiftId?.startsWith("aus"),
      `cash=${cashB?.status} order=${st.order?.paymentStatus} shift=${cashB?.shiftId?.slice(0, 8)}`);
    created.payments.push(...st.payRows.map((p) => p.id));
  }

  // ============================================================
  // C. CASHIER WITHOUT an open shift → SHIFT_NOT_OPEN, DB stays UNPAID
  // ============================================================
  {
    // Test B left the kasir's shift OPEN — close it so "no shift" is real.
    await q(`UPDATE cashiershift SET status='CLOSED' WHERE userId=? AND status='OPEN'`, [kasirId]);
    const stillOpen = (await q(`SELECT COUNT(*) c FROM cashiershift WHERE userId=? AND status='OPEN'`, [kasirId]))[0].c;
    check("C env: kasir has NO OPEN shift at C", Number(stillOpen) === 0, `open=${stillOpen}`);
    const o = await mkOrder(admin, "C");
    // A kasir without an open shift can no longer even create a payment
    // intent (the POST /api/payments route enforces requireOpenShift) — it is
    // rejected with SHIFT_NOT_OPEN BEFORE any payment/order write.
    const c = await kasir.post("/api/payments", { orderId: o.id, method: "KASIR" });
    check("C CASHIER no-shift: createPayment(KASIR) rejected with SHIFT_NOT_OPEN",
      c.status === 409 && c.json?.error === "SHIFT_NOT_OPEN", `create=${c.status} code=${c.json?.error}`);
    const kasirCount = (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND method='KASIR'`, [o.id]))[0].c;
    check("C CASHIER no-shift: NO KASIR payment row recorded", Number(kasirCount) === 0, `count=${kasirCount}`);
    // Repayment QRIS (kasir-initiated, no shift) must also be blocked.
    const qrC = await kasir.post("/api/payments", { orderNumber: o.orderNumber, method: "QRIS" });
    check("C CASHIER no-shift: createKasirQrisPayment rejected with SHIFT_NOT_OPEN",
      qrC.status === 409 && qrC.json?.error === "SHIFT_NOT_OPEN", `create=${qrC.status} code=${qrC.json?.error}`);
    const qrisCount = (await q(`SELECT COUNT(*) c FROM payment WHERE orderId=? AND method='QRIS'`, [o.id]))[0].c;
    check("C CASHIER no-shift: NO QRIS payment row recorded", Number(qrisCount) === 0, `count=${qrisCount}`);
    // Push a KASIR row as ADMIN (bypasses shift) so the mark-paid guard can be
    // exercised in isolation for the no-shift cashier.
    const adminK = await admin.post("/api/payments", { orderId: o.id, method: "KASIR" });
    const mark = await kasir.post(`/api/payments/${adminK.json.data.id}/mark-paid`, { amountReceived: o.grandTotal });
    check("C CASHIER no-shift: mark-paid rejected with SHIFT_NOT_OPEN (not generic CONFLICT)",
      mark.status === 409 && mark.json?.error === "SHIFT_NOT_OPEN",
      `http=${mark.status} code=${mark.json?.error} msg=${mark.json?.message}`);
    const st = await stateOf(o.id);
    const cashC = st.payRows.find((p) => p.method === "KASIR");
    check("C CASHIER no-shift: DB order + cash UNPAID (nothing settled, no PAID rows)",
      st.order?.paymentStatus === "UNPAID" && cashC?.status === "UNPAID" && !st.payRows.some((p) => p.status === "PAID"),
      `order=${st.order?.paymentStatus} cash=${cashC?.status}`);
    const txnC = await q(`SELECT count(*) c FROM paymenttransaction WHERE paymentId=? AND type='cashier_payment'`, [cashC.id]);
    check("C CASHIER no-shift: NO cashier_payment audit row (nothing committed)", Number(txnC[0].c) === 0, `txn=${txnC[0].c}`);
    created.payments.push(...st.payRows.map((p) => p.id));
  }

  // ============================================================
  // D. Reverse: CASH → close → QRIS → customer pays QR (webhook)
  // ============================================================
  {
    const o = await mkOrder(admin, "D");
    const cc = await admin.post("/api/payments", { orderId: o.id, method: "KASIR" });
    check("D CASH→QRIS: CASH intent UNPAID recorded", cc.status === 201 && cc.json.data.status === "UNPAID", `create=${cc.status}`);
    const qr = await qrisIntent(admin, o);
    check("D CASH→QRIS: QRIS intent supersedes cash (returns PENDING QRIS)", qr?.status === "PENDING" && qr?.method === "QRIS", `method=${qr?.method} status=${qr?.status}`);
    const st = await stateOf(o.id);
    const cashD1 = st.payRows.find((p) => p.method === "KASIR");
    check("D CASH→QRIS: live UNPAID cash row superseded → CANCELLED (not reused)",
      !cashD1 || cashD1.status === "CANCELLED", `cash=${cashD1?.status}`);
    const wh = await postWebhook({ reference_id: o.orderNumber, trx_id: `TRX-D-${TAG}`, status: "berhasil", total: String(o.grandTotal), amount: String(o.grandTotal) });
    check("D CASH→QRIS: webhook accepted (200)", wh.status === 200, `http=${wh.status}`);
    const st2 = await stateOf(o.id);
    const qrisD = st2.payRows.find((p) => p.method === "QRIS");
    check("D CASH→QRIS: QRIS PAID + order PAID (reverse flow holds)",
      qrisD?.status === "PAID" && st2.order?.paymentStatus === "PAID", `qris=${qrisD?.status} order=${st2.order?.paymentStatus}`);
    created.payments.push(...st2.payRows.map((p) => p.id));
  }

  // ============================================================
  // F. amountReceived < grandTotal → rejected before any write
  // ============================================================
  {
    const o = await mkOrder(admin, "F");
    const c = await admin.post("/api/payments", { orderId: o.id, method: "KASIR" });
    const mark = await admin.post(`/api/payments/${c.json.data.id}/mark-paid`, { amountReceived: o.grandTotal - 1 });
    check("F invalid cash: rejected 400 VALIDATION_ERROR",
      mark.status === 400 && mark.json?.error === "VALIDATION_ERROR", `http=${mark.status} code=${mark.json?.error}`);
    const st = await stateOf(o.id);
    const cashF = st.payRows.find((p) => p.method === "KASIR");
    check("F invalid cash: DB unchanged (cash UNPAID, order UNPAID)",
      cashF?.status === "UNPAID" && st.order?.paymentStatus === "UNPAID", `cash=${cashF?.status} order=${st.order?.paymentStatus}`);
    created.payments.push(...st.payRows.map((p) => p.id));
  }

  // ============================================================
  // H. TAKEAWAY + DELIVERY: QRIS → close → CASH exact
  // ============================================================
  for (const orderType of ["TAKEAWAY", "DELIVERY"]) {
    const o = await mkOrder(admin, `H-${orderType}`, orderType);
    await qrisIntent(admin, o);
    const res = await cashIntentThenMark(admin, o, o.grandTotal);
    check(`H ${orderType}: mark-paid 200`, res.markPaid?.status === 200, `create=${res.create.status} mark=${res.markPaid?.status}`);
    const st = await stateOf(o.id);
    const qrisH = st.payRows.find((p) => p.method === "QRIS"); const cashH = st.payRows.find((p) => p.method === "KASIR");
    check(`H ${orderType}: DB CASH PAID + order PAID + old QRIS CANCELLED`,
      cashH?.status === "PAID" && st.order?.paymentStatus === "PAID" && (qrisH?.status === "CANCELLED"),
      `cash=${cashH?.status} order=${st.order?.paymentStatus} qris=${qrisH?.status}`);
    created.payments.push(...st.payRows.map((p) => p.id));
  }

  // ---------- summary ----------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"=".repeat(48)}`);
  console.log(`TOTAL: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`);
  failed.forEach((f) => console.log(`  FAILED: ${f.name} (${f.extra})`));

  // ---------- cleanup (tagged rows) ----------
  try {
    await q(`DELETE FROM paymenttransaction WHERE paymentId IN (SELECT id FROM payment WHERE orderId IN (?))`, [created.orders]);
    await q(`DELETE FROM payment WHERE orderId IN (?)`, [created.orders]);
    await q(`DELETE FROM orderstatushistory WHERE orderId IN (?)`, [created.orders]);
    await q(`DELETE FROM \`order\` WHERE id IN (?)`, [created.orders]);
    if (created.shifts.length) await q(`DELETE FROM cashiershift WHERE id IN (?)`, [created.shifts]);
    if (created.customers.length) await q(`DELETE FROM customer WHERE id IN (?)`, [created.customers]);
    console.log("cleanup: audit rows removed");
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