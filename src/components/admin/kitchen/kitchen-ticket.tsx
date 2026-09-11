"use client";

import { useState, useEffect, useCallback } from "react";
import {
  UtensilsCrossed,
  ShoppingBag,
  Truck,
  Clock,
  Loader2,
} from "lucide-react";
import type { Order } from "@/services/order.service";
import { orderService } from "@/services/order.service";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// ============================================================
// Customization snapshot shape (matches OrderItem.customizations)
// ============================================================

interface CustomizationSnapshot {
  productName?: string;
  selections?: Array<{
    groupName: string;
    optionName: string;
    priceAdjustment?: number;
  }>;
  addons?: Array<{ name: string; price: number; quantity: number }>;
  notes?: string;
}

function parseCustomizations(
  value?: string | Record<string, unknown> | null
): CustomizationSnapshot | null {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

// ============================================================
// Elapsed time
// ============================================================

function formatElapsed(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function ElapsedTimer({ createdAt }: { createdAt: string }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return <span>{formatElapsed(createdAt)}</span>;
}

// ============================================================
// Order type badge
// ============================================================

const TYPE_META: Record<
  string,
  { label: string; Icon: typeof UtensilsCrossed; cls: string }
> = {
  DINE_IN: {
    label: "Dine In",
    Icon: UtensilsCrossed,
    cls: "bg-blue-50 text-blue-700",
  },
  TAKEAWAY: {
    label: "Takeaway",
    Icon: ShoppingBag,
    cls: "bg-amber-50 text-amber-700",
  },
  DELIVERY: {
    label: "Delivery",
    Icon: Truck,
    cls: "bg-purple-50 text-purple-700",
  },
};

// ============================================================
// Ticket card
// ============================================================

interface KitchenTicketProps {
  order: Order;
  /** What the action button does for this ticket. */
  action: {
    label: string;
    /** The target status to send to the API. */
    targetStatus: string;
    /** If the order needs a two-step transition (PENDING→CONFIRMED→PROCESSING),
     *  provide the intermediate step. The component handles both in sequence. */
    intermediateStatus?: string;
  };
  /** Visual accent class for the column header area. */
  accentClass?: string;
  onActionDone: () => void;
}

export function KitchenTicket({
  order,
  action,
  accentClass,
  onActionDone,
}: KitchenTicketProps) {
  const [loading, setLoading] = useState(false);

  const handleAction = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      // Two-step transition: PENDING → CONFIRMED → PROCESSING
      if (action.intermediateStatus) {
        await orderService.updateOrderStatus(
          order.id,
          action.intermediateStatus
        );
        await orderService.updateOrderStatus(order.id, action.targetStatus);
      } else {
        await orderService.updateOrderStatus(order.id, action.targetStatus);
      }
      onActionDone();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal mengupdate status";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [loading, order.id, action, onActionDone]);

  const typeMeta = TYPE_META[order.orderType] || TYPE_META.DINE_IN;
  const TypeIcon = typeMeta.Icon;

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden flex flex-col">
      {/* Header accent strip */}
      <div className={`h-1.5 ${accentClass || "bg-gray-200"}`} />

      <div className="p-3.5 flex flex-col gap-2.5 flex-1">
        {/* Row 1: Order number + elapsed */}
        <div className="flex items-center justify-between">
          <span className="font-mono font-bold text-base text-gray-900 truncate">
            #{order.orderNumber}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Clock className="h-3 w-3" />
            <ElapsedTimer createdAt={order.createdAt} />
          </span>
        </div>

        {/* Row 2: Type badge + table / customer */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${typeMeta.cls}`}
          >
            <TypeIcon className="h-3 w-3" />
            {typeMeta.label}
          </span>
          {order.orderType === "DINE_IN" && order.table && (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
              Meja {order.table.number}
            </span>
          )}
          {order.customer?.name && (
            <span className="text-xs text-muted-foreground truncate">
              {order.customer.name}
            </span>
          )}
        </div>

        {/* Row 3: Items */}
        <div className="space-y-1.5 min-h-0 flex-1">
          {order.items.map((item) => {
            const cust = parseCustomizations(item.customizations);
            return (
              <div key={item.id} className="text-sm">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-semibold text-gray-900">
                    {item.quantity}x
                  </span>
                  <span className="text-gray-800 truncate">
                    {item.product.name}
                  </span>
                </div>
                {/* Variants */}
                {cust?.selections && cust.selections.length > 0 && (
                  <div className="pl-5 text-xs text-gray-500">
                    {cust.selections.map((s, i) => (
                      <p key={i}>
                        {s.groupName}: {s.optionName}
                      </p>
                    ))}
                  </div>
                )}
                {/* Addons */}
                {cust?.addons && cust.addons.length > 0 && (
                  <div className="pl-5 text-xs text-gray-500">
                    {cust.addons.map((a, i) => (
                      <p key={i}>
                        +{a.name}
                        {a.quantity > 1 ? ` x${a.quantity}` : ""}
                      </p>
                    ))}
                  </div>
                )}
                {/* Notes */}
                {(item.notes || cust?.notes) && (
                  <p className="pl-5 text-xs text-amber-600 italic">
                    {item.notes || cust?.notes}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Action button */}
      <div className="px-3.5 pb-3.5 pt-1">
        <Button
          onClick={handleAction}
          disabled={loading}
          className="w-full font-semibold text-sm h-9"
          size="sm"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            action.label
          )}
        </Button>
      </div>
    </div>
  );
}
