// ============================================================
// ADMIN SHIFT MONITORING + PAYMENT BREAKDOWN — runtime E2E on 3001.
//
//   T1  CASH Kasir paid → active drawer + list cashRevenue counted
//   T2  QRIS Kasir paid → qrisRevenue counted (active + list)
//   T3  Customer duplicate-DIRECTQRIS paid → NOT counted (shiftId NULL)
//   T4  PENDING QRIS (open shift) → NOT counted
//   T5  Admin list no-filter: breakdown fields present + correct
//   T6  Branch filter: ?branchId=authorized → only those; foreign → 403
//   T7  Status filter (OPEN/CLOSED)
//   T8  userId filter (admin) + cashier self-scope ignores userId param
//   T9  Date filter: startDate/endDate boundaries
//   T10 Combined branch+user+status narrows exactly
// ============================================================
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:3001";
const PROJECT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TAG = `sms-${Date.now().toString().slice(-7)}`;

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

const fmtNum = (n) => Math.round(Number(n) * 100) / 100;

async function main() {
  if (!VA) throw new Error("IPAYMU_VA required");

  const admin = makeApi();
  const asess = await admin.login("admin@restobahagia.com", "admin123");
  const restaurantId = asess.restaurantId;
  const adminBranchIds = asess.branches.map((b) => b.id);
  check("env: admin login", !!restaurantId && adminBranchIds.length > 0, `branches=${adminBranchIds.length}`);
  admin.setBranch(adminBranchIds[0]);

  const kasir = makeApi();
  const ksess = await kasir.login("kasir@restobahagia.com", "kasir123");
  const kasirId = ksess.userId;
  const kasirBranchId = ksess.branches?.[0]?.id || null;
  check("env: kasir login", !!kasirId && !!kasirBranchId, `branch=${kasirBranchId}`);
  kasir.setBranch(kasirBranchId);

  // Deterministic: no OPEN shifts
  await q(`UPDATE cashiershift SET status='CLOSED' WHERE userId=? AND status='OPEN'`, [kasirId]);

  const openNow = await q(`SELECT COUNT(*) c FROM cashiershift WHERE userId=? AND status='OPEN'`, [kasirId]);
  check("env: no OPEN shift for kasir", Number(openNow[0].c) === 0);

  const shiftInsert = async (label) => {
    const id = `sh${crypto.randomBytes(6).toString("hex")}`;
    await q(`INSERT INTO cashiershift (id,restaurantId,branchId,userId,status,shiftNumber,openingCash,openedAt,createdAt,updatedAt)
             VALUES (?,?,?,?,'OPEN',?,50000,NOW(6),NOW(6),NOW(6))`,
      [id, restaurantId, kasirBranchId, kasirId, `SH-${TAG}-${label}`]);
    created.shifts.push(id);
    return id;
  };

  const prod = (await q(
    `SELECT p.id,p.price FROM product p
     JOIN branchproduct bp ON bp.productId=p.id AND bp.branchId=?
     WHERE p.restaurantId=? AND p.isActive=1 AND p.isAvailable=1 AND bp.isAvailable=1 AND bp.stock>0
     ORDER BY p.price ASC LIMIT 1`, [kasirBranchId, restaurantId]))[0];
  if (!prod) throw new Error("no orderable product");

  const mkCustomer = async () => {
    const custId = `sc-${crypto.randomBytes(8).toString("hex")}`;
    await q(`INSERT INTO customer (id,restaurantId,name,phone,isActive,createdAt,updatedAt) VALUES (?,?,?,?,1,NOW(6),NOW(6))`,
      [custId, restaurantId, `ShiftMon ${TAG}`, `guest-${TAG}-${Date.now().toString().slice(-6)}`]);
    created.customers.push(custId);
    return custId;
  };

  const mkOrder = async () => {
    const custId = await mkCustomer();
    const r = await admin.post("/api/orders", { customerId: custId, orderType: "DINE_IN", items: [{ productId: prod.id, quantity: 1 }] });
    if (r.status !== 201) throw new Error(`mkOrder failed: ${JSON.stringify(r.json)}`);
    const o = r.json.data;
    const dbo = (await q(`SELECT id,grandTotal,branchId,restaurantId,orderNumber FROM \`order\` WHERE id=?`, [o.id]))[0];
    created.orders.push(dbo.id);
    created.orderNums.push(dbo.orderNumber);
    return dbo;
  };

  const activeOf = async (api) => {
    const r = await api.get("/api/shifts/active");
    return r.json?.data?.shift ?? null;
  };
  const listOf = async (api, qs = "") => {
    const r = await api.get(`/api/shifts${qs}`);
    return r.json?.data?.items ?? [];
  };
  const findShift = (items, sid) => items.find((s) => s.id === sid);

  // ============================================================
  // T1. CASH Kasir paid → counted (active + list)
  // ============================================================
  let shiftId;
  let grandTotal;
  {
    const o = await mkOrder();
    grandTotal = fmtNum(o.grandTotal);
    shiftId = await shiftInsert("T1");

    const c = await kasir.post("/api/payments", { orderId: o.id, method: "KASIR" });
    if (c.status !== 201) throw new Error(`KASIR create ${c.status}`);
    const mark = await kasir.post(`/api/payments/${c.json.data.id}/mark-paid`, { amountReceived: o.grandTotal });
    check("T1 CASH: mark-paid 200", mark.status === 200);

    const dbRow = (await q(`SELECT shiftId,status,amount FROM payment WHERE orderId=? AND method='KASIR'`, [o.id]))[0];
    check("T1 CASH: linked to shift + PAID", dbRow?.shiftId === shiftId && dbRow?.status === "PAID");

    const active = await activeOf(kasir);
    check("T1 CASH: active drawer cashRevenue", fmtNum(active?.cashRevenue ?? 0) === grandTotal, `cash=${active?.cashRevenue}`);

    const items = await listOf(kasir);
    const s = findShift(items, shiftId);
    check("T1 CASH: list cashRevenue + txn=1", s && fmtNum(s.cashRevenue) === grandTotal && s.transactionCount === 1, `cash=${s?.cashRevenue} txns=${s?.transactionCount}`);
  }

  // ============================================================
  // T2. QRIS Kasir paid → counted (active + list)
  // ============================================================
  {
    const o = await mkOrder();
    const qr = await kasir.post("/api/payments", { orderNumber: o.orderNumber, method: "QRIS" });
    check("T2 QRIS: created PENDING + shifted", qr.status === 200 && qr.json?.data?.payment?.status === "PENDING");
    const dbRow = (await q(`SELECT shiftId,status FROM payment WHERE orderId=? AND method='QRIS'`, [o.id]))[0];
    check("T2 QRIS: linked to shift", dbRow?.shiftId === shiftId);
    const wh = await postWebhook({ reference_id: o.orderNumber, trx_id: `TRX-T2-${TAG}`, status: "berhasil", total: String(o.grandTotal), amount: String(o.grandTotal) });
    check("T2 QRIS: webhook accepted", wh.status === 200);

    const active = await activeOf(kasir);
    check("T2 QRIS: active qrisRevenue + total", fmtNum(active?.qrisRevenue ?? 0) === grandTotal && fmtNum(active?.totalRevenue ?? 0) === grandTotal * 2,
      `qris=${active?.qrisRevenue} total=${active?.totalRevenue}`);

    const items = await listOf(kasir);
    const s = findShift(items, shiftId);
    check("T2 QRIS: list qrisRevenue + txn=2", s && fmtNum(s.qrisRevenue) === grandTotal && s.transactionCount === 2,
      `qris=${s?.qrisRevenue} txns=${s?.transactionCount}`);
  }

  // ============================================================
  // T3. Customer direct QRIS paid → NOT counted
  // ============================================================
  {
    const o = await mkOrder();
    const c = await admin.post("/api/payments", { orderId: o.id });
    check("T3 directQRIS: created PENDING", c.status === 201 && c.json?.data?.status === "PENDING");
    const dbRow = (await q(`SELECT shiftId,status FROM payment WHERE orderId=?`, [o.id]))[0];
    check("T3 directQRIS: shiftId NULL", dbRow?.shiftId === null || dbRow?.shiftId === undefined, `shiftId=${dbRow?.shiftId}`);
    const wh = await postWebhook({ reference_id: o.orderNumber, trx_id: `TRX-T3-${TAG}`, status: "berhasil", total: String(o.grandTotal), amount: String(o.grandTotal) });
    check("T3 directQRIS: webhook accepted", wh.status === 200);
    const dbRow2 = (await q(`SELECT shiftId,status FROM payment WHERE orderId=?`, [o.id]))[0];
    check("T3 directQRIS: shiftId NULL after PAID", dbRow2?.status === "PAID" && (dbRow2?.shiftId === null || dbRow2?.shiftId === undefined));

    const active = await activeOf(kasir);
    check("T3 directQRIS: NOT counted in active drawer", fmtNum(active?.totalRevenue ?? 0) === grandTotal * 2 && fmtNum(active?.qrisRevenue ?? 0) === grandTotal,
      `total=${active?.totalRevenue}`);
  }

  // ============================================================
  // T4. PENDING QRIS → not counted
  // ============================================================
  {
    const o = await mkOrder();
    const qr = await kasir.post("/api/payments", { orderNumber: o.orderNumber, method: "QRIS" });
    check("T4 pendingQRIS: created PENDING", qr.status === 200 && qr.json?.data?.payment?.status === "PENDING");
    const active = await activeOf(kasir);
    check("T4 pendingQRIS: NOT counted", fmtNum(active?.totalRevenue ?? 0) === grandTotal * 2, `total=${active?.totalRevenue}`);
  }

  // ============================================================
  // T5. Admin list (no filter) — breakdown present + correct
  // ============================================================
  {
    const items = await listOf(admin);
    const s = findShift(items, shiftId);
    check("T5 admin list: contains shift w/ breakdown", !!s, "found in all-shifts");
    check("T5 admin list: breakdown exact", s &&
      fmtNum(s.cashRevenue) === grandTotal &&
      fmtNum(s.qrisRevenue) === grandTotal &&
      fmtNum(s.totalRevenue) === grandTotal * 2 &&
      s.transactionCount === 2,
      `cash=${s?.cashRevenue} qris=${s?.qrisRevenue} total=${s?.totalRevenue} txns=${s?.transactionCount}`);
    check("T5 admin list: branch info present", !!s?.branch && s.branch.id === kasirBranchId, `branch=${s?.branch?.code}`);
  }

  // ============================================================
  // T6. Branch filter + authorization
  // ============================================================
  {
    const items = await listOf(admin, `?branchId=${kasirBranchId}`);
    check("T6 branch filter: all rows that branch", items.length > 0 && items.every((s) => s.branchId === kasirBranchId), `n=${items.length}`);

    const foreign = `br${crypto.randomBytes(6).toString("hex")}`;
    const r = await admin.get(`/api/shifts?branchId=${foreign}`);
    check("T6 branch filter: foreign branch → 403", r.status === 403, `http=${r.status} code=${r.json?.error}`);
  }

  // ============================================================
  // T7. Status filter (close SH-1, open SH-2)
  // ============================================================
  let shiftId2;
  {
    const close = await kasir.post("/api/shifts/close", {});
    check("T7 close SH-1: 200", close.status === 200, `http=${close.status} code=${close.json?.error}`);

    shiftId2 = await shiftInsert("T7");

    const open = await listOf(admin, `?status=OPEN`);
    check("T7 status=OPEN: only OPEN (has SH-2, not SH-1)", open.some((s) => s.id === shiftId2) && !open.some((s) => s.id === shiftId),
      `openN=${open.length}`);
    const closed = await listOf(admin, `?status=CLOSED`);
    check("T7 status=CLOSED: only CLOSED (has SH-1, not SH-2)", closed.some((s) => s.id === shiftId) && !closed.some((s) => s.id === shiftId2),
      `closedN=${closed.length}`);
  }

  // ============================================================
  // T8. userId filter (admin) + cashier self-scope
  // ============================================================
  {
    const filtered = await listOf(admin, `?userId=${kasirId}`);
    check("T8 admin userId: only that cashier", filtered.length > 0 && filtered.every((s) => s.userId === kasirId), `n=${filtered.length}`);

    const self = await listOf(kasir, `?userId=${asess.userId}`);
    check("T8 cashier: userId param ignored (own shifts only)", self.every((s) => s.userId === kasirId), `n=${self.length} allSelf=${self.every((s) => s.userId === kasirId)}`);

    const adminShifts = await listOf(admin, `?userId=${asess.userId}`);
    check("T8 admin userId=admin: returns that admin's shifts only", adminShifts.every((s) => s.userId === asess.userId), `n=${adminShifts.length}`);
  }

  // ============================================================
  // T9. Date filter
  // ============================================================
  {
    const today = new Date();
    const local = (d, off) => { const x = new Date(d); x.setDate(x.getDate() + off); return x.toLocaleDateString("en-CA"); };
    const todayStr = local(today, 0);
    const tomorrowStr = local(today, 1);
    const yesterdayStr = local(today, -1);

    const todays = await listOf(admin, `?startDate=${todayStr}&endDate=${todayStr}`);
    check("T9 date=today: includes today's shifts", todays.some((s) => s.id === shiftId), `n=${todays.length}`);

    const after = await listOf(admin, `?startDate=${tomorrowStr}`);
    check("T9 start=tomorrow: empty", after.length === 0, `n=${after.length}`);

    const before = await listOf(admin, `?endDate=${yesterdayStr}`);
    check("T9 end=yesterday: empty", before.length === 0, `n=${before.length}`);
  }

  // ============================================================
  // T10. Combined branch + user + status narrows exactly
  // ============================================================
  {
    const items = await listOf(admin, `?branchId=${kasirBranchId}&userId=${kasirId}&status=OPEN`);
    const ok = items.length === 1 && items[0].id === shiftId2;
    check("T10 combined: exactly SH-2 (OPEN, kasir, branch)", ok, `n=${items.length} ids=${items.map((s) => s.id).join(",")}`);
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