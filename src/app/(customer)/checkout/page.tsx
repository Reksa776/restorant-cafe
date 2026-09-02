"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/hooks/use-cart";
import { ArrowLeft, Loader2, Table2, User, Phone } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/axios";

// ============================================================
// Types
// ============================================================

interface Table {
  id: string;
  number: number;
  name: string;
  capacity: number;
}

// ============================================================
// Component
// ============================================================

export default function CheckoutPage() {
  const router = useRouter();
  const {
    items,
    subtotal,
    tax,
    serviceCharge,
    grandTotal,
    totalItems,
    restaurantId,
    clearCart,
    tableContext,
    clearTableContext,
  } = useCart();

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderType, setOrderType] = useState<"DINE_IN" | "TAKEAWAY" | "DELIVERY">(
    tableContext ? "DINE_IN" : "DINE_IN"
  );
  const [tableId, setTableId] = useState(tableContext?.tableId || "");
  const [notes, setNotes] = useState("");
  const [tables, setTables] = useState<Table[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<"form" | "creating" | "paying">("form");

  // Load tables if restaurant is available and not coming from QR
  useEffect(() => {
    if (restaurantId && orderType === "DINE_IN" && !tableContext) {
      loadTables();
    }
  }, [restaurantId, orderType, tableContext]);

  const loadTables = async () => {
    try {
      const res = await api.get("/public/tables", {
        params: { restaurantId },
      });
      setTables(res.data.data);
    } catch (error) {
      console.error("Failed to load tables:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!customerName.trim()) {
      toast.error("Nama harus diisi");
      return;
    }

    if (items.length === 0) {
      toast.error("Keranjang kosong");
      return;
    }

    if (orderType === "DINE_IN" && !tableId) {
      toast.error("Pilih meja untuk dine-in");
      return;
    }

    setIsSubmitting(true);
    setStep("creating");

    try {
      // Build items array with customization data
      const orderItems = items.map((item) => {
        const orderItem: {
          productId: string;
          quantity: number;
          selections?: Array<{
            groupId: string;
            groupName: string;
            optionId: string;
            optionName: string;
            priceAdjustment: number;
          }>;
          addons?: Array<{
            addonId: string;
            name: string;
            price: number;
            quantity: number;
          }>;
          notes?: string;
        } = {
          productId: item.productId,
          quantity: item.quantity,
        };

        if (item.selections && item.selections.length > 0) {
          orderItem.selections = item.selections;
        }

        if (item.addons && item.addons.length > 0) {
          orderItem.addons = item.addons;
        }

        if (item.notes) {
          orderItem.notes = item.notes;
        }

        return orderItem;
      });

      // Step 1: Create order
      const orderData: Record<string, unknown> = {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || null,
        orderType,
        tableId: tableContext?.tableId || (orderType === "DINE_IN" ? tableId : undefined),
        visitorCount: tableContext?.visitorCount || undefined,
        notes: notes.trim() || undefined,
        items: orderItems,
      };

      const orderRes = await api.post("/public/orders", orderData);
      const orderNumber = orderRes.data.data.orderNumber;

      // Step 2: Create payment
      setStep("paying");
      try {
        const paymentRes = await api.post("/public/payments", {
          orderNumber,
        });

        const paymentUrl = paymentRes.data.data.paymentUrl;

        // Clear cart and table context
        clearCart();
        clearTableContext();
        toast.success("Pesanan berhasil dibuat!");

        // Step 3: Redirect to iPaymu payment page
        if (paymentUrl) {
          window.location.href = paymentUrl;
        } else {
          // No payment URL — redirect to order tracking
          router.push(`/order/${orderNumber}`);
        }
      } catch {
        // Payment creation failed — order still exists, redirect to order page
        clearCart();
        clearTableContext();
        toast.success("Pesanan berhasil dibuat!");
        toast.error("Gagal membuat pembayaran. Silakan bayar dari halaman pesanan.");
        router.push(`/order/${orderNumber}`);
      }
    } catch (error: unknown) {
      setStep("form");
      const message =
        error instanceof Error ? error.message : "Gagal membuat pesanan";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ============================================================
  // Loading States
  // ============================================================

  if (step === "creating") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
        <p className="text-gray-500 font-medium">Menyiapkan pesanan...</p>
      </div>
    );
  }

  if (step === "paying") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
        <p className="text-gray-500 font-medium">Membuka halaman pembayaran...</p>
        <p className="text-xs text-gray-400">Anda akan dialihkan ke iPaymu</p>
      </div>
    );
  }

  // ============================================================
  // Empty Cart
  // ============================================================

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <p className="text-gray-500 text-lg">Keranjang kosong</p>
        <Link
          href="/menu"
          className="bg-black text-white px-6 py-2 rounded-lg font-medium hover:bg-gray-800 transition-colors"
        >
          Lihat Menu
        </Link>
      </div>
    );
  }

  // ============================================================
  // Checkout Form
  // ============================================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/cart" className="text-gray-500 hover:text-black">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Checkout</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Table Info (from QR flow) */}
        {tableContext && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <Table2 className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-blue-900">
                  {tableContext.tableName} — Meja {tableContext.tableNumber}
                </p>
                <p className="text-xs text-blue-600">
                  {tableContext.visitorCount} pengunjung
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Customer Information — Guest Checkout */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-gray-500" />
            <h2 className="font-medium">Data Pelanggan</h2>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nama <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Masukkan nama Anda"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nomor WhatsApp{" "}
              <span className="text-gray-400 font-normal">(opsional)</span>
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="081234567890"
                className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Untuk notifikasi WhatsApp jika pesanan sudah selesai
            </p>
          </div>
        </div>

        {/* Order Type — only show if not from QR */}
        {!tableContext && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
            <h2 className="font-medium">Tipe Pesanan</h2>

            <div className="grid grid-cols-3 gap-3">
              {[
                { value: "DINE_IN", label: "Dine In", icon: "🪑" },
                { value: "TAKEAWAY", label: "Takeaway", icon: "📦" },
                { value: "DELIVERY", label: "Delivery", icon: "🚗" },
              ].map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() =>
                    setOrderType(type.value as typeof orderType)
                  }
                  className={`p-3 rounded-lg border-2 text-center transition-colors ${
                    orderType === type.value
                      ? "border-black bg-gray-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <span className="text-2xl block mb-1">{type.icon}</span>
                  <span className="text-sm font-medium">{type.label}</span>
                </button>
              ))}
            </div>

            {/* Table Selection for DINE_IN without QR */}
            {orderType === "DINE_IN" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Pilih Meja <span className="text-red-500">*</span>
                </label>
                <select
                  value={tableId}
                  onChange={(e) => setTableId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                  required
                >
                  <option value="">Pilih meja...</option>
                  {tables.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.name} (Kapasitas: {table.capacity})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
          <h2 className="font-medium">Catatan</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contoh: Tanpa sambal, extra pedas, dll."
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent resize-none"
          />
        </div>

        {/* Order Summary */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <h2 className="font-medium">Ringkasan Pesanan</h2>

          {/* Items */}
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={`${item.productId}-${index}`} className="space-y-0.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    {item.name} x{item.quantity}
                  </span>
                  <span>
                    Rp{((item.displayPrice || item.price) * item.quantity).toLocaleString("id-ID")}
                  </span>
                </div>
                {/* Show customization summary */}
                {item.selections && item.selections.length > 0 && (
                  <div className="pl-2">
                    {item.selections.map((s, i) => (
                      <p key={i} className="text-[11px] text-gray-400">
                        {s.groupName}: {s.optionName}
                      </p>
                    ))}
                  </div>
                )}
                {item.addons && item.addons.length > 0 && (
                  <div className="pl-2">
                    {item.addons.map((a, i) => (
                      <p key={i} className="text-[11px] text-gray-400">
                        + {a.name} x{a.quantity}
                      </p>
                    ))}
                  </div>
                )}
                {item.notes && (
                  <p className="pl-2 text-[11px] text-gray-400 italic">
                    Catatan: {item.notes}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="border-t pt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Subtotal</span>
              <span>Rp{subtotal.toLocaleString("id-ID")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Pajak (10%)</span>
              <span>Rp{tax.toLocaleString("id-ID")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Service Charge (5%)</span>
              <span>Rp{serviceCharge.toLocaleString("id-ID")}</span>
            </div>
            <div className="border-t pt-2 flex justify-between font-bold">
              <span>Total</span>
              <span>Rp{grandTotal.toLocaleString("id-ID")}</span>
            </div>
          </div>
        </div>

        {/* Payment Info */}
        <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 text-center">
          Pembayaran diproses oleh iPaymu Sandbox. Anda akan dialihkan ke halaman pembayaran setelah pesanan dibuat.
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-black text-white py-3 rounded-xl font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Memproses...
            </>
          ) : (
            "Konfirmasi & Bayar"
          )}
        </button>
      </form>
    </div>
  );
}
