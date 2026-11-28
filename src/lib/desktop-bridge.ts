// ============================================================
// DESKTOP BRIDGE — web POS ↔ RestoPOS Kasir Desktop (Electron)
//
// The desktop shell exposes a tiny API on `window.desktopPOS` (see
// desktop/preload.js). Everything here is optional: in a normal browser the
// helpers degrade to `window.print()`, so the POS keeps working unchanged.
// ============================================================

export interface DesktopPOSConfig {
  storeCode?: string;
  rootDomain?: string;
  customUrl?: string;
  printerName?: string;
  silentPrint?: boolean;
}

export interface DesktopPOSPrinter {
  name: string;
  displayName?: string;
  description?: string;
  isDefault?: boolean;
  status?: number;
}

export interface DesktopPOSResult {
  ok: boolean;
  reason?: string;
  url?: string;
}

export interface DesktopPOSBridge {
  readonly isDesktopApp: true;
  readonly platform?: string;
  getConfig(): Promise<DesktopPOSConfig | null>;
  saveConfig(config: DesktopPOSConfig): Promise<DesktopPOSConfig | null>;
  openPOS?(): Promise<DesktopPOSResult>;
  getPrinters(): Promise<DesktopPOSPrinter[]>;
  testPrint(printerName?: string): Promise<DesktopPOSResult>;
  silentPrintReceipt(): Promise<DesktopPOSResult>;
  openLauncher(): Promise<unknown>;
}

declare global {
  interface Window {
    desktopPOS?: DesktopPOSBridge;
  }
}

/** The Electron bridge, or null when running in a regular browser. */
export function getDesktopBridge(): DesktopPOSBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.desktopPOS;
  return bridge && bridge.isDesktopApp ? bridge : null;
}

/** True only inside the RestoPOS Kasir Desktop shell. */
export function isDesktopApp(): boolean {
  return getDesktopBridge() !== null;
}

/** True when the desktop shell is printing silently to a thermal printer. */
export async function isSilentPrintEnabled(): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (!bridge) return false;
  try {
    const config = await bridge.getConfig();
    return config?.silentPrint !== false;
  } catch {
    return false;
  }
}

export type PrintOutcome = "desktop" | "browser";

/**
 * Print the receipt currently rendered by the POS print view.
 *
 * - Desktop shell + silent print → thermal printer, no OS dialog.
 * - Browser (or silent print off / bridge error) → standard `window.print()`.
 *
 * Never throws: a failed silent print falls back to the browser dialog so a
 * cashier is never left without a printed receipt.
 */
export async function printReceiptSmart(): Promise<PrintOutcome> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    if (typeof window !== "undefined") window.print();
    return "browser";
  }

  try {
    const config = await bridge.getConfig();
    if (config?.silentPrint === false) {
      window.print();
      return "browser";
    }
    const result = await bridge.silentPrintReceipt();
    if (result?.ok) return "desktop";
  } catch (error) {
    console.warn("[desktop] silent print failed, falling back to dialog", error);
  }

  window.print();
  return "browser";
}
