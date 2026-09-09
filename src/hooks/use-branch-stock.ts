"use client";

import { useCallback, useEffect, useState } from "react";
import api from "@/lib/axios";

// ============================================================
// useBranchStock — client-side (advisory) stock lookup for the
// selected branch. The server remains the source of truth for every
// order; this only lets the cart/checkout warn and block early.
//
// When `branchCode` is provided the /public/menu response maps each
// product to its per-branch stock (0 = SOLD OUT, missing BranchProduct
// row counts as 0 under a resolved branch). Without a branch context
// stock is null for every product (legacy unmanaged flow) and the
// client performs no stock checks.
// ============================================================

export interface BranchStockMap {
  [productId: string]: number | null;
}

export function useBranchStock(
  restaurantId: string | null,
  branchCode?: string | null
) {
  const [stockMap, setStockMap] = useState<BranchStockMap>({});
  const [stockLoaded, setStockLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // No branch scope → no client-side stock checks (legacy flow).
    if (!restaurantId || !branchCode) {
      setStockMap({});
      setStockLoaded(true);
      return;
    }
    setStockLoaded(false);
    api
      .get("/public/menu", { params: { restaurantId, branchCode } })
      .then((res) => {
        if (cancelled) return;
        const m: BranchStockMap = {};
        for (const p of res.data?.data?.products ?? []) {
          m[p.id] = p.stock != null ? Number(p.stock) : null;
        }
        setStockMap(m);
        setStockLoaded(true);
      })
      .catch(() => {
        // On failure let the server decide (it is the source of truth).
        if (!cancelled) setStockLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId, branchCode]);

  /**
   * Effective stock for a product at the selected branch.
   * null = unknown / legacy (no branch context) → skip client checks.
   */
  const getStock = useCallback(
    (productId: string): number | null => stockMap[productId] ?? null,
    [stockMap]
  );

  /** True when the item cannot be bought (stock 0 / unknown at branch). */
  const isSoldOut = useCallback(
    (productId: string): boolean => {
      const stock = stockMap[productId] ?? null;
      return stock != null && stock <= 0;
    },
    [stockMap]
  );

  /** True when the requested quantity exceeds the remaining stock. */
  const isOverQuantity = useCallback(
    (productId: string, quantity: number): boolean => {
      const stock = stockMap[productId] ?? null;
      return stock != null && stock > 0 && quantity > stock;
    },
    [stockMap]
  );

  return { stockMap, getStock, isSoldOut, isOverQuantity, stockLoaded };
}