// ============================================================
// RestoPOS Kasir Desktop — preload (contextBridge)
//
// The web POS (loaded from the merchant's own subdomain) only ever sees the
// small, explicitly allow-listed `window.desktopPOS` object below. Node
// APIs, `require`, `ipcRenderer` and the filesystem stay in the main process.
// ============================================================

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPOS", {
  /** Marker used by src/lib/desktop-bridge.ts to detect the desktop shell. */
  isDesktopApp: true,

  platform: process.platform,

  /** Stored store/printer config (never throws — returns defaults). */
  getConfig: () => ipcRenderer.invoke("get-config"),

  /** Persist a partial config; the main process sanitizes every field. */
  saveConfig: (config) =>
    ipcRenderer.invoke(
      "save-config",
      config && typeof config === "object" ? config : {}
    ),

  /** Load the POS for the saved store. */
  openPOS: () => ipcRenderer.invoke("open-pos"),

  /** Installed OS printers (name, displayName, isDefault, status). */
  getPrinters: () => ipcRenderer.invoke("get-printers"),

  /** Print a short test receipt silently on the given (or saved) printer. */
  testPrint: (printerName) =>
    ipcRenderer.invoke("test-print", typeof printerName === "string" ? printerName : ""),

  /**
   * Silent-print the CURRENT page on the saved thermal printer — no Windows
   * print dialog. Returns { ok, reason? }.
   */
  silentPrintReceipt: () => ipcRenderer.invoke("silent-print"),

  /** Back to the "Ganti Toko / Pengaturan Printer" launcher screen. */
  openLauncher: () => ipcRenderer.invoke("open-launcher"),
});
