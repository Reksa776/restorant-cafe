"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgePercent, Loader2, LogIn, Check } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/axios";
import { useCustomerAuth } from "@/hooks/use-customer-auth";
import { CustomerAuthDialog } from "@/components/customer/auth-dialog";

// ============================================================
// Promo section (F3) — shown on the customer menu page.
// Guests see the promos but must log in to claim/use them; logged-in
// customers can claim (race-safe, server-side validated). A claimed
// promo is applied by entering its code at checkout.
// ============================================================

interface Promo {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: "PERCENT" | "FIXED";
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  claimed?: boolean;
  usedCount?: number;
  perCustomerLimit?: number;
}

function promoDiscountLabel(p: Promo): string {
  if (p.type === "PERCENT") {
    const base = `Diskon ${p.value}%`;
    return p.maxDiscount
      ? `${base} · maks ${rupiah(p.maxDiscount)}`
      : base;
  }
  return `Diskon ${rupiah(p.value)}`;
}

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;

export function PromoSection({
  restaurantId,
  branchCode,
}: {
  restaurantId: string | null;
  branchCode?: string | null;
}) {
  const { customer } = useCustomerAuth();
  const [promos, setPromos] = useState<Promo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const loadPromos = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const res = await api.get("/public/promos", {
        params: { restaurantId, branchCode: branchCode || undefined },
      });
      setPromos(res.data.data.promos || []);
    } catch {
      setPromos([]);
    } finally {
      setIsLoading(false);
    }
  }, [restaurantId, branchCode]);

  // Re-fetch on login/logout so the claimed state stays in sync.
  useEffect(() => {
    loadPromos();
  }, [loadPromos, customer?.id]);

  const handleClaim = async (promo: Promo) => {
    if (!customer) {
      setAuthOpen(true);
      return;
    }
    setClaimingId(promo.id);
    try {
      await api.post(`/public/promos/${promo.id}/claim`, {
        branchCode: branchCode || undefined,
      });
      toast.success(`Promo "${promo.name}" berhasil diklaim`);
      await loadPromos();
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.message;
      toast.error(msg || "Gagal mengklaim promo");
    } finally {
      setClaimingId(null);
    }
  };

  if (isLoading || promos.length === 0) return null;

  return (
    <section aria-label="Promo">
      <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-3 sm:mb-4 flex items-center gap-1.5">
        <BadgePercent className="h-5 w-5 text-brand-primary" />
        Promo Untuk Kamu
      </h2>
      <div className="space-y-3 mb-8 sm:mb-10">
        {promos.map((promo) => {
          const claimed = promo.claimed;
          const usedUp =
            (promo.usedCount ?? 0) >= (promo.perCustomerLimit ?? 1);

          return (
            <div
              key={promo.id}
              className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm sm:text-base">
                    {promo.name}
                  </p>
                  <span className="text-[10px] font-mono font-semibold bg-brand-secondary text-brand-secondary-foreground px-2 py-0.5 rounded-full">
                    {promo.code}
                  </span>
                </div>
                {promo.description && (
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                    {promo.description}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  {promoDiscountLabel(promo)}
                  {promo.minOrder > 0 &&
                    ` · Min. order ${rupiah(promo.minOrder)}`}
                  {promo.expiresAt &&
                    ` · s.d. ${new Date(promo.expiresAt).toLocaleDateString("id-ID")}`}
                </p>
              </div>

              <div className="flex-shrink-0">
                {claimed ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded-full px-3 py-1.5">
                    <Check className="h-3.5 w-3.5" />
                    Diklaim
                  </span>
                ) : usedUp ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-3 py-1.5">
                    Terpakai
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleClaim(promo)}
                    disabled={claimingId === promo.id}
                    className="inline-flex items-center gap-1.5 text-xs font-medium bg-brand-primary text-brand-primary-foreground rounded-full px-3 py-1.5 hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
                  >
                    {claimingId === promo.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : customer ? (
                      "Klaim"
                    ) : (
                      <>
                        <LogIn className="h-3.5 w-3.5" />
                        Masuk untuk Klaim
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <CustomerAuthDialog
        restaurantId={restaurantId}
        open={authOpen}
        onOpenChange={setAuthOpen}
        onSuccess={() => {
          // Promos re-fetch via the customer?.id effect.
        }}
      />
    </section>
  );
}