"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Eye,
  CheckCircle,
  XCircle,
  ChefHat,
  Package,
  Clock,
  MessageSquare,
  MessageSquareOff,
  UtensilsCrossed,
  ShoppingBag,
  Truck,
  CreditCard,
  Banknote,
} from "lucide-react";
import type { Order } from "@/services/order.service";

// ============================================================
// Constants
// ============================================================

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: typeof Clock }
> = {
  PENDING: {
    label: "Menunggu",
    color: "bg-yellow-100 text-yellow-800 border-yellow-200",
    icon: Clock,
  },
  CONFIRMED: {
    label: "Dikonfirmasi",
    color: "bg-blue-100 text-blue-800 border-blue-200",
    icon: CheckCircle,
  },
  PROCESSING: {
    label: "Diproses",
    color: "bg-purple-100 text-purple-800 border-purple-200",
    icon: ChefHat,
  },
  READY: {
    label: "Siap",
    color: "bg-orange-100 text-orange-800 border-orange-200",
    icon: Package,
  },
  COMPLETED: {
    label: "Selesai",
    color: "bg-green-100 text-green-800 border-green-200",
    icon: CheckCircle,
  },
  CANCELLED: {
    label: "Dibatalkan",
    color: "bg-red-100 text-red-800 border-red-200",
    icon: XCircle,
  },
};

const ORDER_TYPE_CONFIG: Record<
  string,
  { label: string; icon: typeof UtensilsCrossed; color: string }
> = {
  DINE_IN: {
    label: "Dine In",
    icon: UtensilsCrossed,
    color: "text-blue-600",
  },
  TAKEAWAY: {
    label: "Takeaway",
    icon: ShoppingBag,
    color: "text-amber-600",
  },
  DELIVERY: {
    label: "Delivery",
    icon: Truck,
    color: "text-green-600",
  },
};

const PAYMENT_STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: typeof CreditCard }
> = {
  UNPAID: {
    label: "Belum Bayar",
    color: "bg-gray-100 text-gray-600 border-gray-200",
    icon: CreditCard,
  },
  PENDING: {
    label: "Menunggu",
    color: "bg-yellow-100 text-yellow-700 border-yellow-200",
    icon: CreditCard,
  },
  PAID: {
    label: "Lunas",
    color: "bg-green-100 text-green-700 border-green-200",
    icon: CreditCard,
  },
  FAILED: {
    label: "Gagal",
    color: "bg-red-100 text-red-700 border-red-200",
    icon: CreditCard,
  },
  EXPIRED: {
    label: "Kedaluwarsa",
    color: "bg-orange-100 text-orange-700 border-orange-200",
    icon: CreditCard,
  },
};

const MAX_VISIBLE_ITEMS = 3;

// ============================================================
// Props
// ============================================================

interface OrderCardProps {
  order: Order;
  onDetail: (order: Order) => void;
  onStatusChange: (orderId: string, status: string) => void;
  onMarkPaid: (paymentId: string, orderId: string) => void;
  isUpdating: boolean;
}

// ============================================================
// Component
// ============================================================

export function OrderCard({
  order,
  onDetail,
  onStatusChange,
  onMarkPaid,
  isUpdating,
}: OrderCardProps) {
  const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG.PENDING;
  const typeConfig = ORDER_TYPE_CONFIG[order.orderType] || ORDER_TYPE_CONFIG.DINE_IN;
  const StatusIcon = statusConfig.icon;
  const TypeIcon = typeConfig.icon;

  const hasPhone =
    order.customer.phone && !order.customer.phone.startsWith("guest-");
  const visibleItems = order.items.slice(0, MAX_VISIBLE_ITEMS);
  const hiddenItemsCount = order.items.length - MAX_VISIBLE_ITEMS;
  const orderTime = new Date(order.createdAt).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const isPending = order.status === "PENDING";
  const isConfirmed = order.status === "CONFIRMED";
  const isProcessing = order.status === "PROCESSING";
  const isReady = order.status === "READY";

  // KASIR payment intent (latest unpaid one wins; fall back to any row).
  const payments = order.payments || [];
  const cashierPayment =
    payments.find((p) => p.method === "KASIR" && p.status !== "PAID") ||
    payments.find((p) => p.method === "KASIR");
  const isCashierUnpaid =
    !!cashierPayment && cashierPayment.status !== "PAID";

  return (
    <Card
      className={`border shadow-sm hover:shadow-md transition-shadow ${
        isPending ? "border-yellow-200 bg-yellow-50/30" : ""
      }`}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header: Order Number + Time */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm font-bold">
            #{order.orderNumber}
          </span>
          <span className="text-xs text-muted-foreground">{orderTime}</span>
        </div>

        {/* Status Badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge
            className={`${statusConfig.color} border text-[11px] font-medium px-2 py-0.5`}
          >
            <StatusIcon className="h-3 w-3 mr-1" />
            {statusConfig.label}
          </Badge>
          {(() => {
            const payConfig = PAYMENT_STATUS_CONFIG[order.paymentStatus];
            if (payConfig) {
              const PayIcon = payConfig.icon;
              return (
                <Badge
                  className={`${payConfig.color} border text-[11px] font-medium px-2 py-0.5`}
                >
                  <PayIcon className="h-3 w-3 mr-1" />
                  {payConfig.label}
                </Badge>
              );
            }
            return null;
          })()}
          <Badge
            variant="outline"
            className={`${typeConfig.color} text-[11px] font-medium`}
          >
            <TypeIcon className="h-3 w-3 mr-1" />
            {typeConfig.label}
          </Badge>
          {order.table && (          <Badge variant="outline" className="text-[11px]">
            Meja {order.table.number}
          </Badge>
          )}
          {order.visitorCount && (
            <Badge variant="outline" className="text-[11px]">
              {order.visitorCount} orang
            </Badge>
          )}
          {isCashierUnpaid && (
            <Badge className="bg-amber-50 text-amber-800 border-amber-200 text-[11px] font-medium px-2 py-0.5">
              <Banknote className="h-3 w-3 mr-1" />
              Bayar di Kasir
            </Badge>
          )}
        </div>

        {/* Customer Info */}
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {order.customer.name || "Guest"}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {hasPhone ? (
              <>
                <MessageSquare className="h-3 w-3 text-green-500" />
                <span>{order.customer.phone}</span>
              </>
            ) : (
              <>
                <MessageSquareOff className="h-3 w-3 text-gray-400" />
                <span>WhatsApp tidak tersedia</span>
              </>
            )}
          </div>
        </div>

        <Separator />

        {/* Order Items */}
        <div className="space-y-1">
          {visibleItems.map((item) => {
            let customizations: { selections?: Array<{ groupName: string; optionName: string; priceAdjustment: number }>; addons?: Array<{ name: string; price: number; quantity: number }>; notes?: string } | null = null;
            if (item.customizations) {
              try {
                customizations = typeof item.customizations === "string"
                  ? JSON.parse(item.customizations as string)
                  : item.customizations;
              } catch {
                // ignore
              }
            }
            return (
              <div key={item.id} className="text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {item.quantity}x {item.product.name}
                  </span>
                  <span className="font-medium tabular-nums">
                    Rp{Number(item.totalPrice).toLocaleString("id-ID")}
                  </span>
                </div>
                {customizations?.selections && (
                  <div className="pl-2">
                    {customizations.selections.map((s, i) => (
                      <p key={i} className="text-[10px] text-muted-foreground">
                        {s.groupName}: {s.optionName}
                        {s.priceAdjustment > 0 && (
                          <span className="text-muted-foreground/70"> +Rp{s.priceAdjustment.toLocaleString("id-ID")}</span>
                        )}
                      </p>
                    ))}
                  </div>
                )}
                {customizations?.addons && (
                  <div className="pl-2">
                    {customizations.addons.map((a, i) => (
                      <p key={i} className="text-[10px] text-muted-foreground">
                        + {a.name} x{a.quantity}
                      </p>
                    ))}
                  </div>
                )}
                {customizations?.notes && (
                  <p className="pl-2 text-[10px] text-muted-foreground italic">
                    Catatan: {customizations.notes}
                  </p>
                )}
              </div>
            );
          })}
          {hiddenItemsCount > 0 && (
            <button
              onClick={() => onDetail(order)}
              className="text-xs text-blue-600 hover:underline"
            >
              + {hiddenItemsCount} item lainnya
            </button>
          )}
        </div>

        <Separator />

        {/* Total */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Total</span>
          <span className="text-base font-bold tabular-nums">
            Rp{Number(order.grandTotal).toLocaleString("id-ID")}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDetail(order)}
            className="flex-1"
          >
            <Eye className="h-3.5 w-3.5 mr-1" />
            Detail
          </Button>

          {isPending && (
            <>
              <Button
                size="sm"
                onClick={() => onStatusChange(order.id, "CONFIRMED")}
                disabled={isUpdating}
                className="flex-1"
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                Konfirmasi
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onStatusChange(order.id, "CANCELLED")}
                disabled={isUpdating}
              >
                <XCircle className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          {isConfirmed && (
            <Button
              size="sm"
              onClick={() => onStatusChange(order.id, "PROCESSING")}
              disabled={isUpdating}
              className="flex-1"
            >
              <ChefHat className="h-3.5 w-3.5 mr-1" />
              Proses
            </Button>
          )}

          {isProcessing && (
            <Button
              size="sm"
              onClick={() => onStatusChange(order.id, "READY")}
              disabled={isUpdating}
              className="flex-1 bg-orange-500 hover:bg-orange-600"
            >
              <Package className="h-3.5 w-3.5 mr-1" />
              Siap
            </Button>
          )}

          {isReady && (
            <Button
              size="sm"
              onClick={() => onStatusChange(order.id, "COMPLETED")}
              disabled={isUpdating}
              className="flex-1 bg-green-500 hover:bg-green-600"
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1" />
              Selesai
            </Button>
          )}
        </div>

        {/* Cashier payment — collect & mark as paid (UNPAID only) */}
        {isCashierUnpaid && cashierPayment && (
          <Button
            size="sm"
            onClick={() => onMarkPaid(cashierPayment.id, order.id)}
            disabled={isUpdating}
            className="w-full bg-green-600 hover:bg-green-700"
          >
            <Banknote className="h-3.5 w-3.5 mr-1" />
            Tandai Sudah Dibayar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
