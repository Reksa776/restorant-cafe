"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgePercent, Loader2, LogIn, Receipt, User } from "lucide-react";
import api from "@/lib/axios";
import { Skeleton } from "@/components/ui/skeleton";
import { useCart } from "@/hooks/use-cart";
import { useCustomerAuth } from "@/hooks/use-customer-auth";
import { CustomerAuthDialog } from "@/components/customer/auth-dialog";

// ============================================================
// Customer Account ("Akun Saya")
//
// Read-only view of the logged-in customer's own data:
//   1. Profile   — from the existing customer session (useCustomerAuth / me)
//   2. Voucher Saya — GET /api/public/customer/account/promos
//   3. Riwayat Pesanan — GET /api/public/customer/account/orders
//
// Every endpoint derives customerId + restaurantId from the httpOnly session
// cookie on the server — nothing here sends (or trusts) an identity, and no
// payment credential / provider payload is ever displayed.
// Guests see the EXISTING login/register dialog (no new auth screen).
// ============================================================

const ORDERS_PER_PAGE = 5;

type VoucherState = "AVAILABLE" | "CLAIMED" | "USED" | "EXPIRED";

interface Voucher {
  promoId: string;
  code: string;
  name: string;
  description: string | null;
  type: "PERCENT" | "FIXED";
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  branch: { id: string; code: string; name: string } | null;
  state: VoucherState;
  /** Server-built label — the discount is never recomputed on the client. */
  label: string;
  claimed: boolean;
  usedCount: number;
  perCustomerLimit: number;
}

interface AccountOrder {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  orderType: string;
  grandTotal: string | number;
  createdAt: string;
  branchName: string | null;
  itemCount: number;
}

const VOUCHER_STATE_LABEL: Record<VoucherState, string> = {
  AVAILABLE: "Tersedia",
  CLAIMED: "Diklaim",
  USED: "Terpakai",
  EXPIRED: "Kedaluwarsa",
};

const VOUCHER_STATE_CLASS: Record<VoucherState, string> = {
  AVAILABLE: "text-brand-primary border border-brand-primary/30",
  CLAIMED: "text-green-600 bg-green-50 border border-green-200",
  USED: "text-gray-500 bg-gray-100",
  EXPIRED: "text-gray-400 bg-gray-100",
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  CONFIRMED: "Dikonfirmasi",
  PROCESSING: "Diproses",
  READY: "Siap",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  UNPAID: "Belum Bayar",
  PENDING: "Menunggu Pembayaran",
  PAID: "Lunas",
  FAILED: "Gagal",
  EXPIRED: "Kedaluwarsa",
  REFUNDED: "Dikembalikan",
  CANCELLED: "Dibatalkan",
};

const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine In",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-1.5">
      {icon}
      {children}
    </h2>
  );
}

function LoadingCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-48" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
      <p className="text-xs text-gray-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-xs font-medium text-brand-primary underline"
      >
        Coba lagi
      </button>
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-xl border border-dashed border-gray-200 p-6 text-center">
      <p className="text-xs text-gray-400">{message}</p>
    </div>
  );
}

export default function AccountPage() {
  const { restaurantId } = useCart();
  const { customer, isHydrated, logout } = useCustomerAuth();
  const customerId = customer?.id ?? null;

  const [authOpen, setAuthOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Vouchers
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [vouchersLoading, setVouchersLoading] = useState(true);
  const [vouchersError, setVouchersError] = useState<string | null>(null);

  // Orders (paginated)
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Vouchers — fetched once per login/retry (independent of pagination).
  useEffect(() => {
    if (!isHydrated || !customerId) return;

    let cancelled = false;
    api
      .get("/public/customer/account/promos")
      .then((res) => {
        if (cancelled) return;
        setVouchers(res.data?.data?.vouchers || []);
        setVouchersError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setVouchers([]);
        setVouchersError("Gagal memuat voucher. Coba lagi.");
      })
      .finally(() => {
        if (!cancelled) setVouchersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isHydrated, customerId, reloadKey]);

  // Orders — refetched on page change only.
  useEffect(() => {
    if (!isHydrated || !customerId) return;

    let cancelled = false;
    api
      .get("/public/customer/account/orders", {
        params: { page, limit: ORDERS_PER_PAGE },
      })
      .then((res) => {
        if (cancelled) return;
        setOrders(res.data?.data?.items || []);
        setTotalPages(res.data?.data?.totalPages || 1);
        setOrdersError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setOrders([]);
        setOrdersError("Gagal memuat riwayat pesanan. Coba lagi.");
      })
      .finally(() => {
        if (!cancelled) setOrdersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isHydrated, customerId, page, reloadKey]);

  const retry = () => {
    setVouchersLoading(true);
    setOrdersLoading(true);
    setVouchersError(null);
    setOrdersError(null);
    setReloadKey((k) => k + 1);
  };

  const goToPage = (next: number) => {
    setOrdersLoading(true);
    setPage(next);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } catch {
      // Logout failure is not blocking (the header uses the same call).
    } finally {
      setIsLoggingOut(false);
    }
  };

  // ----------------------------------------------------------
  // Loading (session restoration)
  // ----------------------------------------------------------
  if (!isHydrated) {
    return (
      <div className="space-y-4 pb-8">
        <Skeleton className="h-6 w-32" />
        <LoadingCard />
        <LoadingCard />
        <LoadingCard />
      </div>
    );
  }

  // ----------------------------------------------------------
  // Guest — reuse the EXISTING login/register dialog, show no data.
  // ----------------------------------------------------------
  if (!customer) {
    return (
      <div className="space-y-4 pb-8">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Akun Saya</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Profil, voucher, dan riwayat pesanan Anda
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <User className="h-8 w-8 mx-auto text-gray-300" />
          <p className="mt-2 font-semibold text-sm">Belum masuk</p>
          <p className="text-xs text-gray-500 mt-1">
            Masuk atau daftar untuk melihat voucher dan riwayat pesanan Anda.
          </p>
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium bg-brand-primary text-brand-primary-foreground rounded-full px-4 py-2 hover:bg-brand-primary/90 transition-colors"
          >
            <LogIn className="h-3.5 w-3.5" />
            Masuk / Daftar
          </button>
        </div>

        <CustomerAuthDialog
          restaurantId={restaurantId}
          open={authOpen}
          onOpenChange={setAuthOpen}
        />
      </div>
    );
  }

  // ----------------------------------------------------------
  // Authenticated
  // ----------------------------------------------------------
  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Akun Saya</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Profil, voucher, dan riwayat pesanan Anda
        </p>
      </div>

      {/* Profile — read only (no editing API exists). */}
      <section aria-label="Profil">
        <SectionTitle icon={<User className="h-5 w-5 text-brand-primary" />}>
          Profil
        </SectionTitle>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-secondary flex items-center justify-center flex-shrink-0">
              <User className="h-5 w-5 text-brand-primary" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">
                {customer.name || "Pelanggan"}
              </p>
              {customer.email && (
                <p className="text-xs text-gray-500 truncate">
                  {customer.email}
                </p>
              )}
              {customer.phone && (
                <p className="text-xs text-gray-500">{customer.phone}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="mt-3 w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg py-2 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {isLoggingOut && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Keluar
          </button>
        </div>
      </section>

      {/* Voucher Saya — claims and uses are clearly distinguished. */}
      <section aria-label="Voucher Saya">
        <SectionTitle
          icon={<BadgePercent className="h-5 w-5 text-brand-primary" />}
        >
          Voucher Saya
        </SectionTitle>
        {vouchersLoading ? (
          <div className="space-y-3">
            <LoadingCard />
            <LoadingCard />
          </div>
        ) : vouchersError ? (
          <ErrorCard message={vouchersError} onRetry={retry} />
        ) : vouchers.length === 0 ? (
          <EmptyCard message="Belum ada voucher. Klaim promo di halaman menu." />
        ) : (
          <div className="space-y-3">
            {vouchers.map((voucher) => (
              <div
                key={voucher.promoId}
                className="bg-white rounded-xl border border-gray-200 p-4 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{voucher.name}</p>
                    <span className="text-[10px] font-mono font-semibold bg-brand-secondary text-brand-secondary-foreground px-2 py-0.5 rounded-full">
                      {voucher.code}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{voucher.label}</p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {voucher.minOrder > 0 &&
                      `Min. order ${rupiah(voucher.minOrder)}`}
                    {voucher.expiresAt &&
                      `${voucher.minOrder > 0 ? " · " : ""}s.d. ${new Date(
                        voucher.expiresAt
                      ).toLocaleDateString("id-ID")}`}
                    {voucher.branch &&
                      `${
                        voucher.minOrder > 0 || voucher.expiresAt ? " · " : ""
                      }Cabang ${voucher.branch.name}`}
                  </p>
                </div>
                <span
                  className={`flex-shrink-0 text-xs font-medium rounded-full px-3 py-1.5 ${
                    VOUCHER_STATE_CLASS[voucher.state] ||
                    VOUCHER_STATE_CLASS.EXPIRED
                  }`}
                >
                  {VOUCHER_STATE_LABEL[voucher.state] || voucher.state}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Riwayat Pesanan — own orders only, paginated. */}
      <section aria-label="Riwayat Pesanan">
        <SectionTitle icon={<Receipt className="h-5 w-5 text-brand-primary" />}>
          Riwayat Pesanan
        </SectionTitle>
        {ordersLoading ? (
          <div className="space-y-3">
            <LoadingCard />
            <LoadingCard />
          </div>
        ) : ordersError ? (
          <ErrorCard message={ordersError} onRetry={retry} />
        ) : orders.length === 0 ? (
          <EmptyCard message="Belum ada pesanan." />
        ) : (
          <>
            <div className="space-y-3">
              {orders.map((order) => (
                <Link
                  key={order.orderNumber}
                  href={`/order/${order.orderNumber}`}
                  className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-brand-accent transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-medium">
                      {order.orderNumber}
                    </span>
                    <span className="text-sm font-bold tabular-nums">
                      {rupiah(Number(order.grandTotal))}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-500">
                    <span>
                      {new Date(order.createdAt).toLocaleString("id-ID", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                    <span>·</span>
                    <span>
                      {ORDER_TYPE_LABEL[order.orderType] || order.orderType}
                    </span>
                    {order.branchName && (
                      <>
                        <span>·</span>
                        <span className="truncate">{order.branchName}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{order.itemCount} item</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="text-[10px] font-medium bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                      {ORDER_STATUS_LABEL[order.status] || order.status}
                    </span>
                    <span
                      className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${
                        order.paymentStatus === "PAID"
                          ? "bg-green-50 text-green-600 border border-green-200"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {PAYMENT_STATUS_LABEL[order.paymentStatus] ||
                        order.paymentStatus}
                    </span>
                  </div>
                </Link>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1 || ordersLoading}
                  className="text-xs font-medium text-brand-primary border border-brand-primary/30 rounded-full px-3 py-1.5 hover:bg-brand-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Sebelumnya
                </button>
                <span className="text-xs text-gray-500">
                  Halaman {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages || ordersLoading}
                  className="text-xs font-medium text-brand-primary border border-brand-primary/30 rounded-full px-3 py-1.5 hover:bg-brand-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Berikutnya
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
