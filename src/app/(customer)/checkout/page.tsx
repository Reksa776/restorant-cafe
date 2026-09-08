"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/hooks/use-cart";
import {
  ArrowLeft,
  Loader2,
  Table2,
  User,
  Phone,
  QrCode,
  Banknote,
  BadgePercent,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/axios";
import { useCustomerAuth } from "@/hooks/use-customer-auth";

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
// Voucher (F2) — "Voucher Saya" / pilih / kode / preview / confirm.
// The server re-validates everything at order creation; this state is
// UX only. The client NEVER sends a discount amount.
// ============================================================

interface ClaimablePromo {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: "PERCENT" | "FIXED";
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  expiresAt: string | null;
}

interface VoucherPreview {
  valid: boolean;
  promo: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    type: "PERCENT" | "FIXED";
    value: number;
    minOrder: number;
    maxDiscount: number | null;
    expiresAt: string | null;
  };
  subtotal: number;
  discount: number;
  finalSubtotal: number;
}

interface ConfirmedVoucher {
  code: string;
  name: string;
  discount: number;
}

function voucherDiscountLabel(p: { type: "PERCENT" | "FIXED"; value: number; maxDiscount: number | null }): string {
  if (p.type === "PERCENT") {
    const base = `Diskon ${p.value}%`;
    return p.maxDiscount ? `${base} · maks Rp${Math.round(p.maxDiscount).toLocaleString("id-ID")}` : base;
  }
  return `Diskon Rp${Math.round(p.value).toLocaleString("id-ID")}`;
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

  const { customer, isHydrated } = useCustomerAuth();

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  // ---- Voucher (F2) state ----
  // Claimed vouchers shown in "Voucher Saya" (fetched from /public/promos
  // which already marks claimed state server-side from the session cookie).
  const [claimedPromos, setClaimedPromos] = useState<ClaimablePromo[]>([]);
  const [voucherShowMine, setVoucherShowMine] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [isCheckingVoucher, setIsCheckingVoucher] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [voucherPreview, setVoucherPreview] = useState<VoucherPreview | null>(null);
  const [confirmedVoucher, setConfirmedVoucher] = useState<ConfirmedVoucher | null>(null);
  const [orderType, setOrderType] = useState<"DINE_IN" | "TAKEAWAY" | "DELIVERY">(
    tableContext ? "DINE_IN" : "DINE_IN"
  );
  const [tableId, setTableId] = useState(tableContext?.tableId || "");
  const [notes, setNotes] = useState("");
  const [tables, setTables] = useState<Table[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<"form" | "creating" | "paying">("form");

  // DINE-IN checkout offers exactly two methods: QRIS (default) and Kasir.
  const [paymentMethod, setPaymentMethod] = useState<"QRIS" | "KASIR">("QRIS");

  // DINE_IN orders (QR table flow or manually selected) are tax-free and
  // service-free — subtotal = total. TAKEAWAY / DELIVERY keep tax + service.
  const isDineIn = (tableContext ? "DINE_IN" : orderType) === "DINE_IN";

  // Prefill customer data from the logged-in account (F3).
  useEffect(() => {
    if (!isHydrated || !customer) return;
    setCustomerName((prev) => prev || customer.name || "");
    setCustomerPhone((prev) => prev || customer.phone || "");
  }, [isHydrated, customer]);

  // Load the customer's CLAIMED vouchers for "Voucher Saya" (F2). The
  // /public/promos endpoint marks claimed state server-side from the
  // httpOnly session cookie — never trusted from the client.
  useEffect(() => {
    if (!isHydrated || !customer || !restaurantId) return;
    (async () => {
      try {
        const res = await api.get("/public/promos", {
          params: {
            restaurantId,
            branchCode: tableContext?.branchCode || undefined,
          },
        });
        const all = (res.data.data.promos || []) as Array<
          ClaimablePromo & { claimed?: boolean }
        >;
        setClaimedPromos(all.filter((p) => p.claimed));
      } catch {
        setClaimedPromos([]);
      }
    })();
  }, [isHydrated, customer, restaurantId]);

  /**
   * Run the non-mutating server-side voucher preview (F2). Requires login;
   * never consumes quota; the order path re-validates authoritatively.
   */
  const checkVoucher = async (code: string) => {
    if (!customer) {
      setVoucherError("Login customer diperlukan untuk memakai voucher");
      return;
    }
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setVoucherError("Masukkan kode voucher");
      return;
    }
    setIsCheckingVoucher(true);
    setVoucherError(null);
    setVoucherPreview(null);
    try {
      const res = await api.post("/public/promos/validate", {
        promoCode: trimmed,
        // Advisory cart subtotal — server only uses it to compute the
        // preview; order creation recomputes subtotal from DB prices.
        subtotal,
        // Branch scope from the table the customer is ordering at, so
        // branch-only promos validate correctly.
        branchCode: tableContext?.branchCode || undefined,
      });
      setVoucherPreview(res.data.data as VoucherPreview);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.message;
      setVoucherError(msg || "Voucher tidak valid");
    } finally {
      setIsCheckingVoucher(false);
    }
  };

  const confirmVoucher = (preview: VoucherPreview) => {
    setConfirmedVoucher({
      code: preview.promo.code,
      name: preview.promo.name,
      discount: preview.discount,
    });
    setVoucherPreview(null);
    setManualCode("");
    setVoucherError(null);
    setVoucherShowMine(false);
  };

  const cancelVoucher = () => {
    setConfirmedVoucher(null);
    setVoucherPreview(null);
    setManualCode("");
    setVoucherError(null);
  };

  // Final total including a CONFIRMED voucher discount (display only —
  // server recomputes at order creation). Tax/service for TAKEAWAY /
  // DELIVERY are applied on the discounted subtotal, same as the server.
  const confirmedDiscount = confirmedVoucher?.discount ?? 0;
  const discountedBase = Math.max(subtotal - confirmedDiscount, 0);
  const discountedTax = isDineIn ? 0 : Math.round(discountedBase * 0.1);
  const discountedService = isDineIn ? 0 : Math.round(discountedBase * 0.05);
  const displayTotal = confirmedVoucher
    ? discountedBase + discountedTax + discountedService
    : isDineIn
      ? subtotal
      : grandTotal;

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

    // tableContext hydrates asynchronously from localStorage (refreshing the
    // checkout page), so it may not be available at first render — trust it
    // over the tableId state initialized on mount.
    const effectiveTableId = tableContext?.tableId || tableId;
    if (orderType === "DINE_IN" && !effectiveTableId) {
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

      // Step 1: Create order. The KASIR intent also records the UNPAID
      // cashier payment atomically on the server (no gateway involved).
      // F2 — a voucher is only sent AFTER it was previewed + confirmed by
      // the user; the server re-validates the promo against the DB and
      // recomputes the discount (quota/per-customer consumed atomically
      // with the order, never by the preview).
      const orderData: Record<string, unknown> = {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || null,
        orderType,
        // Send the tenant so tableless (TAKEAWAY/DELIVERY) guest orders are
        // never resolved to a different active restaurant.
        restaurantId,
        tableId: tableContext?.tableId || (orderType === "DINE_IN" ? tableId : undefined),
        visitorCount: tableContext?.visitorCount || undefined,
        notes: notes.trim() || undefined,
        items: orderItems,
        paymentMethod: isDineIn ? paymentMethod : undefined,
        ...(confirmedVoucher
          ? { promoCode: confirmedVoucher.code }
          : {}),
      };

      const orderRes = await api.post("/public/orders", orderData);
      const orderNumber = orderRes.data.data.orderNumber;

      // Clear the cart right after the order exists so a refresh during the
      // payment step can never re-submit the same items (no duplicate order).
      clearCart();
      clearTableContext();

      // Step 2 (Kasir): order done — no gateway, nothing more to pay online.
      if (isDineIn && paymentMethod === "KASIR") {
        toast.success("Pesanan berhasil dibuat!");
        toast.success("Silakan lakukan pembayaran di kasir.");
        router.push(`/order/${orderNumber}`);
        return;
      }

      // Step 2 (QRIS / legacy gateway): create the payment transaction.
      setStep("paying");
      try {
        const paymentRes = await api.post("/public/payments", {
          orderNumber,
          // DINE-IN always pays online via QRIS; TAKEAWAY/DELIVERY keep the
          // legacy gateway flow (no method sent).
          method: isDineIn ? "QRIS" : undefined,
        });

        const paymentUrl = paymentRes.data.data.paymentUrl;
        toast.success("Pesanan berhasil dibuat!");

        // Step 3: DINE-IN QRIS customers go to the app's own payment page
        // (never straight to the raw gateway URL). TAKEAWAY/DELIVERY keep the
        // legacy iPaymu redirect.
        if (isDineIn) {
          router.push(`/payment/${orderNumber}`);
        } else if (paymentUrl) {
          window.location.href = paymentUrl;
        } else {
          // No payment URL — redirect to order tracking
          router.push(`/order/${orderNumber}`);
        }
      } catch {
        // Payment creation failed — order still exists, redirect to order page
        toast.success("Pesanan berhasil dibuat!");
        if (isDineIn) {
          toast.error(
            "Gagal membuat pembayaran QRIS. Silakan coba lagi atau bayar di kasir."
          );
        } else {
          toast.error(
            "Gagal membuat pembayaran. Silakan bayar dari halaman pesanan."
          );
        }
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
        <p className="text-gray-500 font-medium">
          {isDineIn
            ? "Menyiapkan pembayaran QRIS..."
            : "Membuka halaman pembayaran..."}
        </p>
        <p className="text-xs text-gray-400">
          {isDineIn
            ? "Anda akan dialihkan ke halaman pembayaran QRIS"
            : "Anda akan dialihkan ke iPaymu"}
        </p>
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
          className="bg-brand-primary text-brand-primary-foreground px-6 py-2 rounded-lg font-medium hover:bg-brand-primary/90 transition-colors"
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
        {/* Table Info (from QR flow — never asks to re-pick a table) */}
        {tableContext && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Table2 className="h-5 w-5 text-blue-600 flex-shrink-0" />
              <p className="font-semibold text-blue-900 text-[15px] truncate">
                Meja {tableContext.tableNumber}
              </p>
            </div>
            <p className="text-sm text-blue-700 whitespace-nowrap">
              {tableContext.visitorCount} pengunjung
            </p>
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
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
                className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
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

        {/* Voucher — F2: requires login; preview → confirm → apply at submit.
            The server is always authoritative (re-validates + recomputes the
            discount when the order is created). */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <BadgePercent className="h-4 w-4 text-gray-500" />
            <h2 className="font-medium">Voucher</h2>
          </div>

          {!customer ? (
            <p className="text-sm text-gray-500">
              <Link
                href="/menu"
                className="text-brand-primary font-medium hover:underline"
              >
                Masuk akun di halaman menu
              </Link>{" "}
              untuk memakai voucher. Guest tetap bisa checkout tanpa voucher.
            </p>
          ) : confirmedVoucher ? (
            /* ---- Confirmed voucher — order can proceed ---- */
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  Voucher:{" "}
                  <span className="font-mono">{confirmedVoucher.code}</span>
                </p>
                <button
                  type="button"
                  onClick={cancelVoucher}
                  className="text-xs text-gray-500 underline hover:text-gray-700"
                >
                  Batalkan
                </button>
              </div>
              <p className="text-xs text-gray-500">{confirmedVoucher.name}</p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Diskon</span>
                <span className="font-medium text-green-700 tabular-nums">
                  -Rp{confirmedVoucher.discount.toLocaleString("id-ID")}
                </span>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">
                  Rp{displayTotal.toLocaleString("id-ID")}
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* ---- Voucher Saya (claimed) ---- */}
              <button
                type="button"
                onClick={() => setVoucherShowMine((v) => !v)}
                className="w-full flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <span>Voucher Saya ({claimedPromos.length})</span>
                <span className="text-xs text-gray-400">
                  {voucherShowMine ? "▲" : "▼"}
                </span>
              </button>
              {voucherShowMine && (
                <div className="space-y-1.5">
                  {claimedPromos.length === 0 ? (
                    <p className="text-xs text-gray-400 px-1">
                      Belum ada voucher yang diklaim.
                    </p>
                  ) : (
                    claimedPromos.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            <span className="font-mono">{p.code}</span> ·{" "}
                            {p.name}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            {voucherDiscountLabel(p)}
                            {p.minOrder > 0 &&
                              ` · Min. ${Math.round(p.minOrder).toLocaleString("id-ID")}`}
                            {p.expiresAt &&
                              ` · s.d. ${new Date(p.expiresAt).toLocaleDateString("id-ID")}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => checkVoucher(p.code)}
                          disabled={isCheckingVoucher}
                          className="flex-shrink-0 rounded-full bg-brand-primary text-brand-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-50"
                        >
                          Pilih
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* ---- Or enter a code ---- */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => {
                    setManualCode(e.target.value.toUpperCase());
                    setVoucherError(null);
                    setVoucherPreview(null);
                  }}
                  placeholder="Masukkan kode voucher (contoh: HEMAT10)"
                  className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => checkVoucher(manualCode)}
                  disabled={isCheckingVoucher}
                  className="flex-shrink-0 rounded-lg bg-gray-900 text-white px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {isCheckingVoucher ? "Cek..." : "Cek Voucher"}
                </button>
              </div>

              {voucherError && (
                <p className="text-xs text-red-600">{voucherError}</p>
              )}

              {/* ---- Preview (validated server-side, non-mutating) ---- */}
              {voucherPreview && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Preview Voucher
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">
                      {voucherPreview.promo.code}
                    </span>
                    <span className="text-xs text-gray-500">
                      {voucherDiscountLabel(voucherPreview.promo)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Potongan</span>
                    <span className="font-medium text-green-700 tabular-nums">
                      Rp{voucherPreview.discount.toLocaleString("id-ID")}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold">
                    <span>Total setelah diskon</span>
                    <span className="tabular-nums">
                      Rp{voucherPreview.finalSubtotal.toLocaleString("id-ID")}
                    </span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={cancelVoucher}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-white"
                    >
                      Ganti Voucher
                    </button>
                    <button
                      type="button"
                      onClick={() => confirmVoucher(voucherPreview)}
                      className="flex-1 rounded-lg bg-green-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-green-700"
                    >
                      Konfirmasi Voucher
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Notes */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
          <h2 className="font-medium">Catatan</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contoh: Tanpa sambal, extra pedas, dll."
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent resize-none"
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
            {confirmedVoucher && (
              <div className="flex justify-between text-green-700">
                <span>Diskon ({confirmedVoucher.code})</span>
                <span className="tabular-nums">
                  -Rp{confirmedVoucher.discount.toLocaleString("id-ID")}
                </span>
              </div>
            )}
            {!isDineIn && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500">Pajak (10%)</span>
                  <span>Rp{(confirmedVoucher ? discountedTax : tax).toLocaleString("id-ID")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Service Charge (5%)</span>
                  <span>Rp{(confirmedVoucher ? discountedService : serviceCharge).toLocaleString("id-ID")}</span>
                </div>
              </>
            )}
          <div className="border-t pt-2 flex justify-between font-bold">
            <span>Total</span>
            <span>Rp{displayTotal.toLocaleString("id-ID")}</span>
          </div>
        </div>
      </div>

      {/* Payment Method — DINE_IN only: QRIS or Kasir (nothing else) */}
      {isDineIn && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <h2 className="font-medium">Metode Pembayaran</h2>
          <div className="grid grid-cols-1 gap-3">
            {[
              {
                value: "QRIS" as const,
                icon: QrCode,
                label: "QRIS",
                desc: "Bayar menggunakan QRIS",
              },
              {
                value: "KASIR" as const,
                icon: Banknote,
                label: "Kasir",
                desc: "Bayar langsung di kasir",
              },
            ].map((opt) => {
              const Icon = opt.icon;
              const isSelected = paymentMethod === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPaymentMethod(opt.value)}
                  aria-pressed={isSelected}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-colors ${
                    isSelected
                      ? "border-brand-primary bg-brand-secondary"
                      : "border-gray-200 hover:border-brand-accent"
                  }`}
                >
                  {/* Radio dot */}
                  <span
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      isSelected ? "border-brand-primary" : "border-gray-300"
                    }`}
                  >
                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-brand-primary" />
                    )}
                  </span>
                  <Icon
                    className={`h-5 w-5 flex-shrink-0 ${
                      isSelected ? "text-brand-primary" : "text-gray-400"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {opt.label}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {opt.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Payment Info */}
      {isDineIn ? (
        <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 text-center">
          {paymentMethod === "KASIR" ? (
            <>Bayar langsung di kasir setelah pesanan Anda diterima restoran.</>
          ) : (
            <>Setelah pesanan dibuat, Anda akan dialihkan untuk membayar dengan QRIS.</>
          )}
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 text-center">
          Pembayaran diproses oleh iPaymu. Anda akan dialihkan ke halaman pembayaran setelah pesanan dibuat.
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-brand-primary text-brand-primary-foreground py-3 rounded-xl font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Memproses...
          </>
        ) : isDineIn && paymentMethod === "KASIR" ? (
          "Konfirmasi Pesanan"
        ) : (
          "Konfirmasi & Bayar"
        )}
      </button>
      </form>
    </div>
  );
}
