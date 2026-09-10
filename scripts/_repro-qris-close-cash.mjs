// SCRATCH repro: QRIS -> close -> CASH as a CASHIER WITHOUT an open shift.
// Proves: markCashierPaymentPaid 409s (shift required), DB stays UNPAID, and
// the barcode flow catch maps ANY 409 to "paid" -> fake success while DB UNPAID.
import crypto from "node:crypto";
import mysql from "mysql2/promise";

const BASE = "http://127.0.0.1:3001";
const TAG = `repro-${Date.now()}`;
const url = new URL(process.env.DATABASE_URL || "mysql://root:password@localhost:3306/restaurant_app");
const pool = mysql.createPool({ host: url.hostname, port: url.port || 3306, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password || ""), database: url.pathname.replace(/^\//, ""), connectionLimit: 4 });
const q = async (sql, params = []) => (await pool.query(sql, params))[0];
const log = (...a) => console.log(...a);

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

const created = { orders: [], customers: [], payments: [], shifts: [] };

async function main() {
  const admin = makeApi(); const sess = await admin.login("admin@restobahagia.com", "admin123");
  const restaurantId = sess.restaurantId; const branchId = sess.branches?.[0]?.id || null;
  log("admin logged", restaurantId, "branch", branchId);

  const kasir = makeApi(); const ksess = await kasir.login("kasir@restobahagia.com", "kasir123");
  const kasirId = ksess.userId; const kasirRole = ksess.role;
  log("kasir logged", kasirId, kasirRole);

  const prod = (await q(`SELECT p.id,p.price FROM product p JOIN branchproduct bp ON bp.productId=p.id AND bp.branchId=? WHERE p.restaurantId=? AND p.isActive=1 AND p.isAvailable=1 AND bp.isAvailable=1 AND bp.stock>0 ORDER BY p.price ASC LIMIT 1`, [branchId, restaurantId]))[0];
  if (!prod) throw new Error("no product");

  const mk = async (label) => {
    const custId = `rpc${crypto.randomBytes(8).toString("hex")}`;
    await q(`INSERT INTO customer (id, restaurantId, name, phone, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, NOW(6), NOW(6))`, [custId, restaurantId, `Repro ${TAG}`, `guest-${TAG}-${label}`]);
    created.customers.push(custId);
    const r = await admin.post("/api/orders", { customerId: custId, orderType: "DINE_IN", items: [{ productId: prod.id, quantity: 1 }] });
    if (r.status !== 201) throw new Error("create order failed " + JSON.stringify(r.json));
    const o = r.json.data;
    const dbo = (await q(`SELECT id,grandTotal,branchId FROM \`order\` WHERE id=?`, [o.id]))[0];
    created.orders.push(dbo.id);
    return { id: dbo.id, grandTotal: Number(dbo.grandTotal), branchId: dbo.branchId, orderNumber: o.orderNumber };
  };

  // ---------------- ORDER A: no open shift for the kasir ----------------
  const oA = await mk("noshift");
  log(`\n--- ORDER A (casher NO open shift) ${oA.orderNumber} grandTotal=${oA.grandTotal} ---`);

  // step 1: kasir opens QRIS
  const qr1 = await kasir.post("/api/payments", { orderNumber: oA.orderNumber, method: "QRIS" });
  log(`1. createKasirQrisPayment → ${qr1.status} kind=${qr1.json?.data?.kind} method=${qr1.json?.data?.payment?.method} status=${qr1.json?.data?.payment?.status}`);
  const qrisId = qr1.json?.data?.payment?.id;

  // (step 2: kasir CLOSES the dialog — pure client state, nothing hits the API)

  // step 3: reopens → chooses CASH → submit → frontend calls createPayment KASIR then mark-paid
  const kc = await kasir.post("/api/payments", { orderId: oA.id, method: "KASIR" });
  log(`3. createPayment(KASIR) → ${kc.status} payment status=${kc.json?.data?.status} method=${kc.json?.data?.method}`);
  const cashId = kc.json?.data?.id;

  const mp = await kasir.post(`/api/payments/${cashId}/mark-paid`, { amountReceived: oA.grandTotal });
  log(`4. markCashierPaymentPaid → ${mp.status} error=${mp.json?.error} message=${mp.json?.message}`);

  const payA = await q(`SELECT p.id,p.status,p.method FROM payment p WHERE p.orderId=? ORDER BY p.createdAt DESC`, [oA.id]);
  const ordA = (await q(`SELECT paymentStatus FROM \`order\` WHERE id=?`, [oA.id]))[0];
  const qrisA = payA.find((p) => p.method === "QRIS"); const cashA = payA.find((p) => p.method === "KASIR");
  log(`   DB: order=${ordA.paymentStatus} qris=${qrisA.status} cash=${cashA.status}`);
  created.payments.push(...payA.map((p) => p.id));

  // client behavior: barcode-payment-flow.tsx handleCashSubmit catch maps ANY 409 -> paid
  const is409 = mp.status === 409;
  const clientShowsPaid = is409; // status===409 branch (bug)
  const badgeFlipsPaid = is409;  // onPaymentCompleted called -> optimistic PAID
  log(`   => 409? ${is409} | CLIENT shows "Order sudah dibayar" + badge Lunas: ${clientShowsPaid} | DB UNPAID: ${ordA.paymentStatus === "UNPAID"}`);
  log(`   SYMPTOM MATCHED: client paid=${clientShowsPaid && badgeFlipsPaid}, dbUnpaid=${ordA.paymentStatus === "UNPAID"}`);

  // ---------------- ORDER B: kasir WITH open shift (control) ----------------
  const shiftId = `rps${crypto.randomBytes(8).toString("hex")}`;
  await q(`INSERT INTO cashiershift (id, restaurantId, branchId, userId, status, shiftNumber, openingCash, openedAt, createdAt, updatedAt) VALUES (?,?,?,?, 'OPEN', ?, 0, NOW(6), NOW(6), NOW(6))`, [shiftId, restaurantId, oA.branchId, kasirId, `RS-${TAG}`]);
  created.shifts.push(shiftId);

  const oB = await mk("shift");
  log(`\n--- ORDER B (casher WITH open shift) ${oB.orderNumber} ---`);
  const qr2 = await kasir.post("/api/payments", { orderNumber: oB.orderNumber, method: "QRIS" });
  log(`1. QRIS intent → ${qr2.status}`);
  const kc2 = await kasir.post("/api/payments", { orderId: oB.id, method: "KASIR" });
  log(`2. createPayment(KASIR) → ${kc2.status}`);
  const mp2 = await kasir.post(`/api/payments/${kc2.json?.data?.id}/mark-paid`, { amountReceived: oB.grandTotal });
  log(`3. markCashierPaymentPaid → ${mp2.status} shift id=${shiftId}`);
  const payB = await q(`SELECT p.status,p.method,p.shiftId FROM payment p WHERE p.orderId=? ORDER BY p.createdAt DESC`, [oB.id]);
  const ordB = (await q(`SELECT paymentStatus FROM \`order\` WHERE id=?`, [oB.id]))[0];
  log(`   DB: order=${ordB.paymentStatus} cash=${payB.find((p)=>p.method==="KASIR")?.status} linkedShift=${payB.find((p)=>p.method==="KASIR")?.shiftId === shiftId}`);
  created.payments.push(...payB.map((p) => p.id));

  // ---------- cleanup ----------
  try {
    await q(`DELETE FROM paymenttransaction WHERE paymentId IN (SELECT id FROM payment WHERE orderId IN (?))`, [created.orders]);
    await q(`DELETE FROM payment WHERE orderId IN (?)`, [created.orders]);
    await q(`DELETE FROM orderstatushistory WHERE orderId IN (?)`, [created.orders]);
    await q(`DELETE FROM \`order\` WHERE id IN (?)`, [created.orders]);
    if (created.shifts.length) await q(`DELETE FROM cashiershift WHERE id IN (?)`, [created.shifts]);
    if (created.customers.length) await q(`DELETE FROM customer WHERE id IN (?)`, [created.customers]);
    log("cleanup done");
  } catch (e) { log("cleanup err:", e.message); }

  await pool.end();
}
main().catch(async (e) => { console.error("REPRO ERROR:", e); try { await pool.end(); } catch {} process.exit(2); });