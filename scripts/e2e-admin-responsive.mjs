// Admin responsive E2E — horizontal-overflow sweep on every admin route at
// 320/360/390/412/768/1024/1280 + functional mobile checks (drawer, dialogs,
// order detail sheet, menu customization) + desktop regression checks.
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const ROUTES = [
  "/admin/dashboard",
  "/admin/orders",
  "/admin/menu",
  "/admin/tables",
  "/admin/customers",
  "/admin/payments",
  "/admin/settings",
  "/admin/whatsapp",
];
const WIDTHS = [320, 360, 390, 412, 768, 1024, 1280];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: 1280, height: 900 },
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

const waitFor = async (fn, timeout = 20000, label = "") => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(250);
  }
  throw new Error(`timeout waiting: ${label}`);
};
const waitText = async (t, timeout = 15000) =>
  waitFor(() => page.evaluate((x) => (document.body.innerText || "").includes(x), t), timeout, `text ${t}`);

// Detect real overflow: ignore anything fully off the left edge (closed drawer).
const measure = () =>
  page.evaluate(() => {
    const iw = window.innerWidth;
    const sw = document.documentElement.scrollWidth;
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right < -5 || r.left > iw + 5) continue; // fully off-screen
      if (r.right > iw + 1 && r.left >= -5) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === "string" ? el.className : "").slice(0, 60),
          txt: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
          left: Math.round(r.left),
          right: Math.round(r.right),
        });
      }
    }
    return { iw, sw, overflow: sw - iw, offenders: offenders.slice(0, 5) };
  });

const visibleBox = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
  }, sel);

// ---------------- Login (390 first, real device size) ----------------
// NOTE: the admin shell holds an open SSE stream, so the page never goes
// network-idle — use domcontentloaded + explicit text waits everywhere.
const gotoAdmin = async (url, token, timeout = 30000) => {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout });
  if (token) await waitText(token, timeout);
};
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await waitFor(() => page.$('input[type="email"]'), 15000, "email input");
let m = await measure();
check("Login page 390: no horizontal overflow", m.overflow === 0, `overflow=${m.overflow}`);
await page.type('input[type="email"]', "admin@restobahagia.com", { delay: 5 });
await page.type('input[type="password"]', "admin123", { delay: 5 });
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Masuk");
  if (btn) btn.click();
});
await waitFor(() => page.url().includes("/admin"), 20000, "login redirect");
check("Admin login works (mobile)", true, page.url());

// ---------------- Mobile shell: top bar + drawer ----------------
await waitText("Dashboard");
const shell = await page.evaluate(() => {
  const topbar = [...document.querySelectorAll("header")].find((h) => h.textContent.includes("Restoran Bahagia"));
  const openBtn = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Buka menu navigasi");
  const side = document.querySelector('aside[aria-label="Menu navigasi admin"]');
  return {
    topbarVisible: !!topbar,
    topbarH: topbar ? topbar.getBoundingClientRect().height : 0,
    openBtnVisible: !!openBtn,
    desktopSidebarHidden: !side || getComputedStyle(side).visibility === "hidden" || side.getBoundingClientRect().left < 0,
    noFixedSidebar: !document.querySelector('aside.hidden.lg\\:block, aside.w-64'),
  };
});
check("Mobile: top bar with hamburger present", shell.topbarVisible && shell.openBtnVisible, `topbarH=${shell.topbarH}`);
check("Mobile: no full-width fixed sidebar", shell.noFixedSidebar || shell.desktopSidebarHidden, "");
check("Mobile: drawer starts off-canvas", shell.desktopSidebarHidden, "");

// Open drawer
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Buka menu navigasi");
  if (b) b.click();
});
await sleep(400);
const drawerOpen = await page.evaluate(() => {
  const d = document.querySelector('aside[aria-label="Menu navigasi admin"]');
  return d && d.getBoundingClientRect().left === 0 && d.getBoundingClientRect().width === 256;
});
check("Drawer opens (256px, left edge 0)", !!drawerOpen, "");
m = await measure();
check("Drawer open: no page overflow", m.overflow === 0, `overflow=${m.overflow}`);

// Navigate via drawer → Orders, drawer closes
await page.evaluate(() => {
  const d = document.querySelector('aside[aria-label="Menu navigasi admin"]');
  const a = [...d.querySelectorAll("a")].find((x) => x.textContent.trim() === "Orders");
  if (a) a.click();
});
await waitFor(() => page.url().includes("/admin/orders"), 15000, "nav to orders");
const drawerClosed = await page.evaluate(() => {
  const d = document.querySelector('aside[aria-label="Menu navigasi admin"]');
  return d.getBoundingClientRect().left < 0;
});
check("Nav item navigates & drawer auto-closes", page.url().includes("/admin/orders") && drawerClosed, page.url());

// ---------------- Orders: cards, actions, detail sheet ----------------
await waitText("Pesanan");
m = await measure();
check("Orders 390: no overflow", m.overflow === 0, `overflow=${m.overflow}`);
const hasCards = await page.evaluate(() => document.querySelectorAll('[data-slot="card"]').length > 0);
check("Orders 390: order cards present", hasCards, "");
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Detail");
  if (btn) btn.click();
});
await waitText("Item Pesanan", 10000);
const sheet = await visibleBox('[data-slot="sheet-content"]');
check("Order detail sheet fits viewport (mobile)", sheet && sheet.right <= 391 && sheet.left >= 0, JSON.stringify(sheet));
await page.evaluate(() => {
  const sc = document.querySelector('[data-slot="sheet-content"]');
  const b = [...sc.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Close"));
  if (b) b.click();
});
await sleep(400);

// ---------------- Menu: product list, dialog, customization view ----------------
await gotoAdmin("/admin/menu", "Menu");
m = await measure();
check("Menu 390: no overflow", m.overflow === 0, `overflow=${m.overflow}`);

// Switch to Products tab (let the list hydrate first)
await sleep(1200);
await page.evaluate(() => {
  const tab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Produk");
  if (tab) tab.click();
});
await waitText("Tambah Produk", 15000);

// Open "Tambah Produk" dialog
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Tambah Produk"));
  if (b) b.click();
});
await waitText("Harga (Rp)", 8000);
const dialog = await visibleBox('[data-slot="dialog-content"]');
check("Product dialog fits viewport (390)", dialog && dialog.right <= 391 && dialog.left >= 0 && dialog.top >= 0, JSON.stringify(dialog));
m = await measure();
check("Product dialog open: no page overflow", m.overflow === 0, `overflow=${m.overflow}`);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Batal");
  if (b) b.click();
});
await sleep(400);

// Open customization for Minuman Caffe 1 (product with Size/Sugar/Espresso + Extra Shot)
const custClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => {
    if (!(b.textContent || "").includes("Kustomisasi")) return false;
    // The product row is the closest bordered list item containing the product name.
    let el = b.parentElement;
    for (let i = 0; i < 5 && el; i++) {
      const txt = el.textContent || "";
      if (el.querySelectorAll("button").length >= 3 && txt.includes("Minuman Caffe 1") && txt.length < 200) return true;
      el = el.parentElement;
    }
    return false;
  });
  if (!btn) return false;
  btn.click();
  return true;
});
await waitText("Option Groups", 10000);
check("Customization view opens for Minuman Caffe 1", custClicked, "");
m = await measure();
check("Customization view 390: no overflow", m.overflow === 0, `overflow=${m.overflow}`);
// Expand first group (Size)
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Bentangkan group");
  if (b) b.click();
});
await sleep(400);
const groupExpanded = await waitText("Tambah Option", 8000).then(() => true).catch(() => false);
check("Group expansion shows option rows", groupExpanded, "");
m = await measure();
check("Expanded group 390: no overflow", m.overflow === 0, `overflow=${m.overflow}`);
const addonVisible = await page.evaluate(() => (document.body.innerText || "").includes("Extra Shot"));
check("Addons list visible", addonVisible, "");
// Back to product list
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Kembali"));
  if (b) b.click();
});
await sleep(600);

// ---------------- Tables: header + QR dialog ----------------
await gotoAdmin("/admin/tables", "Table 01");
m = await measure();
check("Tables 390: no overflow", m.overflow === 0, `overflow=${m.overflow}`);
await page.evaluate(() => {
  const card = [...document.querySelectorAll('[data-slot="card"]')].find((c) => c.textContent.includes("Table 01"));
  if (!card) return;
  const b = [...card.querySelectorAll("button")].find((x) => (x.textContent || "").includes("QR"));
  if (b) b.click();
});
await waitText("Buka Link", 15000);
const qrDialog = await visibleBox('[data-slot="dialog-content"]');
check("QR dialog fits viewport (390)", qrDialog && qrDialog.right <= 391 && qrDialog.left >= 0, JSON.stringify(qrDialog));
m = await measure();
check("QR dialog open: no page overflow", m.overflow === 0, `overflow=${m.overflow}`);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Tutup");
  if (b) b.click();
});
await sleep(400);

// ---------------- Customers / Payments / Settings / WhatsApp 390 ----------------
for (const [route, token] of [
  ["/admin/customers", "Pelanggan"],
  ["/admin/payments", "Pembayaran"],
  ["/admin/settings", "Pengaturan"],
  ["/admin/whatsapp", "WhatsApp"],
]) {
  await gotoAdmin(route, token);
  m = await measure();
  check(`${route} 390: no overflow`, m.overflow === 0, `overflow=${m.overflow}`);
}

// ---------------- Overflow sweep (all routes x all widths) ----------------
// Same-origin navigations can stall with an open SSE stream, so never block
// on the navigation promise. Instead fire it and then poll measure() — the
// evaluate can throw "Execution context was destroyed" while the new document
// is still swapping in, so retry until the context is stable. If it never
// stabilizes within the budget, that route is a REAL failure (not swallowed).
const measureStable = async (budgetMs = 25000) => {
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < budgetMs) {
    try {
      return await measure();
    } catch (e) {
      lastErr = String(e).slice(0, 120);
      await sleep(400);
    }
  }
  throw new Error(`measurement never stabilized: ${lastErr}`);
};
let sweepFails = 0;
// Load each route ONCE; the responsive layout reflows via CSS media queries,
// so re-measuring at every width on the same document is a genuine overflow
// test (and avoids 56 slow full page loads with SSE streams).
for (const route of ROUTES) {
  page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  try {
    m = await measureStable();
  } catch (e) {
    sweepFails++;
    console.log(`FAIL sweep ${route}: ${e.message}`);
    continue;
  }
  for (const w of WIDTHS) {
    await page.setViewport({ width: w, height: 900 });
    await sleep(400);
    try {
      m = await measureStable(8000);
    } catch (e) {
      sweepFails++;
      console.log(`FAIL sweep ${route} @ ${w}px: ${e.message}`);
      continue;
    }
    if (m.overflow > 0) {
      sweepFails++;
      console.log(`FAIL sweep ${route} @ ${w}px overflow=${m.overflow}`, JSON.stringify(m.offenders));
    }
  }
}
check("Overflow sweep: all routes at 320/360/390/412/768/1024/1280", sweepFails === 0, `${sweepFails} failures`);

// ---------------- Desktop regression (1280) ----------------
await page.setViewport({ width: 1280, height: 900 });
await gotoAdmin("/admin/dashboard", "Dashboard");
const desktop = await page.evaluate(() => {
  const sides = [...document.querySelectorAll("aside")];
  const side = sides.find((s) => {
    const r = s.getBoundingClientRect();
    return getComputedStyle(s).display !== "none" && r.width === 256 && r.left === 0;
  });
  const topbar = [...document.querySelectorAll("header")].find((h) => h.textContent.includes("Restoran Bahagia"));
  const main = document.querySelector("main");
  const sr = side ? side.getBoundingClientRect() : null;
  const mr = main ? main.getBoundingClientRect() : null;
  return {
    sidebarShown: !!side,
    sidebarHasNav: !!side && !!side.querySelector("a[href='/admin/dashboard']"),
    topbarHidden: !topbar || getComputedStyle(topbar).display === "none",
    mainLeft: mr ? mr.left : null,
    sr: sr ? { w: sr.width, left: sr.left } : null,
  };
});
check("Desktop 1280: fixed sidebar visible (w=256, left=0)", desktop.sidebarShown && desktop.sidebarHasNav, JSON.stringify(desktop.sr));
check("Desktop 1280: no mobile top bar", desktop.topbarHidden, "");
check("Desktop 1280: content starts after sidebar (ml-64)", desktop.mainLeft === 256, `mainLeft=${desktop.mainLeft}`);
m = await measure();
check("Desktop 1280: no overflow", m.overflow === 0, `overflow=${m.overflow}`);

// Login page wide (should be unchanged single card) — fresh incognito context
// so the session cookie doesn't redirect /login away.
const anonCtx = await browser.createBrowserContext();
const lp = await anonCtx.newPage();
await lp.setViewport({ width: 1280, height: 900 });
await lp.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await waitFor(() => lp.$('input[type="email"]'), 15000, "email input");
await lp.evaluate(() => {
  const el = document.querySelector('input[type="email"]');
  if (el) el.focus();
});
m = await lp.evaluate(() => {
  const iw = window.innerWidth;
  const sw = document.documentElement.scrollWidth;
  return { iw, sw, overflow: sw - iw };
});
check("Login 1280: no overflow", m.overflow === 0, `overflow=${m.overflow}`);
await anonCtx.close();

await page.screenshot({ path: "shots/admin-responsive-dashboard-1280.png" });
await page.setViewport({ width: 390, height: 844 });
await gotoAdmin("/admin/dashboard", "Dashboard");
await page.screenshot({ path: "shots/admin-responsive-dashboard-390.png" });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks PASSED ====`);
if (failed.length) console.log("FAILED:", failed.map((f) => f.name).join(" | "));
process.exit(failed.length ? 1 : 0);
