import { prisma } from "@/lib/prisma";

// ============================================================
// Types
// ============================================================

export type ConnectionStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "QR_REQUIRED"
  | "CONNECTED"
  | "RECONNECTING"
  | "ERROR";

export interface SessionInfo {
  restaurantId: string;
  status: ConnectionStatus;
  phone: string | null;
  qrCode: string | null;
  lastActiveAt: Date;
  lastError: string | null;
}

/**
 * Minimal interface for the Baileys provider.
 * Defined here to avoid importing heavy Baileys deps at module load.
 */
interface ProviderInstance {
  getConnectionStatus(): ConnectionStatus;
  getConnectedPhone(): string | null;
  getQrCode(): string | null;
  getLastActiveAt(): Date;
  isHealthy(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  forceReconnect(): Promise<void>;
  refreshQr(): Promise<void>;
  sendMessage(to: string, message: string): Promise<void>;
  hasExistingSession(): boolean;
  cleanupSessionFiles(): void;
  onStatusChange(callback: (status: ConnectionStatus) => void): void;
  onQrCode(callback: (qr: string) => void): void;
  onLoggedOut(callback: () => void): void;
  onMaxRetriesExceeded(callback: () => void): void;
  onMessage(
    callback: (message: {
      id: string;
      from: string;
      to: string;
      content: string;
      type: string;
      timestamp: number;
    }) => void
  ): void;
}

// ============================================================
// Lazy Baileys provider import
// ============================================================

let ProviderClass: (new (restaurantId: string) => ProviderInstance) | null = null;

async function loadProviderClass(): Promise<
  new (restaurantId: string) => ProviderInstance
> {
  if (!ProviderClass) {
    const mod = await import(
      "./providers/baileys/baileys.provider.impl"
    );
    ProviderClass = mod.BaileysProviderImpl as unknown as new (
      restaurantId: string
    ) => ProviderInstance;
  }
  return ProviderClass;
}

// ============================================================
// Session Manager — one Baileys connection per restaurant
// ============================================================

class WhatsAppSessionManager {
  private sessions: Map<string, ProviderInstance> = new Map();
  private callbackRegistered: Set<string> = new Set();

  /**
   * Get or create a provider for a specific restaurant.
   * Each restaurant gets its own isolated Baileys connection.
   */
  private async getOrCreateProvider(
    restaurantId: string
  ): Promise<ProviderInstance> {
    let provider = this.sessions.get(restaurantId);
    if (!provider) {
      const Cls = await loadProviderClass();
      provider = new Cls(restaurantId);
      this.sessions.set(restaurantId, provider);
    }
    return provider;
  }

  /**
   * Register callbacks on a provider exactly once per restaurant.
   * Prevents duplicate callback registration on reconnect.
   */
  private registerCallbacks(
    restaurantId: string,
    provider: ProviderInstance
  ): void {
    if (this.callbackRegistered.has(restaurantId)) {
      return;
    }
    this.callbackRegistered.add(restaurantId);

    provider.onStatusChange(async (status) => {
      await this.updateSessionStatus(restaurantId, status, provider);
    });

    provider.onLoggedOut(async () => {
      console.log(
        `[SessionManager] Restaurant ${restaurantId}: Logout detected, cleaning up session files`
      );
      // Clean up invalid session files
      provider.cleanupSessionFiles();
      await this.updateSessionStatus(restaurantId, "DISCONNECTED", provider);
    });

    provider.onMaxRetriesExceeded(async () => {
      console.log(
        `[SessionManager] Restaurant ${restaurantId}: Max reconnect retries exceeded`
      );
      await this.updateSessionStatus(
        restaurantId,
        "ERROR",
        provider,
        "Connection failed after maximum retry attempts"
      );
    });

    provider.onMessage(async (message) => {
      await this.handleIncomingMessage(restaurantId, message);
    });
  }

  /**
   * Connect a restaurant's WhatsApp session.
   * Prevents duplicate connections and properly handles all states.
   */
  async connect(restaurantId: string): Promise<SessionInfo> {
    const provider = await this.getOrCreateProvider(restaurantId);

    // Prevent duplicate connection if already in-progress states
    const currentStatus = provider.getConnectionStatus();
    if (
      currentStatus === "CONNECTED" ||
      currentStatus === "CONNECTING" ||
      currentStatus === "QR_REQUIRED" ||
      currentStatus === "RECONNECTING"
    ) {
      return this.getSessionInfo(restaurantId, provider);
    }

    // Register callbacks (once per restaurant)
    this.registerCallbacks(restaurantId, provider);

    try {
      await provider.connect();
    } catch (error) {
      console.error(
        `[SessionManager] Restaurant ${restaurantId}: Connection failed:`,
        error
      );
      await this.updateSessionStatus(
        restaurantId,
        "ERROR",
        provider,
        error instanceof Error
          ? this.sanitizeError(error.message)
          : "Unknown connection error"
      );
    }

    await this.syncDbSession(restaurantId, provider);
    return this.getSessionInfo(restaurantId, provider);
  }

  /**
   * Disconnect a restaurant's WhatsApp session.
   */
  async disconnect(restaurantId: string): Promise<SessionInfo> {
    const provider = this.sessions.get(restaurantId);
    if (provider) {
      await provider.disconnect();
      this.sessions.delete(restaurantId);
      this.callbackRegistered.delete(restaurantId);
    }

    await this.updateDbStatus(restaurantId, "DISCONNECTED");

    return {
      restaurantId,
      status: "DISCONNECTED",
      phone: null,
      qrCode: null,
      lastActiveAt: new Date(),
      lastError: null,
    };
  }

  /**
   * Refresh QR code for a restaurant's pending connection.
   * Closes existing socket and reconnects to generate new QR.
   */
  async refreshQr(restaurantId: string): Promise<SessionInfo> {
    const provider = this.sessions.get(restaurantId);
    if (!provider) {
      // No active session — initiate fresh connection
      return this.connect(restaurantId);
    }

    const currentStatus = provider.getConnectionStatus();

    // Only refresh if in QR_REQUIRED or CONNECTING state
    if (
      currentStatus !== "QR_REQUIRED" &&
      currentStatus !== "CONNECTING"
    ) {
      return this.getSessionInfo(restaurantId, provider);
    }

    try {
      await provider.refreshQr();
    } catch (error) {
      console.error(
        `[SessionManager] Restaurant ${restaurantId}: QR refresh failed:`,
        error
      );
      await this.updateSessionStatus(
        restaurantId,
        "ERROR",
        provider,
        error instanceof Error
          ? this.sanitizeError(error.message)
          : "QR refresh failed"
      );
    }

    await this.syncDbSession(restaurantId, provider);
    return this.getSessionInfo(restaurantId, provider);
  }

  /**
   * Force reconnect a restaurant's WhatsApp session.
   * Closes the current connection and reconnects from scratch.
   * Used when admin wants to retry after error or force a fresh connection.
   */
  async forceReconnect(restaurantId: string): Promise<SessionInfo> {
    const provider = this.sessions.get(restaurantId);
    if (provider) {
      // Disconnect current connection without removing from session manager
      await provider.disconnect();
      this.callbackRegistered.delete(restaurantId);
    }

    // Connect (will create new provider if needed)
    return this.connect(restaurantId);
  }

  /**
   * Get session info for a restaurant.
   */
  async getStatus(restaurantId: string): Promise<SessionInfo> {
    const provider = this.sessions.get(restaurantId);
    if (provider) {
      return this.getSessionInfo(restaurantId, provider);
    }

    // Fallback to DB state
    const dbSession = await prisma.whatsAppSession.findUnique({
      where: { restaurantId },
    });

    return {
      restaurantId,
      status: (dbSession?.status as ConnectionStatus) || "DISCONNECTED",
      phone: dbSession?.phone || null,
      qrCode: null,
      lastActiveAt: dbSession?.lastActiveAt || new Date(),
      lastError: dbSession?.lastError || null,
    };
  }

  /**
   * Get QR code for a restaurant's pending connection.
   * Returns null if QR has expired.
   */
  getQrCode(restaurantId: string): string | null {
    const provider = this.sessions.get(restaurantId);
    return provider?.getQrCode() || null;
  }

  /**
   * Send a message through a restaurant's WhatsApp connection.
   */
  async sendMessage(
    restaurantId: string,
    to: string,
    message: string
  ): Promise<void> {
    const provider = this.sessions.get(restaurantId);
    if (!provider || provider.getConnectionStatus() !== "CONNECTED") {
      throw new Error(
        `WhatsApp not connected for restaurant ${restaurantId}`
      );
    }
    await provider.sendMessage(to, message);
  }

  /**
   * Check if a restaurant has an active WhatsApp connection.
   */
  isConnected(restaurantId: string): boolean {
    const provider = this.sessions.get(restaurantId);
    return provider?.getConnectionStatus() === "CONNECTED";
  }

  /**
   * Check connection health for a restaurant.
   * Returns healthy status based on socket and last activity.
   */
  isHealthy(restaurantId: string): boolean {
    const provider = this.sessions.get(restaurantId);
    return provider?.isHealthy() ?? false;
  }

  /**
   * Attempt to restore sessions from DB on application restart.
   * Checks for existing credential files and reconnects if valid.
   */
  async restoreSessions(): Promise<void> {
    try {
      // Restore sessions that were active before restart
      // CONNECTED/RECONNECTING: definitely should reconnect
      // QR_REQUIRED: was mid-pairing, reconnect will either succeed or show QR again
      const activeSessions = await prisma.whatsAppSession.findMany({
        where: {
          status: {
            in: ["CONNECTED", "RECONNECTING", "QR_REQUIRED"],
          },
        },
      });

      for (const dbSession of activeSessions) {
        const restaurantId = dbSession.restaurantId;

        // Check if credential files exist
        const provider = await this.getOrCreateProvider(restaurantId);
        if (provider.hasExistingSession()) {
          console.log(
            `[SessionManager] Restaurant ${restaurantId}: Restoring session from disk`
          );
          this.registerCallbacks(restaurantId, provider);

          try {
            await provider.connect();
          } catch (error) {
            console.error(
              `[SessionManager] Restaurant ${restaurantId}: Session restore failed:`,
              error
            );
            await this.updateDbStatus(
              restaurantId,
              "DISCONNECTED",
              "Session restore failed"
            );
          }
        } else {
          // No credentials — mark as disconnected
          console.log(
            `[SessionManager] Restaurant ${restaurantId}: No credentials found, marking as disconnected`
          );
          await this.updateDbStatus(restaurantId, "DISCONNECTED");
        }
      }
    } catch (error) {
      console.error(
        `[SessionManager] Failed to restore sessions:`,
        error
      );
    }
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private getSessionInfo(
    restaurantId: string,
    provider: ProviderInstance
  ): SessionInfo {
    return {
      restaurantId,
      status: provider.getConnectionStatus(),
      phone: provider.getConnectedPhone(),
      qrCode: provider.getQrCode(),
      lastActiveAt: provider.getLastActiveAt(),
      lastError: null,
    };
  }

  /**
   * Synchronize provider state with database.
   */
  private async syncDbSession(
    restaurantId: string,
    provider: ProviderInstance
  ): Promise<void> {
    const status = provider.getConnectionStatus();
    const phone = provider.getConnectedPhone();

    try {
      const existing = await prisma.whatsAppSession.findUnique({
        where: { restaurantId },
      });

      // Preserve phone during RECONNECTING (don't clear it until fully disconnected)
      const shouldClearPhone =
        status === "DISCONNECTED" ||
        status === "ERROR";
      const phoneValue =
        status === "CONNECTED"
          ? phone
          : shouldClearPhone
            ? null
            : existing?.phone || null;

      const data: {
        status: ConnectionStatus;
        phone: string | null;
        lastActiveAt: Date;
        isActive: boolean;
        lastError: string | null;
      } = {
        status,
        phone: phoneValue,
        lastActiveAt: new Date(),
        isActive: status === "CONNECTED",
        lastError: null,
      };

      if (existing) {
        await prisma.whatsAppSession.update({
          where: { restaurantId },
          data,
        });
      } else {
        await prisma.whatsAppSession.create({
          data: {
            restaurantId,
            sessionId: `session-${restaurantId}-${Date.now()}`,
            ...data,
          },
        });
      }
    } catch (error) {
      console.error(
        `[SessionManager] Failed to sync DB for restaurant ${restaurantId}:`,
        error
      );
    }
  }

  /**
   * Update session status in DB with full lifecycle support.
   */
  private async updateSessionStatus(
    restaurantId: string,
    status: ConnectionStatus,
    provider: ProviderInstance,
    lastError?: string
  ): Promise<void> {
    try {
      const existing = await prisma.whatsAppSession.findUnique({
        where: { restaurantId },
      });

      // Preserve phone during RECONNECTING (don't clear until fully disconnected)
      const shouldClearPhone =
        status === "DISCONNECTED" || status === "ERROR";
      const phoneValue =
        status === "CONNECTED"
          ? provider.getConnectedPhone()
          : shouldClearPhone
            ? null
            : existing?.phone || null;

      const data: {
        status: ConnectionStatus;
        phone: string | null;
        lastError: string | null;
        lastActiveAt: Date;
        isActive: boolean;
      } = {
        status,
        phone: phoneValue,
        lastError: lastError || null,
        lastActiveAt: new Date(),
        isActive: status === "CONNECTED",
      };

      if (existing) {
        await prisma.whatsAppSession.update({
          where: { restaurantId },
          data,
        });
      } else {
        await prisma.whatsAppSession.create({
          data: {
            restaurantId,
            sessionId: `session-${restaurantId}-${Date.now()}`,
            ...data,
          },
        });
      }
    } catch (error) {
      console.error(
        `[SessionManager] Failed to update session status for restaurant ${restaurantId}:`,
        error
      );
    }
  }

  /**
   * Update DB status directly (used during disconnect cleanup).
   */
  private async updateDbStatus(
    restaurantId: string,
    status: string,
    lastError?: string
  ): Promise<void> {
    try {
      await prisma.whatsAppSession.update({
        where: { restaurantId },
        data: {
          status: status as ConnectionStatus,
          phone: null,
          lastError: lastError || null,
          lastActiveAt: new Date(),
          isActive: false,
        },
      });
    } catch (error) {
      console.error(
        `[SessionManager] Failed to update DB status for restaurant ${restaurantId}:`,
        error
      );
    }
  }

  /**
   * Sanitize error messages to prevent credential/internal data leakage.
   */
  private sanitizeError(message: string): string {
    // Remove any potential path information
    let sanitized = message.replace(/\/[^\s]+\//g, "/***...");
    // Remove any potential credential patterns
    sanitized = sanitized.replace(
      /password[=:]\s*\S+/gi,
      "password=***"
    );
    sanitized = sanitized.replace(
      /secret[=:]\s*\S+/gi,
      "secret=***"
    );
    // Truncate very long messages
    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 200) + "...";
    }
    return sanitized;
  }

  /**
   * Handle incoming WhatsApp message — store in database.
   */
  private async handleIncomingMessage(
    restaurantId: string,
    message: {
      id: string;
      from: string;
      to: string;
      content: string;
      type: string;
      timestamp: number;
    }
  ): Promise<void> {
    try {
      await prisma.whatsAppMessage.create({
        data: {
          restaurantId,
          direction: "INCOMING",
          from: message.from,
          to: message.to,
          messageId: message.id || undefined,
          content: message.content,
          type: message.type,
          status: "received",
          metadata: {
            timestamp: message.timestamp,
          },
        },
      });
    } catch (error) {
      console.error(
        `[SessionManager] Restaurant ${restaurantId}: Failed to store incoming message:`,
        error instanceof Error ? error.message : error
      );
    }
  }
}

// ============================================================
// Singleton export
// ============================================================

const globalForSessionManager = globalThis as unknown as {
  whatsappSessionManager: WhatsAppSessionManager | undefined;
};

export const whatsappSessionManager =
  globalForSessionManager.whatsappSessionManager ??
  new WhatsAppSessionManager();

if (process.env.NODE_ENV !== "production") {
  globalForSessionManager.whatsappSessionManager = whatsappSessionManager;
}
