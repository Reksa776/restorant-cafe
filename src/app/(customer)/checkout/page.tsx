"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  MapPin,
  Navigation,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/axios";
import { useCustomerAuth } from "@/hooks/use-customer-auth";
import { useBranchStock } from "@/hooks/use-branch-stock";
import { getErrorMessage } from "@/lib/api-error-handler";

// ============================================================
// Types
// ============================================================

interface Table {
  id: string;
  number: number;
  name: string;
  capacity: number;
  /** Branch this table belongs to (null = legacy/unassigned table). */
  branch?: { id: string; name: string; code: string } | null;
}

/** One instant-courier quote returned by POST /public/delivery/rates. */
interface DeliveryRateOption {
  provider: string;
  courierCode: string;
  courierName: string;
  serviceType: string;
  serviceName: string;
  fee: number;
  currency: string;
  etaMinMinutes: number | null;
  etaMaxMinutes: number | null;
}

const deliveryRateKey = (rate: DeliveryRateOption) =>
  `${rate.courierCode}:${rate.serviceType}`;

function formatEta(rate: DeliveryRateOption): string {
  if (rate.etaMinMinutes === null && rate.etaMaxMinutes === null) return "";
  if (rate.etaMinMinutes !== null && rate.etaMaxMinutes !== null) {
    return `± ${rate.etaMinMinutes}–${rate.etaMaxMinutes} menit`;
  }
  return `± ${rate.etaMinMinutes ?? rate.etaMaxMinutes} menit`;
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
    restaurantId,
    clearCart,
    tableContext,
    clearTableContext,
    customerBranch,
  } = useCart();

  const { customer, isHydrated } = useCustomerAuth();

  // Branch scope used everywhere below (order payload + advisory stock lookup).
  const checkoutBranchCode =
    tableContext?.branchCode ?? customerBranch?.branchCode ?? undefined;
  const { getStock, stockLoaded } = useBranchStock(
    restaurantId,
    checkoutBranchCode
  );

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

  // DELIVERY — customer address + coordinates + the SERVER courier quote.
  // The client never sends a fee: the server re-quotes and charges its own.
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryLatitude, setDeliveryLatitude] = useState("");
  const [deliveryLongitude, setDeliveryLongitude] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryRates, setDeliveryRates] = useState<DeliveryRateOption[]>([]);
  const [selectedDeliveryKey, setSelectedDeliveryKey] = useState<string | null>(
    null
  );
  const [isLoadingRates, setIsLoadingRates] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  // DINE_IN drives the payment-method choice (QRIS/KASIR); it no longer
  // changes the bill — H5 removed the hardcoded tax/service charge, so every
  // order type totals exactly `subtotal − discount` on the server.
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
            branchCode:
              tableContext?.branchCode ??
              customerBranch?.branchCode ??
              undefined,
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
  }, [isHydrated, customer, restaurantId, customerBranch, tableContext?.branchCode]);

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
        branchCode:
          tableContext?.branchCode ?? customerBranch?.branchCode ?? undefined,
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
  // server recomputes at order creation). No tax/service charge is added:
  // the server bills exactly the discounted subtotal.
  const confirmedDiscount = confirmedVoucher?.discount ?? 0;
  const discountedBase = Math.max(subtotal - confirmedDiscount, 0);
  const selectedDeliveryRate =
    (selectedDeliveryKey
      ? deliveryRates.find((r) => deliveryRateKey(r) === selectedDeliveryKey)
      : null) ??
    deliveryRates[0] ??
    null;
  // A quote is only meaningful with a branch, a real address and both
  // coordinates. This is also the render gate for the rate list — no state is
  // cleared from inside an effect.
  const deliveryLocationValid =
    Boolean(checkoutBranchCode) &&
    deliveryAddress.trim().length >= 5 &&
    deliveryLatitude.trim() !== "" &&
    deliveryLongitude.trim() !== "" &&
    Number.isFinite(Number(deliveryLatitude)) &&
    Number.isFinite(Number(deliveryLongitude));
  const deliveryFee =
    orderType === "DELIVERY" && deliveryLocationValid
      ? (selectedDeliveryRate?.fee ?? 0)
      : 0;
  const displayTotal = discountedBase + deliveryFee;

  // Load tables if restaurant is available and not coming from QR. The list
  // is scoped to the branch the customer selected (checkoutBranchCode): the
  // server treats the chosen TABLE's branch as authoritative for stock
  // validation, so offering tables from another branch would make an
  // in-stock menu item fail checkout with "Produk sudah habis" (menu stock
  // source ≠ checkout stock source). Tables carry their branch so the label
  // is unambiguous.
  // Declared before the effects that use it and memoized on its only inputs.
  const loadTables = useCallback(async () => {
    try {
      const res = await api.get("/public/tables", {
        params: { restaurantId, branchCode: checkoutBranchCode },
      });
      setTables(res.data.data);
    } catch (error) {
      console.error("Failed to load tables:", error);
    }
  }, [restaurantId, checkoutBranchCode]);

  // Reached through a latest-value ref so the load effect keeps its exact
  // trigger set (the branch scope) and never re-subscribes to the callback.
  const loadTablesRef = useRef(loadTables);
  useEffect(() => {
    loadTablesRef.current = loadTables;
  }, [loadTables]);

  useEffect(() => {
    if (restaurantId && orderType === "DINE_IN" && !tableContext) {
      loadTablesRef.current();
    }
  }, [restaurantId, orderType, tableContext, checkoutBranchCode]);

  // Live courier quote (debounced). Purely advisory: the order endpoint
  // re-quotes and charges its own server-side fee, so a stale/forged quote can
  // never change what the customer pays.
  useEffect(() => {
    if (orderType !== "DELIVERY") return;

    const address = deliveryAddress.trim();
    const lat = Number(deliveryLatitude);
    const lng = Number(deliveryLongitude);
    const hasCoords =
      deliveryLatitude.trim() !== "" &&
      deliveryLongitude.trim() !== "" &&
      Number.isFinite(lat) &&
      Number.isFinite(lng);

    if (!checkoutBranchCode || address.length < 5 || !hasCoords) {
      // Nothing to quote yet. The UI hides stale rates via
      // `deliveryLocationValid`; no synchronous setState in this effect.
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsLoadingRates(true);
      setRatesError(null);
      try {
        const res = await api.post("/public/delivery/rates", {
          branchCode: checkoutBranchCode,
          address,
          latitude: lat,
          longitude: lng,
        });
        if (cancelled) return;
        const rates = (res.data?.data?.rates || []) as DeliveryRateOption[];
        setDeliveryRates(rates);
        if (rates.length === 0) {
          setRatesError("Tidak ada layanan kurir untuk alamat ini.");
        }
      } catch (error) {
        if (cancelled) return;
        setDeliveryRates([]);
        setRatesError(getErrorMessage(error) || "Gagal menghitung ongkir");
      } finally {
        if (!cancelled) setIsLoadingRates(false);
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    orderType,
    deliveryAddress,
    deliveryLatitude,
    deliveryLongitude,
    checkoutBranchCode,
  ]);

  const handleUseMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Browser tidak mendukung geolokasi. Isi koordinat manual.");
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDeliveryLatitude(position.coords.latitude.toFixed(6));
        setDeliveryLongitude(position.coords.longitude.toFixed(6));
        setIsLocating(false);
        toast.success("Lokasi berhasil diambil");
      },
      () => {
        setIsLocating(false);
        toast.error("Gagal mengambil lokasi. Isi latitude/longitude manual.");
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
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

    // Advisory client-side stock gate (the server re-validates and remains
    // the source of truth). Runs only when a branch scope gave us stock for
    // this order; legacy no-branch orders skip client checks and rely on the
    // server, which has no branch to validate either.
    if (stockLoaded) {
      const stockFailures: string[] = [];
      for (const item of items) {
        const stock = getStock(item.productId);
        if (stock == null) continue;
        if (stock <= 0) {
          stockFailures.push(`${item.name} sudah habis`);
        } else if (item.quantity > stock) {
          stockFailures.push(
            `${item.name}: stok tersisa ${stock}, diminta ${item.quantity}`
          );
        }
      }
      if (stockFailures.length > 0) {
        toast.error(`Stok tidak mencukupi: ${stockFailures[0]}`);
        return;
      }
    }

    // tableContext hydrates asynchronously from localStorage (refreshing the
    // checkout page), so it may not be available at first render — trust it
    // over the tableId state initialized on mount.
    const effectiveTableId = tableContext?.tableId || tableId;
    if (orderType === "DINE_IN" && !effectiveTableId) {
      toast.error("Pilih meja untuk dine-in");
      return;
    }

    if (orderType === "DELIVERY") {
      if (deliveryAddress.trim().length < 5) {
        toast.error("Alamat pengiriman wajib diisi");
        return;
      }
      const lat = Number(deliveryLatitude);
      const lng = Number(deliveryLongitude);
      if (
        deliveryLatitude.trim() === "" ||
        deliveryLongitude.trim() === "" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        toast.error(
          "Koordinat alamat wajib diisi. Gunakan tombol \"Gunakan Lokasi Saya\"."
        );
        return;
      }
      if (!checkoutBranchCode) {
        toast.error("Pilih cabang pengiriman terlebih dahulu");
        return;
      }
      if (!selectedDeliveryRate) {
        toast.error("Ongkir belum tersedia — tunggu perhitungan selesai");
        return;
      }
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
        // Branch scope: QR table wins; otherwise the branch the customer
        // picked (or explicitly left unset for legacy no-branch flows).
        branchCode: checkoutBranchCode,
        tableId: tableContext?.tableId || (orderType === "DINE_IN" ? tableId : undefined),
        visitorCount: tableContext?.visitorCount || undefined,
        notes: notes.trim() || undefined,
        items: orderItems,
        paymentMethod: isDineIn ? paymentMethod : undefined,
        // DELIVERY: the server re-quotes from these coordinates and ignores
        // any client fee. Courier/service only hint which quoted rate to use.
        ...(orderType === "DELIVERY" && selectedDeliveryRate
          ? {
              deliveryAddress: deliveryAddress.trim(),
              deliveryLatitude: Number(deliveryLatitude),
              deliveryLongitude: Number(deliveryLongitude),
              deliveryNotes: deliveryNotes.trim() || undefined,
              deliveryCourier: selectedDeliveryRate.courierCode,
              deliveryService: selectedDeliveryRate.serviceType,
            }
          : {}),
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
      // Prefer the server's message (e.g. "Produk sudah habis / stok tidak
      // mencukupi") so stale-cart stock failures are clear to the customer.
      const message = getErrorMessage(error) || "Gagal membuat pesanan";
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
        <Link href="/cart" className="text-gray-500 hover:text-brand-primary">
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
                      ? "border-brand-primary bg-brand-secondary"
                      : "border-gray-200 hover:border-brand-accent"
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
                      {table.branch ? ` — ${table.branch.name}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Delivery — address + coordinates + live courier quote */}
        {!tableContext && orderType === "DELIVERY" && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-gray-500" />
              <h2 className="font-medium">Alamat Pengiriman</h2>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Alamat Lengkap <span className="text-red-500">*</span>
              </label>
              <textarea
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="Nama gedung/jalan, nomor rumah, RT/RW, kelurahan, kecamatan, patokan"
                rows={3}
                maxLength={500}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent resize-none"
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-gray-700">
                  Koordinat <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={handleUseMyLocation}
                  disabled={isLocating}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-primary px-3 py-1.5 text-xs font-medium text-brand-primary hover:bg-brand-secondary disabled:opacity-50"
                >
                  {isLocating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Navigation className="h-3.5 w-3.5" />
                  )}
                  Gunakan Lokasi Saya
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">
                    Latitude
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={deliveryLatitude}
                    onChange={(e) => setDeliveryLatitude(e.target.value)}
                    placeholder="-6.175392"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">
                    Longitude
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={deliveryLongitude}
                    onChange={(e) => setDeliveryLongitude(e.target.value)}
                    placeholder="106.827152"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                  />
                </div>
              </div>
              <p className="text-[11px] text-gray-400">
                Koordinat dipakai untuk menghitung ongkir dan titik antar
                kurir. Aktifkan izin lokasi pada browser Anda.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Catatan untuk Kurir{" "}
                <span className="text-gray-400 font-normal">(opsional)</span>
              </label>
              <input
                type="text"
                value={deliveryNotes}
                onChange={(e) => setDeliveryNotes(e.target.value)}
                maxLength={300}
                placeholder="Contoh: titip ke satpam, jangan ketuk pintu"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              />
            </div>

            {/* Live courier quote */}
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-gray-500" />
                <p className="text-sm font-medium">Ongkir Instan</p>
              </div>

              {isLoadingRates ? (
                <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Menghitung ongkir...
                </div>
              ) : ratesError ? (
                <p className="text-xs text-red-600">{ratesError}</p>
              ) : !deliveryLocationValid || deliveryRates.length === 0 ? (
                <p className="text-xs text-gray-400">
                  Isi alamat dan koordinat untuk melihat tarif kurir.
                </p>
              ) : (
                <div className="space-y-2">
                  {deliveryRates.map((rate) => {
                    const key = deliveryRateKey(rate);
                    const selected =
                      selectedDeliveryRate !== null &&
                      deliveryRateKey(selectedDeliveryRate) === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedDeliveryKey(key)}
                        aria-pressed={selected}
                        className={`w-full flex items-center justify-between gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-colors ${
                          selected
                            ? "border-brand-primary bg-brand-secondary"
                            : "border-gray-200 hover:border-brand-accent"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            {rate.courierName} — {rate.serviceName}
                          </span>
                          <span className="block text-[11px] text-gray-500">
                            {formatEta(rate) || "Estimasi instan"}
                          </span>
                        </span>
                        <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
                          Rp{rate.fee.toLocaleString("id-ID")}
                        </span>
                      </button>
                    );
                  })}
                  <p className="text-[11px] text-gray-400">
                    Ongkir final dihitung ulang oleh server saat pesanan dibuat.
                  </p>
                </div>
              )}
            </div>
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
                  className="flex-shrink-0 rounded-lg bg-brand-primary text-brand-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-50"
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
                {(() => {
                  const stock = getStock(item.productId);
                  if (stock == null) return null;
                  if (stock <= 0) {
                    return (
                      <p className="pl-2 text-[11px] font-semibold text-red-600">
                        Produk sudah habis — tidak dapat dibeli
                      </p>
                    );
                  }
                  if (item.quantity > stock) {
                    return (
                      <p className="pl-2 text-[11px] font-semibold text-amber-600">
                        Stok tidak mencukupi (tersisa {stock})
                      </p>
                    );
                  }
                  return null;
                })()}
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
            {orderType === "DELIVERY" && deliveryFee > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">
                  Ongkir
                  {selectedDeliveryRate
                    ? ` (${selectedDeliveryRate.courierName})`
                    : ""}
                </span>
                <span className="tabular-nums">
                  Rp{deliveryFee.toLocaleString("id-ID")}
                </span>
              </div>
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
                      isSelected
                        ? "text-brand-secondary-foreground"
                        : "text-gray-400"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {opt.label}
                    </span>
                    <span className={`block text-xs ${isSelected ? "text-brand-secondary-foreground/70" : "text-gray-500"}`}>
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
