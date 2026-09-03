"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  MessageSquare,
  Wifi,
  WifiOff,
  QrCode,
  Phone,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
} from "lucide-react";
import {
  whatsappService,
  type WhatsAppStatus,
  type ConnectionStatus,
} from "@/services/whatsapp.service";

// ============================================================
// Status Config
// ============================================================

const STATUS_CONFIG: Record<
  ConnectionStatus,
  {
    label: string;
    color: "default" | "secondary" | "destructive" | "outline";
    icon: typeof Wifi;
    description: string;
  }
> = {
  DISCONNECTED: {
    label: "Terputus",
    color: "secondary",
    icon: WifiOff,
    description: "WhatsApp belum terhubung",
  },
  CONNECTING: {
    label: "Menghubungkan",
    color: "outline",
    icon: Loader2,
    description: "Sedang menghubungkan ke WhatsApp...",
  },
  QR_REQUIRED: {
    label: "Perlu QR",
    color: "default",
    icon: QrCode,
    description: "Scan QR code dengan WhatsApp",
  },
  CONNECTED: {
    label: "Terhubung",
    color: "default",
    icon: CheckCircle,
    description: "WhatsApp sudah terhubung",
  },
  RECONNECTING: {
    label: "Menghubungkan Ulang",
    color: "outline",
    icon: RefreshCw,
    description: "Sedang menghubungkan ulang...",
  },
  ERROR: {
    label: "Error",
    color: "destructive",
    icon: XCircle,
    description: "Terjadi kesalahan koneksi",
  },
};

// ============================================================
// Main Page Component
// ============================================================

export default function WhatsAppPage() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ============================================================
  // Fetch Status
  // ============================================================

  const fetchStatus = useCallback(async () => {
    try {
      const data = await whatsappService.getStatus();
      setStatus(data);

      // If status changed away from QR_REQUIRED, stop polling QR
      if (data.status !== "QR_REQUIRED" && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }

      return data;
    } catch {
      console.error("Failed to fetch WhatsApp status");
      return null;
    }
  }, []);

  // ============================================================
  // Fetch QR Code
  // ============================================================

  const fetchQrCode = useCallback(async () => {
    try {
      const data = await whatsappService.getQrCode();
      if (data.qrCode) {
        setQrCode(data.qrCode);
      }
      return data;
    } catch {
      console.error("Failed to fetch QR code");
      return null;
    }
  }, []);

  // ============================================================
  // Poll QR Code
  // ============================================================

  const startQrPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
    }

    pollRef.current = setInterval(async () => {
      const statusData = await fetchStatus();
      if (statusData?.status === "QR_REQUIRED") {
        await fetchQrCode();
      } else if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 2000);
  }, [fetchStatus, fetchQrCode]);

  // ============================================================
  // Connect
  // ============================================================

  const handleConnect = async () => {
    setIsConnecting(true);
    setQrCode(null);
    try {
      await whatsappService.connect();
      toast.success("WhatsApp sedang menghubungkan...");

      // Start polling for QR code
      startQrPolling();

      // Fetch initial status
      await fetchStatus();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Gagal menghubungkan WhatsApp";
      toast.error(message);
    } finally {
      setIsConnecting(false);
    }
  };

  // ============================================================
  // Disconnect
  // ============================================================

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await whatsappService.disconnect();
      setQrCode(null);
      toast.success("WhatsApp berhasil terputus");
      await fetchStatus();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Gagal memutuskan WhatsApp";
      toast.error(message);
    } finally {
      setIsDisconnecting(false);
    }
  };

  // ============================================================
  // Force Reconnect (for ERROR state)
  // ============================================================

  const handleReconnect = async () => {
    setIsReconnecting(true);
    setQrCode(null);
    try {
      await whatsappService.reconnect();
      toast.success("WhatsApp sedang menyambungkan kembali...");
      startQrPolling();
      await fetchStatus();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Gagal menyambungkan kembali WhatsApp";
      toast.error(message);
    } finally {
      setIsReconnecting(false);
    }
  };

  // ============================================================
  // Refresh QR (close and reconnect to get new QR)
  // ============================================================

  const handleRefreshQr = async () => {
    setIsConnecting(true);
    setQrCode(null);
    try {
      await whatsappService.connect();
      toast.success("QR code baru sedang dibuat...");
      startQrPolling();
      await fetchStatus();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Gagal me-refresh QR code";
      toast.error(message);
    } finally {
      setIsConnecting(false);
    }
  };

  // ============================================================
  // Refresh Status
  // ============================================================

  const handleRefresh = async () => {
    setIsLoading(true);
    await fetchStatus();
    if (status?.status === "QR_REQUIRED") {
      await fetchQrCode();
    }
    setIsLoading(false);
  };

  // ============================================================
  // Initial Load & Auto-refresh
  // ============================================================

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await fetchStatus();
      setIsLoading(false);
    };
    init();

    // Auto-refresh status every 10 seconds
    const interval = setInterval(fetchStatus, 10000);

    return () => {
      clearInterval(interval);
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [fetchStatus]);

  // ============================================================
  // Render
  // ============================================================

  const statusConfig = status
    ? STATUS_CONFIG[status.status]
    : STATUS_CONFIG.DISCONNECTED;
  const StatusIcon = statusConfig.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <MessageSquare className="h-8 w-8" />
            WhatsApp
          </h1>
          <p className="text-gray-500">
            Kelola koneksi WhatsApp restoran
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleRefresh}
          disabled={isLoading}
          className="w-full sm:w-auto"
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Connection Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <StatusIcon className="h-5 w-5" />
              Status Koneksi
            </CardTitle>
            <CardDescription>
              Informasi koneksi WhatsApp
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Status Badge */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Status:</span>
              <Badge variant={statusConfig.color}>
                {statusConfig.label}
              </Badge>
            </div>

            {/* Status Description */}
            <p className="text-sm text-gray-600">
              {statusConfig.description}
            </p>

            {/* Connected Phone */}
            {status?.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-gray-500" />
                <span className="font-medium">Nomor:</span>
                <span>{status.phone}</span>
              </div>
            )}

            {/* Last Error */}
            {status?.lastError && (
              <div className="flex items-start gap-2 text-sm text-red-600">
                <AlertTriangle className="h-4 w-4 mt-0.5" />
                <span>{status.lastError}</span>
              </div>
            )}

            {/* Last Active */}
            {status?.lastActiveAt && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Clock className="h-4 w-4" />
                <span>
                  Terakhir aktif:{" "}
                  {new Date(status.lastActiveAt).toLocaleString("id-ID")}
                </span>
              </div>
            )}

            <Separator />

            {/* Action Buttons */}
            <div className="flex gap-2">
              {/* DISCONNECTED / ERROR — Show Connect/Reconnect */}
              {(status?.status === "DISCONNECTED" ||
                status?.status === "ERROR") && (
                <Button
                  onClick={
                    status?.status === "ERROR"
                      ? handleReconnect
                      : handleConnect
                  }
                  disabled={isConnecting || isReconnecting}
                  className="flex-1"
                >
                  {isConnecting || isReconnecting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Wifi className="h-4 w-4 mr-2" />
                  )}
                  {status?.status === "ERROR"
                    ? "Hubungkan Ulang"
                    : "Hubungkan"}
                </Button>
              )}

              {/* CONNECTING / QR_REQUIRED — Show Cancel */}
              {(status?.status === "CONNECTING" ||
                status?.status === "QR_REQUIRED" ||
                status?.status === "RECONNECTING") && (
                <Button
                  variant="destructive"
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="flex-1"
                >
                  {isDisconnecting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <WifiOff className="h-4 w-4 mr-2" />
                  )}
                  Batalkan
                </Button>
              )}

              {/* CONNECTED — Show Disconnect */}
              {status?.status === "CONNECTED" && (
                <Button
                  variant="destructive"
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="flex-1"
                >
                  {isDisconnecting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <WifiOff className="h-4 w-4 mr-2" />
                  )}
                  Putuskan
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* QR Code Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              QR Code
            </CardTitle>
            <CardDescription>
              Scan QR code dengan WhatsApp untuk menghubungkan
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center min-h-[300px]">
            {status?.status === "QR_REQUIRED" && qrCode ? (
              <div className="space-y-4">
                {/* QR Code Image */}
                <div className="p-3 sm:p-4 bg-white rounded-lg border-2 border-dashed border-gray-200">
                  <img
                    src={qrCode}
                    alt="WhatsApp QR Code"
                    className="w-52 h-52 sm:w-64 sm:h-64 max-w-full"
                  />
                </div>
                <p className="text-sm text-center text-gray-600">
                  Buka WhatsApp → Settings → Linked Devices → Link a Device
                </p>
                {/* QR Actions */}
                <div className="flex gap-2 justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshQr}
                    disabled={isConnecting}
                  >
                    <RefreshCw
                      className={`h-4 w-4 mr-2 ${isConnecting ? "animate-spin" : ""}`}
                    />
                    Refresh QR
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDisconnect}
                    disabled={isDisconnecting}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Batalkan
                  </Button>
                </div>
              </div>
            ) : status?.status === "CONNECTED" ? (
              <div className="text-center space-y-2">
                <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
                <p className="text-lg font-medium text-green-700">
                  WhatsApp Terhubung
                </p>
                {status.phone && (
                  <p className="text-sm text-gray-600">
                    Nomor: {status.phone}
                  </p>
                )}
              </div>
            ) : status?.status === "CONNECTING" ||
              status?.status === "RECONNECTING" ? (
              <div className="text-center space-y-2">
                <Loader2 className="h-16 w-16 text-blue-500 mx-auto animate-spin" />
                <p className="text-lg font-medium text-blue-700">
                  {status.status === "CONNECTING"
                    ? "Menghubungkan..."
                    : "Menghubungkan Ulang..."}
                </p>
                <p className="text-sm text-gray-600">
                  Menunggu QR code...
                </p>
              </div>
            ) : status?.status === "ERROR" ? (
              <div className="text-center space-y-2">
                <XCircle className="h-16 w-16 text-red-500 mx-auto" />
                <p className="text-lg font-medium text-red-700">
                  Koneksi Error
                </p>
                <p className="text-sm text-gray-600">
                  {status.lastError || "Terjadi kesalahan koneksi"}
                </p>
                <Button
                  onClick={handleReconnect}
                  disabled={isReconnecting}
                >
                  {isReconnecting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Hubungkan Ulang
                </Button>
              </div>
            ) : (
              <div className="text-center space-y-2">
                <WifiOff className="h-16 w-16 text-gray-400 mx-auto" />
                <p className="text-lg font-medium text-gray-700">
                  Belum Terhubung
                </p>
                <p className="text-sm text-gray-600">
                  Klik &quot;Hubungkan&quot; untuk memulai
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Queue Stats */}
      {status?.queue && (
        <Card>
          <CardHeader>
            <CardTitle>Queue Status</CardTitle>
            <CardDescription>
              Status antrian pesan WhatsApp
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold">{status.queue.waiting}</p>
                <p className="text-sm text-gray-500">Menunggu</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{status.queue.active}</p>
                <p className="text-sm text-gray-500">Aktif</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">
                  {status.queue.completed}
                </p>
                <p className="text-sm text-gray-500">Selesai</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-red-600">
                  {status.queue.failed}
                </p>
                <p className="text-sm text-gray-500">Gagal</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
