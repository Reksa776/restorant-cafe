// ============================================================
// RestoPOS Kasir Desktop — Electron main process
//
// This app is a THIN SHELL around the existing multi-tenant web POS:
//   • it never re-implements POS logic, it loads `<slug>.<root>/admin/orders/new`
//   • it adds what a browser cannot do reliably: SILENT thermal printing,
//     a persistent store/printer config, and cashier keyboard shortcuts
//
// Isolation: this folder is NOT part of the Next.js build (see the root
// tsconfig.json `exclude`), so `npm run build:low-mem` on the VPS is
// completely unaffected by Electron or electron-builder.
// ============================================================

const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

const APP_DIR = __dirname;
const PRELOAD_FILE = path.join(APP_DIR, "preload.js");
const LAUNCHER_FILE = path.join(APP_DIR, "launcher.html");
const LAUNCHER_URL = `file://${LAUNCHER_FILE}`;

/** The POS screen inside the multi-tenant app (cashier "Buat Pesanan"). */
const POS_PATH = "/admin/orders/new";

/** Platform root domain — overridable per install from the launcher. */
const DEFAULT_ROOT_DOMAIN = "resto.demosolusisejalan.my.id";

const DEFAULT_CONFIG = {
  storeCode: "",
  rootDomain: DEFAULT_ROOT_DOMAIN,
  /** Optional full URL (e.g. http://localhost:3001/admin/orders/new). */
  customUrl: "",
  printerName: "",
  silentPrint: true,
};

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** Cached config so the navigation guard never touches the disk mid-request. */
let cachedConfig = { ...DEFAULT_CONFIG };

// ------------------------------------------------------------
// Config persistence — app.getPath("userData")/pos-config.json
// ------------------------------------------------------------

function configFile() {
  // Resolved lazily: `app.getPath` is only guaranteed once Electron is ready.
  return path.join(app.getPath("userData"), "pos-config.json");
}

function normalizeRootDomain(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

function normalizeStoreCode(raw) {
  let value = String(raw || "").trim().toLowerCase();
  value = value.replace(/^[a-z]+:\/\//, "");
  value = value.replace(/\/.*$/, "");
  value = value.replace(/:\d+$/, "");
  if (value.includes(".")) value = value.split(".")[0];
  return value.replace(/[^a-z0-9-]/g, "").slice(0, 48);
}

/**
 * Merge any partial config over the stored one. Unknown keys are dropped and
 * every string is trimmed/capped, so a malformed pos-config.json (or a bad
 * IPC payload) can never crash the shell or inject a huge value.
 */
function sanitizeConfig(input) {
  const merged = { ...DEFAULT_CONFIG, ...readConfig() };
  if (input && typeof input === "object") {
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (input[key] !== undefined && input[key] !== null) {
        merged[key] = input[key];
      }
    }
  }
  return {
    storeCode: String(merged.storeCode || "").trim().slice(0, 120),
    rootDomain: normalizeRootDomain(merged.rootDomain) || DEFAULT_ROOT_DOMAIN,
    customUrl: String(merged.customUrl || "").trim().slice(0, 500),
    printerName: String(merged.printerName || "").trim().slice(0, 200),
    silentPrint: merged.silentPrint !== false,
  };
}

function readConfig() {
  try {
    const raw = fs.readFileSync(configFile(), "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    // Missing or corrupt file: fall back to defaults (first-run experience).
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config) {
  const safe = sanitizeConfig(config);
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  cachedConfig = safe;
  return safe;
}

// ------------------------------------------------------------
// URL helpers
// ------------------------------------------------------------

/** Append the POS path when the user only supplied an origin. */
function withPosPath(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "" || parsed.pathname === "/") {
      parsed.pathname = POS_PATH;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Resolve the POS URL from a config:
 *   1. `customUrl` (full URL — works for localhost during testing)
 *   2. `<storeCode>.<rootDomain>/admin/orders/new`
 * Returns null when no store is configured yet (→ launcher).
 */
function resolvePosUrl(config) {
  const custom = String(config.customUrl || "").trim();
  if (custom) {
    const absolute = /^https?:\/\//i.test(custom) ? custom : `https://${custom}`;
    return withPosPath(absolute);
  }
  const code = normalizeStoreCode(config.storeCode);
  if (!code) return null;
  const root = normalizeRootDomain(config.rootDomain) || DEFAULT_ROOT_DOMAIN;
  const isLocal =
    root === "localhost" ||
    root.startsWith("localhost:") ||
    root.startsWith("127.") ||
    root.startsWith("192.168.") ||
    root.startsWith("10.");
  const scheme = isLocal ? "http" : "https";
  return `${scheme}://${code}.${root}${POS_PATH}`;
}

/** True for the merchant's own tenant(s), localhost, and the launcher page. */
function isAllowedUrl(target) {
  try {
    const parsed = new URL(target);
    if (parsed.protocol === "file:") return target.startsWith(LAUNCHER_URL);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      // Private LAN / loopback only — never a public IP.
      return (
        host.startsWith("127.") ||
        host.startsWith("192.168.") ||
        host.startsWith("10.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      );
    }

    const root = normalizeRootDomain(cachedConfig.rootDomain) || DEFAULT_ROOT_DOMAIN;
    return host === root || host.endsWith(`.${root}`);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------
// Windows & navigation
// ------------------------------------------------------------

function loadLauncher() {
  if (!mainWindow) return;
  mainWindow.loadURL(LAUNCHER_URL).catch(() => {
    /* file:// always exists in the packaged app — nothing to recover here */
  });
}

function loadErrorPage(win, failedUrl, reason) {
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8" />
<title>Toko tidak dapat dibuka</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family: "Segoe UI", system-ui, sans-serif; background:#f8fafc; color:#0f172a; }
  .card { width:min(560px, calc(100vw - 48px)); background:#fff; border:1px solid #e2e8f0;
          border-radius:16px; padding:32px; box-shadow:0 12px 40px rgba(15,23,42,.08); }
  .badge { display:inline-flex; gap:8px; align-items:center; padding:4px 10px; border-radius:999px;
           background:#fef3c7; color:#92400e; font-size:12px; font-weight:600; }
  h1 { font-size:20px; margin:16px 0 8px; }
  p { font-size:14px; line-height:1.6; color:#475569; margin:0 0 8px; }
  code { font-family: ui-monospace, monospace; font-size:12px; background:#f1f5f9;
         padding:2px 6px; border-radius:6px; word-break:break-all; }
  button { margin-top:20px; padding:10px 18px; border:0; border-radius:10px; background:#0f172a;
           color:#fff; font-size:14px; font-weight:600; cursor:pointer; }
</style></head><body>
  <div class="card">
    <span class="badge">Koneksi gagal</span>
    <h1>Toko tidak dapat dibuka</h1>
    <p>Pastikan kode toko benar dan perangkat terhubung ke internet.</p>
    <p>Alamat yang dicoba:</p>
    <code>${String(failedUrl || "-").replace(/[<>&]/g, "")}</code>
    ${reason ? `<p style="margin-top:12px">Detail: ${String(reason).replace(/[<>&]/g, "")}</p>` : ""}
    <button onclick="window.desktopPOS.openLauncher()">Ganti Toko / Pengaturan Printer</button>
  </div>
</body></html>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
}

function openPOS() {
  if (!mainWindow) return { ok: false, reason: "no-window" };
  const url = resolvePosUrl(cachedConfig);
  if (!url) {
    loadLauncher();
    return { ok: false, reason: "no-store" };
  }
  // Surface network failures (DNS, offline) instead of Electron's blank page.
  // Registered BEFORE loadURL so a fast failure cannot be missed.
  mainWindow.webContents.once("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame && code !== -3 /* ABORTED (redirects/reloads) */) {
      loadErrorPage(mainWindow, validatedURL || url, description);
    }
  });
  mainWindow.loadURL(url).catch((error) => {
    loadErrorPage(mainWindow, url, error && error.message ? error.message : "");
  });
  return { ok: true, url };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    show: false,
    title: "RestoPOS Kasir Desktop",
    icon: path.join(APP_DIR, "assets", "icon.png"),
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());

  const wc = mainWindow.webContents;

  // External links (payment gateway docs, maps, WhatsApp) open in the OS
  // browser; only the merchant's own tenant stays inside the app.
  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 760,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  wc.on("will-navigate", (event, url) => {
    if (isAllowedUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  // No <webview> tags: this shell only hosts the trusted tenant pages.
  wc.on("will-attach-webview", (event) => event.preventDefault());

  // Cashier shortcuts. Handled here (in addition to the menu accelerators) so
  // they work identically on Windows, macOS and Linux even while focus is in
  // an input field.
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !mainWindow) return;
    const key = String(input.key || "").toLowerCase();
    const primary = process.platform === "darwin" ? input.meta : input.control;

    if (input.key === "F11") {
      event.preventDefault();
      toggleFullScreen();
      return;
    }
    if (input.key === "F5" || (primary && !input.shift && key === "r")) {
      event.preventDefault();
      mainWindow.reload();
      return;
    }
    if (primary && input.shift && key === "s") {
      event.preventDefault();
      loadLauncher();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (resolvePosUrl(cachedConfig)) {
    openPOS();
  } else {
    loadLauncher();
  }
}

// ------------------------------------------------------------
// Printing
// ------------------------------------------------------------

function printOptions(printerName) {
  /** @type {Electron.WebContentsPrintOptions} */
  const options = {
    silent: true,
    printBackground: true,
    margins: { marginType: "none" },
  };
  if (printerName) options.deviceName = printerName;
  return options;
}

/** Silent-print the current page (the POS receipt CSS hides the rest). */
function printCurrentPage(win, printerName) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) {
      resolve({ ok: false, reason: "no-window" });
      return;
    }
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      win.webContents.print(printOptions(printerName), (success, failureReason) => {
        done(success ? { ok: true } : { ok: false, reason: failureReason || "print-failed" });
      });
      // Safety net: some drivers never invoke the callback.
      setTimeout(() => done({ ok: false, reason: "timeout" }), 20000);
    } catch (error) {
      done({ ok: false, reason: error && error.message ? error.message : "print-error" });
    }
  });
}

function testReceiptHtml(printerName) {
  const now = new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  const printer = printerName || "Printer default sistem";
  return `<!doctype html><html lang="id"><head><meta charset="utf-8" />
<title>Tes Cetak</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { width: 80mm; margin: 0; padding: 6mm 4mm; font-family: "Courier New", ui-monospace, monospace;
         color: #000; font-size: 11px; line-height: 1.45; }
  .center { text-align: center; }
  .title { font-size: 15px; font-weight: 700; letter-spacing: .5px; }
  .muted { font-size: 10px; }
  .sep { border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .big { font-size: 13px; font-weight: 700; }
</style></head><body>
  <div class="center">
    <div class="title">RESTOPOS</div>
    <div class="muted">KASIR DESKTOP</div>
  </div>
  <div class="sep"></div>
  <div class="center big">TES CETAK STRUK</div>
  <div class="center muted">Silent print aktif — tanpa dialog Windows</div>
  <div class="sep"></div>
  <div class="row"><span>Waktu</span><span>${now}</span></div>
  <div class="row"><span>Printer</span><span>${printer}</span></div>
  <div class="row"><span>Lebar</span><span>80 mm (58 mm auto)</span></div>
  <div class="sep"></div>
  <div class="center muted">Jika struk ini tercetak, printer siap digunakan.</div>
  <div class="center muted">Terima kasih</div>
</body></html>`;
}

async function printTestReceipt(printerName) {
  const testWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 640,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(testReceiptHtml(printerName))}`;
    await testWindow.loadURL(dataUrl);
    const result = await printCurrentPage(testWindow, printerName);
    return result;
  } catch (error) {
    return { ok: false, reason: error && error.message ? error.message : "test-print-error" };
  } finally {
    if (!testWindow.isDestroyed()) {
      setTimeout(() => {
        if (!testWindow.isDestroyed()) testWindow.close();
      }, 1500);
    }
  }
}

// ------------------------------------------------------------
// IPC — the only surface exposed to the web POS
// ------------------------------------------------------------

function registerIpc() {
  ipcMain.handle("get-config", () => sanitizeConfig(cachedConfig));

  ipcMain.handle("save-config", (_event, incoming) => writeConfig(incoming));

  ipcMain.handle("open-pos", () => openPOS());

  ipcMain.handle("open-launcher", () => {
    loadLauncher();
    return { ok: true };
  });

  ipcMain.handle("get-printers", async () => {
    try {
      const printers = await mainWindow.webContents.getPrintersAsync();
      return printers.map((printer) => ({
        name: printer.name,
        displayName: printer.displayName || printer.name,
        description: printer.description || "",
        isDefault: Boolean(printer.isDefault),
        status: printer.status,
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle("silent-print", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const config = sanitizeConfig(cachedConfig);
    if (!config.silentPrint) return { ok: false, reason: "silent-print-disabled" };
    return printCurrentPage(win, config.printerName);
  });

  ipcMain.handle("test-print", async (_event, printerName) => {
    const chosen = String(printerName || cachedConfig.printerName || "").trim();
    return printTestReceipt(chosen);
  });
}

// ------------------------------------------------------------
// Application menu & cashier shortcuts
// ------------------------------------------------------------

function toggleFullScreen() {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "Kasir",
      submenu: [
        {
          label: "Ganti Toko / Pengaturan Printer",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => loadLauncher(),
        },
        {
          label: "Reload Layar Kasir",
          accelerator: "F5",
          click: () => mainWindow && mainWindow.reload(),
        },
        {
          label: "Reload Layar Kasir",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow && mainWindow.reload(),
        },
        {
          label: "Layar Penuh",
          accelerator: "F11",
          click: () => toggleFullScreen(),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit", label: "Keluar" },
      ],
    },
    {
      label: "Tampilan",
      submenu: [
        { role: "resetZoom", label: "Ukuran Normal" },
        { role: "zoomIn", label: "Perbesar" },
        { role: "zoomOut", label: "Perkecil" },
        { type: "separator" },
        { role: "toggleDevTools", label: "Developer Tools" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------
// Lifecycle
// ------------------------------------------------------------

// Single instance: a second double-click focuses the running cashier window
// instead of opening a second session with its own printer state.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    cachedConfig = sanitizeConfig(readConfig());
    registerIpc();
    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
