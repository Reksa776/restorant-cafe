import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import path from "path";
import fs from "fs";
import type {
  WhatsAppProvider,
  ConnectionStatus,
} from "./baileys.provider";

const logger = pino({ level: "silent" });

// ============================================================
// QR expiration: Baileys QR codes expire after ~20 seconds
// ============================================================
const QR_EXPIRATION_MS = 25_000;
const MAX_RECONNECT_ATTEMPTS = 5;

interface BaileysProviderCallbacks {
  onStatusChange?: (status: ConnectionStatus) => void;
  onQrCode?: (qr: string) => void;
  onLoggedOut?: () => void;
  onMaxRetriesExceeded?: () => void;
  onMessage?: (message: {
    id: string;
    from: string;
    to: string;
    content: string;
    type: string;
    timestamp: number;
  }) => void;
}

export class BaileysProviderImpl implements WhatsAppProvider {
  private sock: WASocket | null = null;
  private status: ConnectionStatus = "DISCONNECTED";
  private qrCode: string | null = null;
  private qrGeneratedAt: number | null = null;
  private connectedPhone: string | null = null;
  private lastActiveAt: Date = new Date();
  private restaurantId: string;
  private sessionDir: string;
  private callbacks: BaileysProviderCallbacks = {};
  private reconnectAttempts = 0;
  private maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS;
  private connectionAttemptInProgress = false;

  constructor(restaurantId: string) {
    this.restaurantId = restaurantId;
    this.sessionDir =
      process.env.WHATSAPP_SESSION_DIR || "/app/whatsapp-session";
  }

  // ============================================================
  // Session path helpers
  // ============================================================

  private getSessionPath(): string {
    return path.join(this.sessionDir, `restaurant-${this.restaurantId}`);
  }

  /**
   * Check if this restaurant has existing Baileys credential files.
   */
  hasExistingSession(): boolean {
    const sessionPath = this.getSessionPath();
    try {
      const credsPath = path.join(sessionPath, "creds.json");
      return fs.existsSync(credsPath);
    } catch {
      return false;
    }
  }

  /**
   * Remove all session/credential files for this restaurant.
   * Called on logout, badSession, or connectionReplaced to ensure clean state.
   */
  cleanupSessionFiles(): void {
    const sessionPath = this.getSessionPath();
    try {
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log(
          `[Baileys] Restaurant ${this.restaurantId}: Session files cleaned up`
        );
      }
    } catch (error) {
      console.error(
        `[Baileys] Restaurant ${this.restaurantId}: Failed to clean session files:`,
        error
      );
    }
  }

  // ============================================================
  // Status management
  // ============================================================

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  private touchLastActive() {
    this.lastActiveAt = new Date();
  }

  // ============================================================
  // Callback registration
  // ============================================================

  onStatusChange(callback: (status: ConnectionStatus) => void) {
    this.callbacks.onStatusChange = callback;
  }

  onQrCode(callback: (qr: string) => void) {
    this.callbacks.onQrCode = callback;
  }

  onLoggedOut(callback: () => void) {
    this.callbacks.onLoggedOut = callback;
  }

  onMaxRetriesExceeded(callback: () => void) {
    this.callbacks.onMaxRetriesExceeded = callback;
  }

  onMessage(
    callback: (message: {
      id: string;
      from: string;
      to: string;
      content: string;
      type: string;
      timestamp: number;
    }) => void
  ) {
    this.callbacks.onMessage = callback;
  }

  // ============================================================
  // Getters
  // ============================================================

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  getQrCode(): string | null {
    // Return QR only if it hasn't expired
    if (this.qrCode && this.qrGeneratedAt) {
      const elapsed = Date.now() - this.qrGeneratedAt;
      if (elapsed > QR_EXPIRATION_MS) {
        this.qrCode = null;
        this.qrGeneratedAt = null;
        return null;
      }
    }
    return this.qrCode;
  }

  getConnectedPhone(): string | null {
    return this.connectedPhone;
  }

  getLastActiveAt(): Date {
    return this.lastActiveAt;
  }

  isHealthy(): boolean {
    if (!this.sock) return false;
    if (this.status !== "CONNECTED") return false;
    // Consider unhealthy if no activity for 5 minutes
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    return this.lastActiveAt.getTime() > fiveMinutesAgo;
  }

  // ============================================================
  // Connect
  // ============================================================

  async connect(): Promise<void> {
    // Prevent duplicate connection attempts
    if (this.connectionAttemptInProgress) {
      console.log(
        `[Baileys] Restaurant ${this.restaurantId}: Connection attempt already in progress`
      );
      return;
    }

    if (this.sock) {
      console.log(
        `[Baileys] Restaurant ${this.restaurantId}: Already connected or connecting`
      );
      return;
    }

    this.connectionAttemptInProgress = true;
    this.setStatus("CONNECTING");
    this.qrCode = null;
    this.qrGeneratedAt = null;

    try {
      const sessionPath = this.getSessionPath();

      // Ensure session directory exists
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }

      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        logger,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
      });

      // Handle credentials update — save to disk
      this.sock.ev.on("creds.update", saveCreds);

      // Handle connection updates
      this.sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          this.qrGeneratedAt = Date.now();
          this.setStatus("QR_REQUIRED");
          this.callbacks.onQrCode?.(qr);
          // SECURITY: Do NOT log QR code content
        }

        if (connection === "close") {
          const statusCode = (
            lastDisconnect?.error as Boom | undefined
          )?.output?.statusCode;

          this.sock = null;
          this.qrCode = null;
          this.qrGeneratedAt = null;
          this.connectionAttemptInProgress = false;

          // Non-recoverable reasons — do NOT auto-reconnect
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const badSession = statusCode === 500;
          const connectionReplaced =
            statusCode === DisconnectReason.connectionReplaced;

          if (loggedOut || badSession || connectionReplaced) {
            const reason = loggedOut
              ? "loggedOut"
              : badSession
                ? "badSession"
                : "connectionReplaced";
            console.log(
              `[Baileys] Restaurant ${this.restaurantId}: Connection closed (${reason}), not reconnecting`
            );
            this.connectedPhone = null;
            this.reconnectAttempts = 0;

            // Clean up corrupted/invalid session files
            this.cleanupSessionFiles();

            this.setStatus("DISCONNECTED");

            if (loggedOut) {
              this.callbacks.onLoggedOut?.();
            }
            return;
          }

          // Recoverable reasons — attempt reconnect with exponential backoff
          if (
            this.reconnectAttempts < this.maxReconnectAttempts
          ) {
            this.setStatus("RECONNECTING");
            this.reconnectAttempts++;
            const delay = Math.min(
              1000 * Math.pow(2, this.reconnectAttempts - 1),
              16000
            );
            console.log(
              `[Baileys] Restaurant ${this.restaurantId}: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
            );
            setTimeout(() => {
              this.connectionAttemptInProgress = false;
              this.connect();
            }, delay);
          } else {
            // Max retries exceeded
            this.connectedPhone = null;
            this.reconnectAttempts = 0;
            this.setStatus("ERROR");
            this.callbacks.onMaxRetriesExceeded?.();
          }
        }

        if (connection === "open") {
          this.setStatus("CONNECTED");
          this.qrCode = null;
          this.qrGeneratedAt = null;
          this.reconnectAttempts = 0;
          this.connectionAttemptInProgress = false;
          this.touchLastActive();

          // Extract phone number from JID
          const me = this.sock?.user;
          if (me?.id) {
            this.connectedPhone = me.id.split(":")[0];
          }
        }
      });

      // Handle incoming messages — update last active
      this.sock.ev.on("messages.upsert", (msg) => {
        this.touchLastActive();

        if (msg.type !== "notify") return;

        for (const m of msg.messages) {
          // Skip status broadcasts and self-sent messages
          if (m.key.fromMe) continue;
          if (!m.message) continue;

          const from = m.key.remoteJid || "";
          const content = this.extractMessageContent(m.message);
          const type = this.getMessageType(m.message);

          if (content) {
            this.callbacks.onMessage?.({
              id: m.key.id || "",
              from,
              to: this.sock?.user?.id || "",
              content,
              type,
              timestamp: m.messageTimestamp
                ? typeof m.messageTimestamp === "number"
                  ? m.messageTimestamp
                  : Number(m.messageTimestamp)
                : Date.now() / 1000,
            });
          }
        }
      });

      // Update last active on message receipt acknowledgment
      this.sock.ev.on("messages.update", () => {
        this.touchLastActive();
      });

      console.log(
        `[Baileys] Restaurant ${this.restaurantId}: Socket created, waiting for connection...`
      );
    } catch (error) {
      console.error(
        `[Baileys] Restaurant ${this.restaurantId}: Connection error:`,
        error
      );
      this.setStatus("ERROR");
      this.sock = null;
      this.connectionAttemptInProgress = false;
      throw error;
    }
  }

  // ============================================================
  // Disconnect
  // ============================================================

  async disconnect(): Promise<void> {
    this.reconnectAttempts = 0;
    this.connectionAttemptInProgress = false;

    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.qrCode = null;
    this.qrGeneratedAt = null;
    this.connectedPhone = null;
    this.setStatus("DISCONNECTED");
  }

  // ============================================================
  // Refresh QR — close and reconnect to get new QR
  // ============================================================

  async refreshQr(): Promise<void> {
    console.log(
      `[Baileys] Restaurant ${this.restaurantId}: Refreshing QR code`
    );

    // Close existing socket if any
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.qrCode = null;
    this.qrGeneratedAt = null;
    this.connectionAttemptInProgress = false;
    this.reconnectAttempts = 0;

    // Reconnect to generate new QR
    await this.connect();
  }

  // ============================================================
  // Force Reconnect — close and reconnect from scratch
  // ============================================================

  async forceReconnect(): Promise<void> {
    console.log(
      `[Baileys] Restaurant ${this.restaurantId}: Force reconnecting`
    );

    // Close existing socket if any
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.qrCode = null;
    this.qrGeneratedAt = null;
    this.connectionAttemptInProgress = false;
    this.reconnectAttempts = 0;
    this.connectedPhone = null;

    // Reconnect
    await this.connect();
  }

  // ============================================================
  // Send message
  // ============================================================

  async sendMessage(to: string, message: string): Promise<void> {
    if (!this.sock || this.status !== "CONNECTED") {
      throw new Error(
        `WhatsApp not connected for restaurant ${this.restaurantId}`
      );
    }

    // Format phone number to JID
    const jid = to.includes("@")
      ? to
      : `${to.replace(/[^0-9]/g, "")}@s.whatsapp.net`;

    await this.sock.sendMessage(jid, { text: message });
    this.touchLastActive();
  }

  // ============================================================
  // Message parsing helpers
  // ============================================================

  private extractMessageContent(
    message: ReturnType<typeof Object> & Record<string, unknown>
  ): string {
    const msg = message as Record<string, unknown>;
    if (msg.conversation) return msg.conversation as string;
    if (msg.extendedTextMessage) {
      const ext = msg.extendedTextMessage as Record<string, unknown>;
      return (ext.text as string) || "";
    }
    if (msg.imageMessage) {
      const img = msg.imageMessage as Record<string, unknown>;
      return (img.caption as string) || "[Image]";
    }
    if (msg.videoMessage) {
      const vid = msg.videoMessage as Record<string, unknown>;
      return (vid.caption as string) || "[Video]";
    }
    if (msg.documentMessage) return "[Document]";
    if (msg.audioMessage) return "[Audio]";
    if (msg.stickerMessage) return "[Sticker]";
    return "";
  }

  private getMessageType(
    message: ReturnType<typeof Object> & Record<string, unknown>
  ): string {
    const msg = message as Record<string, unknown>;
    if (msg.conversation || msg.extendedTextMessage) return "text";
    if (msg.imageMessage) return "image";
    if (msg.videoMessage) return "video";
    if (msg.documentMessage) return "document";
    if (msg.audioMessage) return "audio";
    if (msg.stickerMessage) return "sticker";
    return "unknown";
  }
}
