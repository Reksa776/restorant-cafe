// E2E: Product create 409 regression — duplicate-submit after image upload.
//
// Background: after the product image-upload feature, saving a product became
// async (image upload happens inside handleSaveProduct BEFORE the create POST).
// The Simpan button was never disabled while saving, so a second click during
// the upload window fired a SECOND POST /api/menu/products:
//   - if the first POST already committed, the second hit the (pre-existing)
//     duplicate-name check -> 409 "Product with this name already exists..."
//   - if both raced, two identical products were persisted.
//
// This test locks in the fix:
//   1. one user action (even a double-click) = exactly ONE create POST
//   2. a genuine duplicate create still returns 409 with the real message
//   3. the UI surfaces the backend's real 409 message (not a generic toast)
//   4. create without image, create with uploaded image, and edit flows all
//      still work.
//
// Requires: dev server on http://localhost:3000, MySQL reachable, seeded DB
// (admin@restobahagia.com/admin123).
import puppeteer from "puppeteer-core";
import { createConnection } from "mysql2/promise";
import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";

// Minimal valid 1x1 red PNG (browsers must be able to preview it).
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
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
const VALID_PNG = validPngBytes();

const BASE = process.env.BASE || "http://localhost:3000";
const PREFIX = "E2E-409-";
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

// Categories for the seeded restaurant
const [cats] = await conn.query("SELECT id, name FROM category ORDER BY name");
const catMakanan = cats.find((c) => c.name === "Makanan");
const catMinuman = cats.find((c) => c.name === "Minuman");

async function apiCreate(payload) {
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
async function apiUpdate(id, payload) {
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
async function apiUpload(bytes, type, name) {
  return page.evaluate(async ({ bytes, type, name }) => {
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
  }, { bytes: Array.from(bytes), type, name });
}
async function productRow(name) {
  const [rows] = await conn.query("SELECT id, imageUrl, isAvailable FROM product WHERE name = ?", [name]);
  return rows[0] || null;
}

const uniq = `${PREFIX}${Date.now()}`;

// ---------------------------------------------------------------
// 1. Create WITHOUT image -> 201
// ---------------------------------------------------------------
const noImg = await apiCreate({ categoryId: catMakanan.id, name: `${uniq}-A`, price: 10000 });
check("1. Create without image -> 201", noImg.status === 201, `status=${noImg.status}`);

// ---------------------------------------------------------------
// 2. Create WITH uploaded image -> 201 + imageUrl persisted
// ---------------------------------------------------------------
const up = await apiUpload(Array.from(VALID_PNG), "image/png", "valid.png");
check("2a. Upload image accepted", up.status === 201 && up.data?.data?.url?.startsWith("/uploads/products/"), `status=${up.status}`);
const withImg = await apiCreate({ categoryId: catMakanan.id, name: `${uniq}-B`, price: 15000, imageUrl: up.data?.data?.url });
check("2b. Create with uploaded image -> 201", withImg.status === 201, `status=${withImg.status}`);
const rowB = await productRow(`${uniq}-B`);
check("2c. imageUrl persisted", rowB?.imageUrl === up.data?.data?.url, rowB?.imageUrl ?? "-");

// ---------------------------------------------------------------
// 3. Same name + same category twice -> first 201, second 409 (real message)
// ---------------------------------------------------------------
const nameC = `${uniq}-C`;
const c1 = await apiCreate({ categoryId: catMakanan.id, name: nameC, price: 20000 });
check("3a. First duplicate-scenario create -> 201", c1.status === 201, `status=${c1.status}`);
const c2 = await apiCreate({ categoryId: catMakanan.id, name: nameC, price: 20000 });
check(
  "3b. Second create (same name+category) -> 409 with real message",
  c2.status === 409 && /already exists/.test(c2.data?.message || ""),
  `status=${c2.status} body=${JSON.stringify(c2.data)}`
);
// Same name, different category is still allowed (scope is per-category).
const c3 = await apiCreate({ categoryId: catMinuman.id, name: nameC, price: 8000 });
check("3c. Same name, different category -> 201", c3.status === 201, `status=${c3.status}`);

// ---------------------------------------------------------------
// 4. Edit existing product WITH new image -> 200 + replaced
// ---------------------------------------------------------------
const up2 = await apiUpload(Array.from(VALID_PNG), "image/png", "valid2.png");
const e1 = await apiUpdate(rowB.id, { name: `${uniq}-B`, price: 16000, imageUrl: up2.data?.data?.url });
check("4a. Edit with new image -> 200", e1.status === 200, `status=${e1.status}`);
const rowB2 = await productRow(`${uniq}-B`);
check("4b. imageUrl replaced on edit", rowB2?.imageUrl === up2.data?.data?.url, rowB2?.imageUrl ?? "-");

// ---------------------------------------------------------------
// 5. Edit existing product WITHOUT touching image -> 200, image kept
// ---------------------------------------------------------------
const e2 = await apiUpdate(rowB2.id, { name: `${uniq}-B`, price: 17000 });
check("5a. Edit without image field -> 200", e2.status === 200, `status=${e2.status}`);
const rowB3 = await productRow(`${uniq}-B`);
check("5b. imageUrl kept on unrelated edit", rowB3?.imageUrl === up2.data?.data?.url, rowB3?.imageUrl ?? "-");
// Editing to a name that collides with ANOTHER product -> 409 (still enforced)
const e3 = await apiUpdate(rowB2.id, { name: nameC });
check("5c. Edit to duplicate name -> 409", e3.status === 409, `status=${e3.status}`);

// ---------------------------------------------------------------
// 6. UI: double-click Simpan (with uploaded file) -> exactly ONE POST
// ---------------------------------------------------------------
const uiName = `${PREFIX}Ui-${Date.now()}`;
const tmpPng = path.join(os.tmpdir(), `${uiName}.png`);
fs.writeFileSync(tmpPng, VALID_PNG);

const createPosts = [];
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/api/menu/products")) {
    createPosts.push({ url: req.url(), ts: Date.now() });
  }
});

await page.goto(`${BASE}/admin/menu`, { waitUntil: "networkidle2" });
await sleep(800);
await page.evaluate(() => {
  const tab = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Produk");
  if (tab) tab.click();
});
await sleep(400);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Tambah Produk"));
  if (btn) btn.click();
});
await sleep(500);
await page.type("#prodName", uiName);
await page.type("#prodPrice", "19000");
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Upload Gambar"));
  if (btn) btn.click();
});
await sleep(300);
const fileInput = await page.$('input[type="file"]');
if (fileInput) await fileInput.uploadFile(tmpPng);
await sleep(400);

// Double-click Simpan — both clicks land in the same render cycle.
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter(
    (b) => (b.textContent || "").trim() === "Simpan" && b.offsetParent !== null
  );
  const target = btns[btns.length - 1];
  if (target) { target.click(); target.click(); }
});

// Wait for the save to settle (upload + create + list refresh).
await sleep(6000);
check(
  "6a. Double-click Simpan -> exactly ONE create POST",
  createPosts.length === 1,
  `posts=${createPosts.length}`
);
const uiRow = await productRow(uiName);
check("6b. Exactly one product persisted", !!uiRow, uiRow?.id ?? "-");

// ---------------------------------------------------------------
// 7. UI: genuine duplicate shows the backend's real 409 message
// ---------------------------------------------------------------
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Tambah Produk"));
  if (btn) btn.click();
});
await sleep(400);
await page.type("#prodName", uiName);
await page.type("#prodPrice", "19000");
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter(
    (b) => (b.textContent || "").trim() === "Simpan" && b.offsetParent !== null
  );
  const target = btns[btns.length - 1];
  if (target) target.click();
});
const sawRealMessage = await waitFor(async () => {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll("[data-sonner-toast]")].find((t) =>
      /already exists in this category/.test(t.textContent || "")
    );
    return !!el;
  });
});
check("7. UI toast shows real 409 message", !!sawRealMessage);

// Cleanup: remove test products and the uploaded files they referenced
// (respecting PRODUCT_UPLOAD_DIR, which may redirect the upload root).
const uploadRoot = (process.env.PRODUCT_UPLOAD_DIR || "uploads/products").trim();
const absUploadRoot = path.isAbsolute(uploadRoot) ? uploadRoot : path.join(process.cwd(), uploadRoot);
await conn.query(`DELETE FROM product WHERE name LIKE '${PREFIX}%'`);
for (const url of [up.data?.data?.url, up2.data?.data?.url]) {
  if (!url) continue;
  const rel = url.replace(/^\/uploads\/products\/?/, "");
  try { fs.rmSync(path.join(absUploadRoot, rel), { force: true }); } catch {}
}
if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng);
await browser.close();
await conn.end();

async function waitFor(fn, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  return null;
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S) ❌`);
process.exit(failures === 0 ? 0 : 1);