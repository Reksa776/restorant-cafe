"use client";

import { useCallback, useEffect, useState } from "react";
import { orderService, type Order } from "@/services/order.service";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  normalizeApiError,
  isUnauthorized,
  type NormalizedApiError,
} from "@/lib/api-error-handler";
import { KitchenBoard } from "@/components/admin/kitchen/kitchen-board";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// ============================================================
// KDS statuses — the "active" order queue
// ============================================================

const KDS_STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "READY"];

// ============================================================
// Kitchen Page
// ============================================================

export default function KitchenPage() {
  const { isLoading: branchCtxLoading } = useBranchContext();

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<NormalizedApiError | null>(null);

  // ----------------------------------------------------------
  // Data loading
  // ----------------------------------------------------------

  const loadOrders = useCallback(async () => {
    setError(null);
    try {
      // Fetch all active kitchen orders. The API returns branch-scoped
      // results based on the authenticated user's branch context.
      const result = await orderService.getOrders({ limit: 100 });

      // Client-side filter: only show orders relevant to the kitchen.
      const active = result.items.filter((o) =>
        KDS_STATUSES.includes(o.status)
      );
      setOrders(active);
    } catch (err) {
      if (isUnauthorized(err)) return;
      console.error("Failed to load kitchen orders:", err);
      setError(normalizeApiError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (branchCtxLoading) return;
    loadOrders();
  }, [branchCtxLoading, loadOrders]);

  // ----------------------------------------------------------
  // Realtime — refetch on order lifecycle events
  // ----------------------------------------------------------

  useRealtimeListener(
    [
      REALTIME_EVENT_TYPES.ORDER_CREATED,
      REALTIME_EVENT_TYPES.ORDER_STATUS_CHANGED,
      REALTIME_EVENT_TYPES.ORDER_UPDATED,
      REALTIME_EVENT_TYPES.OFFLINE_POLL,
    ],
    () => {
      if (!isLoading) loadOrders();
    },
    1000 // 1s cooldown — kitchen needs near-realtime but not thrashing
  );

  // ----------------------------------------------------------
  // Loading state
  // ----------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100dvh-4rem)] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Memuat dapur…</p>
      </div>
    );
  }

  // ----------------------------------------------------------
  // Error state
  // ----------------------------------------------------------

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100dvh-4rem)] gap-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <p className="text-lg font-medium">{error.message}</p>
        {error.retryable && (
          <Button variant="outline" size="sm" onClick={loadOrders}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Coba Lagi
          </Button>
        )}
      </div>
    );
  }

  // ----------------------------------------------------------
  // Board
  // ----------------------------------------------------------

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] p-4 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dapur</h1>
          <p className="text-sm text-muted-foreground">
            {orders.length} pesanan aktif
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadOrders}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Board fills remaining space */}
      <div className="flex-1 min-h-0">
        <KitchenBoard orders={orders} onActionDone={loadOrders} />
      </div>
    </div>
  );
}
