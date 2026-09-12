"use client";

import StockPage from "../page";

/**
 * G.3 — STOK BAHAN BAKU.
 *
 * A dedicated route so Inventory separates "Stok Bahan Baku"
 * (BranchIngredient.stock + WAC) from "Stok Produk" (BranchProduct.stock).
 * Reuses the existing stock screen component — no duplicate stock engine.
 */
export default function StockIngredientsPage() {
  return <StockPage initialTab="ingredients" />;
}
