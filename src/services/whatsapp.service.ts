import api from "@/lib/axios";

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

export interface WhatsAppStatus {
  restaurantId: string;
  status: ConnectionStatus;
  phone: string | null;
  qrCode: string | null;
  lastActiveAt: string;
  lastError: string | null;
  queue?: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  };
}

export interface QrResponse {
  qrCode: string | null;
  status: ConnectionStatus;
  message: string;
}

// ============================================================
// WhatsApp Service (Client-side)
// ============================================================

export const whatsappService = {
  /**
   * Get current WhatsApp connection status.
   */
  async getStatus(): Promise<WhatsAppStatus> {
    const response = await api.get("/whatsapp/status");
    return response.data.data;
  },

  /**
   * Initiate WhatsApp connection.
   * After calling this, poll /qr for QR code.
   */
  async connect(): Promise<WhatsAppStatus> {
    const response = await api.post("/whatsapp/connect");
    return response.data.data;
  },

  /**
   * Disconnect WhatsApp.
   */
  async disconnect(): Promise<WhatsAppStatus> {
    const response = await api.post("/whatsapp/disconnect");
    return response.data.data;
  },

  /**
   * Force reconnect WhatsApp.
   * Closes existing connection and reconnects from scratch.
   * Used when admin wants to retry after error.
   */
  async reconnect(): Promise<WhatsAppStatus> {
    const response = await api.post("/whatsapp/reconnect");
    return response.data.data;
  },

  /**
   * Get QR code for WhatsApp pairing.
   * Returns qrCode (base64 data URL or null), status, and message.
   */
  async getQrCode(): Promise<QrResponse> {
    const response = await api.get("/whatsapp/qr");
    return response.data.data;
  },
};
