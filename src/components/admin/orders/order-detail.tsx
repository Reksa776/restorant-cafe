"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  MessageSquare,
  MessageSquareOff,
  UtensilsCrossed,
  ShoppingBag,
  Truck,
  Clock,
  CheckCircle,
  ChefHat,
  Package,
  XCircle,
  User,
  CreditCard,
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

const ORDER_TYPE_LABELS: Record<string, { label: string; icon: typeof UtensilsCrossed }> = {
  DINE_IN: { label: "Dine In", icon: UtensilsCrossed },
  TAKEAWAY: { label: "Takeaway", icon: ShoppingBag },
  DELIVERY: { label: "Delivery", icon: Truck },
};

const PAYMENT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  UNPAID: { label: "Belum Bayar", color: "bg-gray-100 text-gray-600" },
  PENDING: { label: "Menunggu Pembayaran", color: "bg-yellow-100 text-yellow-700" },
  PAID: { label: "Lunas", color: "bg-green-100 text-green-700" },
  FAILED: { label: "Pembayaran Gagal", color: "bg-red-100 text-red-700" },
  EXPIRED: { label: "Pembayaran Kedaluwarsa", color: "bg-orange-100 text-orange-700" },
};

// ============================================================
// Props
// ============================================================

interface OrderDetailProps {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============================================================
// Component
// ============================================================

export function OrderDetail({ order, open, onOpenChange }: OrderDetailProps) {
  if (!order) return null;

  const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG.PENDING;
  const typeConfig = ORDER_TYPE_LABELS[order.orderType] || ORDER_TYPE_LABELS.DINE_IN;
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;

  const hasPhone =
    order.customer.phone && !order.customer.phone.startsWith("guest-");

  const orderDate = new Date(order.createdAt).toLocaleString("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  });

  // Build status history from order data if available
  const statusHistory = [
    {
      status: "PENDING",
      label: "Pesanan dibuat",
      time: order.createdAt,
      done: true,
    },
    {
      status: "CONFIRMED",
      label: "Pesanan dikonfirmasi",
      done: ["CONFIRMED", "PROCESSING", "READY", "COMPLETED"].includes(order.status),
    },
    {
      status: "PROCESSING",
      label: "Pesanan sedang diproses",
      done: ["PROCESSING", "READY", "COMPLETED"].includes(order.status),
    },
    {
      status: "READY",
      label: "Pesanan siap",
      done: ["READY", "COMPLETED"].includes(order.status),
    },
    {
      status: "COMPLETED",
      label: "Pesanan selesai",
      done: order.status === "COMPLETED",
    },
  ];

  if (order.status === "CANCELLED") {
    statusHistory.forEach((s) => {
      s.done = false;
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-lg">
            #{order.orderNumber}
          </SheetTitle>
          <SheetDescription>{orderDate}</SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-5">
          {/* Status & Type */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              className={`${statusConfig.color} border text-xs font-medium px-2.5 py-0.5`}
            >
              <StatusIcon className="h-3 w-3 mr-1" />
              {statusConfig.label}
            </Badge>
            {(() => {
              const payLabel = PAYMENT_STATUS_LABELS[order.paymentStatus];
              if (payLabel) {
                return (
                  <Badge
                    className={`${payLabel.color} text-xs font-medium px-2.5 py-0.5`}
                  >
                    <CreditCard className="h-3 w-3 mr-1" />
                    {payLabel.label}
                  </Badge>
                );
              }
              return null;
            })()}
            <Badge variant="outline" className="text-xs font-medium">
              <TypeIcon className="h-3 w-3 mr-1" />
              {typeConfig.label}
            </Badge>
            {order.table && (
              <Badge variant="outline" className="text-xs">
                Meja {order.table.number}
              </Badge>
            )}
          </div>

          {/* Customer Info */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">
                {order.customer.name || "Guest"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {hasPhone ? (
                <>
                  <MessageSquare className="h-4 w-4 text-green-500" />
                  <span>{order.customer.phone}</span>
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    WA tersedia
                  </Badge>
                </>
              ) : (
                <>
                  <MessageSquareOff className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    WhatsApp tidak tersedia
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Order Items */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Item Pesanan
            </h3>
            <div className="space-y-1.5">
              {order.items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm py-1">
                  <div>
                    <span className="font-medium">{item.quantity}x</span>{" "}
                    <span>{item.product.name}</span>
                  </div>
                  <span className="font-medium tabular-nums">
                    Rp{Number(item.totalPrice).toLocaleString("id-ID")}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Price Breakdown */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">
                Rp{Number(order.subtotal).toLocaleString("id-ID")}
              </span>
            </div>
            {Number(order.discount) > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Diskon</span>
                <span className="tabular-nums">
                  -Rp{Number(order.discount).toLocaleString("id-ID")}
                </span>
              </div>
            )}
            {Number(order.tax) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pajak (10%)</span>
                <span className="tabular-nums">
                  Rp{Number(order.tax).toLocaleString("id-ID")}
                </span>
              </div>
            )}
            {Number(order.serviceCharge) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Service Charge (5%)</span>
                <span className="tabular-nums">
                  Rp{Number(order.serviceCharge).toLocaleString("id-ID")}
                </span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-bold">
              <span>Total</span>
              <span className="text-lg tabular-nums">
                Rp{Number(order.grandTotal).toLocaleString("id-ID")}
              </span>
            </div>
          </div>

          {/* Notes */}
          {order.notes && (
            <>
              <Separator />
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Catatan
                </h3>
                <p className="text-sm bg-muted/50 rounded-lg p-3">
                  {order.notes}
                </p>
              </div>
            </>
          )}

          {/* Status Timeline */}
          <Separator />
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              Status Timeline
            </h3>
            <div className="space-y-0">
              {statusHistory.map((step, index) => {
                const isLast = index === statusHistory.length - 1;
                return (
                  <div key={step.status} className="flex gap-3">
                    {/* Line + Dot */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-3 h-3 rounded-full flex-shrink-0 mt-1 ${
                          step.done
                            ? "bg-green-500"
                            : order.status === step.status
                              ? "bg-blue-500 ring-2 ring-blue-200"
                              : "bg-gray-200"
                        }`}
                      />
                      {!isLast && (
                        <div
                          className={`w-0.5 flex-1 my-1 ${
                            step.done ? "bg-green-200" : "bg-gray-200"
                          }`}
                        />
                      )}
                    </div>
                    {/* Content */}
                    <div className="pb-4">
                      <p
                        className={`text-sm ${
                          step.done
                            ? "font-medium text-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        {step.label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
