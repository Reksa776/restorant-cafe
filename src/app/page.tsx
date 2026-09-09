"use client";

import { useEffect, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Loader2, MapPin } from "lucide-react";
import api from "@/lib/axios";
import { CartProvider, useCart } from "@/hooks/use-cart";
import { BrandingProvider, useBranding } from "@/hooks/use-branding";

// ============================================================
// "/" — client-side routing + branch control point (replaces the
// old hardcoded 307).
//
// The root is the ONLY place a customer can consciously switch the
// selected branch, so when a saved branch context exists it is shown
// here (never auto-redirected past the switch): the customer either
// continues to the menu or taps "Ganti Cabang" to re-open the
// selector. Auto-redirect only happens for:
//   1. QR table context present → /menu (table wins always).
//   2. No saved branch context  → /pilih-cabang (first-time ask).
//   3. Saved context failed server validation → clear → /pilih-cabang.
//
// The validation is only a redirect/display decider — authorization
// for orders still happens server-side on the order endpoints
// themselves.
// ============================================================

function HomeRedirect() {
  const router = useRouter();
  const {
    isHydrated,
    tableContext,
    customerBranch,
    clearCustomerBranch,
  } = useCart();
  const { applyBranding } = useBranding();
  const [failed, retry] = useReducer((x: number) => x + 1, 0);
  const [error, setError] = useState(false);
  const [branchValid, setBranchValid] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isHydrated) return;
    setBranchValid(null);

    // 1. QR table context wins unconditionally (the /t lookup already
    //    validated the restaurant + branch server-side).
    if (tableContext) {
      router.replace("/menu");
      return;
    }

    // No saved branch context → ask the customer.
    if (!customerBranch) {
      router.replace("/pilih-cabang");
      return;
    }

    // Validate the saved branch context server-side; when valid we KEEP
    // the customer here (landing with a switch option) instead of
    // auto-redirecting, so the branch can be changed at any time.
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/public/branches", {
          params: { restaurantId: customerBranch.restaurantId },
        });
        if (cancelled) return;
        // Apply the restaurant's branding so the landing view (and the
        // /pilih-cabang → /menu chain) is already on-theme.
        const branding = res.data?.data?.restaurant?.branding;
        if (branding) {
          applyBranding({
            siteName: branding.siteName,
            logoUrl: branding.logoUrl,
            primaryColor: branding.primaryColor,
            secondaryColor: branding.secondaryColor,
            accentColor: branding.accentColor,
          });
        }
        const list: {
          id: string;
          code: string;
          isActive: boolean;
        }[] = res.data?.data?.branches ?? [];
        const valid = list.some(
          (b) =>
            b.id === customerBranch.branchId &&
            b.isActive &&
            b.code === customerBranch.branchCode
        );
        if (valid) {
          setBranchValid(true);
        } else {
          clearCustomerBranch();
          router.replace("/pilih-cabang");
        }
      } catch {
        // Transient failure (network / 5xx) — do NOT clear the saved branch;
        // show a retry so we never silently drop a potentially-valid choice.
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, tableContext, customerBranch, failed]);

  const handleChangeBranch = () => {
    clearCustomerBranch();
    router.push("/pilih-cabang");
  };

  // Valid saved branch — show the branch landing with an explicit switch.
  if (branchValid === true && customerBranch) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-secondary mb-4">
            <Building2 className="h-6 w-6 text-brand-primary" />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 text-green-700 text-xs font-bold px-3 py-1 mb-3">
            <Check className="h-3.5 w-3.5" />
            Cabang terpilih
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 break-words">
            {customerBranch.branchName}
          </h1>
          <p className="text-xs font-medium text-gray-400 mt-0.5">
            {customerBranch.branchCode}
          </p>
          <p className="text-sm text-gray-500 mt-3">
            Anda akan melihat menu, stok, dan harga untuk cabang ini.
          </p>

          <div className="mt-6 space-y-2.5">
            <button
              type="button"
              onClick={() => router.push("/menu")}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary text-brand-primary-foreground py-3 font-medium hover:bg-brand-primary/90 transition-colors"
            >
              <MapPin className="h-4 w-4" />
              Lanjut ke Menu
            </button>
            <button
              type="button"
              onClick={handleChangeBranch}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Building2 className="h-4 w-4" />
              Ganti Cabang
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (branchValid === false) {
    // Should not render (we redirect), but keep a safe fallback.
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
        <Loader2 className="h-6 w-6 animate-spin mb-2 text-gray-400" />
        <p className="text-sm text-gray-500">Mengalihkan…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      {error ? (
        <div className="text-center">
          <p className="text-sm text-gray-500">
            Gagal memuat. Periksa koneksi Anda lalu coba lagi.
          </p>
          <button
            type="button"
            onClick={() => {
              setError(false);
              retry();
            }}
            className="mt-4 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Coba Lagi
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin mb-2" />
          <p className="text-sm">Memuat…</p>
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <CartProvider>
      <BrandingProvider>
        <HomeRedirect />
      </BrandingProvider>
    </CartProvider>
  );
}