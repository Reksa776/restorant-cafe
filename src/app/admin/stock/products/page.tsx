"use client";

import StockPage from "../page";

/**
 * G.3 — STOK PRODUK.
 *
 * A dedicated route so Inventory separates "Stok Produk" (BranchProduct.stock)
 * from "Stok Bahan Baku" (BranchIngredient.stock). Reuses the existing stock
 * screen component — no duplicate stock engine.
 */
export default function StockProductsPage() {
  return <StockPage initialTab="products" />;
}
