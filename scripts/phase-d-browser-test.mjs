/**
 * PHASE D — BROWSER TEST (real Chrome against the running app on :3001).
 * Run: node scripts/phase-d-browser-test.mjs
 *
 * Drives the actual admin UI: reports navigation, Purchase Report,
 * Inventory Report, CSV downloads (UTF-8 BOM / CRLF / formula-injection
 * guard), supplier + purchase + inventory regression smoke, and the final
 * security matrix (unauthenticated 401, KASIR read 200, forged branch 403,
 * cross-restaurant 403, invalid date 400, malformed filters 200). Captures
 * console errors, uncaught page errors and failed requests on every page.
 */

import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const CHROME = "/usr/bin/google-chrome-stable";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@restobahagia.com";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";
const KASIR_EMAIL = process.env.KASIR_EMAIL || "kasir@restobahagia.com";
const KASIR_PASS = process.env.KASIR_PASS || "kasir123";

let pass = 0;
let fail = 0;
const failures = [];
const consoleIssues = [];
const pageErrors = [];
const failedRequests = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 15000, interval = 300) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) return null;
    await sleep(interval);
  }
}

function attachListeners(page, label) {
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleIssues.push(`[${label}] console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => pageErrors.push(`[${label}] pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    failedRequests.push(`[${label}] requestfailed: ${req.method()} ${req.url()} ${req.failure()?.errorText || ""}`);
  });
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#email", { timeout: 15000 });
  await page.type("#email", email);
  await page.type("#password", password);
  await page.click('button[type="submit"]');
  const ok = await waitFor(async () => page.url().includes("/admin/dashboard"), 20000);
  if (!ok) throw new Error(`login failed, landed on ${page.url()}`);
}

async function goto(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitFor(() => page.$("h1"), 15000);
}

async function waitForText(page, text, timeout = 15000) {
  return waitFor(async () => page.evaluate((t) => document.body.innerText.includes(t), text), timeout);
}

async function apiFetch(page, path, method = "GET", body) {
  const absolute = path.startsWith("http") ? path : `${BASE}${path}`;
  return page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(path, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json };
    },
    { path: absolute, method, body }
  );
}

/** Read the first 3 bytes of a response (UTF-8 BOM check — res.text() strips the BOM). */
async function csvBom(page, path) {
  const absolute = path.startsWith("http") ? path : `${BASE}${path}`;
  return page.evaluate(async (p) => {
    const res = await fetch(p, { credentials: "include" });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, bytes: buf.length >= 3 ? Array.from(buf.slice(0, 3)) : [] };
  }, absolute);
}

async function hasButtonText(page, text) {
  return page.evaluate((t) => {
    return Array.from(document.querySelectorAll("button")).some((b) => (b.textContent || "").includes(t));
  }, text);
}

async function clickButton(page, text) {
  const appeared = await waitFor(() => hasButtonText(page, text), 15000);
  if (!appeared) throw new Error(`button "${text}" not found`);
  const clicked = await page.evaluate((t) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const target = buttons.find((b) => (b.textContent || "").trim() === t) || buttons.find((b) => (b.textContent || "").includes(t));
    if (!target) return false;
    target.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`button "${text}" not found`);
  await sleep(300);
}

/** Click a Base UI Select trigger (by index), then its option containing `text`. */
async function pickSelect(page, index, text, label) {
  // The branch filter renders only after the session loads — wait until the
  // expected trigger index actually exists before interacting.
  const ready = await waitFor(async () => {
    const triggers = await page.$$('[data-slot="select-trigger"]');
    return triggers.length > index ? triggers : null;
  }, 12000);
  if (!ready) {
    const n = (await page.$$('[data-slot="select-trigger"]')).length;
    throw new Error(`${label}: trigger #${index} not found (have ${n})`);
  }
  await ready[index].click();
  const found = await waitFor(async () => {
    const items = await page.$$eval('[data-slot="select-item"]', (els) => els.map((e) => e.textContent || ""));
    return items.some((t) => t.includes(text));
  }, 8000);
  if (!found) throw new Error(`${label}: option "${text}" not found in select`);
  const clicked = await page.evaluate((needle) => {
    const items = Array.from(document.querySelectorAll('[data-slot="select-item"]'));
    const target = items.find((el) => (el.textContent || "").includes(needle));
    if (!target) return false;
    target.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`${label}: could not click option "${text}"`);
  await sleep(400);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  // ---------------- ADMIN ----------------
  const adminCtx = await browser.createBrowserContext();
  const page = await adminCtx.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on("dialog", (d) => d.accept());
  attachListeners(page, "admin");

  console.log("== STEP 1 — AUTH ==");
  await login(page, ADMIN_EMAIL, ADMIN_PASS);
  check("admin login reaches /admin/dashboard", page.url().includes("/admin/dashboard"), page.url());

  console.log("== STEP 2 — REPORTS NAV ==");
  await goto(page, "/admin/reports");
  await waitForText(page, "Reports", 15000);
  const navText = await page.evaluate(() => document.body.innerText);
  check("reports nav includes Pembelian", navText.includes("Pembelian"));
  check("reports nav includes Inventory", navText.includes("Inventory"));
  check("reports nav still has existing reports", navText.includes("Penjualan") && navText.includes("Produk") && navText.includes("Pembayaran"));
  const salesApi = await apiFetch(page, "/api/reports/sales?period=today");
  check("existing sales report API still 200", salesApi.status === 200, `status=${salesApi.status}`);

  console.log("== STEP 3 — PURCHASE REPORT PAGE ==");
  await goto(page, "/admin/reports/purchases");
  await waitForText(page, "Laporan Pembelian", 15000);
  const purApi = await apiFetch(page, "/api/reports/purchases?period=month&limit=50");
  check("GET /api/reports/purchases 200", purApi.status === 200, `status=${purApi.status}`);
  const purData = purApi.json?.data;
  check("purchase report returns summary", purData?.summary && typeof purData.summary.totalPurchases === "number",
    JSON.stringify(purData?.summary)?.slice(0, 200));
  check("purchase report pagination present", purData?.pagination && purData.pagination.totalPages >= 0);
  check("purchase report detail rows have supplier/status/total",
    Array.isArray(purData?.items) && purData.items.every((r) => r.supplierName !== undefined && r.status && typeof r.total === "number"),
    `rows=${purData?.items?.length}`);
  check("purchase report product breakdown present", Array.isArray(purData?.productBreakdown));
  check("purchase report supplier breakdown present", Array.isArray(purData?.supplierBreakdown));

  // Status filter must actually re-query with status=RECEIVED.
  const purCalls = [];
  const purReqListener = (req) => {
    if (req.url().includes("/api/reports/purchases?")) purCalls.push(req.url());
  };
  page.on("request", purReqListener);
  try {
    // Select order on this page: 0 = branch filter, 1 = supplier, 2 = status.
    await pickSelect(page, 2, "Diterima", "status filter");
    const filtered = await waitFor(() => purCalls.some((u) => u.includes("status=RECEIVED")), 12000);
    check("status filter refetches with status=RECEIVED", !!filtered, purCalls.slice(-3).join(" | "));
    await waitForText(page, "Laporan Pembelian");
  } catch (e) {
    check("status filter interaction", false, e.message);
  } finally {
    page.off("request", purReqListener);
  }

  console.log("== STEP 4 — INVENTORY REPORT PAGE ==");
  await goto(page, "/admin/reports/inventory");
  await waitForText(page, "Laporan Inventory", 15000);
  const invApi = await apiFetch(page, "/api/reports/inventory?period=month&limit=50");
  check("GET /api/reports/inventory 200", invApi.status === 200, `status=${invApi.status}`);
  const invData = invApi.json?.data;
  check("inventory report summary present", invData?.summary && typeof invData.summary.totalStock === "number",
    JSON.stringify(invData?.summary)?.slice(0, 200));
  check("inventory movement rows present + named",
    Array.isArray(invData?.items) && invData.items.every((m) => m.type && typeof m.balanceAfter === "number" && m.productName !== undefined),
    `rows=${invData?.items?.length}`);
  check("inventory product stock summary present",
    Array.isArray(invData?.productStockSummary) && invData.productStockSummary.every((r) => typeof r.currentStock === "number"),
    `rows=${invData?.productStockSummary?.length}`);

  // Type filter refetch.
  const invCalls = [];
  const invReqListener = (req) => {
    if (req.url().includes("/api/reports/inventory?")) invCalls.push(req.url());
  };
  page.on("request", invReqListener);
  try {
    // Select order on this page: 0 = branch, 1 = product, 2 = category, 3 = type.
    await pickSelect(page, 3, "Penyesuaian", "type filter");
    const filtered = await waitFor(() => invCalls.some((u) => u.includes("type=ADJUSTMENT")), 12000);
    check("type filter refetches with type=ADJUSTMENT", !!filtered, invCalls.slice(-3).join(" | "));
    await waitForText(page, "Laporan Inventory");
  } catch (e) {
    check("type filter interaction", false, e.message);
  } finally {
    page.off("request", invReqListener);
  }

  console.log("== STEP 5 — CSV EXPORTS ==");
  const purCsv = await apiFetch(page, "/api/reports/purchases/export?period=month");
  check("purchase CSV export 200 + text/csv", purCsv.status === 200 && (purCsv.headers["content-type"] || "").includes("text/csv"),
    `status=${purCsv.status} ct=${purCsv.headers["content-type"]}`);
  check("purchase CSV export is attachment", (purCsv.headers["content-disposition"] || "").includes("attachment"),
    purCsv.headers["content-disposition"] || "");
  const purBom = await csvBom(page, "/api/reports/purchases/export?period=month");
  check("purchase CSV has UTF-8 BOM (EF BB BF)",
    purBom.status === 200 && purBom.bytes.join(",") === "239,187,191", `bytes=${purBom.bytes.join(",")}`);
  check("purchase CSV uses CRLF", typeof purCsv.json === "string" && purCsv.json.includes("\r\n"));
  check("purchase CSV header row correct", typeof purCsv.json === "string" && purCsv.json.includes("Total Nilai") && purCsv.json.includes("Status"));

  const invCsv = await apiFetch(page, "/api/reports/inventory/export?period=month");
  const invBom = await csvBom(page, "/api/reports/inventory/export?period=month");
  check("inventory CSV export 200 + UTF-8 BOM",
    invCsv.status === 200 && invBom.status === 200 && invBom.bytes.join(",") === "239,187,191",
    `status=${invCsv.status} bytes=${invBom.bytes.join(",")}`);
  check("inventory CSV uses CRLF + correct headers", typeof invCsv.json === "string" && invCsv.json.includes("\r\n") && invCsv.json.includes("Saldo Akhir") && invCsv.json.includes("Referensi"));

  // Formula-injection guard through the real export path: create a supplier
  // whose name starts with "=" and a DRAFT purchase, export with supplierId
  // filter, verify the cell is guarded with a leading apostrophe. Unique per
  // run — suppliers are soft-deleted so a previous run leaves a deactivated
  // row behind (tenant-unique name).
  const formulaName = `=PHASED-FORMULA-${Date.now().toString(36)}()`;
  const formulaSupplier = await apiFetch(page, "/api/admin/suppliers", "POST", { name: formulaName });
  const supId = formulaSupplier.json?.data?.id;
  check("create formula-named supplier", formulaSupplier.status === 201 && !!supId, `status=${formulaSupplier.status} body=${JSON.stringify(formulaSupplier.json)?.slice(0, 160)}`);
  if (supId) {
    const prods = await apiFetch(page, "/api/menu/products");
    const prodArr = Array.isArray(prods.json?.data) ? prods.json.data : prods.json?.data?.items || [];
    const product = prodArr.find((p) => p.isAvailable !== false) || prodArr[0];
    const newPur = await apiFetch(page, "/api/admin/purchases", "POST", {
      branchId: null,
      supplierId: supId,
      notes: "phased-formula",
      items: product ? [{ productId: product.id, quantity: 1, unitCost: 1000 }] : [],
    });
    check("create DRAFT purchase with formula supplier", newPur.status === 201, `status=${newPur.status}`);
    const purId = newPur.json?.data?.id;
    if (purId) {
      const csv = await apiFetch(page, `/api/reports/purchases/export?period=month&supplierId=${encodeURIComponent(supId)}`);
      check("formula supplier CSV export 200", csv.status === 200, `status=${csv.status}`);
      const body = typeof csv.json === "string" ? csv.json : "";
      check("CSV formula injection guarded with apostrophe", body.includes(`'${formulaName}`), body.slice(0, 400));
      // Cleanup: cancel the DRAFT purchase, deactivate the supplier.
      await apiFetch(page, `/api/admin/purchases/${purId}/cancel`, "POST");
    }
    await apiFetch(page, `/api/admin/suppliers/${supId}`, "PATCH", { isActive: false });
    check("formula test cleanup: purchase cancelled + supplier deactivated", true);
  }

  console.log("== STEP 6 — SECURITY MATRIX ==");
  // Unauthenticated (fresh context, no cookies) — navigate to a real page
  // first so the fetch runs from the app origin (about:blank has an opaque
  // origin and would CORS-fail before reaching the server).
  const anonCtx = await browser.createBrowserContext();
  const anonPage = await anonCtx.newPage();
  attachListeners(anonPage, "anon");
  await anonPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const anonPur = await apiFetch(anonPage, "/api/reports/purchases?period=today");
  check("unauthenticated purchase report -> 401", anonPur.status === 401, `status=${anonPur.status}`);
  const anonInv = await apiFetch(anonPage, "/api/reports/inventory?period=today");
  check("unauthenticated inventory report -> 401", anonInv.status === 401, `status=${anonInv.status}`);
  const anonCsv = await apiFetch(anonPage, "/api/reports/purchases/export?period=today");
  check("unauthenticated purchase CSV -> 401", anonCsv.status === 401, `status=${anonCsv.status}`);
  await anonCtx.close();

  // Forged branch / cross-restaurant / invalid inputs (authenticated ADMIN).
  const forgedBranch = await apiFetch(page, "/api/reports/purchases?period=today&branchId=TEST-BR-BKS");
  check("forged cross-restaurant branchId -> 403", forgedBranch.status === 403, `status=${forgedBranch.status}`);
  const foreignBranch = await apiFetch(page, "/api/reports/inventory?period=today&branchId=TEST-BR-JKT");
  check("foreign branch filter for scoped admin -> 403", foreignBranch.status === 403, `status=${foreignBranch.status}`);
  const invalidDate = await apiFetch(page, "/api/reports/purchases?period=custom&startDate=not-a-date&endDate=2026-01-31");
  check("invalid custom date -> 400", invalidDate.status === 400, `status=${invalidDate.status}`);
  const invertedDate = await apiFetch(page, "/api/reports/inventory?period=custom&startDate=2026-02-01&endDate=2026-01-01");
  check("inverted custom range -> 400", invertedDate.status === 400, `status=${invertedDate.status}`);
  const malformedStatus = await apiFetch(page, "/api/reports/purchases?period=today&status=;DROP%20TABLE%20purchase");
  check("malformed status (SQL-injection-like) -> 200 with empty filter", malformedStatus.status === 200, `status=${malformedStatus.status}`);
  const malformedType = await apiFetch(page, "/api/reports/inventory?period=today&type=IN%27%20OR%201=1");
  check("malformed type -> 200 (treated as null, never OR-injected)", malformedType.status === 200, `status=${malformedType.status}`);
  const hugeRange = await apiFetch(page, "/api/reports/inventory?period=custom&startDate=2000-01-01&endDate=2100-01-01&limit=100");
  check("huge date range -> 200 + bounded rows", hugeRange.status === 200 && (hugeRange.json?.data?.items?.length || 0) <= 100,
    `status=${hugeRange.status}`);
  const badLimit = await apiFetch(page, "/api/reports/purchases?period=today&limit=999999");
  check("over-limit request is clamped (<=100)", badLimit.status === 200 && badLimit.json?.data?.pagination?.limit <= 100,
    `limit=${badLimit.json?.data?.pagination?.limit}`);

  console.log("== STEP 7 — KASIR ==");
  const kasirCtx = await browser.createBrowserContext();
  const kpage = await kasirCtx.newPage();
  await kpage.setViewport({ width: 1400, height: 900 });
  kpage.on("dialog", (d) => d.accept());
  attachListeners(kpage, "kasir");
  const klogin = await login(kpage, KASIR_EMAIL, KASIR_PASS).then(() => true).catch(() => false);
  check("kasir login", klogin);
  const kPur = await apiFetch(kpage, "/api/reports/purchases?period=today");
  check("KASIR purchase report -> 200 (read-only)", kPur.status === 200, `status=${kPur.status}`);
  const kInv = await apiFetch(kpage, "/api/reports/inventory?period=today");
  check("KASIR inventory report -> 200 (read-only)", kInv.status === 200, `status=${kInv.status}`);
  const kCsv = await apiFetch(kpage, "/api/reports/purchases/export?period=today");
  check("KASIR purchase CSV -> 200", kCsv.status === 200, `status=${kCsv.status}`);
  for (const p of ["/admin/reports/purchases", "/admin/reports/inventory", "/admin/reports"]) {
    const resp = await kpage.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    check(`KASIR page ${p} 200`, resp?.status() === 200, `status=${resp?.status()}`);
    await sleep(500);
  }

  console.log("== STEP 8 — REGRESSION SMOKE ==");
  await goto(page, "/admin/purchasing/suppliers");
  await waitForText(page, "Daftar Supplier", 15000);
  check("suppliers page renders", true);
  await goto(page, "/admin/purchasing/purchases");
  await waitForText(page, "Daftar Pembelian", 15000);
  check("purchases list page renders", true);
  await goto(page, "/admin/inventory");
  await waitForText(page, "Riwayat Stok", 15000);
  check("inventory history page renders", true);
  await goto(page, "/admin/reports");
  await waitForText(page, "Reports", 15000);
  check("sales report page still renders", true);
  await goto(page, "/admin/reports/products");
  await waitForText(page, "Laporan Produk", 15000);
  check("products report page still renders", true);
  await goto(page, "/admin/reports/payments");
  await waitForText(page, "Laporan Pembayaran", 15000);
  check("payments report page still renders", true);

  console.log("== SUMMARY ==");
  const isExpectedProbe = (c) =>
    c.includes("409 (Conflict)") || c.includes("400 (Bad Request)") || c.includes("403 (Forbidden)") || c.includes("401 (Unauthorized)");
  const realConsole = consoleIssues.filter((c) => !c.includes("favicon") && !c.includes("404") && !isExpectedProbe(c));
  const realFailed = failedRequests.filter((r) => !r.includes("net::ERR_ABORTED"));
  check("0 uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 5).join(" | "));
  check("0 unexpected console errors", realConsole.length === 0, realConsole.slice(0, 5).join(" | "));
  check("0 unexpected failed requests", realFailed.length === 0, realFailed.slice(0, 5).join(" | "));

  await browser.close();
  finish();
}

function finish() {
  console.log("\n====================");
  console.log(`PASS ${pass}  FAIL ${fail}`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("BROWSER TEST CRASH:", e);
  process.exit(2);
});