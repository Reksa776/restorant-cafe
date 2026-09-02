export type ConnectionStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "QR_REQUIRED"
  | "CONNECTED"
  | "RECONNECTING"
  | "ERROR";

export interface WhatsAppProvider {
  sendMessage(to: string, message: string): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  forceReconnect(): Promise<void>;
  refreshQr(): Promise<void>;
  getConnectionStatus(): ConnectionStatus;
  getQrCode(): string | null;
  getConnectedPhone(): string | null;
  getLastActiveAt(): Date;
  isHealthy(): boolean;
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
