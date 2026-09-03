"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  Clock,
  ChefHat,
  Package,
  CheckCircle,
  CreditCard,
  Loader2,
  Table2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/axios";

// ============================================================
// Types
// ============================================================

interface CustomizationSnapshot {
  productName: string;
  basePrice: number;
  selections: Array<{
    groupId: string;
    groupName: string;
    optionId: string;
    optionName: string;
    priceAdjustment: number;
  }>;
  addons: Array<{
    addonId: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  notes: string | null;
}

interface OrderData {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  orderType: string;
  grandTotal: string;
  subtotal: string;
  tax: string;
  serviceCharge: string;
  discount: string;
  visitorCount: number | null;
  notes?: string;
  createdAt: string;
  customer: { name?: string; phone?: string };
  table?: { number: number; name: string };
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
    notes?: string;
    customizations?: CustomizationSnapshot;
  }>;
  payments?: Array<{
    method: string | null;
    provider: string | null;
    status: string;
    amount: string;
  }>;
  statusHistory: Array<{
    status: string;
    notes?: string;
    createdAt: string;
  }>;
}

// ============================================================
// Status Config
// ============================================================

const STATUS_STEPS = [
  { key: "PENDING", label: "Pesanan Diterima", icon: Clock },
  { key: "CONFIRMED", label: "Dikonfirmasi", icon: Check },
  { key: "PROCESSING", label: "Sedang Dibuat", icon: ChefHat },
  { key: "READY", label: "Siap", icon: Package },
  { key: "COMPLETED", label: "Selesai", icon: CheckCircle },
];

// ============================================================
// Component
// ============================================================

export default function OrderTrackingPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const [order, setOrder] = useState<OrderData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaying, setIsPaying] = useState(false);

  useEffect(() => {
    loadOrder();
    // Poll for status updates every 10 seconds
    const interval = setInterval(loadOrder, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadOrder = async () => {
    try {
      const { orderNumber } = await params;
      const res = await api.get(`/public/orders/${orderNumber}`);
      setOrder(res.data.data);
    } catch (error) {
      console.error("Failed to load order:", error);
      if (!order) {
        toast.error("Pesanan tidak ditemukan");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePayNow = async () => {
    if (!order) return;
    setIsPaying(true);
    try {
      const res = await api.post("/public/payments", {
        orderNumber: order.orderNumber,
      });
      const paymentUrl = res.data.data.paymentUrl;
      if (paymentUrl) {
        window.location.href = paymentUrl;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Gagal membuat pembayaran";
      toast.error(message);
      setIsPaying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Memuat pesanan...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <p className="text-gray-500 text-lg">Pesanan tidak ditemukan</p>
        <Link
          href="/menu"
          className="bg-black text-white px-6 py-2 rounded-lg font-medium hover:bg-gray-800 transition-colors"
        >
          Kembali ke Menu
        </Link>
      </div>
    );
  }

  const currentStepIndex = STATUS_STEPS.findIndex(
    (s) => s.key === order.status
  );
  const isCancelled = order.status === "CANCELLED";
  const paymentStatus = order.paymentStatus || "UNPAID";
  const isPaid = paymentStatus === "PAID";
  const isPaymentPending = paymentStatus === "PENDING";
  const isPaymentFailed =
    paymentStatus === "FAILED" || paymentStatus === "EXPIRED";

  return (
    <div className="space-y-6">
      {/* Success Header */}
      <div className="text-center py-4">
        <div className="text-4xl mb-2">
          {isCancelled ? "❌" : currentStepIndex >= 3 ? "✅" : "⏳"}
        </div>
        <h1 className="text-2xl font-bold">
          {isCancelled ? "Pesanan Dibatalkan" : "Pesanan Dibuat!"}
        </h1>
        {!isCancelled && (
          <p className="text-gray-500 mt-1">Terima kasih telah memesan</p>
        )}
      </div>

      {/* Payment Status */}
      <div
        className={`rounded-lg p-4 ${
          isPaid
            ? "bg-green-50 border border-green-200"
            : isPaymentFailed
              ? "bg-red-50 border border-red-200"
              : "bg-yellow-50 border border-yellow-200"
        }`}
      >
        <div className="flex items-center gap-3">
          <CreditCard
            className={`h-5 w-5 ${
              isPaid
                ? "text-green-600"
                : isPaymentFailed
                  ? "text-red-600"
                  : "text-yellow-600"
            }`}
          />
          <div className="flex-1">
            <p
              className={`text-sm font-medium ${
                isPaid
                  ? "text-green-800"
                  : isPaymentFailed
                    ? "text-red-800"
                    : "text-yellow-800"
              }`}
            >
              {isPaid
                ? "✓ Pembayaran berhasil"
                : isPaymentFailed
                  ? "Pembayaran gagal"
                  : isPaymentPending
                    ? "Menunggu pembayaran..."
                    : "Pembayaran belum selesai"}
            </p>
            {!isPaid && (
              <p className="text-xs text-gray-500 mt-0.5">
                Total: Rp{Number(order.grandTotal).toLocaleString("id-ID")}
              </p>
            )}
          </div>
          {isPaymentFailed && (
            <button
              onClick={handlePayNow}
              disabled={isPaying}
              className="bg-gray-900 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-black transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {isPaying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              Bayar Lagi
            </button>
          )}
        </div>
      </div>

      {/* Order Info Card */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm text-gray-500">Nomor Pesanan</p>
            <p className="font-bold text-lg">{order.orderNumber}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Tipe</p>
            <p className="font-medium">
              {order.orderType === "DINE_IN"
                ? "Dine In"
                : order.orderType === "TAKEAWAY"
                  ? "Takeaway"
                  : "Delivery"}
            </p>
          </div>
        </div>

        {order.table && (
          <div className="flex items-center gap-2">
            <Table2 className="h-4 w-4 text-gray-500" />
            <div>
              <p className="text-sm text-gray-500">Meja</p>
              <p className="font-medium">{order.table.name}</p>
            </div>
          </div>
        )}

        {order.visitorCount && (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gray-500" />
            <div>
              <p className="text-sm text-gray-500">Pengunjung</p>
              <p className="font-medium">{order.visitorCount} orang</p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <p className="text-sm text-gray-500">Atas Nama</p>
          <p className="font-medium">{order.customer?.name || "Guest"}</p>
        </div>
      </div>

      {/* Status Timeline */}
      {!isCancelled && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="font-medium mb-4">Status Pesanan</h2>
          <div className="space-y-4">
            {STATUS_STEPS.map((step, index) => {
              const isCompleted = index <= currentStepIndex;
              const isCurrent = index === currentStepIndex;
              const Icon = step.icon;

              return (
                <div key={step.key} className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isCompleted
                        ? "bg-green-500 text-white"
                        : "bg-gray-100 text-gray-400"
                    } ${isCurrent ? "ring-2 ring-green-200" : ""}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p
                      className={`text-sm font-medium ${
                        isCompleted ? "text-green-600" : "text-gray-400"
                      }`}
                    >
                      {step.label}
                    </p>
                  </div>
                  {isCompleted && !isCurrent && (
                    <Check className="h-4 w-4 text-green-500" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Order Items */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <h2 className="font-medium">Item Pesanan</h2>
        <div className="space-y-3">
          {order.items.map((item, index) => (
            <div key={index} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">
                  {item.name} x{item.quantity}
                </span>
                <span>
                  Rp{Number(item.totalPrice).toLocaleString("id-ID")}
                </span>
              </div>

              {/* Customization details */}
              {item.customizations && (
                <div className="pl-2 space-y-0.5">
                  {item.customizations.selections.map((s, i) => (
                    <p key={i} className="text-[11px] text-gray-500">
                      {s.groupName}: {s.optionName}
                      {s.priceAdjustment > 0 && (
                        <span className="text-gray-400">
                          {" "}
                          +Rp{s.priceAdjustment.toLocaleString("id-ID")}
                        </span>
                      )}
                    </p>
                  ))}
                  {item.customizations.addons.map((a, i) => (
                    <p key={i} className="text-[11px] text-gray-500">
                      + {a.name} x{a.quantity}
                      {a.price > 0 && (
                        <span className="text-gray-400">
                          {" "}
                          +Rp{(a.price * a.quantity).toLocaleString("id-ID")}
                        </span>
                      )}
                    </p>
                  ))}
                </div>
              )}

              {/* Item notes */}
              {item.notes && (
                <p className="pl-2 text-[11px] text-gray-400 italic">
                  Catatan: {item.notes}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Price Breakdown */}
        <div className="border-t pt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Subtotal</span>
            <span>
              Rp{Number(order.subtotal).toLocaleString("id-ID")}
            </span>
          </div>
          {Number(order.discount) > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Diskon</span>
              <span>
                -Rp{Number(order.discount).toLocaleString("id-ID")}
              </span>
            </div>
          )}
          {/* Tax/service rows only when they apply (DINE_IN orders are free) */}
          {Number(order.tax) > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-500">Pajak (10%)</span>
              <span>
                Rp{Number(order.tax).toLocaleString("id-ID")}
              </span>
            </div>
          )}
          {Number(order.serviceCharge) > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-500">Service Charge (5%)</span>
              <span>
                Rp{Number(order.serviceCharge).toLocaleString("id-ID")}
              </span>
            </div>
          )}
          <div className="border-t pt-2 flex justify-between font-bold">
            <span>Total</span>
            <span>
              Rp{Number(order.grandTotal).toLocaleString("id-ID")}
            </span>
          </div>
        </div>

        {/* Payment method */}
        {order.payments && order.payments.length > 0 && order.payments[0].method && (
          <div className="border-t pt-3">
            <p className="text-xs text-gray-500">
              Metode Pembayaran: {order.payments[0].method}
            </p>
          </div>
        )}
      </div>

      {/* Notes */}
      {order.notes && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="font-medium mb-1">Catatan</h2>
          <p className="text-sm text-gray-600">{order.notes}</p>
        </div>
      )}

      {/* Back to Menu */}
      <Link
        href="/menu"
        className="block w-full bg-gray-100 text-center py-3 rounded-xl font-medium text-gray-600 hover:bg-gray-200 transition-colors"
      >
        Kembali ke Menu
      </Link>
    </div>
  );
}
