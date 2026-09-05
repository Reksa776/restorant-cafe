// Production-like deployment & storage E2E for product images.
//
// Proves that runtime uploads survive what a real deployment does to the app:
//   npm run build  (build never wipes runtime uploads under ./public/uploads)
//   server restart (PM2 / docker restart / recreate)
//   next start     (production server)
//   .next/standalone/server.js
//
// Scenarios (Audit 10):
//   1. build → start prod server → upload image → create product → GET 200
//   2. restart server → GET image 200 (persisted)
//   3. replace image → old file removed from disk, new GET 200
//   4. soft-delete product → file intentionally kept (product may be restored)
//   5. npm run build again → runtime uploads still on disk AND still served
//   6. standalone server.js: write a fresh upload through the standalone
//      runtime, restart it, GET 200 (runtime dir must be cwd-public/uploads)
//
// Requires a built app, seeded DB, and Chrome (same as other e2e scripts).
import puppeteer from "puppeteer-core";
import { createConnection } from "mysql2/promise";
import { spawn } from "child_process";
import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";

const PREFIX = "E2E-DEP-";
const PROD_PORT = 3111;
const STANDALONE_PORT = 3112;
let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures += 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- valid 1x1 PNG (decodable by browsers) ----------
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
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
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
const PNG = validPngBytes();

// ---------- DB ----------
const dbUrl = new URL(process.env.DATABASE_URL);
const conn = await createConnection({
  host: dbUrl.hostname,
  port: parseInt(dbUrl.port || "3306", 10),
  user: dbUrl.username,
  password: dbUrl.password,
  database: dbUrl.pathname.replace("/", ""),
});
await conn.query(`DELETE FROM product WHERE name LIKE '${PREFIX}%'`);

const CHROME =
  process.env.CHROME_PATH ||
  [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

// ---------- server process helpers ----------
let currentChild = null;
async function waitHttp(url, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`server not ready at ${url}`);
}
async function stopServer() {
  if (currentChild) {
    currentChild.kill("SIGKILL");
    await new Promise((r) => currentChild.once("exit", r));
    currentChild = null;
  }
}
async function startNextStart(port) {
  await stopServer();
  currentChild = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
    { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "inherit", "inherit"] }
  );
  await waitHttp(`http://localhost:${port}/login`);
}
async function startStandalone(port) {
  await stopServer();
  const serverPath = path.join(process.cwd(), ".next", "standalone", "server.js");
  if (!fs.existsSync(serverPath)) {
    throw new Error(".next/standalone/server.js missing — run npm run build with output: standalone");
  }
  // Standalone resolves its appDir from the build root (the Docker image root
  // `/app` in production). Running it with cwd = app root mirrors that layout
  // so runtime uploads (process.cwd()/uploads) are written to and served from
  // the SAME directory the app uses.
  currentChild = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOSTNAME: "0.0.0.0" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitHttp(`http://localhost:${port}/login`);
}

// ---------- browser/auth helpers ----------
async function loggedInPage(port) {
  const page = await browser.newPage();
  const base = `http://localhost:${port}`;
  await page.goto(`${base}/admin/dashboard`, { waitUntil: "networkidle2" }).catch(() => {});
  if (!page.url().includes("/admin")) {
    await page.goto(`${base}/login`, { waitUntil: "networkidle2" });
    await page.type("#email", "admin@restobahagia.com");
    await page.type("#password", "admin123");
    await page.click("button[type=submit]");
    await sleep(1800);
  }
  if (!page.url().includes("/admin")) {
    throw new Error(`login failed on port ${port} (url=${page.url()})`);
  }
  return { page, base };
}
async function uploadImage(page, bytes, type, name) {
  const r = await page.evaluate(async ({ bytes, type, name }) => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(bytes)], name, { type }));
    const res = await fetch("/api/admin/uploads/product-image", { method: "POST", body: fd });
    const data = await res.json().catch(() => null);
    return { status: res.status, url: data?.data?.url };
  }, { bytes: Array.from(bytes), type, name });
  return r;
}
async function createProduct(page, categoryId, name, imageUrl) {
  const r = await page.evaluate(async ({ categoryId, name, imageUrl }) => {
    const res = await fetch("/api/menu/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId, name, price: 10000, imageUrl }),
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, id: data?.data?.id };
  }, { categoryId, name, imageUrl });
  return r;
}

// ---------- helpers ----------
async function fileExistsForUrl(port, url) {
  // Runtime uploads dir is <root>/uploads (private, NOT Next public/) — the
  // same directory the docker volume mounts and the /uploads/products route
  // reads from. `next start` writes under cwd; the standalone runtime chdirs
  // to .next/standalone, so check both candidate roots.
  const candidates = [
    process.cwd(),
    path.join(process.cwd(), ".next", "standalone"),
  ];
  const rel = url.replace(/^\/uploads\/?/, "");
  return candidates.some((root) => fs.existsSync(path.join(root, "uploads", rel)));
}
async function getStatus(port, url) {
  try {
    const res = await fetch(`http://localhost:${port}${url}`, { signal: AbortSignal.timeout(4000) });
    return res.status;
  } catch {
    return 0;
  }
}
async function rowByProduct(id) {
  const [rows] = await conn.query("SELECT id, imageUrl FROM product WHERE id = ?", [id]);
  return rows[0] || null;
}

const catRows = await conn.query(
  "SELECT id FROM category WHERE isActive = 1 ORDER BY sortOrder LIMIT 1"
);
const categoryId = catRows[0][0].id;
const rid = (await conn.query("SELECT restaurantId FROM category WHERE id = ?", [categoryId]))[0][0].restaurantId;

// Track created URLs for cleanup (relative to each runtime root).
const createdFiles = [];
const createdProductIds = [];

try {
  // ================================================================
  // Phase 1 — production server (next start)
  // ================================================================
  check("Setup: seeded DB reachable", !!categoryId);
  await startNextStart(PROD_PORT);
  const { page: p1 } = await loggedInPage(PROD_PORT);

  const up1 = await uploadImage(p1, PNG, "image/png", "deploy-1.png");
  check("1. Upload works on production server", up1.status === 201 && up1.url?.startsWith("/uploads/products/"), `status=${up1.status}`);
  const url1 = up1.url;
  createdFiles.push({ port: PROD_PORT, url: url1 });

  const prod = await createProduct(p1, categoryId, `${PREFIX}Prod-${Date.now()}`, url1);
  check("1b. Product created with image", prod.status === 201, `status=${prod.status}`);
  createdProductIds.push(prod.id);
  check("1c. Uploaded file on disk (prod root)", await fileExistsForUrl(PROD_PORT, url1));
  const s1 = await getStatus(PROD_PORT, url1);
  check("1d. Image served HTTP 200", s1 === 200, `status=${s1}`);
  await p1.close();

  // ================================================================
  // Phase 2 — restart (PM2/docker-restart equivalent)
  // ================================================================
  await startNextStart(PROD_PORT); // restart same port
  const { page: p2 } = await loggedInPage(PROD_PORT);
  const s2 = await getStatus(PROD_PORT, url1);
  check("2. Image survives server restart (HTTP 200)", s2 === 200, `status=${s2}`);
  const rowAfterRestart = await rowByProduct(prod.id);
  check("2b. Product row intact after restart", rowAfterRestart?.imageUrl === url1);

  // ================================================================
  // Phase 3 — replace image (old file cleanup)
  // ================================================================
  const up2 = await uploadImage(p2, PNG, "image/png", "deploy-2.png");
  const url2 = up2.url;
  createdFiles.push({ port: PROD_PORT, url: url2 });
  const upd = await p2.evaluate(async ({ id, url2 }) => {
    const res = await fetch(`/api/menu/products/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: url2 }),
    });
    return res.status;
  }, { id: prod.id, url2 });
  check("3. Replace image on prod server", upd === 200, `status=${upd}`);
  const s3new = await getStatus(PROD_PORT, url2);
  check("3b. New image served HTTP 200", s3new === 200, `status=${s3new}`);
  const oldGone = !(await fileExistsForUrl(PROD_PORT, url1));
  check("3c. Old file removed from disk after replace", oldGone);

  // ================================================================
  // Phase 4 — soft delete keeps file (by design; product restorable)
  // ================================================================
  const del = await p2.evaluate(async (id) => {
    const res = await fetch(`/api/menu/products/${id}`, { method: "DELETE" });
    return res.status;
  }, prod.id);
  check("4. Product soft-deleted", del === 200, `status=${del}`);
  const stillServed = await getStatus(PROD_PORT, url2);
  check("4b. Image still available (soft delete keeps file)", stillServed === 200, `status=${stillServed}`);

  // ================================================================
  // Phase 5 — rebuild: runtime uploads must survive `npm run build`
  // ================================================================
  check("5. Pre-rebuild upload file on disk", await fileExistsForUrl(PROD_PORT, url2));
  const build = spawn("npm", ["run", "build"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "ignore", "ignore"],
  });
  const buildCode = await new Promise((r) => build.once("exit", r));
  check("5a. npm run build succeeds", buildCode === 0, `exit=${buildCode}`);
  check("5b. Runtime upload SURVIVES rebuild", await fileExistsForUrl(PROD_PORT, url2));

  await startNextStart(PROD_PORT);
  const s5 = await getStatus(PROD_PORT, url2);
  check("5c. Image served HTTP 200 after rebuild + restart", s5 === 200, `status=${s5}`);
  await p2.close();

  // ================================================================
  // Phase 6 — Next standalone (node .next/standalone/server.js)
  // ================================================================
  await startStandalone(STANDALONE_PORT);
  const { page: ps } = await loggedInPage(STANDALONE_PORT);
  const upS = await uploadImage(ps, PNG, "image/png", "standalone-1.png");
  check("6. Upload works through standalone server.js", upS.status === 201 && upS.url?.startsWith("/uploads/products/"), `status=${upS.status}`);
  const urlS = upS.url;
  createdFiles.push({ port: STANDALONE_PORT, url: urlS });
  check("6b. File written under standalone runtime uploads dir", await fileExistsForUrl(STANDALONE_PORT, urlS));
  const sS1 = await getStatus(STANDALONE_PORT, urlS);
  check("6c. Image served HTTP 200 by standalone", sS1 === 200, `status=${sS1}`);

  const prodS = await createProduct(ps, categoryId, `${PREFIX}Standalone-${Date.now()}`, urlS);
  check("6d. Product created via standalone", prodS.status === 201, `status=${prodS.status}`);
  createdProductIds.push(prodS.id);
  await ps.close();

  // Restart standalone → image must persist (runtime dir not in build artifact).
  await startStandalone(STANDALONE_PORT);
  const sS2 = await getStatus(STANDALONE_PORT, urlS);
  check("6e. Standalone restart keeps image (HTTP 200)", sS2 === 200, `status=${sS2}`);
} finally {
  await stopServer();
  await browser.close();

  // Cleanup DB rows + runtime files in both roots.
  for (const id of createdProductIds) {
    await conn.query("DELETE FROM product WHERE id = ?", [id]);
  }
  for (const { url } of createdFiles) {
    for (const root of [process.cwd(), path.join(process.cwd(), ".next", "standalone")]) {
      try {
        fs.rmSync(path.join(root, "uploads", url.replace(/^\/uploads\/?/, "")), { force: true });
      } catch {}
    }
  }
  // Drop leftover empty restaurant dirs under both uploads roots.
  for (const root of [process.cwd(), path.join(process.cwd(), ".next", "standalone")]) {
    const dir = path.join(root, "uploads", "products", rid);
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  await conn.end();
}

console.log(failures === 0 ? "\nDEPLOY/STORAGE ALL PASS ✅" : `\n${failures} FAILURE(S) ❌`);
process.exit(failures === 0 ? 0 : 1);
