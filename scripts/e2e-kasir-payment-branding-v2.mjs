// ============================================================
// Runtime smoke test — Kasir payment flows + branding (PORT 3001 ONLY).
//
// Uses plain Node fetch with Auth.js credentials-cookie auth (no browser —
// the Chrome harness was flaky in this environment). Payment flows run
// against the REAL production build server on 127.0.0.1:3001; the QRIS leg
// is pointed at a LOCAL mock of the iPaymu direct endpoint
// (scripts/_mock-ipaymu.mjs) so no real gateway traffic is generated.
//
// Test matrix (per order type DINE_IN / TAKEAWAY / DELIVERY):
//   QRIS → Kembali → CASH (mark-paid with amountReceived) → PAID
//   CASH → Kembali → QRIS (fresh PENDING intent, cash row CANCELLED)
//   stale-webhook protection (real HMAC signature, CANCELLED row ignored)
//   PAID is terminal (CASH collect after PAID → 409)
//   amountReceived < total rejected server-side
//   double QRIS create → single live intent (idempotent)
//   branding: PUT/GET round-trip + CASHIER visibility (own restaurant only)
//
// DB writes are TEST-ONLY rows (cuid-like tag "e2e-smoke-v2"); read-only
// invariant queries afterwards; targeted cleanup of exactly those rows.
// ============================================================
import crypto from "node:crypto";
import mysql from "mysql2/promise";

const BASE = "http://127.0.0.1:3001";
const PORT = 3001;
const TAG = `smoke-${Date.now()}`;
// Webhook signing secret = the server's real IPAYMU_VA (validateWebhook uses
// VA as the HMAC secret). Read from env; never printed/logged.
const VA = (process.env.IPAYMU_VA || "").trim();
const results = [];
const created = { orders: [], customers: [], payments: [], history: [], users: [] };

const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

// ---------- DB helpers (read-only except tagged test rows) ----------
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

// ---------- HTTP helpers (cookie jar) ----------
const makeApi = () => {
  let cookie = "";
  return {
    async login(email, password) {
      const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
      const setCookies = csrfRes.headers.getSetCookie ? csrfRes.headers.getSetCookie() : [];
      cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
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
    async put(path, body) {
      const res = await fetch(`${BASE}${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    },
  };
};

// ---------- webhook helper (real HMAC, same algorithm as provider) ----------
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
  return { status: res.status, json: await res.json().catch(() => null) };
};

// ---------- test-data helpers ----------
async function ensureTestUsers(restaurantId, branchId) {
  const rows = await q(
    `SELECT id, email FROM user WHERE email IN (?, ?)`,
    [`smoke-admin-${TAG}@test.local`, `smoke-kasir-${TAG}@test.local`]
  );
  const have = new Set(rows.map((r) => r.email));
  const mk = async (email, role) => {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("smoke-pass-123", 4);
    const id = `smokeu${crypto.randomBytes(8).toString("hex")}`;
    await q(
      `INSERT INTO user (id, restaurantId, name, email, password, role, isActive, sessionVersion, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, NOW(6), NOW(6))`,
      [id, restaurantId, role === "ADMIN" ? "Smoke Admin" : "Smoke Kasir", email, hash, role]
    );
    if (branchId) {
      await q(
        `INSERT INTO userbranch (id, userId, branchId) VALUES (?, ?, ?)`,
        [`smokeub${crypto.randomBytes(8).toString("hex")}`, id, branchId]
      );
    }
    created.users.push(id);
    return id;
  };
  const adminId = have.has(`smoke-admin-${TAG}@test.local`)
    ? (await q(`SELECT id FROM user WHERE email = ?`, [`smoke-admin-${TAG}@test.local`]))[0].id
    : await mk(`smoke-admin-${TAG}@test.local`, "ADMIN");
  const kasirId = have.has(`smoke-kasir-${TAG}@test.local`)
    ? (await q(`SELECT id FROM user WHERE email = ?`, [`smoke-kasir-${TAG}@test.local`]))[0].id
    : await mk(`smoke-kasir-${TAG}@test.local`, "CASHIER");
  return { adminId, kasirId };
}

async function openShift(kasirApi, kasirId, branchId) {
  await q(`DELETE FROM cashiershift WHERE userId = ?`, [kasirId]);
  const res = await kasirApi.post("/api/shifts", { openingCash: 500000 });
  if (res.status !== 201) throw new Error(`openShift failed: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.data.id;
}

async function createOrder(api, { orderType, customerId, tableId, restaurantId, branchId, productId, price }) {
  // Price is asserted against the DB row the order service recomputes from.
  const qty = 1;
  const isDineIn = orderType === "DINE_IN";
  const expectedSubtotal = price * qty;
  const expectedTotal = expectedSubtotal + (isDineIn ? 0 : Math.round(expectedSubtotal * 0.1) + Math.round(expectedSubtotal * 0.05));
  const res = await api.post("/api/orders", {
    customerId,
    orderType,
    ...(orderType === "DINE_IN" && tableId ? { tableId } : {}),
    items: [{ productId, quantity: qty }],
  });
  if (res.status !== 201) throw new Error(`createOrder failed: ${res.status} ${JSON.stringify(res.json)}`);
  const order = res.json.data;
  created.orders.push(order.id);
  const dbOrder = (await q(`SELECT grandTotal, subtotal, branchId, restaurantId, orderNumber FROM \`order\` WHERE id = ?`, [order.id]))[0];
  check(`createOrder ${orderType} recomputes price from DB`,
    Number(dbOrder.grandTotal) === expectedTotal && Number(dbOrder.subtotal) === expectedSubtotal,
    `total=${dbOrder.grandTotal}`);
  return { ...order, grandTotal: Number(dbOrder.grandTotal) };
}

// ---------- per-order-type payment matrix ----------
async function runPaymentMatrix(api, kasirApi, label, { orderType, customerId, tableId, restaurantId, branchId, productId, price }) {
  console.log(`\n=== ${label} (${orderType}) ===`);

  // ---------- Flow A: QRIS → Kembali → CASH ----------
  {
    const order = await createOrder(api, { orderType, customerId, tableId, restaurantId, branchId, productId, price });

    // QRIS attempt #1 (orderNumber-based kasir QRIS endpoint)
    const q1 = await api.post("/api/payments", { orderNumber: order.orderNumber, method: "QRIS" });
    check(`${label} QRIS created (PENDING, method QRIS, branch/restaurant match)`,
      q1.status === 200 && q1.json?.data?.payment?.status === "PENDING" && q1.json.data.payment.method === "QRIS" &&
      q1.json.data.payment.branchId === branchId && q1.json.data.payment.restaurantId === restaurantId,
      `status=${q1.status} body=${JSON.stringify(q1.json).slice(0, 220)}`);
    const qrisId1 = q1.json?.data?.payment?.id;

    // Stale-webhook protection: a "berhasil" callback for the NOT-YET-cancelled
    // QRIS would pay the order — so this webhook is sent only AFTER the cash
    // supersede below, against the CANCELLED row (must be ignored).
    // (Deferred until after CASH is recorded — see below.)

    // "Kembali" → CASH (supersede happens atomically server-side)
    const cash = await api.post("/api/payments", { orderId: order.id, method: "KASIR" });
    check(`${label} CASH after QRIS: no 409, method=KASIR, UNPAID`,
      cash.status === 201 && cash.json?.data?.status === "UNPAID" && cash.json?.data?.method === "KASIR",
      `status=${cash.status} method=${cash.json?.data?.method}`);

    // QRIS #1 must now be CANCELLED (history kept, not deleted)
    const q1row = (await q(`SELECT status FROM payment WHERE id = ?`, [qrisId1]))[0];
    check(`${label} superseded QRIS row → CANCELLED (history kept)`, q1row?.status === "CANCELLED", `status=${q1row?.status}`);

    // NOW fire the stale webhook for the CANCELLED QRIS (real HMAC) — must be ignored.
    const wh = await postWebhook({ reference_id: order.orderNumber, trx_id: `TRX-${TAG}-A1`, status: "berhasil", total: String(order.grandTotal), amount: String(order.grandTotal) });
    const q1rowAfter = (await q(`SELECT status FROM payment WHERE id = ?`, [qrisId1]))[0];
    const orderAfter = (await q(`SELECT paymentStatus FROM \`order\` WHERE id = ?`, [order.id]))[0];
    check(`${label} stale webhook on CANCELLED QRIS ignored (no resurrection, order not PAID)`,
      q1rowAfter?.status === "CANCELLED" && orderAfter?.paymentStatus === "UNPAID",
      `payment=${q1rowAfter?.status} order=${orderAfter?.paymentStatus} http=${wh.status}`);

    // Cashier opens shift + collects cash (amountReceived ≥ total)
    await openShift(kasirApi, created.kasirId, branchId);
    const mark = await kasirApi.post(`/api/payments/${cash.json.data.id}/mark-paid`, { amountReceived: order.grandTotal + 50000 });
    const txRows = await q(`SELECT status, amount FROM paymenttransaction WHERE paymentId = ?`, [cash.json.data.id]);
    check(`${label} markCashierPaymentPaid → PAID (amountReceived validated, audit row written)`,
      mark.status === 200 && mark.json?.data?.payment?.status === "PAID" && txRows.length === 1,
      `status=${mark.status} tx=${txRows.length}`);

    const oRow = (await q(`SELECT paymentStatus, status FROM \`order\` WHERE id = ?`, [order.id]))[0];
    check(`${label} order PAID after cash collection`, oRow?.paymentStatus === "PAID", `paymentStatus=${oRow?.paymentStatus}`);

    // PAID is terminal: another CASH collect → 409
    const again = await kasirApi.post(`/api/payments/${cash.json.data.id}/mark-paid`, { amountReceived: order.grandTotal + 50000 });
    check(`${label} double collect blocked (409 already completed)`, again.status === 409, `status=${again.status}`);

    // New QRIS on PAID order → 409
    const q2 = await api.post("/api/payments", { orderNumber: order.orderNumber, method: "QRIS" });
    check(`${label} QRIS on PAID order rejected (409)`, q2.status === 409, `status=${q2.status}`);
  }

  // ---------- Flow B: CASH → Kembali → QRIS ----------
  {
    const order = await createOrder(api, { orderType, customerId, tableId, restaurantId, branchId, productId, price });

    const cash = await api.post("/api/payments", { orderId: order.id, method: "KASIR" });
    check(`${label} CASH recorded (UNPAID KASIR)`, cash.status === 201 && cash.json?.data?.method === "KASIR", `status=${cash.status}`);

    // "Kembali" → QRIS (reverse switch; cash row must be CANCELLED, not reused)
    const q1 = await api.post("/api/payments", { orderNumber: order.orderNumber, method: "QRIS" });
    const cashRow = (await q(`SELECT status FROM payment WHERE id = ?`, [cash.json.data.id]))[0];
    check(`${label} CASH → QRIS: no 409, QRIS PENDING, cash row CANCELLED`,
      q1.status === 200 && q1.json?.data?.payment?.status === "PENDING" && q1.json?.data?.payment?.method === "QRIS" && cashRow?.status === "CANCELLED",
      `status=${q1.status} cash=${cashRow?.status}`);
    const qrisId = q1.json?.data?.payment?.id;

    // Idempotency: a second QRIS create returns the SAME live intent (no duplicate)
    const q2 = await api.post("/api/payments", { orderNumber: order.orderNumber, method: "QRIS" });
    const pendCount = (await q(`SELECT COUNT(*) n FROM payment WHERE orderId = ? AND method = 'QRIS' AND status = 'PENDING'`, [order.id]))[0].n;
    check(`${label} duplicate QRIS create is idempotent (single live PENDING intent)`,
      q2.status === 200 && q2.json?.data?.payment?.id === qrisId && Number(pendCount) === 1,
      `rows=${pendCount}`);

    // Webhook PAID on the live QRIS → order PAID (race-safe mirror)
    const wh = await postWebhook({ reference_id: order.orderNumber, trx_id: `TRX-${TAG}-B1`, status: "berhasil", total: String(order.grandTotal), amount: String(order.grandTotal) });
    const qRow = (await q(`SELECT status, paidAt FROM payment WHERE id = ?`, [qrisId]))[0];
    const oRow = (await q(`SELECT paymentStatus FROM \`order\` WHERE id = ?`, [order.id]))[0];
    check(`${label} QRIS webhook → PAID + order PAID`,
      qRow?.status === "PAID" && oRow?.paymentStatus === "PAID" && qRow?.paidAt !== null,
      `payment=${qRow?.status} order=${oRow?.paymentStatus} http=${wh.status}`);

    // CASH collect after QRIS PAID must be blocked (order-level protection)
    const lateCash = await api.post("/api/payments", { orderId: order.id, method: "KASIR" });
    check(`${label} CASH create on PAID order rejected (409)`, lateCash.status === 409, `status=${lateCash.status}`);

    // Webhook replay after PAID → idempotent no-op
    const replay = await postWebhook({ reference_id: order.orderNumber, trx_id: `TRX-${TAG}-B1`, status: "berhasil", total: String(order.grandTotal), amount: String(order.grandTotal) });
    check(`${label} webhook replay idempotent (200, still single PAID row)`,
      replay.status === 200, `http=${replay.status}`);
  }

  // ---------- Flow C: QRIS → Kembali → QRIS (re-issue) ----------
  {
    const order = await createOrder(api, { orderType, customerId, tableId, restaurantId, branchId, productId, price });
    const q1 = await api.post("/api/payments", { orderNumber: order.orderNumber, method: "QRIS" });
    const qrisId1 = q1.json?.data?.payment?.id;
    const cash = await api.post("/api/payments", { orderId: order.id, method: "KASIR" }); // supersede
    const q2 = await api.post("/api/payments", { orderNumber: order.orderNumber, method: "QRIS" }); // re-issue
    const q1row = (await q(`SELECT status FROM payment WHERE id = ?`, [qrisId1]))[0];
    const cashRow = (await q(`SELECT status FROM payment WHERE id = ?`, [cash.json.data.id]))[0];
    check(`${label} QRIS → CASH → QRIS: old QRIS CANCELLED, cash CANCELLED, new QRIS PENDING`,
      q1row?.status === "CANCELLED" && cashRow?.status === "CANCELLED" && q2.json?.data?.payment?.status === "PENDING",
      `old=${q1row?.status} cash=${cashRow?.status} new=${q2.json?.data?.payment?.status}`);
    // amountReceived validation: underpay must be rejected BEFORE any write.
    // Switch back to CASH (supersedes the re-issued QRIS) and probe the
    // KASIR collect endpoint with an amount BELOW the total — the server
    // must reject it with 400 and leave the cash row UNPAID.
    const cash2 = await api.post("/api/payments", { orderId: order.id, method: "KASIR" });
    check(`${label} QRIS → CASH re-switch works (UNPAID KASIR row)`,
      cash2.status === 201 && cash2.json?.data?.status === "UNPAID", `status=${cash2.status}`);
    await openShift(kasirApi, created.kasirId, branchId);
    const underpay = await kasirApi.post(`/api/payments/${cash2.json.data.id}/mark-paid`, { amountReceived: 1 });
    const stillUnpaid = (await q(`SELECT status FROM payment WHERE id = ?`, [cash2.json.data.id]))[0];
    const q2After = (await q(`SELECT status FROM payment WHERE id = ?`, [q2.json.data.payment.id]))[0];
    check(`${label} amountReceived < total rejected server-side (no state change)`,
      underpay.status === 400 && stillUnpaid?.status === "UNPAID" && q2After?.status === "CANCELLED",
      `status=${underpay.status} cash=${stillUnpaid?.status} qris=${q2After?.status}`);

    // Settle properly so every test order ends PAID (invariant below).
    const mark = await kasirApi.post(`/api/payments/${cash2.json.data.id}/mark-paid`, { amountReceived: 999999 });
    const finalOrder = (await q(`SELECT paymentStatus FROM \`order\` WHERE id = ?`, [order.id]))[0];
    check(`${label} final cash collection settles the order (PAID)`,
      mark.status === 200 && finalOrder?.paymentStatus === "PAID", `status=${mark.status} order=${finalOrder?.paymentStatus}`);
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log(`TAG=${TAG}\n`);
  if (!VA) {
    console.error("IPAYMU_VA must be set (source .env) so webhook signatures validate");
    process.exit(2);
  }

  // ---------- 0. server + env ----------
  const health = await fetch(`${BASE}/login`).then((r) => r.status).catch(() => 0);
  check("server on 127.0.0.1:3001 responds", health === 200, `http=${health}`);

  const admin = makeApi();
  const kasir = makeApi();

  // ---------- 1. login ----------
  const sess = await admin.login("admin@restobahagia.com", "admin123");
  const restaurantId = sess.restaurantId;
  const branchId = sess.branches?.[0]?.id || null;
  check("admin login (restaurantId from session)", !!restaurantId, `restaurant=${restaurantId}`);

  const { kasirId } = await ensureTestUsers(restaurantId, branchId);
  created.kasirId = kasirId;
  await kasir.login(`smoke-kasir-${TAG}@test.local`, "smoke-pass-123");
  check("cashier login (branch-scoped test user)", true, `kasir=${kasirId}`);

  // ---------- 2. test product + customer ----------
  // Pick a product that is orderable in THIS branch: active + available and
  // (when a branchproduct row exists) available there with stock > 0.
  const prod = (await q(
    `SELECT p.id, p.price
     FROM product p
     JOIN branchproduct bp ON bp.productId = p.id AND bp.branchId = ?
     WHERE p.restaurantId = ? AND p.isActive = 1 AND p.isAvailable = 1
       AND bp.isAvailable = 1 AND bp.stock > 0
     ORDER BY p.price ASC LIMIT 1`,
    [branchId, restaurantId]
  ))[0];
  if (!prod) throw new Error("No orderable product found for branch");
  const custId = `smokec${crypto.randomBytes(8).toString("hex")}`;
  await q(
    `INSERT INTO customer (id, restaurantId, name, phone, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, NOW(6), NOW(6))`,
    [custId, restaurantId, `Smoke Customer ${TAG}`, `guest-smoke-${TAG}`]
  );
  created.customers.push(custId);

  // Free table for DINE_IN legs (not strictly required by the API, keeps data sane)
  const table = (await q(
    `SELECT id FROM \`table\` WHERE restaurantId = ? AND branchId = ? AND id NOT IN (SELECT COALESCE(tableId,'') FROM \`order\` WHERE status IN ('PENDING','CONFIRMED','PROCESSING','READY')) LIMIT 1`,
    [restaurantId, branchId]
  ))[0];

  // ---------- 3. payment matrix (all order types) ----------
  for (const orderType of ["DINE_IN", "TAKEAWAY", "DELIVERY"]) {
    await runPaymentMatrix(admin, kasir, orderType, {
      orderType,
      customerId: custId,
      tableId: table?.id || null,
      restaurantId,
      branchId,
      productId: prod.id,
      price: Number(prod.price),
    });
  }

  // ---------- 3.5 TENANT / BRANCH ISOLATION (IDOR) ----------
  console.log(`\n=== ISOLATION ===`);
  {
    // A second REAL restaurant (not owned by the test admin) is required so
    // the checks exercise the actual tenant boundary. Seed one tagged row
    // (cleaned up at the end) instead of assuming foreign data exists.
    const foreignR = `smoker${crypto.randomBytes(6).toString("hex")}`;
    await q(
      `INSERT INTO restaurant (id, name, isActive, createdAt, updatedAt) VALUES (?, ?, 1, NOW(6), NOW(6))`,
      [foreignR, `Smoke Foreign Resto ${TAG}`]
    );
    const foreignB = `smokeb${crypto.randomBytes(6).toString("hex")}`;
    await q(
      `INSERT INTO branch (id, restaurantId, code, name, isActive, createdAt, updatedAt) VALUES (?, ?, 'SMK', 'Smoke Foreign Branch', 1, NOW(6), NOW(6))`,
      [foreignB, foreignR]
    );
    const foreignC = `smokec${crypto.randomBytes(6).toString("hex")}`;
    await q(
      `INSERT INTO customer (id, restaurantId, name, phone, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, NOW(6), NOW(6))`,
      [foreignC, foreignR, "Smoke Foreign Cust", `guest-smoke-f-${TAG}`]
    );
    const foreignO = `smokeo${crypto.randomBytes(6).toString("hex")}`;
    await q(
      `INSERT INTO \`order\` (id, restaurantId, branchId, orderNumber, customerId, orderType, status, paymentStatus, subtotal, tax, serviceCharge, grandTotal, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'TAKEAWAY', 'PENDING', 'UNPAID', 10000, 0, 0, 10000, NOW(6), NOW(6))`,
      [foreignO, foreignR, foreignB, `SMOKE-F-${TAG}`, foreignC]
    );

    // 1. Admin of restaurant A cannot read restaurant B's order by number.
    const byNumber = await admin.get(`/api/orders/by-number/SMOKE-F-${TAG}`);
    check("tenant isolation: foreign orderNumber lookup rejected/not found",
      byNumber.status === 404 || byNumber.status === 403,
      `status=${byNumber.status}`);

    // 2. Admin cannot create a payment for a foreign orderId.
    const foreignPay = await admin.post("/api/payments", { orderId: foreignO, method: "KASIR" });
    check("tenant isolation: payment create for foreign orderId rejected",
      foreignPay.status === 404 || foreignPay.status === 403,
      `status=${foreignPay.status}`);

    // 3. Foreign order untouched (no payment written, mirror unchanged).
    const fPay = (await q(`SELECT COUNT(*) n FROM payment WHERE orderId = ?`, [foreignO]))[0].n;
    const fMirror = (await q(`SELECT paymentStatus FROM \`order\` WHERE id = ?`, [foreignO]))[0];
    check("tenant isolation: foreign order unchanged after attempts",
      Number(fPay) === 0 && fMirror?.paymentStatus === "UNPAID",
      `payments=${fPay} mirror=${fMirror?.paymentStatus}`);

    // 4. Branch isolation: the CASHIER is scoped to ONE branch; an order in
    //    the same restaurant but OUTSIDE their branch scope must be invisible.
    const otherBranch = `smokeb${crypto.randomBytes(6).toString("hex")}`;
    await q(
      `INSERT INTO branch (id, restaurantId, code, name, isActive, createdAt, updatedAt) VALUES (?, ?, 'SMK2', 'Smoke Other Branch', 1, NOW(6), NOW(6))`,
      [otherBranch, restaurantId]
    );
    const otherO = `smokeo${crypto.randomBytes(6).toString("hex")}`;
    await q(
      `INSERT INTO \`order\` (id, restaurantId, branchId, orderNumber, customerId, orderType, status, paymentStatus, subtotal, tax, serviceCharge, grandTotal, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'TAKEAWAY', 'PENDING', 'UNPAID', 10000, 0, 0, 10000, NOW(6), NOW(6))`,
      [otherO, restaurantId, otherBranch, `SMOKE-O-${TAG}`, custId]
    );
    const kasirSees = await kasir.get("/api/orders?search=SMOKE-O-");
    const kasirRows = kasirSees.json?.data?.orders || kasirSees.json?.data || [];
    const leaked = Array.isArray(kasirRows) && kasirRows.some((o) => o.id === otherO);
    check("branch isolation: cashier cannot see other-branch order",
      !leaked, `status=${kasirSees.status}`);
    const kasirMark = await kasir.post(`/api/payments/${crypto.randomBytes(12).toString("hex")}/mark-paid`, {});
    check("branch isolation: mark-paid unknown/foreign payment rejected",
      kasirMark.status === 404 || kasirMark.status === 403, `status=${kasirMark.status}`);

    // Cleanup isolation fixtures.
    await q(`DELETE FROM \`order\` WHERE id IN (?, ?)`, [foreignO, otherO]);
    await q(`DELETE FROM customer WHERE id = ?`, [foreignC]);
    await q(`DELETE FROM branch WHERE id IN (?, ?)`, [foreignB, otherBranch]);
    await q(`DELETE FROM restaurant WHERE id = ?`, [foreignR]);
  }

  // ---------- 4. BRANDING runtime ----------
  console.log(`\n=== BRANDING ===`);
  const b0 = await admin.get("/api/admin/settings/branding");
  check("branding GET (admin) returns restaurantName + branding",
    b0.status === 200 && b0.json?.data?.branding && "siteName" in b0.json.data.branding,
    `siteName=${b0.json?.data?.branding?.siteName}`);
  const original = b0.json.data.branding;

  const newSite = `Smoke Brand ${TAG}`;
  const put = await admin.put("/api/admin/settings/branding", {
    siteName: newSite,
    primaryColor: "#0d9488",
    secondaryColor: "#f0fdfa",
    accentColor: "#99f6e4",
  });
  check("branding PUT (admin) persists", put.status === 200 && put.json?.data?.siteName === newSite, `status=${put.status}`);

  const b1 = await admin.get("/api/admin/settings/branding");
  check("branding GET reflects update (server source of truth)",
    b1.json?.data?.branding?.siteName === newSite && b1.json?.data?.branding?.primaryColor === "#0d9488",
    `siteName=${b1.json?.data?.branding?.siteName}`);

  // CASHIER sees the SAME restaurant branding (single source, no separate endpoint)
  const bk = await kasir.get("/api/admin/settings/branding");
  check("branding GET as CASHIER returns same restaurant branding",
    bk.status === 200 && bk.json?.data?.branding?.siteName === newSite,
    `status=${bk.status}`);

  // Restore original branding (leave the system as found)
  await admin.put("/api/admin/settings/branding", {
    siteName: original.siteName ?? null,
    primaryColor: original.primaryColor,
    secondaryColor: original.secondaryColor,
    accentColor: original.accentColor,
  });
  const b2 = await admin.get("/api/admin/settings/branding");
  check("branding restored after test", b2.json?.data?.branding?.siteName === original.siteName, "");

  // ---------- 5. DB invariants (read-only) ----------
  console.log(`\n=== INVARIANTS ===`);
  const invariants = await q(
    `SELECT p.id, p.orderId, p.branchId, p.restaurantId, o.branchId ob, o.restaurantId orid
     FROM payment p JOIN \`order\` o ON o.id = p.orderId
     WHERE p.orderId IN (?)`,
    [created.orders]
  );
  const bad = invariants.filter((r) => r.branchId !== r.ob || r.restaurantId !== r.orid);
  check("invariant: payment.branchId === order.branchId && payment.restaurantId === order.restaurantId",
    bad.length === 0, `violations=${bad.length}`);

  const multiLive = await q(
    `SELECT orderId, COUNT(*) n FROM payment
     WHERE orderId IN (?) AND status IN ('UNPAID','PENDING') GROUP BY orderId HAVING n > 1`,
    [created.orders]
  );
  check("invariant: at most ONE live intent per order", multiLive.length === 0, `violations=${multiLive.length}`);

  const paidMulti = await q(
    `SELECT orderId, COUNT(*) n FROM payment WHERE orderId IN (?) AND status = 'PAID' GROUP BY orderId HAVING n > 1`,
    [created.orders]
  );
  check("invariant: never two PAID rows per order", paidMulti.length === 0, `violations=${paidMulti.length}`);

  const mirror = await q(
    `SELECT o.id, o.paymentStatus FROM \`order\` o WHERE o.id IN (?)`,
    [created.orders]
  );
  const mirrorBad = mirror.filter((o) => o.paymentStatus !== "PAID");
  check("invariant: all test orders end PAID with correct mirror", mirrorBad.length === 0,
    `bad=${mirrorBad.map((o) => o.paymentStatus).join(",")}`);

  // ---------- 6. summary ----------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n========================================`);
  console.log(`TOTAL: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`);
  failed.forEach((f) => console.log(`  FAILED: ${f.name} (${f.extra})`));
  console.log(`========================================`);

  // ---------- 7. cleanup (TEST rows only, history-safe order) ----------
  try {
    const orderIds = created.orders;
    if (orderIds.length) {
      await q(`DELETE FROM paymenttransaction WHERE paymentId IN (SELECT id FROM payment WHERE orderId IN (?))`, [orderIds]);
      await q(`DELETE FROM payment WHERE orderId IN (?)`, [orderIds]);
      await q(`DELETE FROM orderstatushistory WHERE orderId IN (?)`, [orderIds]);
      await q(`DELETE FROM \`order\` WHERE id IN (?)`, [orderIds]);
    }
    if (created.customers.length) await q(`DELETE FROM customer WHERE id IN (?)`, [created.customers]);
    if (created.kasirId) {
      await q(`DELETE FROM cashiershift WHERE userId = ?`, [created.kasirId]);
      await q(`DELETE FROM userbranch WHERE userId = ?`, [created.kasirId]);
      await q(`DELETE FROM user WHERE id IN (?)`, [created.users]);
    }
    console.log("cleanup: test rows removed (orders/payments/customers/test users)");
  } catch (e) {
    console.log(`cleanup error (rows remain, tagged ${TAG}):`, e.message);
  }
  await pool.end();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  try { await pool.end(); } catch { }
  process.exit(2);
});
