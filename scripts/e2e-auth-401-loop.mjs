// E2E: AUTH 401 REDIRECT LOOP regression.
//
// Reproduces the stale-session root cause:
//   valid JWT whose `sub` points to a user that no longer exists
//   -> middleware lets /admin/dashboard through
//   -> dashboard APIs 401
//   -> the axios interceptor must clear the Auth.js session cookie ONCE and
//      navigate to /login ONCE — never a 307 bounce back to /admin/dashboard.
//
// Phases:
//   A. Baseline: throwaway admin logs in, dashboard APIs 200.
//   B. Stale session: throwaway user deleted from DB, dashboard reloaded with
//      the still-valid JWT -> 401s -> ONE signout -> ONE /login, then a 40s
//      observation window with zero repeated navigations.
//   C. Normal-login regression: seeded admin stays on the dashboard 30s with
//      APIs 200 and the realtime stream connected, no redirect/signout.
//   D. Simultaneous 401s: /api/auth/session + /orders/dashboard/stats +
//      /orders fail together but only ONE signout POST and ONE /login load.
//   E. Customer/public flow: /menu loads with no session and never redirects.
//
// Requires: dev server on http://localhost:3000, MySQL reachable, seeded DB.
import puppeteer from "puppeteer-core";
import { createConnection } from "mysql2/promise";
import bcrypt from "bcryptjs";
import "dotenv/config";
import fs from "fs";

const BASE = process.env.BASE || "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 10000, step = 150) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------
// DB
// ---------------------------------------------------------------
const dbUrl = new URL(
  process.env.DATABASE_URL || "mysql://root:password@localhost:3306/restaurant_app"
);
const conn = await createConnection({
  host: dbUrl.hostname,
  port: parseInt(dbUrl.port || "3306", 10),
  user: dbUrl.username,
  password: dbUrl.password,
  database: dbUrl.pathname.replace("/", ""),
});

// Chrome
const CHROME =
  process.env.CHROME_PATH ||
  [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((p) => fs.existsSync(p));

// cuid-compatible id (fits the varchar(25) PK like Prisma's cuid()).
function cuidish() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 25);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

// ---------------------------------------------------------------
// Instrumented page
// ---------------------------------------------------------------
const DASHBOARD_APIS = [
  "/api/auth/session",
  "/api/orders/dashboard/stats",
  "/api/orders",
];

function instrument(page) {
  const s = { nav: {}, docStatus: {}, apiStatus: {}, signoutPosts: 0, csrfGets: 0 };
  page.on("response", (res) => {
    const u = new URL(res.url());
    if (res.request().resourceType() === "document") {
      s.nav[u.pathname] = (s.nav[u.pathname] || 0) + 1;
      s.docStatus[u.pathname] = res.status();
    }
    if (DASHBOARD_APIS.includes(u.pathname)) {
      (s.apiStatus[u.pathname] = s.apiStatus[u.pathname] || []).push(res.status());
    }
  });
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.pathname === "/api/auth/signout" && req.method() === "POST") s.signoutPosts += 1;
    if (u.pathname === "/api/auth/csrf") s.csrfGets += 1;
  });
  return s;
}

// ---------------------------------------------------------------
// Phase A — baseline: throwaway admin reaches a healthy dashboard
// ---------------------------------------------------------------
const uid = cuidish();
const email = `e2e-stale-${Date.now()}@restobahagia.com`;
const password = "StalePass123!";
const hash = await bcrypt.hash(password, 10);
const [[restaurant]] = await conn.query(
  "SELECT id FROM restaurant ORDER BY createdAt LIMIT 1"
);
await conn.query(
  "INSERT INTO user (id, restaurantId, name, email, password, role, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 'ADMIN', 1, NOW(), NOW())",
  [uid, restaurant.id, "Stale Test", email, hash]
);
console.log("Setup: throwaway admin created (will be deleted to simulate the stale session)");

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const stats = instrument(page);
const browserLog = [];
page.on("console", (m) => browserLog.push(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => browserLog.push(`[pageerror] ${e.message}`));

async function loginAs(page, userEmail, userPassword, waitMs = 20000) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await waitFor(() => page.$("#email"));
  await sleep(400); // let hydration wire up the submit handler
  await page.type("#email", userEmail);
  await page.type("#password", userPassword);
  await sleep(300);
  await page.click("button[type=submit]");
  return waitFor(() => page.url().includes("/admin/dashboard"), waitMs);
}

await loginAs(page, email, password);
await sleep(2500); // let the dashboard APIs settle
check(
  "A. Baseline: throwaway admin reaches /admin/dashboard",
  page.url().includes("/admin/dashboard"),
  page.url()
);
const baseline200 =
  (stats.apiStatus["/api/auth/session"] || []).includes(200) &&
  (stats.apiStatus["/api/orders/dashboard/stats"] || []).includes(200) &&
  (stats.apiStatus["/api/orders"] || []).includes(200);
check("A2. Baseline: dashboard APIs 200", baseline200, JSON.stringify(stats.apiStatus));
check("A3. Baseline: no signout triggered", stats.signoutPosts === 0, `posts=${stats.signoutPosts}`);

// ---------------------------------------------------------------
// Phase B — stale session: user deleted, valid JWT remains
// ---------------------------------------------------------------
await conn.query("DELETE FROM user WHERE id = ?", [uid]);
console.log("Stale: throwaway user deleted from DB — cookie still holds a valid JWT");

// Reset counters for the stale phase.
stats.nav = {};
stats.docStatus = {};
stats.apiStatus = {};
stats.signoutPosts = 0;
stats.csrfGets = 0;

await page
  .goto(`${BASE}/admin/dashboard`, { waitUntil: "domcontentloaded", timeout: 15000 })
  .catch(() => {});
await waitFor(() => page.url().includes("/login"), 15000);
check("B1. Stale session lands on /login", page.url().startsWith(`${BASE}/login`), page.url());
check("B2. /login renders the login form", !!(await page.$("#email")));
check("B3. Dashboard APIs 401'd (stale JWT -> missing user)", JSON.stringify(stats.apiStatus).includes("401") &&
  (stats.apiStatus["/api/auth/session"] || []).includes(401) &&
  (stats.apiStatus["/api/orders/dashboard/stats"] || []).includes(401) &&
  (stats.apiStatus["/api/orders"] || []).includes(401), JSON.stringify(stats.apiStatus));
check("B4. /login served 200 (no 307 bounce)", stats.docStatus["/login"] === 200, `status=${stats.docStatus["/login"]}`);
check("B5. Exactly ONE signout POST (simultaneous 401s collapse)", stats.signoutPosts === 1, `posts=${stats.signoutPosts}`);

// Observe 40s: zero repeated navigations.
const navSnapshot = { ...stats.nav };
await sleep(40000);
check("B6. Exactly ONE /admin/dashboard document load", stats.nav["/admin/dashboard"] === 1, `nav=${stats.nav["/admin/dashboard"]}`);
check("B7. Exactly ONE /login document load", stats.nav["/login"] === 1, `nav=${stats.nav["/login"]}`);
check("B8. No repeated dashboard/login loads in 40s", JSON.stringify(stats.nav) === JSON.stringify(navSnapshot), JSON.stringify(stats.nav));
check("B9. Still on /login after observation", page.url().startsWith(`${BASE}/login`), page.url());
await page.close();

// ---------------------------------------------------------------
// Phase C — normal login regression (seeded admin)
// ---------------------------------------------------------------
const page2 = await browser.newPage();
await page2.setViewport({ width: 1280, height: 900 });
const stats2 = instrument(page2);

await loginAs(page2, "admin@restobahagia.com", "admin123");
await sleep(2500);
check("C. Regression: seeded admin reaches /admin/dashboard", page2.url().includes("/admin/dashboard"), page2.url());
// Snapshot navigations after the login visit; a redirect loop would add more.
const navAfterLogin = { ...stats2.nav };
const reg200 =
  (stats2.apiStatus["/api/auth/session"] || []).includes(200) &&
  (stats2.apiStatus["/api/orders/dashboard/stats"] || []).includes(200) &&
  (stats2.apiStatus["/api/orders"] || []).includes(200);
check("C2. Regression: dashboard APIs 200", reg200, JSON.stringify(stats2.apiStatus));
const realtimeOk = await waitFor(
  () => page2.evaluate(() => document.body.innerText.includes("Realtime Connected")),
  15000
);
check("C3. Regression: realtime stream connected", !!realtimeOk);

await sleep(30000);
check("C4. Regression: still on dashboard after 30s (no redirect)", page2.url().includes("/admin/dashboard"), page2.url());
check("C5. Regression: no signout triggered", stats2.signoutPosts === 0, `posts=${stats2.signoutPosts}`);
check("C6. Regression: no extra /login or /admin/dashboard navigations",
  JSON.stringify(stats2.nav) === JSON.stringify(navAfterLogin),
  JSON.stringify(stats2.nav));
await page2.close();

// ---------------------------------------------------------------
// Phase E — customer/public flow unaffected (no session at all)
// ---------------------------------------------------------------
const page3 = await browser.newPage();
await page3.setViewport({ width: 1280, height: 900 });
const stats3 = instrument(page3);

await page3.goto(`${BASE}/menu`, { waitUntil: "domcontentloaded" });
await sleep(2500);
const menuOk = await page3.evaluate(() => document.querySelectorAll("h3").length);
check("E. Customer /menu renders without a session", menuOk > 0, `h3=${menuOk}`);
check("E2. Customer stays on /menu (no /login redirect)", page3.url().includes("/menu"), page3.url());
check("E3. Customer flow: no signout triggered", stats3.signoutPosts === 0, `posts=${stats3.signoutPosts}`);

if (failures > 0) console.log("\nBrowser diagnostics:\n" + browserLog.slice(-30).join("\n"));
await page3.close();

// ---------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------
await conn.query("DELETE FROM user WHERE id = ?", [uid]).catch(() => {});
await browser.close();
await conn.end();

console.log(failures === 0 ? "\nALL PASS ✅" : `\n${failures} FAILURE(S) ❌`);
process.exit(failures === 0 ? 0 : 1);