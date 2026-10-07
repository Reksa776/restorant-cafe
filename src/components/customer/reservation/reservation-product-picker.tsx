"use client";

// ============================================================
// Reservation product picker (in-wizard "Pembelian" step).
//
// REUSES the existing public menu API (`GET /api/public/menu`) — the same
// catalogue `/menu` reads: restaurant-scoped, branch-scoped (availability +
// price override), active products with their option groups and addons. It does
// NOT create a new product/cart engine and it does NOT touch the global
// `useCart` (localStorage) — the lines live in the wizard's own state.
//
// Prices shown here are DISPLAY ONLY. The server recomputes every price,
// variant, addon, tax and total from the database on submit.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Minus,
  Plus,
  RotateCw,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import api from "@/lib/axios";
import { normalizeApiError } from "@/lib/api-error-handler";
import {
  formatRupiah,
  reservationPurchaseLineNotes,
  reservationPurchaseLineTotal,
  reservationPurchaseSubtotal,
  type ReservationPurchaseAddon,
  type ReservationPurchaseLine,
  type ReservationPurchaseSelection,
} from "@/app/(customer)/reservasi/reservation-flow";

interface MenuOption {
  id: string;
  name: string;
  priceAdjustment: number | string;
  sortOrder?: number;
}

interface MenuOptionGroup {
  id: string;
  name: string;
  type: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  options: MenuOption[];
}

interface MenuAddon {
  id: string;
  name: string;
  price: number | string;
}

interface MenuProduct {
  id: string;
  name: string;
  description?: string | null;
  price: number | string;
  imageUrl?: string | null;
  categoryId: string;
  category?: { id: string; name: string } | null;
  optionGroups: MenuOptionGroup[];
  addons: MenuAddon[];
  stock?: number | null;
}

interface MenuCategory {
  id: string;
  name: string;
}

interface MenuResponse {
  categories: MenuCategory[];
  products: MenuProduct[];
}

export interface ReservationProductPickerProps {
  restaurantId: string | null;
  branchCode: string;
  lines: ReservationPurchaseLine[];
  onChange: (lines: ReservationPurchaseLine[]) => void;
}

const toNumber = (value: number | string | null | undefined): number => {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const isMultiGroup = (group: MenuOptionGroup) =>
  group.type === "MULTI" || group.maxSelect > 1;

/** Merge a new line into the cart when an identical configuration exists. */
function lineSignature(line: ReservationPurchaseLine): string {
  const selections = [...line.selections]
    .map((s) => `${s.groupId}:${s.optionId}`)
    .sort()
    .join("|");
  const addons = [...line.addons]
    .map((a) => `${a.addonId}:${a.quantity}`)
    .sort()
    .join("|");
  return `${line.productId}#${selections}#${addons}#${line.notes ?? ""}`;
}

function mergeLine(
  lines: ReservationPurchaseLine[],
  line: ReservationPurchaseLine
): ReservationPurchaseLine[] {
  const signature = lineSignature(line);
  const index = lines.findIndex((l) => lineSignature(l) === signature);
  if (index < 0) return [...lines, line];
  return lines.map((l, i) =>
    i === index ? { ...l, quantity: l.quantity + line.quantity } : l
  );
}

export function ReservationProductPicker({
  restaurantId,
  branchCode,
  lines,
  onChange,
}: ReservationProductPickerProps) {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [products, setProducts] = useState<MenuProduct[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  // Customization modal
  const [modalProduct, setModalProduct] = useState<MenuProduct | null>(null);

  const loadMenu = useCallback(async () => {
    if (!restaurantId || !branchCode) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const res = await api.get("/public/menu", {
        params: { restaurantId, branchCode },
      });
      const data = (res.data?.data ?? {}) as MenuResponse;
      setCategories(data.categories ?? []);
      setProducts(data.products ?? []);
      setStatus("ready");
    } catch (err) {
      setError(normalizeApiError(err).message);
      setStatus("error");
    }
  }, [restaurantId, branchCode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadMenu();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadMenu, reloadKey]);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCategoryId && p.categoryId !== activeCategoryId) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        (p.description ?? "").toLowerCase().includes(term)
      );
    });
  }, [products, search, activeCategoryId]);

  const subtotal = reservationPurchaseSubtotal(lines);

  const addLine = (line: ReservationPurchaseLine) => {
    onChange(mergeLine(lines, line));
  };

  const setQuantity = (lineId: string, quantity: number) => {
    if (quantity <= 0) {
      onChange(lines.filter((l) => l.lineId !== lineId));
      return;
    }
    onChange(lines.map((l) => (l.lineId === lineId ? { ...l, quantity } : l)));
  };

  const removeLine = (lineId: string) => {
    onChange(lines.filter((l) => l.lineId !== lineId));
  };

  return (
    <div className="space-y-3">
      {/* ---- Cart lines ---- */}
      {lines.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
          {lines.map((line) => {
            const note = reservationPurchaseLineNotes(line);
            return (
              <div key={line.lineId} className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 break-words">
                    {line.name}
                  </p>
                  {note && (
                    <p className="text-xs text-gray-500 mt-0.5 break-words">
                      {note}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    {formatRupiah(line.unitPrice)} × {line.quantity} ={" "}
                    <span className="font-medium text-gray-700">
                      {formatRupiah(reservationPurchaseLineTotal(line))}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setQuantity(line.lineId, line.quantity - 1)}
                    className="h-8 w-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50"
                    aria-label={`Kurangi ${line.name}`}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-6 text-center text-sm font-bold">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity(line.lineId, line.quantity + 1)}
                    className="h-8 w-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50"
                    aria-label={`Tambah ${line.name}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLine(line.lineId)}
                    className="h-8 w-8 rounded-lg border border-gray-300 flex items-center justify-center text-red-500 hover:bg-red-50"
                    aria-label={`Hapus ${line.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-b-xl">
            <span className="text-sm font-medium text-gray-600">
              Total Pembelian
            </span>
            <span className="text-sm font-bold text-gray-900">
              {formatRupiah(subtotal)}
            </span>
          </div>
        </div>
      )}

      {/* ---- Catalogue ---- */}
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari produk..."
            className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
          />
        </div>

        {categories.length > 0 && (
          <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveCategoryId(null)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                activeCategoryId === null
                  ? "bg-brand-primary text-brand-primary-foreground border-brand-primary"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              Semua
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategoryId(cat.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                  activeCategoryId === cat.id
                    ? "bg-brand-primary text-brand-primary-foreground border-brand-primary"
                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3">
          {status === "loading" && (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin mb-2" />
              <p className="text-sm">Memuat produk…</p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center justify-center py-8 text-center px-3">
              <AlertCircle className="h-7 w-7 text-red-400 mb-2" />
              <p className="text-sm text-gray-600">{error}</p>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <RotateCw className="h-4 w-4" />
                Coba Lagi
              </button>
            </div>
          )}

          {status === "idle" && (
            <div className="flex items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <AlertCircle className="h-4 w-4 text-gray-400 shrink-0" />
              <p className="text-xs text-gray-600">
                Pilih cabang terlebih dahulu untuk memuat produk.
              </p>
            </div>
          )}

          {status === "ready" && visibleProducts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center px-3">
              <ShoppingBag className="h-7 w-7 text-gray-300 mb-2" />
              <p className="text-sm text-gray-600">
                Tidak ada produk yang cocok.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Coba kata kunci atau kategori lain.
              </p>
            </div>
          )}

          {status === "ready" && visibleProducts.length > 0 && (
            <div className="space-y-2">
              {visibleProducts.map((product) => {
                const hasChoices =
                  product.optionGroups.length > 0 || product.addons.length > 0;
                const soldOut = product.stock === 0;
                return (
                  <div
                    key={product.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 break-words">
                        {product.name}
                      </p>
                      {product.description && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 break-words">
                          {product.description}
                        </p>
                      )}
                      <p className="text-sm font-bold text-brand-primary mt-1">
                        {formatRupiah(toNumber(product.price))}
                      </p>
                      {soldOut && (
                        <p className="text-[11px] font-medium text-red-500 mt-0.5">
                          Stok habis
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={soldOut}
                      onClick={() => {
                        if (hasChoices) {
                          setModalProduct(product);
                          return;
                        }
                        addLine({
                          lineId: `${product.id}-${Date.now()}-${Math.random()
                            .toString(36)
                            .slice(2, 7)}`,
                          productId: product.id,
                          name: product.name,
                          unitPrice: toNumber(product.price),
                          quantity: 1,
                          selections: [],
                          addons: [],
                        });
                      }}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-brand-primary text-brand-primary-foreground px-3 py-2 text-xs font-semibold hover:bg-brand-primary/90 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tambah
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {modalProduct && (
        <ProductCustomizeModal
          product={modalProduct}
          onClose={() => setModalProduct(null)}
          onAdd={(line) => {
            addLine(line);
            setModalProduct(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Customize modal — variants/options + addons + quantity
// ============================================================

function ProductCustomizeModal({
  product,
  onClose,
  onAdd,
}: {
  product: MenuProduct;
  onClose: () => void;
  onAdd: (line: ReservationPurchaseLine) => void;
}) {
  const [singleChoice, setSingleChoice] = useState<Record<string, string>>({});
  const [multiChoice, setMultiChoice] = useState<Record<string, string[]>>({});
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const basePrice = toNumber(product.price);

  const selections: ReservationPurchaseSelection[] = useMemo(() => {
    const result: ReservationPurchaseSelection[] = [];
    for (const group of product.optionGroups) {
      if (isMultiGroup(group)) {
        const ids = multiChoice[group.id] ?? [];
        for (const optionId of ids) {
          const option = group.options.find((o) => o.id === optionId);
          if (!option) continue;
          result.push({
            groupId: group.id,
            groupName: group.name,
            optionId: option.id,
            optionName: option.name,
            priceAdjustment: toNumber(option.priceAdjustment),
          });
        }
      } else {
        const optionId = singleChoice[group.id];
        if (!optionId) continue;
        const option = group.options.find((o) => o.id === optionId);
        if (!option) continue;
        result.push({
          groupId: group.id,
          groupName: group.name,
          optionId: option.id,
          optionName: option.name,
          priceAdjustment: toNumber(option.priceAdjustment),
        });
      }
    }
    return result;
  }, [product.optionGroups, singleChoice, multiChoice]);

  const addons: ReservationPurchaseAddon[] = useMemo(
    () =>
      product.addons
        .filter((a) => (addonQty[a.id] ?? 0) > 0)
        .map((a) => ({
          addonId: a.id,
          name: a.name,
          price: toNumber(a.price),
          quantity: addonQty[a.id] ?? 0,
        })),
    [product.addons, addonQty]
  );

  const unitPrice =
    basePrice +
    selections.reduce((sum, s) => sum + s.priceAdjustment, 0) +
    addons.reduce((sum, a) => sum + a.price * a.quantity, 0);

  // Required-group validation mirrors the server rule (min/max per group).
  const validationError = useMemo(() => {
    for (const group of product.optionGroups) {
      const count = isMultiGroup(group)
        ? (multiChoice[group.id] ?? []).length
        : singleChoice[group.id]
          ? 1
          : 0;
      if (group.isRequired && count < group.minSelect) {
        return `Wajib memilih minimal ${group.minSelect} dari ${group.name}`;
      }
      if (count > group.maxSelect) {
        return `Maksimal memilih ${group.maxSelect} dari ${group.name}`;
      }
    }
    return null;
  }, [product.optionGroups, singleChoice, multiChoice]);

  const toggleMulti = (group: MenuOptionGroup, optionId: string) => {
    setMultiChoice((prev) => {
      const current = prev[group.id] ?? [];
      const exists = current.includes(optionId);
      let next = exists
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
      if (next.length > group.maxSelect) {
        next = next.slice(next.length - group.maxSelect);
      }
      return { ...prev, [group.id]: next };
    });
  };

  const changeAddon = (id: string, delta: number) => {
    setAddonQty((prev) => {
      const next = Math.max(0, Math.min(20, (prev[id] ?? 0) + delta));
      return { ...prev, [id]: next };
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900 break-words">
              {product.name}
            </h3>
            <p className="text-sm font-bold text-brand-primary mt-0.5">
              {formatRupiah(basePrice)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 h-8 w-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {product.optionGroups.map((group) => {
            const multi = isMultiGroup(group);
            return (
              <div key={group.id}>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-800">
                    {group.name}
                  </p>
                  {group.isRequired && (
                    <span className="rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5">
                      Wajib
                    </span>
                  )}
                  {multi && (
                    <span className="text-[11px] text-gray-400">
                      maks {group.maxSelect}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {group.options.map((option) => {
                    const checked = multi
                      ? (multiChoice[group.id] ?? []).includes(option.id)
                      : singleChoice[group.id] === option.id;
                    const adj = toNumber(option.priceAdjustment);
                    return (
                      <label
                        key={option.id}
                        className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer ${
                          checked
                            ? "border-brand-primary bg-brand-secondary"
                            : "border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type={multi ? "checkbox" : "radio"}
                            name={`group-${group.id}`}
                            checked={checked}
                            onChange={() => {
                              if (multi) {
                                toggleMulti(group, option.id);
                              } else {
                                setSingleChoice((prev) => ({
                                  ...prev,
                                  [group.id]: option.id,
                                }));
                              }
                            }}
                            className="accent-brand-primary"
                          />
                          <span className="min-w-0 break-words">
                            {option.name}
                          </span>
                        </span>
                        {adj !== 0 && (
                          <span className="shrink-0 text-xs text-gray-500">
                            {adj > 0 ? "+" : ""}
                            {formatRupiah(adj)}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {product.addons.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-800">
                Tambahan (opsional)
              </p>
              <div className="mt-1.5 space-y-1.5">
                {product.addons.map((addon) => {
                  const qty = addonQty[addon.id] ?? 0;
                  return (
                    <div
                      key={addon.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-gray-800 break-words">
                          {addon.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          +{formatRupiah(toNumber(addon.price))}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => changeAddon(addon.id, -1)}
                          disabled={qty <= 0}
                          className="h-7 w-7 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 disabled:opacity-40"
                          aria-label={`Kurangi ${addon.name}`}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-5 text-center text-sm font-bold">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeAddon(addon.id, 1)}
                          className="h-7 w-7 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600"
                          aria-label={`Tambah ${addon.name}`}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Catatan (opsional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 200))}
              placeholder="Contoh: tanpa sambal"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
            <span className="text-sm font-medium text-gray-700">Jumlah</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                className="h-8 w-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 disabled:opacity-40"
                aria-label="Kurangi jumlah"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-8 text-center text-sm font-bold">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                className="h-8 w-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600"
                aria-label="Tambah jumlah"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {validationError && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">{validationError}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={Boolean(validationError)}
              onClick={() =>
                onAdd({
                  lineId: `${product.id}-${Date.now()}-${Math.random()
                    .toString(36)
                    .slice(2, 7)}`,
                  productId: product.id,
                  name: product.name,
                  unitPrice,
                  quantity,
                  selections,
                  addons,
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                })
              }
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary text-brand-primary-foreground py-3 px-4 font-semibold hover:bg-brand-primary/90 disabled:opacity-50"
            >
              Tambah · {formatRupiah(unitPrice * quantity)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
