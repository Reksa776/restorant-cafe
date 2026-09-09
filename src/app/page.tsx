"use client";

import { useEffect, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import api from "@/lib/axios";
import { CartProvider, useCart } from "@/hooks/use-cart";

// ============================================================
// "/" — client-side routing (replaces the old hardcoded 307).
//
// Decision tree (after cart hydration so localStorage is known):
//   1. QR table context present        → /menu   (table wins always).
//   2. Saved customer branch context   → validate server-side via
//      /public/branches (exists + active). Valid → /menu.
//      Stale/invalid                   → clear → /pilih-cabang.
//   3. No context at all               → /pilih-cabang.
//
// The validation is only a redirect decider — authorization for orders
// still happens server-side on the order endpoints themselves.
// ============================================================

function HomeRedirect() {
  const router = useRouter();
  const {
    isHydrated,
    tableContext,
    customerBranch,
    clearCustomerBranch,
  } = useCart();
  const [failed, retry] = useReducer((x: number) => x + 1, 0);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isHydrated) return;

    // 1. QR table context wins unconditionally (the /t lookup already
    //    validated the restaurant + branch server-side).
    if (tableContext) {
      router.replace("/menu");
      return;
    }

    // 3. No saved branch context → ask the customer.
    if (!customerBranch) {
      router.replace("/pilih-cabang");
      return;
    }

    // 2. Validate the saved branch context server-side.
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/public/branches", {
          params: { restaurantId: customerBranch.restaurantId },
        });
        if (cancelled) return;
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
          router.replace("/menu");
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
      <HomeRedirect />
    </CartProvider>
  );
}