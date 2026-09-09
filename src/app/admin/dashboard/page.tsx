"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orderService, type Order } from "@/services/order.service";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { useBranchContext } from "@/hooks/use-branch-context";
import { OrderScanner } from "@/components/admin/order-scanner";
import {
  ShoppingCart,
  Clock,
  ChefHat,
  Package,
  CheckCircle,
  DollarSign,
  CreditCard,
  AlertCircle,
  RefreshCw,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  normalizeApiError,
  isUnauthorized,
  type NormalizedApiError,
} from "@/lib/api-error-handler";

interface DashboardStats {
  todayOrders: number;
  pendingOrders: number;
  processingOrders: number;
  readyOrders: number;
  completedOrders: number;
  todayRevenue: string;
  pendingPayments: number;
  paidOrders: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const { isLoading: branchCtxLoading } = useBranchContext();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statsError, setStatsError] = useState<NormalizedApiError | null>(null);
  const [ordersError, setOrdersError] = useState<NormalizedApiError | null>(null);

  // Load stats and recent orders independently so a failure in one section
  // (e.g. an authorization 403) is surfaced with its own error instead of
  // blanking the whole dashboard. A rejected section is never shown as "no
  // data" — the error is displayed explicitly.
  const loadStats = async () => {
    setStatsError(null);
    try {
      const statsData = await orderService.getDashboardStats();
      setStats(statsData);
    } catch (error) {
      if (isUnauthorized(error)) return; // 401 handled by the axios interceptor
      console.error("Failed to load dashboard stats:", error);
      setStatsError(normalizeApiError(error));
    }
  };

  const loadRecentOrders = async () => {
    setOrdersError(null);
    try {
      const ordersData = await orderService.getOrders({ limit: 5 });
      setRecentOrders(ordersData.items);
    } catch (error) {
      if (isUnauthorized(error)) return; // 401 handled by the axios interceptor
      console.error("Failed to load recent orders:", error);
      setOrdersError(normalizeApiError(error));
    }
  };

  const loadDashboardData = async () => {
    setIsLoading(true);
    await Promise.allSettled([loadStats(), loadRecentOrders()]);
    setIsLoading(false);
  };

  useEffect(() => {
    // Wait for the branch context to resolve first so a stale
    // admin_branch_id in localStorage has already been cleared/validated
    // before data requests fire. Without this, a leftover branch id from a
    // previous session is sent as x-branch-id and the server correctly
    // rejects it with 403 (root cause of the Main Outlet cashier 403s).
    if (branchCtxLoading) return;
    loadDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchCtxLoading]);

  // Realtime: refresh stats + recent orders without a page reload whenever
  // orders/payments change (e.g. a QR-table customer places an order).
  useRealtimeListener(
    [
      REALTIME_EVENT_TYPES.ORDER_CREATED,
      REALTIME_EVENT_TYPES.ORDER_UPDATED,
      REALTIME_EVENT_TYPES.ORDER_STATUS_CHANGED,
      REALTIME_EVENT_TYPES.PAYMENT_CREATED,
      REALTIME_EVENT_TYPES.PAYMENT_STATUS_CHANGED,
      REALTIME_EVENT_TYPES.DASHBOARD_UPDATED,
      REALTIME_EVENT_TYPES.OFFLINE_POLL,
    ],
    () => {
      if (!isLoading) loadDashboardData();
    }
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-gray-500">Selamat datang di admin dashboard</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <OrderScanner
            onScan={(num) => router.push(`/admin/orders/${num}`)}
            triggerLabel="Scan QR Pesanan"
          />
          <Button
            variant="default"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => router.push("/admin/orders/new")}
          >
            <Plus className="h-4 w-4 mr-2" />
            Buat Pesanan
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      {statsError && (
        <DashboardErrorBanner error={statsError} onRetry={loadStats} />
      )}

      {!statsError && (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pesanan Hari Ini</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.todayOrders || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Menunggu Konfirmasi</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.pendingOrders || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sedang Diproses</CardTitle>
            <ChefHat className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.processingOrders || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Siap Diambil</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{stats?.readyOrders || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Selesai Hari Ini</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.completedOrders || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendapatan Hari Ini</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              Rp{Number(stats?.todayRevenue || 0).toLocaleString("id-ID")}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pembayaran Tertunda</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.pendingPayments || 0}</div>
          </CardContent>
        </Card>
      </div>
      )}

      {/* Recent Orders */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Pesanan Terbaru</CardTitle>
          {ordersError && ordersError.retryable && (
            <Button variant="outline" size="sm" onClick={loadRecentOrders}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Coba Lagi
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {ordersError ? (
            <div className="flex flex-col items-center justify-center py-6 space-y-3 text-center">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <p className="text-sm text-gray-600">{ordersError.message}</p>
              {!ordersError.retryable && (
                <p className="text-xs text-gray-400">
                  Silakan pilih cabang yang sesuai dengan akun Anda, atau hubungi admin.
                </p>
              )}
              {ordersError.retryable && (
                <Button variant="outline" size="sm" onClick={loadRecentOrders}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Coba Lagi
                </Button>
              )}
            </div>
          ) : recentOrders.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              Belum ada pesanan
            </p>
          ) : (
            <div className="space-y-4">
              {recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between border-b pb-4 last:border-0"
                >
                  <div>
                    <p className="font-medium">{order.orderNumber}</p>
                    <p className="text-sm text-gray-500">
                      {order.customer.name || "Guest"}
                      {order.table && ` • Meja ${order.table.number}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">
                      Rp{Number(order.grandTotal).toLocaleString("id-ID")}
                    </p>
                    <p className="text-sm text-gray-500">{order.status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Reusable inline error banner for a dashboard section that failed to load.
 * Differentiates a hard 403 (do not retry, point the user to their branch)
 * from transient failures (429/5xx/network) that offer "Coba Lagi".
 */
function DashboardErrorBanner({
  error,
  onRetry,
}: {
  error: NormalizedApiError;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-6 space-y-3 text-center">
      <AlertCircle className="h-8 w-8 text-red-500" />
      <p className="text-sm text-gray-700">{error.message}</p>
      {error.retryable ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Coba Lagi
        </Button>
      ) : (
        <p className="text-xs text-gray-400">
          Silakan pilih cabang yang sesuai dengan akun Anda, atau hubungi admin.
        </p>
      )}
    </div>
  );
}
