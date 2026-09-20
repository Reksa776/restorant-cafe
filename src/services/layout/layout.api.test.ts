import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// ============================================================
// PHASE 3 — FLOOR LAYOUT HTTP API TESTS (route layer, REAL server)
//
// The admin routes call `auth()` (NextAuth), which needs the real Next
// request context — they CANNOT be invoked directly under tsx. So this suite
// bootstraps a REAL `next dev` server on an ephemeral port (same harness as
// reservation.api.test.ts), signs in with real fixture staff over HTTP and
// drives /api/admin/branches/:branchId/layout + /api/public/branches/:code/layout
// against the real local database.
//
// Run with: npx tsx --test src/services/layout/layout.api.test.ts
// ============================================================

const ROOT = path.resolve(__dirname, "../../..");

// ---- HTTP api helper ---------------
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

// ---- fixture ids ---------------
let restA = "";
let restB = "";
let MAIN = "";
let ALT = "";
let PUB = "";
let B2 = "";
let tMain1 = "";
let tAlt = "";
let tPubAct = "";
let tPubInact = "";
let tB = "";

let emailA = "";
let emailB = "";
let emailC = "";
let pwA = "";
let pwB = "";
let pwC = "";
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
  const parts = session
    .split("; ")
    .filter((c) => c.startsWith("authjs.session-token="));
  if (parts.length === 0) {
    throw new Error(`login failed for ${email} (HTTP ${loginRes.status})`);
  }
  return parts.join("; ");
}

// ---- payload builders + assertions ---------------
function layoutItem(tableId: string, overrides: Record<string, unknown> = {}) {
  return {
    tableId,
    x: 100,
    y: 100,
    width: 120,
    height: 80,
    rotation: 0,
    shape: "RECTANGLE",
    ...overrides,
  };
}

const ITEM_KEYS = [
  "tableId",
  "number",
  "name",
  "capacity",
  "shape",
  "x",
  "y",
  "width",
  "height",
  "rotation",
].sort();

const ADMIN_TOP_KEYS = ["branchId", "version", "canvas", "items"].sort();

function assertKeysExactly(obj: Record<string, unknown>, keys: string[]) {
  assert.deepEqual(Object.keys(obj).sort(), keys);
}

function assertCleanLayoutPayload(
  body: Record<string, unknown> | null,
  opts: { branchCode?: string } = {}
) {
  assert.ok(body, "expected a data payload");
  const dto = body.data as Record<string, unknown>;
  const expected = opts.branchCode
    ? [...ADMIN_TOP_KEYS, "branchCode"].sort()
    : ADMIN_TOP_KEYS;
  assertKeysExactly(dto, expected);
  assert.deepEqual(dto.canvas, { width: 900, height: 600 });
  assert.equal(typeof dto.version, "number");
  const items = dto.items as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(items));
  for (const item of items) {
    assertKeysExactly(item, ITEM_KEYS);
  }
  return { dto, items };
}

// ============================================================
// Fixtures
// ============================================================
async function seedFixtures(): Promise<void> {
  const tag = `LAYAPI${Date.now()}`;
  pwA = `A-pw-${Math.random().toString(36).slice(2, 10)}`;
  pwB = `B-pw-${Math.random().toString(36).slice(2, 10)}`;
  pwC = `C-pw-${Math.random().toString(36).slice(2, 10)}`;

  const [ra, rb] = await Promise.all([
    prisma.restaurant.create({ data: { name: `QA Layout API A ${tag}` } }),
    prisma.restaurant.create({ data: { name: `QA Layout API B ${tag}` } }),
  ]);
  restA = ra.id;
  restB = rb.id;

  const [bMain, bAlt, bInact, bPub, bB] = await Promise.all([
    prisma.branch.create({
      data: { restaurantId: restA, code: "LAY-MAIN", name: "Layout Main" },
    }),
    prisma.branch.create({
      data: { restaurantId: restA, code: "LAY-ALT", name: "Layout Alt" },
    }),
    prisma.branch.create({
      data: {
        restaurantId: restA,
        code: "LAY-INACT",
        name: "Layout Inactive",
        isActive: false,
      },
    }),
    prisma.branch.create({
      data: { restaurantId: restA, code: "LAY-PUB", name: "Layout Public" },
    }),
    prisma.branch.create({
      data: { restaurantId: restB, code: "LAY-B", name: "Layout B" },
    }),
  ]);
  MAIN = bMain.id;
  ALT = bAlt.id;
  void bInact;
  PUB = bPub.id;
  B2 = bB.id;

  const [t1, ta, tpA, tpI] = await Promise.all([
    prisma.table.create({
      data: {
        restaurantId: restA,
        branchId: MAIN,
        number: 9001,
        name: "LAY-MAIN-1",
        capacity: 4,
        isActive: true,
        status: "AVAILABLE",
      },
    }),
    prisma.table.create({
      data: {
        restaurantId: restA,
        branchId: ALT,
        number: 9101,
        name: "LAY-ALT-1",
        capacity: 2,
        isActive: true,
        status: "AVAILABLE",
      },
    }),
    prisma.table.create({
      data: {
        restaurantId: restA,
        branchId: PUB,
        number: 9201,
        name: "LAY-PUB-ACT",
        capacity: 4,
        isActive: true,
        status: "AVAILABLE",
      },
    }),
    prisma.table.create({
      data: {
        restaurantId: restA,
        branchId: PUB,
        number: 9202,
        name: "LAY-PUB-INACT",
        capacity: 4,
        isActive: true,
        status: "AVAILABLE",
      },
    }),
  ]);
  tMain1 = t1.id;
  tAlt = ta.id;
  tPubAct = tpA.id;
  tPubInact = tpI.id;

  tB = (
    await prisma.table.create({
      data: {
        restaurantId: restB,
        branchId: B2,
        number: 9301,
        name: "LAY-B-1",
        capacity: 4,
        isActive: true,
        status: "AVAILABLE",
      },
    })
  ).id;

  const hashedA = await bcrypt.hash(pwA, 10);
  const hashedB = await bcrypt.hash(pwB, 10);
  const hashedC = await bcrypt.hash(pwC, 10);

  emailA = `${tag}-a@layout.test`;
  const ua = await prisma.user.create({
    data: {
      restaurantId: restA,
      name: "Layout Admin A",
      email: emailA,
      password: hashedA,
      role: "ADMIN",
      isActive: true,
      sessionVersion: 0,
    },
  });
  emailB = `${tag}-b@layout.test`;
  await prisma.user.create({
    data: {
      restaurantId: restB,
      name: "Layout Admin B",
      email: emailB,
      password: hashedB,
      role: "ADMIN",
      isActive: true,
      sessionVersion: 0,
    },
  });
  emailC = `${tag}-c@layout.test`;
  const uc = await prisma.user.create({
    data: {
      restaurantId: restA,
      name: "Layout Kasir C",
      email: emailC,
      password: hashedC,
      role: "CASHIER",
      isActive: true,
      sessionVersion: 0,
    },
  });
  await prisma.userBranch.create({ data: { userId: uc.id, branchId: ALT } });
  void ua;

  // Seed the public-filter branch: place BOTH tables, then deactivate one so
  // the admin view keeps it but the public floor map must hide it.
  await prisma.tableLayout.create({
    data: {
      restaurantId: restA,
      branchId: PUB,
      version: 2,
      items: {
        create: [
          {
            tableId: tPubAct,
            x: 50,
            y: 50,
            width: 120,
            height: 80,
            rotation: 90,
            shape: "RECTANGLE",
          },
          {
            tableId: tPubInact,
            x: 200,
            y: 50,
            width: 120,
            height: 80,
            rotation: 0,
            shape: "CIRCLE",
          },
        ],
      },
    },
  });
  await prisma.table.update({
    where: { id: tPubInact },
    data: { isActive: false },
  });
}

async function teardownFixtures(): Promise<void> {
  const ids = [restA, restB].filter(Boolean);
  if (ids.length === 0) return;
  await prisma.tableLayout.deleteMany({
    where: { restaurantId: { in: ids } },
  });
  await prisma.table.deleteMany({
    where: { restaurantId: { in: ids } },
  });
  await prisma.userBranch.deleteMany({ where: { user: { restaurantId: { in: ids } } } });
  await prisma.user.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.branch.deleteMany({
    where: { restaurantId: { in: ids } },
  });
  await prisma.restaurant.deleteMany({ where: { id: { in: ids } } });
}

before(async () => {
  await seedFixtures();
  await startServer();
  tokenA = await login(emailA, pwA);
  tokenB = await login(emailB, pwB);
  tokenC = await login(emailC, pwC);
});

after(async () => {
  await stopServer();
  await teardownFixtures();
  await prisma.$disconnect();
});

// ============================================================
// ADMIN ROUTES — happy path
// ============================================================

test("1. ADMIN GET own branch layout (empty branch → version 1, no 404)", async () => {
  const res = await api(`/api/admin/branches/${MAIN}/layout`, { token: tokenA });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { dto, items } = assertCleanLayoutPayload(res.body);
  assert.equal(dto.branchId, MAIN);
  assert.equal(dto.version, 1);
  assert.deepEqual(items, []);
});

test("2. ADMIN PUT own branch layout (creates row, bumps version, returns items)", async () => {
  const res = await api(`/api/admin/branches/${MAIN}/layout`, {
    method: "PUT",
    token: tokenA,
    body: { version: 1, items: [layoutItem(tMain1)] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { dto, items } = assertCleanLayoutPayload(res.body);
  assert.equal(dto.version, 2);
  assert.equal(items.length, 1);
  assert.equal(items[0].tableId, tMain1);
  assert.equal(items[0].number, 9001);
  assert.equal(items[0].name, "LAY-MAIN-1");
  assert.equal(items[0].capacity, 4);
  assert.equal(items[0].shape, "RECTANGLE");
  assert.equal(items[0].x, 100);
});

test("3. ADMIN GET reflects the saved layout", async () => {
  const res = await api(`/api/admin/branches/${MAIN}/layout`, { token: tokenA });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { dto, items } = assertCleanLayoutPayload(res.body);
  assert.equal(dto.version, 2);
  assert.equal(items.length, 1);
  assert.equal(items[0].tableId, tMain1);
});

test("4. CASHIER GET assigned branch → 200", async () => {
  const res = await api(`/api/admin/branches/${ALT}/layout`, { token: tokenC });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { dto } = assertCleanLayoutPayload(res.body);
  assert.equal(dto.branchId, ALT);
  assert.equal(dto.version, 1);
});

test("5. CASHIER PUT assigned branch → 200", async () => {
  const res = await api(`/api/admin/branches/${ALT}/layout`, {
    method: "PUT",
    token: tokenC,
    body: { version: 1, items: [layoutItem(tAlt)] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { dto, items } = assertCleanLayoutPayload(res.body);
  assert.equal(dto.version, 2);
  assert.equal(items[0].tableId, tAlt);
});

test("6. CASHIER cannot GET another branch → 403", async () => {
  const res = await api(`/api/admin/branches/${MAIN}/layout`, { token: tokenC });
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body?.error, "FORBIDDEN");
  assert.equal(res.body?.success, false);
});

test("7. CASHIER cannot PUT another branch → 403", async () => {
  const res = await api(`/api/admin/branches/${MAIN}/layout`, {
    method: "PUT",
    token: tokenC,
    body: { version: 2, items: [layoutItem(tMain1)] },
  });
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body?.error, "FORBIDDEN");
});

test("8. unauthenticated admin API → 401 (GET and PUT)", async () => {
  const get = await api(`/api/admin/branches/${MAIN}/layout`);
  assert.equal(get.status, 401, JSON.stringify(get.body));
  assert.equal(get.body?.error, "UNAUTHORIZED");

  const put = await api(`/api/admin/branches/${MAIN}/layout`, {
    method: "PUT",
    body: { version: 1, items: [] },
  });
  assert.equal(put.status, 401, JSON.stringify(put.body));
});

test("9. invalid payload → 400 VALIDATION_ERROR", async () => {
  const res = await api(`/api/admin/branches/${MAIN}/layout`, {
    method: "PUT",
    token: tokenA,
    body: { items: "not-an-array" },
  });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body?.error, "VALIDATION_ERROR");
  assert.equal(res.body?.success, false);
});

test("10. version conflict → 409 CONFLICT, layout unchanged", async () => {
  const res = await api(`/api/admin/branches/${MAIN}/layout`, {
    method: "PUT",
    token: tokenA,
    body: { version: 99, items: [layoutItem(tMain1)] },
  });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body?.error, "CONFLICT");

  const after = await api(`/api/admin/branches/${MAIN}/layout`, { token: tokenA });
  const { dto } = assertCleanLayoutPayload(after.body);
  assert.equal(dto.version, 2);
});

test("11. foreign tableId (another restaurant) → 404, layout unchanged", async () => {
  const res = await api(`/api/admin/branches/${MAIN}/layout`, {
    method: "PUT",
    token: tokenA,
    body: { version: 2, items: [layoutItem(tB)] },
  });
  assert.equal(res.status, 404, JSON.stringify(res.body));
  assert.equal(res.body?.error, "NOT_FOUND");

  const after = await api(`/api/admin/branches/${MAIN}/layout`, { token: tokenA });
  const { dto } = assertCleanLayoutPayload(after.body);
  assert.equal(dto.version, 2);
  assert.equal((dto.items as unknown[]).length, 1);
});

test("12. cross-branch tableId → 403 FORBIDDEN, layout unchanged", async () => {
  const res = await api(`/api/admin/branches/${MAIN}/layout`, {
    method: "PUT",
    token: tokenA,
    body: { version: 2, items: [layoutItem(tAlt)] },
  });
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body?.error, "FORBIDDEN");

  const after = await api(`/api/admin/branches/${MAIN}/layout`, { token: tokenA });
  const { dto } = assertCleanLayoutPayload(after.body);
  assert.equal(dto.version, 2);
  assert.equal((dto.items as unknown[]).length, 1);
});

test("13. restaurant isolation — another restaurant's admin cannot read/write → 403", async () => {
  const get = await api(`/api/admin/branches/${MAIN}/layout`, { token: tokenB });
  assert.equal(get.status, 403, JSON.stringify(get.body));
  assert.equal(get.body?.error, "FORBIDDEN");

  const put = await api(`/api/admin/branches/${MAIN}/layout`, {
    method: "PUT",
    token: tokenB,
    body: { version: 2, items: [layoutItem(tMain1)] },
  });
  assert.equal(put.status, 403, JSON.stringify(put.body));
});

// ============================================================
// PUBLIC ROUTES
// ============================================================

test("14. public GET — valid active branchCode returns the floor map", async () => {
  const res = await api(`/api/public/branches/LAY-MAIN/layout`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { dto, items } = assertCleanLayoutPayload(res.body, { branchCode: "LAY-MAIN" });
  assert.equal(dto.branchCode, "LAY-MAIN");
  assert.equal(dto.branchId, MAIN);
  assert.equal(dto.version, 2);
  assert.equal(items.length, 1);
  assert.equal(items[0].tableId, tMain1);
});

test("15. public GET — unknown branchCode → 404", async () => {
  const res = await api(`/api/public/branches/LAY-NOPE/layout`);
  assert.equal(res.status, 404, JSON.stringify(res.body));
  assert.equal(res.body?.error, "NOT_FOUND");
  assert.equal(res.body?.success, false);
});

test("16. public GET — inactive branch → rejected (404)", async () => {
  const res = await api(`/api/public/branches/LAY-INACT/layout`);
  assert.equal(res.status, 404, JSON.stringify(res.body));
  assert.equal(res.body?.error, "NOT_FOUND");
});

test("17. public route is read-only — non-GET → 405", async () => {
  const put = await api(`/api/public/branches/LAY-MAIN/layout`, {
    method: "PUT",
    body: { version: 1, items: [] },
  });
  assert.equal(put.status, 405);

  const post = await api(`/api/public/branches/LAY-MAIN/layout`, {
    method: "POST",
    body: {},
  });
  assert.equal(post.status, 405);

  const del = await api(`/api/public/branches/LAY-MAIN/layout`, {
    method: "DELETE",
  });
  assert.equal(del.status, 405);
});

test("18. public GET — placed-but-deactivated tables are hidden", async () => {
  // Admin view keeps the deactivated table (source of truth for staff).
  const admin = await api(`/api/admin/branches/${PUB}/layout`, { token: tokenA });
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  const adminItems = (admin.body?.data as { items: Array<{ tableId: string }> }).items;
  assert.equal(adminItems.length, 2);

  // Public floor map must only advertise ACTIVE tables.
  const pub = await api(`/api/public/branches/LAY-PUB/layout`);
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const { dto, items } = assertCleanLayoutPayload(pub.body, { branchCode: "LAY-PUB" });
  assert.equal(dto.version, 2);
  assert.equal(items.length, 1);
  assert.equal(items[0].tableId, tPubAct);
});

test("19. public GET — no restaurantId / layoutId leakage", async () => {
  const res = await api(`/api/public/branches/LAY-PUB/layout`);
  assert.equal(res.status, 200);
  const raw = JSON.stringify(res.body);
  assert.equal(raw.includes("restaurantId"), false, "restaurantId must not leak");
  assert.equal(raw.includes("layoutId"), false, "layoutId must not leak");
  assert.equal(raw.includes("createdAt"), false, "audit timestamp must not leak");
  assert.equal(raw.includes("updatedAt"), false, "audit timestamp must not leak");
  assert.equal(raw.includes("isActive"), false, "isActive must not leak");
  assert.equal(raw.includes("status"), false, "Table.status must not leak");
});

test("20. public GET — no customer / order / payment data leakage", async () => {
  const res = await api(`/api/public/branches/LAY-MAIN/layout`);
  assert.equal(res.status, 200);
  const raw = JSON.stringify(res.body);
  for (const needle of [
    "customerId",
    "orderId",
    "paymentId",
    "guestPhone",
    "qrCode",
    "provider",
    "password",
  ]) {
    assert.equal(raw.includes(needle), false, `"${needle}" must not leak`);
  }
});