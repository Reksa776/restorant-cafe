import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { addDaysToDateOnly, dateOnlyFromDb } from "./reservation.slots";

// ============================================================
// PHASE R3 — RESERVATION HTTP API TESTS (route layer, REAL server)
//
// Route handlers call `auth()` (NextAuth), which needs the real Next request
// context — they CANNOT be invoked directly under tsx. So this suite bootstraps
// a REAL `next dev` server on an ephemeral port, signs in with real fixture
// staff (via the real /api/auth/csrf + /api/auth/callback/credentials flow) and
// exercises the /api/public/reservations + /api/admin/reservations route layer
// over plain HTTP against the real local database.
//
// Run with: npx tsx --test src/services/reservation/reservation.api.test.ts
// ============================================================

const ROOT = path.resolve(__dirname, "../../..");
const SLOT_18 = 18 * 60; // 18:00
const DUR_120 = 120; // 18:00–20:00 (ends before 22:00 close)
const TODAY = dateOnlyFromDb(new Date());

function futureDate(days: number) {
  return addDaysToDateOnly(TODAY, days);
}

// Per-test-day allocations so bookings never collide across tests (each test
// area uses a dedicated future day). Always ≥ +2 → safely inside the 60-day
// horizon and never "past".
const DAY_CREATE = futureDate(2); // public create + lookup
const DAY_DUP = futureDate(7); // duplicate-slot capacity test on tMain
const DAY_CONFLICT = futureDate(3); // concurrency race (capacity-2 table)
const DAY_XTENANT = futureDate(5); // restB reservation (cross-tenant probes)
const DAY_STATUS = futureDate(4); // admin create / status / cancel
const DAY_SCOPED = futureDate(6); // branch-scoped cashier creates

// 08120000XXXX block for fixtures (never collides with the API keys below).
let phoneCounter = 1;
function fixturePhone() {
  const n = String(90000000 + phoneCounter).slice(-8);
  phoneCounter += 1;
  return `0812${n}`;
}
function apiPhone() {
  const n = String(80000000 + phoneCounter).slice(-8);
  phoneCounter += 1;
  return `0812${n}`;
}

// ---- authorized API consumers ------------
const PW_A = `A-pw-${Math.random().toString(36).slice(2, 10)}`;
const PW_B = `B-pw-${Math.random().toString(36).slice(2, 10)}`;
const PW_C = `C-pw-${Math.random().toString(36).slice(2, 10)}`;

let restA = "";
let restB = "";
let MAIN = "";
let ALT = "";
let R2B = "";
let tMain = "";
let tAlt = "";
let emailA = "";
let emailB = "";
let emailC = "";
let tokenA = "";
let tokenB = "";
let tokenC = "";

// ---- dev server ----------------
let server: ChildProcess | null = null;
let base = "";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, () => {
      const address = srv.address() as net.AddressInfo;
      const port = address.port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url: string, timeoutMs = 180_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/public/restaurant`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.status === 200) return;
    } catch {
      if (server?.exitCode !== null) {
        throw new Error("next dev exited before becoming ready");
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("next dev did not become ready in time");
}

async function startServer(): Promise<void> {
  // Next releases refuse to start a SECOND dev server for the same project —
  // they print "Another next dev server is already running" and exit. Kill any
  // stale dev server left behind by an aborted run before spawning ours.
  try {
    execSync("pkill -f 'next/dist/bin/next [d]ev' || true", {
      timeout: 5000,
      stdio: "ignore",
    });
  } catch {
    // ignore
  }
  const port = await freePort();
  base = `http://localhost:${port}`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-p", String(port)],
    {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let logs = "";
  server.stdout?.on("data", (d) => (logs += String(d)));
  server.stderr?.on("data", (d) => (logs += String(d)));
  server.on("exit", (code) => {
    if (code !== 0 && !teardownStarted) {
      console.error("[next dev dirty exit]", code, "\n", logs.slice(-2000));
    }
  });
  await waitForServer(base);
}

let teardownStarted = false;
async function stopServer(): Promise<void> {
  teardownStarted = true;
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 8_000);
      server?.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  server = null;
}
process.on("exit", () => {
  if (server && server.exitCode === null) server.kill("SIGTERM");
});
process.on("uncaughtException", () => {
  if (server && server.exitCode === null) server.kill("SIGTERM");
});

// ---- Auth.JS login over HTTP ----------------
function parseCookies(setCookie: string[]): string {
  return setCookie.map((c): string => c.split(";")[0]).join("; ");
}

async function login(email: string, password: string): Promise<string> {
  const csrfRes = await fetch(`${base}/api/auth/csrf`, {
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  const csrfCookies = parseCookies(csrfRes.headers.getSetCookie());
  const body = (await csrfRes.json()) as { csrfToken: string };

  const loginRes = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: csrfCookies,
    },
    body: new URLSearchParams({
      csrfToken: body.csrfToken,
      email,
      password,
      redirect: "false",
      callbackUrl: "http://localhost:3000",
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  const session = parseCookies(loginRes.headers.getSetCookie());
  const parts = session.split("; ").filter((c) => c.startsWith("authjs.session-token="));
  if (parts.length === 0) {
    throw new Error(`login failed for ${email} (HTTP ${loginRes.status})`);
  }
  return parts.join("; ");
}

// ---- HTTP helper ---------------
interface ApiOptions {
  method?: string;
  token?: string;
  body?: unknown;
}

async function api(pathName: string, opts: ApiOptions = {}) {
  const res = await fetch(`${base}${pathName}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.token ? { cookie: opts.token } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, body: json };
}

const qs = (query: Record<string, string>) =>
  Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

// ---- payload builders -------------------
function publicCreate(overrides: Record<string, unknown> = {}) {
  return {
    branchCode: "QA-MAIN",
    reservationDate: DAY_CREATE,
    startMinutes: SLOT_18,
    durationMinutes: DUR_120,
    partySize: 2,
    guestName: "Tes Publik",
    guestPhone: apiPhone(),
    ...overrides,
  };
}

function adminCreate(overrides: Record<string, unknown> = {}) {
  return {
    branchId: MAIN,
    reservationDate: DAY_STATUS,
    startMinutes: SLOT_18,
    durationMinutes: DUR_120,
    partySize: 2,
    guestName: "Tes Admin",
    guestPhone: fixturePhone(),
    ...overrides,
  };
}

async function createAdminReservation(token: string, overrides: Record<string, unknown> = {}) {
  return api("/api/admin/reservations", { method: "POST", token, body: adminCreate(overrides) });
}

function assertNoInternalFields(dto: Record<string, unknown>, ignore: string[] = []) {
  const forbidden = ["customerId", "orderId", "source", "notes", "branchId", "tableId"];
  for (const key of forbidden) {
    if (ignore.includes(key)) continue;
    assert.equal(key in dto, false, `public DTO must not expose "${key}"`);
  }
}

// ============================================================
// Fixtures
// ============================================================
async function seedFixtures(): Promise<void> {
  const tag = `R3API${Date.now()}`;
  const hashedA = await bcrypt.hash(PW_A, 10);
  const hashedB = await bcrypt.hash(PW_B, 10);
  const hashedC = await bcrypt.hash(PW_C, 10);

  const [ra, rb] = await Promise.all([
    prisma.restaurant.create({ data: { name: `QA R3 API A ${tag}` } }),
    prisma.restaurant.create({ data: { name: `QA R3 API B ${tag}` } }),
  ]);
  restA = ra.id;
  restB = rb.id;

  const [bMain, bAlt, bR2B] = await Promise.all([
    prisma.branch.create({ data: { restaurantId: restA, code: "QA-MAIN", name: "Cabang Utama" } }),
    prisma.branch.create({ data: { restaurantId: restA, code: "QA-ALT", name: "Cabang Alt" } }),
    prisma.branch.create({ data: { restaurantId: restB, code: "QA-R2B", name: "Cabang B" } }),
  ]);
  MAIN = bMain.id;
  ALT = bAlt.id;
  R2B = bR2B.id;

  const [t1, t2] = await Promise.all([
    prisma.table.create({
      data: { restaurantId: restA, branchId: MAIN, number: 5001, name: "QA-MAIN-1", capacity: 2, isActive: true, status: "AVAILABLE" },
    }),
    prisma.table.create({
      data: { restaurantId: restA, branchId: ALT, number: 5002, name: "QA-ALT-1", capacity: 6, isActive: true, status: "AVAILABLE" },
    }),
  ]);
  await prisma.table.create({
    data: { restaurantId: restB, branchId: R2B, number: 5003, name: "QA-R2B-1", capacity: 4, isActive: true, status: "AVAILABLE" },
  });
  tMain = t1.id;
  tAlt = t2.id;

  // adminA — restA, ADMIN, all-branch (no UserBranch rows)
  emailA = `${tag}-a@r3.test`;
  const ua = await prisma.user.create({
    data: { restaurantId: restA, name: "Admin A", email: emailA, password: hashedA, role: "ADMIN", isActive: true, sessionVersion: 0 },
  });
  // adminB — restB, ADMIN, all-branch
  emailB = `${tag}-b@r3.test`;
  await prisma.user.create({
    data: { restaurantId: restB, name: "Admin B", email: emailB, password: hashedB, role: "ADMIN", isActive: true, sessionVersion: 0 },
  });
  // cashierC — restA, CASHIER, scoped to ALT only
  emailC = `${tag}-c@r3.test`;
  const uc = await prisma.user.create({
    data: { restaurantId: restA, name: "Kasir C", email: emailC, password: hashedC, role: "CASHIER", isActive: true, sessionVersion: 0 },
  });
  await prisma.userBranch.create({ data: { userId: uc.id, branchId: ALT } });
  void ua;
}

async function teardownFixtures(): Promise<void> {
  const ids = [restA, restB].filter(Boolean);
  if (ids.length === 0) return;
  await prisma.reservation.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.table.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.userBranch.deleteMany({ where: { user: { restaurantId: { in: ids } } } });
  await prisma.user.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.branch.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: ids } } });
}

before(async () => {
  await seedFixtures();
  await startServer();
  tokenA = await login(emailA, PW_A);
  tokenB = await login(emailB, PW_B);
  tokenC = await login(emailC, PW_C);
});

after(async () => {
  await stopServer();
  await teardownFixtures();
  await prisma.$disconnect();
});

// ============================================================
// PUBLIC ROUTES
// ============================================================

test("P1 public create — happy path returns a safe public DTO", async () => {
  const phone = apiPhone();
  const res = await api("/api/public/reservations", {
    method: "POST",
    body: publicCreate({ tableId: tMain, guestPhone: phone }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const dto = res.body?.data as Record<string, unknown>;
  assert.equal(res.body?.success, true);
  assert.equal(typeof dto.code, "string");
  assert.equal(dto.status, "PENDING");
  assert.equal(dto.reservationDate, DAY_CREATE);
  assert.equal(dto.startMinutes, SLOT_18);
  assert.equal(dto.durationMinutes, DUR_120);
  assert.equal(dto.partySize, 2);
  assert.deepEqual(dto.branch, { code: "QA-MAIN", name: "Cabang Utama" });
  assert.equal((dto.table as Record<string, unknown>).number, 5001);
  assert.equal(dto.guestPhone, normalizePhone(phone));
  assertNoInternalFields(dto as Record<string, unknown>);
});

test("P2 public create — duplicate slot on same capacity-2 table → 409", async () => {
  // Dedicated day so the first booking is the one that fills the table.
  const first = await api("/api/public/reservations", {
    method: "POST",
    body: publicCreate({
      tableId: tMain,
      reservationDate: DAY_DUP,
      guestPhone: apiPhone(),
      guestName: "Duplikat 1",
    }),
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));

  const second = await api("/api/public/reservations", {
    method: "POST",
    body: publicCreate({
      tableId: tMain,
      reservationDate: DAY_DUP,
      guestPhone: apiPhone(),
      guestName: "Duplikat 2",
    }),
  });
  assert.equal(second.status, 409, JSON.stringify(second.body));
  assert.equal(second.body?.error, "CONFLICT");
  assert.equal(second.body?.success, false);
});

test("P3 public create — validation errors → 400 VALIDATION_ERROR", async () => {
  const noPhone = await api("/api/public/reservations", {
    method: "POST",
    body: publicCreate({ guestPhone: undefined }),
  });
  assert.equal(noPhone.status, 400);
  assert.equal(noPhone.body?.error, "VALIDATION_ERROR");

  const badDate = await api("/api/public/reservations", {
    method: "POST",
    body: publicCreate({ reservationDate: "2026-02-30", guestPhone: apiPhone() }),
  });
  assert.equal(badDate.status, 400);

  const badStart = await api("/api/public/reservations", {
    method: "POST",
    body: publicCreate({ startMinutes: 3000, guestPhone: apiPhone() }),
  });
  assert.equal(badStart.status, 400);
});

test("P4 public create — past date → 400", async () => {
  const res = await api("/api/public/reservations", {
    method: "POST",
    body: publicCreate({
      reservationDate: addDaysToDateOnly(TODAY, -1),
      restaurantId: restA,
      guestPhone: apiPhone(),
    }),
  });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test("P5 public create — fake tableId → 400 (server-validated, never trusted)", async () => {
  const res = await api("/api/public/reservations", {
    method: "POST",
    body: publicCreate({ tableId: "nonexistent-table-id", guestPhone: apiPhone() }),
  });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test("P6 public create — cross-tenant branchCode → 404 (branch resolved under the table's restaurant)", async () => {
  const res = await api("/api/public/reservations", {
    method: "POST",
    body: publicCreate({ tableId: tMain, branchCode: "QA-R2B", guestPhone: apiPhone() }),
  });
  assert.equal(res.status, 404, JSON.stringify(res.body));
});

test("P7 public create — malformed JSON → generic 500 (no stack leak)", async () => {
  const raw = await fetch(`${base}/api/public/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
    signal: AbortSignal.timeout(120_000),
  });
  assert.equal(raw.status, 500);
  const body = (await raw.json()) as Record<string, unknown>;
  assert.equal(body.error, "INTERNAL_ERROR");
  assert.equal(body.success, false);
  // The synthetic fallback message must never leak runtime internals; the
  // catch path only ever emits THIS exact string on an unexpected error.
  assert.equal(body.message, "Gagal membuat reservasi");
  assert.equal(/\bat\b|\bstack\b/.test(String(body.message)), false);
});

test("P8 public lookup — code + correct phone → 200 with safe DTO", async () => {
  const created = await api("/api/public/reservations", {
    method: "POST",
    body: publicCreate({ tableId: tAlt, branchCode: "QA-ALT", guestPhone: apiPhone(), guestName: "Cari Saya" }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { code } = created.body?.data as { code: string };
  const phone = (created.body?.data as { guestPhone: string }).guestPhone;

  const res = await api(
    `/api/public/reservations/${encodeURIComponent(code)}?${qs({ phone, restaurantId: restA })}`
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const dto = res.body?.data as Record<string, unknown>;
  assert.equal(dto.code, code);
  assert.equal(dto.guestName, "Cari Saya");
  assertNoInternalFields(dto);
});

test("P9 public lookup — wrong phone → 404 (phone must match stored)", async () => {
  const created = await api("/api/public/reservations", {
    method: "POST",
    body: publicCreate({ tableId: tAlt, branchCode: "QA-ALT", guestPhone: apiPhone() }),
  });
  const { code } = created.body?.data as { code: string };

  const res = await api(
    `/api/public/reservations/${encodeURIComponent(code)}?${qs({ phone: "081299999999", restaurantId: restA })}`
  );
  assert.equal(res.status, 404, JSON.stringify(res.body));
});

test("P10 public lookup — missing phone → 400", async () => {
  const res = await api(`/api/public/reservations/ANYCODE`);
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body?.error, "VALIDATION_ERROR");
});

test("P11 public lookup — code from another tenant → 404", async () => {
  // Create a reservation in restB via its admin.
  const created = await api("/api/admin/reservations", {
    method: "POST",
    token: tokenB,
    body: {
      branchId: R2B,
      reservationDate: DAY_XTENANT,
      startMinutes: SLOT_18,
      durationMinutes: DUR_120,
      partySize: 2,
      guestName: "Tenant B",
      guestPhone: fixturePhone(),
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { code } = created.body?.data as { code: string };
  const phone = (created.body?.data as { guestPhone: string }).guestPhone;

  // Lookup scoping to restA (an active restaurant) must NOT find restB's row.
  const res = await api(
    `/api/public/reservations/${encodeURIComponent(code)}?${qs({ phone, restaurantId: restA })}`
  );
  assert.equal(res.status, 404, JSON.stringify(res.body));
});

test("P12 public availability — happy path returns seat counts", async () => {
  // Probe an untouched 19:00–21:00 window on tAlt (P8/P9 only book 18:00)).
  const res = await api(
    `/api/public/reservations/availability?${qs({
      branchCode: "QA-ALT",
      date: DAY_CREATE,
      partySize: "2",
      tableId: tAlt,
      startMinutes: String(19 * 60),
      durationMinutes: String(DUR_120),
    })}`
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const data = res.body?.data as { tables: Array<Record<string, unknown>> };
  const probe = data.tables.find((t) => t.tableId === tAlt);
  assert.ok(probe, "table appears in availability response");
  assert.equal(probe.available, true);
  assert.ok((probe.remainingSeats as number) >= 2);
});

test("P13 public availability — invalid date / missing start → 400", async () => {
  const badDate = await api(
    `/api/public/reservations/availability?${qs({ branchCode: "QA-MAIN", date: "not-a-date", partySize: "2", startMinutes: String(SLOT_18) })}`
  );
  assert.equal(badDate.status, 400);

  const noStart = await api(
    `/api/public/reservations/availability?${qs({ branchCode: "QA-MAIN", date: DAY_CREATE, partySize: "2" })}`
  );
  assert.equal(noStart.status, 400);
});

test("P14 public availability — cross-tenant branchCode → 404", async () => {
  const res = await api(
    `/api/public/reservations/availability?${qs({
      branchCode: "QA-R2B",
      date: DAY_CREATE,
      partySize: "2",
      tableId: tMain,
      startMinutes: String(SLOT_18),
    })}`
  );
  assert.equal(res.status, 404, JSON.stringify(res.body));
});

// ============================================================
// ADMIN ROUTES — authentication
// ============================================================

test("A1 unauthenticated admin routes → 401", async () => {
  const list = await api("/api/admin/reservations");
  assert.equal(list.status, 401, JSON.stringify(list.body));
  assert.equal(list.body?.error, "UNAUTHORIZED");

  const detail = await api(`/api/admin/reservations/${tMain}`);
  assert.equal(detail.status, 401);

  const statusUpdate = await api(`/api/admin/reservations/${tMain}/status`, {
    method: "PATCH",
    body: { status: "CONFIRMED" },
  });
  assert.equal(statusUpdate.status, 401);

  const cancel = await api(`/api/admin/reservations/${tMain}/cancel`, {
    method: "POST",
    body: {},
  });
  assert.equal(cancel.status, 401);
});

// ============================================================
// ADMIN ROUTES — create
// ============================================================

test("A2 admin create — happy path (source stamped ADMIN)", async () => {
  const res = await createAdminReservation(tokenA);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const view = res.body?.data as Record<string, unknown>;
  assert.equal(view.source, "ADMIN");
  assert.equal(view.status, "PENDING");
  assert.equal((view.branch as Record<string, unknown> | null)?.id, MAIN);
});

test("A3 admin create — cross-tenant branchId → 403 (assertBranchInScope)", async () => {
  const res = await createAdminReservation(tokenA, { branchId: R2B });
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body?.error, "FORBIDDEN");
});

test("A4 admin create — validation error → 400", async () => {
  const res = await createAdminReservation(tokenA, { reservationDate: "bad" });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

// ============================================================
// ADMIN ROUTES — tenant isolation
// ============================================================

test("A5 tenant isolation — restB admin cannot read restA reservation → 404", async () => {
  const created = await createAdminReservation(tokenA);
  assert.equal(created.status, 201);
  const id = (created.body?.data as { id: string }).id;

  const res = await api(`/api/admin/reservations/${id}`, { token: tokenB });
  assert.equal(res.status, 404, JSON.stringify(res.body));
});

test("A6 tenant isolation — restB admin cannot transition restA reservation → 404", async () => {
  const created = await createAdminReservation(tokenA);
  const id = (created.body?.data as { id: string }).id;

  const res = await api(`/api/admin/reservations/${id}/status`, {
    method: "PATCH",
    token: tokenB,
    body: { status: "CONFIRMED" },
  });
  assert.equal(res.status, 404, JSON.stringify(res.body));
});

test("A7 tenant isolation — restB admin cannot cancel restA reservation → 404", async () => {
  const created = await createAdminReservation(tokenA);
  const id = (created.body?.data as { id: string }).id;

  const res = await api(`/api/admin/reservations/${id}/cancel`, {
    method: "POST",
    token: tokenB,
    body: { cancelReason: "nope" },
  });
  assert.equal(res.status, 404, JSON.stringify(res.body));
});

// ============================================================
// ADMIN ROUTES — branch scope (CASHIER, single-branch)
// ============================================================

test("A8 branch scope — CASHIER can create+read in their own branch", async () => {
  const created = await api("/api/admin/reservations", {
    method: "POST",
    token: tokenC,
    body: adminCreate({
      branchId: ALT,
      reservationDate: DAY_SCOPED,
      tableId: tAlt,
      guestPhone: fixturePhone(),
    }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = (created.body?.data as { id: string }).id;

  const detail = await api(`/api/admin/reservations/${id}`, { token: tokenC });
  assert.equal(detail.status, 200);
  assert.equal((detail.body?.data as { branchId: string }).branchId, ALT);
});

test("A9 branch scope — CASHIER cannot create in another branch → 403", async () => {
  const res = await api("/api/admin/reservations", {
    method: "POST",
    token: tokenC,
    body: adminCreate({
      branchId: MAIN,
      reservationDate: DAY_SCOPED,
      guestPhone: fixturePhone(),
    }),
  });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("A10 branch scope — CASHIER cannot read another branch's reservation → 404", async () => {
  const created = await createAdminReservation(tokenA, { branchId: MAIN });
  const id = (created.body?.data as { id: string }).id;

  const res = await api(`/api/admin/reservations/${id}`, { token: tokenC });
  assert.equal(res.status, 404, JSON.stringify(res.body));
});

test("A11 admin list — paginated + windowed by branch param", async () => {
  await createAdminReservation(tokenA);
  const res = await api(
    `/api/admin/reservations?${qs({ branchId: MAIN, limit: "1" })}`,
    { token: tokenA }
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const data = res.body?.data as {
    items: unknown[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  assert.equal(data.items.length, 1);
  assert.equal(data.limit, 1);
  assert.ok(data.total >= 1);
  assert.ok(data.page === 1);
});

test("A12 admin lookup by code → 200", async () => {
  const created = await createAdminReservation(tokenA);
  const code = (created.body?.data as { code: string }).code;

  const res = await api(
    `/api/admin/reservations/code/${encodeURIComponent(code)}`,
    { token: tokenA }
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((res.body?.data as { id: string }).id, (created.body?.data as { id: string }).id);
});

test("A13 admin availability — happy path", async () => {
  const res = await api(
    `/api/admin/reservations/availability?${qs({
      branchId: MAIN,
      date: DAY_CREATE,
      partySize: "2",
      tableId: tMain,
      startMinutes: String(19 * 60),
      durationMinutes: String(DUR_120),
    })}`,
    { token: tokenA }
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test("A14 admin status transition — PENDING→CONFIRMED→SEATED→COMPLETED", async () => {
  const created = await createAdminReservation(tokenA, { branchId: ALT, tableId: tAlt });
  const id = (created.body?.data as { id: string }).id;

  const confirmed = await api(`/api/admin/reservations/${id}/status`, {
    method: "PATCH",
    token: tokenA,
    body: { status: "CONFIRMED" },
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal((confirmed.body?.data as { status: string }).status, "CONFIRMED");

  const seated = await api(`/api/admin/reservations/${id}/status`, {
    method: "PATCH",
    token: tokenA,
    body: { status: "SEATED" },
  });
  assert.equal(seated.status, 200);
  assert.equal((seated.body?.data as { status: string }).status, "SEATED");

  const completed = await api(`/api/admin/reservations/${id}/status`, {
    method: "PATCH",
    token: tokenA,
    body: { status: "COMPLETED" },
  });
  assert.equal(completed.status, 200);
  assert.equal((completed.body?.data as { status: string }).status, "COMPLETED");

  // Terminal state cannot be cancelled.
  const cancel = await api(`/api/admin/reservations/${id}/cancel`, {
    method: "POST",
    token: tokenA,
    body: { cancelReason: "too late" },
  });
  assert.equal(cancel.status, 409, JSON.stringify(cancel.body));
});

test("A15 admin cancel — PENDING → CANCELLED with reason", async () => {
  const created = await createAdminReservation(tokenA, { branchId: ALT, tableId: tAlt });
  const id = (created.body?.data as { id: string }).id;
  const reason = "table broken";

  const res = await api(`/api/admin/reservations/${id}/cancel`, {
    method: "POST",
    token: tokenA,
    body: { cancelReason: reason },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const view = res.body?.data as { status: string; cancelReason: string | null };
  assert.equal(view.status, "CANCELLED");
  assert.equal(view.cancelReason, reason);

  // Already cancelled → 409.
  const again = await api(`/api/admin/reservations/${id}/cancel`, {
    method: "POST",
    token: tokenA,
    body: {},
  });
  assert.equal(again.status, 409, JSON.stringify(again.body));
});

// ============================================================
// CONCURRENCY — exactly one winner over HTTP
// ============================================================

test("A16 concurrent identical public creates → exactly one 201, rest 409", async () => {
  const requests = Array.from({ length: 5 }, () =>
    api("/api/public/reservations", {
      method: "POST",
      body: publicCreate({
        tableId: tMain,
        reservationDate: DAY_CONFLICT,
        guestPhone: apiPhone(),
      }),
    })
  );
  const results = await Promise.all(requests);

  const created = results.filter((r) => r.status === 201);
  const conflicted = results.filter((r) => r.status === 409);
  assert.equal(created.length, 1, `expected exactly one winner, got ${results.map((r) => r.status).join(",")}`);
  assert.equal(conflicted.length, 4, `expected four 409s, got ${results.map((r) => r.status).join(",")}`);
});