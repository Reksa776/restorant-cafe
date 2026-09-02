"use client";

import { useEffect, useState, useCallback } from "react";
import { orderService, type Order } from "@/services/order.service";
import { toast } from "sonner";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrderSummary } from "@/components/admin/orders/order-summary";
import { OrderFilters } from "@/components/admin/orders/order-filters";
import { OrderCard } from "@/components/admin/orders/order-card";
import { OrderDetail } from "@/components/admin/orders/order-detail";
import {
  OrderCardSkeleton,
  OrderSummarySkeleton,
} from "@/components/admin/orders/order-skeleton";

export default function OrdersPage() {
  // Data state
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<{
    pendingOrders: number;
    processingOrders: number;
    readyOrders: number;
    todayOrders: number;
  } | null>(null);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  // Detail drawer state
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // ============================================================
  // Data Loading
  // ============================================================

  const loadOrders = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setIsRefreshing(true);
      setError(null);

      try {
        const [ordersResult, statsResult] = await Promise.all([
          orderService.getOrders({
            status: statusFilter === "all" ? undefined : statusFilter,
            search: search || undefined,
          }),
          orderService.getDashboardStats(),
        ]);

        let filteredOrders = ordersResult.items;

        // Client-side filter by order type
        if (typeFilter !== "all") {
          filteredOrders = filteredOrders.filter(
            (o) => o.orderType === typeFilter
          );
        }

        setOrders(filteredOrders);
        setStats(statsResult);
      } catch (err) {
        console.error("Failed to load orders:", err);
        setError("Gagal memuat pesanan");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [statusFilter, search, typeFilter]
  );

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // ============================================================
  // Handlers
  // ============================================================

  const handleSearchSubmit = () => {
    loadOrders();
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
  };

  const handleTypeChange = (value: string) => {
    setTypeFilter(value);
  };

  const handleDetail = (order: Order) => {
    setSelectedOrder(order);
    setIsDetailOpen(true);
  };

  const handleStatusUpdate = async (orderId: string, status: string) => {
    setIsUpdating(true);
    try {
      const result = await orderService.updateOrderStatus(orderId, status);
      toast.success("Status pesanan berhasil diupdate");
      if (result.whatsappTriggered) {
        toast.info("Notifikasi WhatsApp dikirim ke pelanggan");
      }
      loadOrders();
    } catch (err) {
      console.error("Failed to update order status:", err);
      toast.error("Gagal mengupdate status pesanan");
    } finally {
      setIsUpdating(false);
    }
  };

  // ============================================================
  // Loading State
  // ============================================================

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Pesanan</h1>
          <p className="text-muted-foreground">Kelola pesanan restoran</p>
        </div>
        <OrderSummarySkeleton />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <OrderCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // ============================================================
  // Error State
  // ============================================================

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Pesanan</h1>
          <p className="text-muted-foreground">Kelola pesanan restoran</p>
        </div>
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <p className="text-lg font-medium">{error}</p>
          <Button onClick={() => loadOrders()} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Coba Lagi
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================
  // Empty State
  // ============================================================

  const hasOrders = orders.length > 0;
  const hasActiveFilters =
    statusFilter !== "all" || typeFilter !== "all" || search !== "";

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pesanan</h1>
          <p className="text-muted-foreground">Kelola pesanan restoran</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadOrders(true)}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      {stats && (
        <OrderSummary
          pending={stats.pendingOrders}
          processing={stats.processingOrders}
          ready={stats.readyOrders}
          todayTotal={stats.todayOrders}
        />
      )}

      {/* Filters */}
      <OrderFilters
        search={search}
        statusFilter={statusFilter}
        typeFilter={typeFilter}
        onSearchChange={setSearch}
        onSearchSubmit={handleSearchSubmit}
        onStatusChange={handleStatusChange}
        onTypeChange={handleTypeChange}
      />

      {/* Order Cards Grid */}
      {!hasOrders ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <div className="text-4xl">📋</div>
          <p className="text-lg font-medium text-muted-foreground">
            {hasActiveFilters
              ? "Tidak ada pesanan ditemukan"
              : "Belum ada pesanan"}
          </p>
          {!hasActiveFilters && (
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Pesanan dari website pelanggan akan muncul di sini.
            </p>
          )}
          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setTypeFilter("all");
              }}
            >
              Reset Filter
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onDetail={handleDetail}
              onStatusChange={handleStatusUpdate}
              isUpdating={isUpdating}
            />
          ))}
        </div>
      )}

      {/* Detail Drawer */}
      <OrderDetail
        order={selectedOrder}
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
      />
    </div>
  );
}
