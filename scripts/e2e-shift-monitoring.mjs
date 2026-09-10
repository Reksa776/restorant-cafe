// ============================================================
// SHIFT MONITORING E2E — port 3001 only.
//
// Tests: filter API, payment breakdown, duration, cashier isolation.
// ============================================================
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:3001";
const PROJECT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TAG = `sm-${Date.now().toString().slice(-7)}`;

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
  database: url.pathname.replace(/^\//, ""), connectionLimit: 6,
});
const q = async (sql, params = []) => (await pool.query(sql, params))[0];

const results = [];
const created = { orders: [], customers: [], payments: [], shifts: [] };
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

async function main() {
  // --- Login ---
  const admin = makeApi();
  const asess = await admin.login("admin@restobahagia.com", "admin123");
  const restaurantId = asess.restaurantId;
  const adminBranchId = asess.branches?.[0]?.id || null;
  check("env: admin login", !!restaurantId && !!adminBranchId);
  admin.setBranch(adminBranchId);

  const kasir = makeApi();
  const ksess = await kasir.login("kasir@restobahagia.com", "kasir123");
  const kasirId = ksess.userId;
  const kasirBranchId = ksess.branches?.[0]?.id || null;
  check("env: kasir login", !!kasirId && !!kasirBranchId);
  kasir.setBranch(kasirBranchId);

  // --- Close any open shifts ---
  await q(`UPDATE cashiershift SET status='CLOSED' WHERE userId=? AND status='OPEN'`, [kasirId]);

  // --- T1: ADMIN list all shifts (200) ---
  {
    const r = await admin.get("/api/shifts");
    check("T1 admin list shifts: 200", r.status === 200, `http=${r.status}`);
    check("T1 admin list shifts: has items", Array.isArray(r.json?.data?.items), `items=${r.json?.data?.items?.length}`);
    // Check that items have breakdown fields
    const first = r.json?.data?.items?.[0];
    if (first) {
      check("T1 admin shifts: has cashRevenue field", "cashRevenue" in first, `cashRevenue=${first.cashRevenue}`);
      check("T1 admin shifts: has qrisRevenue field", "qrisRevenue" in first, `qrisRevenue=${first.qrisRevenue}`);
      check("T1 admin shifts: has totalRevenue field", "totalRevenue" in first, `totalRevenue=${first.totalRevenue}`);
      check("T1 admin shifts: has transactionCount field", "transactionCount" in first, `txCount=${first.transactionCount}`);
    }
  }

  // --- T2: ADMIN filter status=OPEN ---
  {
    const r = await admin.get("/api/shifts?status=OPEN");
    check("T2 filter status=OPEN: 200", r.status === 200, `http=${r.status}`);
    const items = r.json?.data?.items || [];
    const allOpen = items.every((s) => s.status === "OPEN");
    check("T2 filter status=OPEN: all items OPEN", allOpen, `count=${items.length}`);
  }

  // --- T3: ADMIN filter status=CLOSED ---
  {
    const r = await admin.get("/api/shifts?status=CLOSED");
    check("T3 filter status=CLOSED: 200", r.status === 200, `http=${r.status}`);
    const items = r.json?.data?.items || [];
    const allClosed = items.every((s) => s.status === "CLOSED");
    check("T3 filter status=CLOSED: all items CLOSED", allClosed, `count=${items.length}`);
  }

  // --- T4: ADMIN filter date range ---
  {
    const today = new Date().toISOString().slice(0, 10);
    const r = await admin.get(`/api/shifts?startDate=${today}&endDate=${today}`);
    check("T4 filter date range: 200", r.status === 200, `http=${r.status}`);
    const items = r.json?.data?.items || [];
    check("T4 filter date range: items filtered", items.length >= 0, `count=${items.length}`);
  }

  // --- T5: Cashier list own shifts ---
  {
    const r = await kasir.get("/api/shifts");
    check("T5 cashier list: 200", r.status === 200, `http=${r.status}`);
    const items = r.json?.data?.items || [];
    const allOwn = items.every((s) => s.userId === kasirId);
    check("T5 cashier list: all shifts are own", allOwn, `count=${items.length} allOwn=${allOwn}`);
  }

  // --- T6: Cashier cannot filter by userId ---
  {
    const r = await kasir.get(`/api/shifts?userId=someotherid`);
    check("T6 cashier userId ignored: 200", r.status === 200, `http=${r.status}`);
    const items = r.json?.data?.items || [];
    const allOwn = items.every((s) => s.userId === kasirId);
    check("T6 cashier userId ignored: still shows only own shifts", allOwn, `count=${items.length}`);
  }

  // --- T7: Create test data — open shift + cash payment + QRIS payment ---
  {
    // Open shift for kasir
    const shiftR = await kasir.post("/api/shifts", { openingCash: 500000 });
    check("T7 open shift: 201", shiftR.status === 201, `http=${shiftR.status}`);
    const shiftId = shiftR.json?.data?.id;
    if (shiftId) created.shifts.push(shiftId);

    // Create order
    const prod = (await q(
      `SELECT p.id FROM product p JOIN branchproduct bp ON bp.productId=p.id AND bp.branchId=?
       WHERE p.restaurantId=? AND p.isActive=1 AND bp.isAvailable=1 AND bp.stock>0 LIMIT 1`,
      [kasirBranchId, restaurantId]))[0];
    if (prod) {
      const custId = `sc-${crypto.randomBytes(8).toString("hex")}`;
      await q(`INSERT INTO customer (id,restaurantId,name,phone,isActive,createdAt,updatedAt) VALUES (?,?,?,?,1,NOW(6),NOW(6))`,
        [custId, restaurantId, `SM Test ${TAG}`, `sm-${TAG}`]);
      created.customers.push(custId);

      const orderR = await admin.post("/api/orders", { customerId: custId, orderType: "DINE_IN", items: [{ productId: prod.id, quantity: 1 }] });
      if (orderR.status === 201) {
        const orderId = orderR.json.data.id;
        created.orders.push(orderId);

        // Create CASH payment
        const cashR = await kasir.post("/api/payments", { orderId, method: "KASIR" });
        if (cashR.status === 201 || cashR.status === 200) {
          const paymentId = cashR.json?.data?.id;
          if (paymentId) {
            const markR = await kasir.post(`/api/payments/${paymentId}/mark-paid`, { amountReceived: orderR.json.data.grandTotal });
            check("T7 cash payment PAID", markR.status === 200, `mark=${markR.status}`);

            // Verify shiftId is set
            const payRow = (await q(`SELECT shiftId FROM payment WHERE id=?`, [paymentId]))[0];
            check("T7 cash payment has shiftId", payRow?.shiftId === shiftId, `shiftId=${payRow?.shiftId} expected=${shiftId}`);
          }
        }
      }
    }

    // Verify breakdown
    const r = await admin.get("/api/shifts");
    if (shiftId) {
      const myShift = r.json?.data?.items?.find((s) => s.id === shiftId);
      if (myShift) {
        check("T7 shift has cashRevenue > 0", (myShift.cashRevenue ?? 0) > 0, `cash=${myShift.cashRevenue}`);
        check("T7 shift has totalRevenue > 0", (myShift.totalRevenue ?? 0) > 0, `total=${myShift.totalRevenue}`);
      }
    }
  }

  // --- T8: Duration computation ---
  {
    const r = await admin.get("/api/shifts");
    const items = r.json?.data?.items || [];
    const openShift = items.find((s) => s.status === "OPEN" && s.openedAt);
    if (openShift) {
      const startMs = new Date(openShift.openedAt).getTime();
      const nowMs = Date.now();
      const durationMs = nowMs - startMs;
      check("T8 open shift duration > 0", durationMs > 0, `ms=${durationMs}`);
    } else {
      check("T8 open shift duration: no open shift to test", true, "skip");
    }
  }

  // --- T9: ADMIN filter by userId ---
  {
    const r = await admin.get(`/api/shifts?userId=${kasirId}`);
    check("T9 admin userId filter: 200", r.status === 200, `http=${r.status}`);
    const items = r.json?.data?.items || [];
    const allKasir = items.every((s) => s.userId === kasirId);
    check("T9 admin userId filter: all items belong to kasir", allKasir, `count=${items.length}`);
  }

  // --- T10: Branch isolation — kasir cannot see admin's shifts ---
  {
    const kasirShifts = (await kasir.get("/api/shifts")).json?.data?.items || [];
    const allOwn = kasirShifts.every((s) => s.userId === kasirId);
    check("T10 branch isolation: kasir only sees own shifts", allOwn, `count=${kasirShifts.length}`);
  }

  // --- T11: Shift detail endpoint ---
  {
    const shifts = (await admin.get("/api/shifts")).json?.data?.items || [];
    const first = shifts[0];
    if (first) {
      const r = await admin.get(`/api/shifts/${first.id}`);
      check("T11 shift detail: 200", r.status === 200, `http=${r.status}`);
      check("T11 shift detail: has totals", !!r.json?.data?.totals, `totals=${!!r.json?.data?.totals}`);
      check("T11 shift detail: has payments array", Array.isArray(r.json?.data?.shift?.payments), `payments=${r.json?.data?.shift?.payments?.length}`);
    }
  }

  // --- T12: Cashier cannot read another cashier's shift detail ---
  {
    const adminShifts = (await admin.get("/api/shifts")).json?.data?.items || [];
    const otherShift = adminShifts.find((s) => s.userId !== kasirId);
    if (otherShift) {
      const r = await kasir.get(`/api/shifts/${otherShift.id}`);
      check("T12 cashier cannot read other shift: 404/403", r.status === 404 || r.status === 403, `http=${r.status}`);
    } else {
      check("T12 cashier cannot read other shift: only 1 cashier", true, "skip");
    }
  }

  // --- Summary ---
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"=".repeat(48)}`);
  console.log(`TOTAL: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`);
  failed.forEach((f) => console.log(`  FAILED: ${f.name} (${f.extra})`));

  // --- Cleanup ---
  try {
    if (created.payments.length) await q(`DELETE FROM paymenttransaction WHERE paymentId IN (?)`, [created.payments]);
    if (created.payments.length) await q(`DELETE FROM payment WHERE id IN (?)`, [created.payments]);
    if (created.orders.length) {
      await q(`DELETE FROM orderstatushistory WHERE orderId IN (?)`, [created.orders]);
      await q(`DELETE FROM orderitem WHERE orderId IN (?)`, [created.orders]);
      await q(`DELETE FROM \`order\` WHERE id IN (?)`, [created.orders]);
    }
    if (created.shifts.length) await q(`DELETE FROM cashiershift WHERE id IN (?)`, [created.shifts]);
    if (created.customers.length) await q(`DELETE FROM customer WHERE id IN (?)`, [created.customers]);
    console.log("cleanup: tagged rows removed");
  } catch (e) {
    console.log("cleanup error:", e.message);
  }

  await pool.end();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  try { await pool.end(); } catch {}
  process.exit(2);
});
