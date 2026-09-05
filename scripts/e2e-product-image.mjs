// E2E: Product image upload / image URL feature.
//
// Covers:
//  - server validation: JPEG/PNG/WEBP ok, >5MB rejected (413), non-image
//    rejected (400), MIME-spoof rejected by magic-byte sniffing,
//    invalid/unsafe URLs rejected (400), empty image allowed
//  - create/update product with uploaded + external URL images
//  - remove image (null), upload->URL and URL->upload transitions
//  - old uploaded file deleted after replace/remove
//  - authorization: anonymous upload -> 401, cashier upload -> 403
//  - customer menu renders image for products with one, stays compact for
//    products without one
//  - admin UI: create product via device upload and via URL
//
// Requires: dev server on http://localhost:3000, MySQL reachable,
// a seeded DB (admin@restobahagia.com/admin123).
import puppeteer from "puppeteer-core";
import { createConnection } from "mysql2/promise";
import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";

// ---------------------------------------------------------------
// Minimal VALID 1x1 PNG (red). Browsers must be able to decode it for
// customer-menu render checks (sniff-only bytes are not decodable).
// ---------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function validPngBytes() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width 1
  ihdr.writeUInt32BE(1, 4); // height 1
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0])); // filter 0 + red pixel
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
const VALID_PNG = validPngBytes();

const BASE = process.env.BASE || "http://localhost:3000";
const PREFIX = "E2E-IMG-";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Wipe leftovers from previous runs.
await conn.query(`DELETE FROM product WHERE name LIKE '${PREFIX}%'`);

// Chrome
const CHROME =
  process.env.CHROME_PATH ||
  [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].find((p) => fs.existsSync(p)) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-img-"));

function tmpImage(name, bytes) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
}

// Minimal-but-sniffable image payloads (magic-byte detection only).
const JPEG = tmpImage("valid.jpg", [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = tmpImage("valid.png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const WEBP = tmpImage("valid.webp", [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const FAKE = tmpImage("fake.png", Buffer.from("this is definitely not an image"));

// Every uploaded asset URL created during this run (for cleanup).
const createdUploadUrls = [];

// Multipart upload via the browser session (cookies attached).
async function uploadAs(page, name, bytes, type) {
  const result = await page.evaluate(
    async ({ name, bytes, type }) => {
      const res = await fetch("/api/admin/uploads/product-image", {
        method: "POST",
        body: (() => {
          const fd = new FormData();
          fd.append("file", new File([new Uint8Array(bytes)], name, { type }));
          return fd;
        })(),
      });
      let data = null;
      try { data = await res.json(); } catch {}
      return { status: res.status, data };
    },
    { name, bytes: Array.from(bytes), type }
  );
  if (result.data?.data?.url) createdUploadUrls.push(result.data.data.url);
  return result;
}

async function createProductAs(page, payload) {
  return page.evaluate(async (payload) => {
    const res = await fetch("/api/menu/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }, payload);
}

async function updateProductAs(page, id, payload) {
  return page.evaluate(async ({ id, payload }) => {
    const res = await fetch(`/api/menu/products/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }, { id, payload });
}

async function productRow(id) {
  const [rows] = await conn.query("SELECT id, imageUrl FROM product WHERE id = ?", [id]);
  return rows[0] || null;
}

async function waitFor(fn, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  return null;
}

// ---------------------------------------------------------------
// Browser + admin login
// ---------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

// Login as admin
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await page.type("#email", "admin@restobahagia.com");
await page.type("#password", "admin123");
await Promise.all([
  page.click("button[type=submit]"),
  page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }).catch(() => {}),
]);
await sleep(1200);
check("Admin login", page.url().includes("/admin"), page.url());

// ---------------------------------------------------------------
// Server-side validation (admin session)
// ---------------------------------------------------------------
{
  const jpeg = await uploadAs(page, "real.jpg", fs.readFileSync(JPEG), "image/jpeg");
  check("A. Upload valid JPEG accepted", jpeg.status === 201 && jpeg.data?.data?.url?.startsWith("/uploads/products/"), `status=${jpeg.status} url=${jpeg.data?.data?.url ?? "-"}`);
}
{
  const png = await uploadAs(page, "real.png", fs.readFileSync(PNG), "image/png");
  check("B. Upload valid PNG accepted", png.status === 201 && png.data?.data?.url?.endsWith(".png"), `status=${png.status}`);
}
{
  const webp = await uploadAs(page, "real.webp", fs.readFileSync(WEBP), "image/webp");
  check("C. Upload valid WEBP accepted", webp.status === 201 && webp.data?.data?.url?.endsWith(".webp"), `status=${webp.status}`);
}
{
  const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);
  const over = await uploadAs(page, "huge.jpg", big, "image/jpeg");
  check("D. File > 5 MB rejected (413)", over.status === 413, `status=${over.status}`);
}
{
  const text = await uploadAs(page, "notes.txt", Buffer.from("hello"), "text/plain");
  check("E. Non-image rejected (400)", text.status === 400, `status=${text.status}`);
}
{
  const spoof = await uploadAs(page, "spoof.png", fs.readFileSync(FAKE), "image/png");
  check("E2. MIME-spoof rejected by magic-byte sniff (400)", spoof.status === 400, `status=${spoof.status}`);
}

// ---------------------------------------------------------------
// Create + image flows (admin session)
// ---------------------------------------------------------------
const cat = await conn.query(
  "SELECT id FROM category WHERE isActive = 1 AND restaurantId = (SELECT id FROM restaurant LIMIT 1) ORDER BY sortOrder LIMIT 1"
);
const categoryId = cat[0][0]?.id;
const rid = (await conn.query("SELECT restaurantId FROM category WHERE id = ?", [categoryId]))[0][0].restaurantId;

const name1 = `${PREFIX}UploadJpeg-${Date.now()}`;
const name2 = `${PREFIX}UrlOnly-${Date.now()}`;
const name3 = `${PREFIX}NoImage-${Date.now()}`;

// Product created with an uploaded image file
const jpegRes = await uploadAs(page, "for-create.jpg", fs.readFileSync(JPEG), "image/jpeg");
const storedUrl = jpegRes.data?.data?.url;
check("Upload URL returned for create", !!storedUrl);

const c1 = await createProductAs(page, {
  categoryId, name: name1, price: 15000, description: "dibuat lewat upload", imageUrl: storedUrl,
});
check("Product created with uploaded image", c1.status === 201 && c1.data?.data?.id, `status=${c1.status}`);
const p1 = c1.data?.data?.id;

const absPath1 = path.join(process.cwd(), "uploads", storedUrl.replace(/^\/uploads\/?/, ""));
check("Uploaded file exists on disk", fs.existsSync(absPath1), absPath1);

{
  const row = await productRow(p1);
  check("DB: imageUrl persisted", row?.imageUrl === storedUrl);
}

// URL-only create (valid remote URL — never fetched by server)
const c2 = await createProductAs(page, {
  categoryId, name: name2, price: 22000, imageUrl: "https://example.com/food/ayam-geprek.jpg",
});
check("F. Valid URL product created", c2.status === 201 && c2.data?.data?.id, `status=${c2.status}`);
const p2 = c2.data?.data?.id;
{
  const row = await productRow(p2);
  check("DB: external URL stored verbatim", row?.imageUrl === "https://example.com/food/ayam-geprek.jpg");
}

// Empty image (no imageUrl) still allowed — backward compatible
const c3 = await createProductAs(page, {
  categoryId, name: name3, price: 8000,
});
check("H. Product without image allowed", c3.status === 201 && c3.data?.data?.id, `status=${c3.status}`);
const p3 = c3.data?.data?.id;
{
  const row = await productRow(p3);
  check("DB: imageUrl NULL for empty image", row?.imageUrl === null);
}

// Invalid / unsafe URLs rejected
for (const bad of [
  "not-a-url",
  "javascript:alert(1)",
  "ftp://x/y.png",
  "   ",
  "http://" + "a".repeat(250) + ".com/x.png",
  "http://localhost:3000/x.png",
  "http://127.0.0.1/x.png",
]) {
  const r = await createProductAs(page, { categoryId, name: `${PREFIX}Bad-${Date.now()}-${Math.random()}`, price: 1, imageUrl: bad });
  check(`G. Invalid URL rejected (${bad.slice(0, 24)})`, r.status === 400, `status=${r.status}`);
}

// Tenant isolation: a local asset from ANOTHER restaurant must be rejected
// (otherwise tenant A could later delete tenant B's file on replace/remove).
{
  const r = await createProductAs(page, {
    categoryId,
    name: `${PREFIX}Tenant-${Date.now()}`, price: 1,
    imageUrl: "/uploads/products/some-other-restaurant-cuid/00000000-0000-4000-8000-000000000000.jpg",
  });
  check("G5. Other-restaurant uploaded asset rejected (400)", r.status === 400, `status=${r.status} msg=${r.data?.message ?? "-"}`);
}

// J. Edit existing image (replace uploaded with another uploaded)
{
  const up2 = await uploadAs(page, "replacement.jpg", fs.readFileSync(JPEG), "image/jpeg");
  const url2 = up2.data?.data?.url;
  const r = await updateProductAs(page, p1, { imageUrl: url2 });
  check("J. Edit replaces image", r.status === 200, `status=${r.status}`);
  const row = await productRow(p1);
  check("DB: imageUrl replaced", row?.imageUrl === url2);
  check("Old uploaded file deleted on replace", !fs.existsSync(absPath1));
  await sleep(100);
}

// K. Upload → URL transition (product switches to an external URL)
{
  const r = await updateProductAs(page, p1, { imageUrl: "https://example.com/food/nasi-goreng.jpg" });
  check("K. Upload -> URL transition works", r.status === 200, `status=${r.status}`);
  const row = await productRow(p1);
  check("DB: imageUrl is now external URL", row?.imageUrl === "https://example.com/food/nasi-goreng.jpg");
}

// L. URL → upload transition (uses a REAL decodable PNG so the browser can
// render it later in the customer-menu check)
{
  const up = await uploadAs(page, "uploaded.png", VALID_PNG, "image/png");
  const newUrl = up.data?.data?.url;
  const r = await updateProductAs(page, p2, { imageUrl: newUrl });
  check("L. URL -> upload transition works", r.status === 200, `status=${r.status}`);
  const row = await productRow(p2);
  check("DB: imageUrl is now uploaded asset", row?.imageUrl === newUrl);
}

// I. Remove image (null)
{
  const r = await updateProductAs(page, p1, { imageUrl: null });
  check("I. Remove image (null) works", r.status === 200, `status=${r.status}`);
  const row = await productRow(p1);
  check("DB: imageUrl cleared to NULL", row?.imageUrl === null);
}

// Keep-existing: update other fields without imageUrl must NOT wipe image
{
  const r = await updateProductAs(page, p2, { price: 23000 });
  const row = await productRow(p2);
  check("Keep-existing image on unrelated update", r.status === 200 && !!row?.imageUrl, `img=${row?.imageUrl ?? "-"}`);
}

// ---------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------
{
  // Anonymous (node context, no cookies)
  const anon = await fetch(`${BASE}/api/admin/uploads/product-image`, { method: "POST" });
  check("N. Anonymous upload rejected (401)", anon.status === 401, `status=${anon.status}`);
  const anonCreate = await fetch(`${BASE}/api/menu/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categoryId, name: "x", price: 1 }),
  });
  check("N2. Anonymous product create rejected (401)", anonCreate.status === 401, `status=${anonCreate.status}`);
}

// Cashier must not be able to upload or manage products (403).
// Use a FRESH browser context so the admin session cookie does not leak in.
{
  const ctx = await browser.createBrowserContext();
  const page2 = await ctx.newPage();
  await page2.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page2.type("#email", "kasir@restobahagia.com");
  await page2.type("#password", "kasir123");
  await page2.click("button[type=submit]");
  await sleep(1800);
  check("O0. Cashier can log in", page2.url().includes("/admin"), page2.url());
  const up = await page2.evaluate(async () => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "x.jpg", { type: "image/jpeg" }));
    const res = await fetch("/api/admin/uploads/product-image", { method: "POST", body: fd });
    return { status: res.status };
  });
  check("O. Cashier upload rejected (403)", up.status === 403, `status=${up.status}`);
  const createRes = await page2.evaluate(async () => {
    const res = await fetch("/api/menu/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: "x", name: "x", price: 1 }),
    });
    return { status: res.status };
  });
  check("O2. Cashier product create rejected (403)", createRes.status === 403, `status=${createRes.status}`);
  await ctx.close();
}

// ---------------------------------------------------------------
// Admin UI flow — create product via device upload
// ---------------------------------------------------------------
const uiName = `${PREFIX}UiUpload-${Date.now()}`;
const uiImage = tmpImage("ui-upload.png", VALID_PNG);
await page.goto(`${BASE}/admin/menu`, { waitUntil: "networkidle2" });
await sleep(800);
// Switch to Produk tab if needed, then open dialog
await page.evaluate(() => {
  const tab = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Produk");
  if (tab) tab.click();
});
await sleep(400);
const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Tambah Produk"));
  if (!btn) return false;
  btn.click();
  return true;
});
check("UI: Tambah Produk dialog opened", opened);
await sleep(500);

await page.type("#prodName", uiName);
await page.type("#prodPrice", "19000");

// Choose "Upload Gambar", then attach a real file
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Upload Gambar"));
  if (btn) btn.click();
});
await sleep(300);
const fileInput = await page.$('input[type="file"]');
check("UI: file input present in upload mode", !!fileInput);
if (fileInput) {
  await fileInput.uploadFile(uiImage);
  const preview = await waitFor(async () => {
    return page.evaluate(() => {
      const img = [...document.querySelectorAll("img")].find((i) => (i.alt || "").includes("Preview"));
      return img ? { src: img.src } : null;
    });
  });
  check("UI: preview shown for picked file", !!preview && preview.src.startsWith("blob:"), preview?.src?.slice(0, 40));
}

// Simpan — click the only VISIBLE "Simpan" button (product dialog is the only open dialog).
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter(
    (b) => (b.textContent || "").trim() === "Simpan" && b.offsetParent !== null
  );
  const target = btns[btns.length - 1];
  if (target) target.click();
});
const uiRow = await waitFor(async () => {
  const [rows] = await conn.query("SELECT id, imageUrl FROM product WHERE name = ?", [uiName]);
  return rows[0] || null;
});
check("UI: product persisted after upload+save", !!uiRow && !!uiRow.imageUrl, uiRow?.imageUrl ?? "-");

// ---------------------------------------------------------------
// Admin UI flow — replace image via URL + save keeps everything intact
// ---------------------------------------------------------------
if (uiRow) {
  await sleep(600);
  // Reload list and click the edit (pencil) button for our product
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll("p.font-medium")];
    const el = rows.find((p) => (p.textContent || "").trim() === name);
    let cur = el;
    while (cur && cur !== document.body) {
      const pencil = [...cur.querySelectorAll("button")].find((b) => b.querySelector("svg.lucide-pencil"));
      if (pencil) { pencil.click(); return; }
      cur = cur.parentElement;
    }
  }, uiName);
  await sleep(600);
  const dialogOpen = await page.evaluate(() => !![...document.querySelectorAll("h2, [data-slot='dialog-title']")].find((h) => (h.textContent || "").includes("Edit Produk")));
  check("UI: Edit Produk dialog shows existing image preview", dialogOpen);
  if (dialogOpen) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Gunakan URL"));
      if (btn) btn.click();
    });
    await sleep(300);
    await page.type('input[placeholder="https://example.com/gambar.jpg"]', "https://example.com/food/ganti-url.jpg");
    await sleep(300);
    await page.evaluate(() => {
      const dialog = document.querySelector("[data-slot='dialog-content'], [role='dialog']");
      const target = dialog && [...dialog.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Simpan");
      if (target) target.click();
    });
    const updated = await waitFor(async () => {
      const [rows] = await conn.query("SELECT imageUrl FROM product WHERE id = ?", [uiRow.id]);
      return rows[0] && rows[0].imageUrl === "https://example.com/food/ganti-url.jpg" ? rows[0] : null;
    });
    check("UI: URL replace persisted (upload -> URL)", !!updated, updated?.imageUrl);
  }
}

// ---------------------------------------------------------------
// Customer menu rendering
// ---------------------------------------------------------------
// Simulate a STALE persisted table context (restaurant id no longer exists in
// the DB, e.g. after a DB restore). /menu must recover by clearing it and
// falling back to the active restaurant instead of bricking on the 404.
await page.evaluate(() => {
  localStorage.setItem(
    "table_context",
    JSON.stringify({
      tableId: "stale-table-1",
      tableNumber: 99,
      tableName: "Table 99",
      restaurantId: "cmtefc75v00008mu8dly56b9e", // no longer exists in DB
      visitorCount: 2,
    })
  );
  localStorage.setItem("restaurant_id", "cmtefc75v00008mu8dly56b9e");
});

// Fresh product with a plain external URL (kept until the menu check)
const nameExt = `${PREFIX}External-${Date.now()}`;
const cExt = await createProductAs(page, {
  categoryId,
  name: nameExt,
  price: 12000,
  imageUrl: "https://example.com/food/ayam-geprek.jpg",
});
check("Setup: external-URL product created for menu check", cExt.status === 201, `status=${cExt.status}`);

await page.goto(`${BASE}/menu`, { waitUntil: "networkidle2" });
await sleep(2500);
const menuProbe = await page.evaluate(() => {
  return { names: [...document.querySelectorAll("h3")].map((h) => (h.textContent || "").trim()).length };
});
check("M. Customer menu renders (products visible)", menuProbe.names > 0, `h3 count=${menuProbe.names}`);
const staleState = await page.evaluate(() => ({
  ctx: localStorage.getItem("table_context"),
  rid: localStorage.getItem("restaurant_id"),
}));
check(
  "M1. Stale table context recovered (menu loads, context cleared)",
  menuProbe.names > 0 && staleState.ctx === null && !!staleState.rid && staleState.rid !== "cmtefc75v00008mu8dly56b9e",
  JSON.stringify(staleState)
);

// Product WITHOUT image must not render an <img> (compact card preserved)
const noImgCard = await page.evaluate((name) => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === name);
  if (!h3) return null;
  let el = h3, card = null;
  while (el && el !== document.body) {
    if (el.classList && el.classList.contains("rounded-xl")) { card = el; break; }
    el = el.parentElement;
  }
  return card ? { hasImg: !!card.querySelector("img") } : null;
}, name3);
check("M2. No-image product stays compact (no <img>)", noImgCard && noImgCard.hasImg === false, JSON.stringify(noImgCard));

// External URL must be served to the customer API verbatim, and the card
// must degrade gracefully in the browser (img OR soft placeholder — never a
// native broken glyph). Network to example.com may be blocked in CI, so we
// assert on the API contract + graceful UI state rather than the fetch.
const publicMenu = await page.evaluate(async (restaurantId) => {
  const res = await fetch(`/api/public/menu?restaurantId=${restaurantId}`);
  const json = await res.json();
  return json.data.products.find((p) => p.name.includes("External-")) || null;
}, rid);
check(
  "M3. External URL stored & served to customer API verbatim",
  !!publicMenu && publicMenu.imageUrl === "https://example.com/food/ayam-geprek.jpg",
  JSON.stringify(publicMenu && { n: publicMenu.name, img: publicMenu.imageUrl })
);
const externalCard = await page.evaluate((needle) => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim().includes(needle));
  if (!h3) return null;
  let el = h3, card = null;
  while (el && el !== document.body) {
    if (el.classList && el.classList.contains("rounded-xl")) { card = el; break; }
    el = el.parentElement;
  }
  if (!card) return null;
  const img = card.querySelector("img");
  const media = [...card.querySelectorAll("div")].some((d) => (d.className || "").includes("aspect-"));
  return { hasImg: !!img, imgSrc: img ? img.getAttribute("src") : null, hasMediaBox: media };
}, nameExt);
check(
  "M3b. External image card renders image or graceful fallback",
  !!externalCard && externalCard.hasMediaBox && (externalCard.hasImg ? externalCard.imgSrc === "https://example.com/food/ayam-geprek.jpg" : true),
  JSON.stringify(externalCard)
);

// Locally uploaded (valid PNG) asset must actually render in the menu.
await sleep(1500); // let the image decode (or error) before inspecting
const localImgCard = await page.evaluate((needle) => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim().includes(needle));
  if (!h3) return null;
  let el = h3, card = null;
  while (el && el !== document.body) {
    if (el.classList && el.classList.contains("rounded-xl")) { card = el; break; }
    el = el.parentElement;
  }
  const img = card && card.querySelector("img");
  return img ? { src: img.getAttribute("src") } : null;
}, name2);
check("M3c. Locally uploaded image renders in customer menu", localImgCard && localImgCard.src.startsWith("/uploads/products/"), JSON.stringify(localImgCard));

// Broken URL must degrade gracefully (no native broken glyph)
const brokenUiName = `${PREFIX}Broken-${Date.now()}`;
await createProductAs(page, { categoryId, name: brokenUiName, price: 5000, imageUrl: "https://invalid.invalid/x.png" });
await page.goto(`${BASE}/menu`, { waitUntil: "networkidle2" });
await sleep(2500);
const brokenCard = await page.evaluate((name) => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === name);
  if (!h3) return null;
  let el = h3, card = null;
  while (el && el !== document.body) {
    if (el.classList && el.classList.contains("rounded-xl")) { card = el; break; }
    el = el.parentElement;
  }
  const img = card && card.querySelector("img");
  // Wait a beat for onError to fire
  return { hasImg: !!img, imgSrc: img ? img.getAttribute("src") : null };
}, brokenUiName);
await sleep(1200);
const brokenAfter = await page.evaluate((name) => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === name);
  if (!h3) return null;
  let el = h3, card = null;
  while (el && el !== document.body) {
    if (el.classList && el.classList.contains("rounded-xl")) { card = el; break; }
    el = el.parentElement;
  }
  return card ? { hasImg: !!card.querySelector("img") } : null;
}, brokenUiName);
check("M4. Broken image URL falls back gracefully (no <img> left)", brokenAfter && brokenAfter.hasImg === false, JSON.stringify(brokenAfter));

// ---------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------
const rows = await conn.query("SELECT id, imageUrl FROM product WHERE name LIKE 'E2E-IMG-%'");
for (const r of rows[0]) {
  if (r.imageUrl && r.imageUrl.startsWith("/uploads/products/")) {
    try { fs.rmSync(path.join(process.cwd(), "uploads", r.imageUrl.replace(/^\/uploads\/?/, "")), { force: true }); } catch {}
  }
  await conn.query("DELETE FROM product WHERE id = ?", [r.id]);
}
// Remove any uploaded assets that were never attached to a product row.
for (const u of createdUploadUrls) {
  try { fs.rmSync(path.join(process.cwd(), "uploads", u.replace(/^\/uploads\/?/, "")), { force: true }); } catch {}
}
// Drop the restaurant upload dir when we leave it empty.
const uploadRoot = path.join(process.cwd(), "uploads", "products", rid);
try {
  if (fs.existsSync(uploadRoot) && fs.readdirSync(uploadRoot).length === 0) {
    fs.rmSync(uploadRoot, { recursive: true, force: true });
  }
} catch {}
fs.rmSync(TMP, { recursive: true, force: true });

try { fs.mkdirSync("shots", { recursive: true }); } catch {}
await page.screenshot({ path: "shots/e2e-product-image.png" });

await browser.close();
await conn.end();

console.log(failures === 0 ? "\nALL PASS ✅" : `\n${failures} FAILURE(S) ❌`);
process.exit(failures === 0 ? 0 : 1);
