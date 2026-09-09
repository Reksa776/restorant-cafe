"use client";

import { Suspense, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCart } from "@/hooks/use-cart";
import Link from "next/link";
import { Plus, Minus, Search, ShoppingCart, UtensilsCrossed, X } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/axios";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranding } from "@/hooks/use-branding";
import { useCustomerAuth } from "@/hooks/use-customer-auth";
import { PromoSection } from "@/components/customer/promo-section";

// ============================================================
// Types
// ============================================================

interface OptionGroup {
  id: string;
  name: string;
  type: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  isActive?: boolean;
  options: Array<{
    id: string;
    name: string;
    priceAdjustment: number;
    isActive?: boolean;
  }>;
}

interface Addon {
  id: string;
  name: string;
  price: number;
  isActive?: boolean;
}

interface Category {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  productCount: number;
}

interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  isAvailable: boolean;
  category: { id: string; name: string };
  optionGroups: OptionGroup[];
  addons: Addon[];
  /** Per-branch stock. null = stock not tracked (no branch context). */
  stock?: number | null;
}

interface RestaurantInfo {
  id: string;
  name: string;
  branding?: {
    siteName: string;
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
  };
}

interface CustomizationState {
  selections: Record<string, string | string[]>; // groupId -> optionId(s)
  addons: Record<string, number>; // addonId -> quantity
  quantity: number;
  notes: string;
}

/**
 * Normalize a product coming from the API.
 * Prisma serializes Decimal fields (price, priceAdjustment) as STRINGS
 * (e.g. "230000", "5000.00"). Coerce them to numbers so price math,
 * cart totals, and checkout payloads work correctly.
 */
function normalizeProduct(p: Product): Product {
  return {
    ...p,
    price: Number(p.price) || 0,
    stock: p.stock != null ? Number(p.stock) : null,
    optionGroups: (p.optionGroups || []).map((g) => ({
      ...g,
      options: (g.options || []).map((o) => ({
        ...o,
        priceAdjustment: Number(o.priceAdjustment) || 0,
      })),
    })),
    addons: (p.addons || []).map((a) => ({
      ...a,
      price: Number(a.price) || 0,
    })),
  };
}

/**
 * Determine if a product requires the customization modal.
 * A product is CUSTOMIZABLE if it has at least one ACTIVE option group
 * with at least one ACTIVE option, OR at least one ACTIVE addon.
 * Defensive: handles null/undefined, empty arrays, and inactive items.
 */
function hasCustomization(product: Product): boolean {
  // Active option group that has at least one active option
  const hasActiveGroup = (product.optionGroups || []).some(
    (group) =>
      group &&
      group.isActive !== false &&
      Array.isArray(group.options) &&
      group.options.some((option) => option && option.isActive !== false)
  );

  // Active addon
  const hasActiveAddon = (product.addons || []).some(
    (addon) => addon && addon.isActive !== false
  );

  return hasActiveGroup || hasActiveAddon;
}

/**
 * Whether a product is out of stock at the selected branch.
 * Only applies when a branch context provides stock (stock != null).
 * Business meaning: isAvailable = manual disable; stock = 0 inventory habis.
 */
function isSoldOut(product: Product): boolean {
  return product.stock != null && product.stock <= 0;
}

// ============================================================
// Helpers
// ============================================================



function calculateCustomizedPrice(
  product: Product,
  state: CustomizationState
): number {
  let price = Number(product.price) || 0;

  // Add selection price adjustments (support MULTI groups)
  for (const group of product.optionGroups) {
    const selected = state.selections[group.id];
    if (!selected) continue;
    const selectedIds = Array.isArray(selected) ? selected : [selected];
    for (const optionId of selectedIds) {
      const option = group.options.find((o) => o.id === optionId);
      if (option) {
        price += Number(option.priceAdjustment) || 0;
      }
    }
  }

  // Add addon prices
  for (const addon of product.addons) {
    const qty = state.addons[addon.id] || 0;
    price += (Number(addon.price) || 0) * qty;
  }

  return price;
}

// ============================================================
// Customization Modal
// ============================================================

function CustomizationModal({
  product,
  onClose,
  onAdd,
  initialSelections,
  initialAddons,
  initialQuantity,
  initialNotes,
}: {
  product: Product;
  onClose: () => void;
  onAdd: (state: CustomizationState) => void;
  initialSelections?: Record<string, string | string[]>;
  initialAddons?: Record<string, number>;
  initialQuantity?: number;
  initialNotes?: string;
}) {
  const [state, setState] = useState<CustomizationState>({
    selections: initialSelections
      ? Object.fromEntries(
          Object.entries(initialSelections).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v])
        )
      : {},
    addons: initialAddons || {},
    quantity: initialQuantity || 1,
    notes: initialNotes || "",
  });

  // Auto-select first option in required single-select groups (only if no initial state)
  useEffect(() => {
    if (initialSelections) return;
    const initial: Record<string, string> = {};
    for (const group of product.optionGroups) {
      if (group.isRequired && group.type === "SINGLE" && group.options.length > 0) {
        initial[group.id] = group.options[0].id;
      }
    }
    setState((prev) => ({ ...prev, selections: initial }));
  }, [product, initialSelections]);

  const handleGroupSelect = useCallback(
    (groupId: string, optionId: string, isMulti: boolean, maxSelect: number) => {
      if (isMulti) {
        setState((prev) => {
          const current = prev.selections[groupId];
          const currentArray = Array.isArray(current) ? current : current ? [current] : [];
          const isSelected = currentArray.includes(optionId);

          // Enforce maxSelect: block adding beyond the allowed maximum
          if (!isSelected && currentArray.length >= maxSelect) {
            toast.error(`Maksimal pilih ${maxSelect} opsi`);
            return prev;
          }

          const nextArray = isSelected
            ? currentArray.filter((id) => id !== optionId)
            : [...currentArray, optionId];
          return {
            ...prev,
            selections: { ...prev.selections, [groupId]: nextArray },
          };
        });
      } else {
        setState((prev) => ({
          ...prev,
          selections: { ...prev.selections, [groupId]: optionId },
        }));
      }
    },
    []
  );

  const handleAddonToggle = useCallback((addonId: string) => {
    setState((prev) => ({
      ...prev,
      addons: {
        ...prev.addons,
        [addonId]: prev.addons[addonId] ? 0 : 1,
      },
    }));
  }, []);

  const unitPrice = calculateCustomizedPrice(product, state);
  const total = unitPrice * state.quantity;

  // Validate required groups (supports SINGLE and MULTI)
  // Required MULTI: minSelect must be met, maxSelect must not be exceeded.
  const is_valid = product.optionGroups.every((group) => {
    if (!group.isRequired) return true;
    const selected = state.selections[group.id];
    if (!selected) return false;
    if (group.type === "MULTI") {
      const arr = Array.isArray(selected) ? selected : [selected];
      return arr.length >= group.minSelect && arr.length <= group.maxSelect;
    }
    return !!selected;
  });

  const handleAdd = () => {
    if (!is_valid) {
      toast.error("Harap lengkapi pilihan yang diperlukan");
      return;
    }
    onAdd(state);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-base">{product.name}</h2>
            <p className="text-sm text-gray-500">
              Rp{Number(product.price).toLocaleString("id-ID")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-brand-secondary flex items-center justify-center hover:bg-brand-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 py-4 space-y-5">            {/* Option Groups */}
          {product.optionGroups.map((group) => {
            const isMulti = group.type === "MULTI";
            return (
            <div key={group.id}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-medium">{group.name}</h3>
                {group.isRequired && (
                  <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full font-medium">
                    Wajib
                  </span>
                )}
                {isMulti && (
                  <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                    {group.minSelect > 0 ? `Pilih ${group.minSelect}-${group.maxSelect}` : `Hingga ${group.maxSelect}`}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {group.options.map((option) => {
                  const isOptionSelected = isMulti
                    ? (() => {
                        const val = state.selections[group.id];
                        const arr = Array.isArray(val) ? val : val ? [val] : [];
                        return arr.includes(option.id);
                      })()
                    : state.selections[group.id] === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => handleGroupSelect(group.id, option.id, isMulti, group.maxSelect)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-colors text-sm ${
                        isOptionSelected
                          ? "border-brand-primary bg-brand-secondary"
                          : "border-gray-200 hover:border-brand-accent"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isMulti ? (
                          <div
                            className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                              isOptionSelected
                                ? "border-brand-primary bg-brand-primary"
                                : "border-gray-300"
                            }`}
                          >
                            {isOptionSelected && (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        ) : (
                          <div
                            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              isOptionSelected
                                ? "border-brand-primary"
                                : "border-gray-300"
                            }`}
                          >
                            {isOptionSelected && (
                              <div className="w-2 h-2 rounded-full bg-brand-primary" />
                            )}
                          </div>
                        )}
                        <span>{option.name}</span>
                      </div>
                      {Number(option.priceAdjustment) !== 0 && (
                        <span className="text-gray-500 text-xs">
                          {Number(option.priceAdjustment) > 0 ? "+" : ""} Rp{Math.abs(Number(option.priceAdjustment)).toLocaleString("id-ID")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {isMulti && group.isRequired && group.minSelect > 0 && (
                <p className="text-[10px] text-gray-400 mt-1 ml-1">
                  Minimal pilih {group.minSelect}
                </p>
              )}
            </div>
            );
          })}

          {/* Add-ons */}
          {product.addons.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Tambahan</h3>
              <div className="space-y-1.5">
                {product.addons.map((addon) => {
                  const qty = state.addons[addon.id] || 0;
                  return (
                    <div
                      key={addon.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-gray-200"
                    >
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleAddonToggle(addon.id)}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                            qty > 0
                              ? "border-brand-primary bg-brand-primary"
                              : "border-gray-300"
                          }`}
                        >
                          {qty > 0 && (
                            <svg
                              className="w-3 h-3 text-white"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          )}
                        </button>
                        <span className="text-sm">{addon.name}</span>
                      </div>
                      <span className="text-xs text-gray-500">
                        + Rp{Number(addon.price).toLocaleString("id-ID")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantity */}
          <div>
            <h3 className="text-sm font-medium mb-2">Jumlah</h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    quantity: Math.max(1, prev.quantity - 1),
                  }))
                }
                className="w-10 h-10 rounded-full bg-brand-secondary flex items-center justify-center hover:bg-brand-accent transition-colors"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-10 text-center text-lg font-bold">
                {state.quantity}
              </span>
              <button
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    quantity: prev.quantity + 1,
                  }))
                }
                className="w-10 h-10 rounded-full bg-brand-primary text-brand-primary-foreground flex items-center justify-center hover:bg-brand-primary/90 transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <h3 className="text-sm font-medium mb-2">
              Catatan untuk Kasir
              <span className="text-gray-400 font-normal ml-1">(opsional)</span>
            </h3>
            <textarea
              value={state.notes}
              onChange={(e) =>
                setState((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="Contoh: Es batu sedikit, tanpa sambal..."
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent resize-none"
            />
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-3">
          <button
            onClick={handleAdd}
            disabled={!is_valid}
            className="w-full bg-brand-primary text-brand-primary-foreground py-3 rounded-xl font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <span>Tambah ke Keranjang</span>
            <span className="font-bold">
              Rp{total.toLocaleString("id-ID")}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Product Card Skeleton
// ============================================================

function ProductCardSkeleton() {
  return (
    <div className="bg-white rounded-xl overflow-hidden">
      <div className="p-3 sm:p-4 flex flex-col gap-1.5">
        <Skeleton className="h-4 sm:h-5 w-4/5" />
        <Skeleton className="h-3 sm:h-3.5 w-full" />
        <Skeleton className="h-3 sm:h-3.5 w-2/3" />
        <div className="pt-2 sm:pt-3 flex flex-col gap-2 sm:gap-2.5">
          <Skeleton className="h-5 sm:h-6 w-1/3" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// No Results (active filters matched nothing)
// ============================================================

function NoResults({
  hasFilters,
  onReset,
}: {
  hasFilters: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <Search className="h-6 w-6 text-gray-300" />
      </div>
      <p className="text-gray-500 text-sm font-medium">
        Tidak ada produk yang cocok
      </p>
      {hasFilters && (
        <button
          onClick={onReset}
          className="mt-3 text-xs font-semibold text-brand-primary hover:underline"
        >
          Reset Filter
        </button>
      )}
    </div>
  );
}

// ============================================================
// Product Image (with broken-image fallback)
// ============================================================

/**
 * Renders the product image inside the card's 4:3 media area. If the URL is
 * dead or the asset cannot be decoded, it swaps in a quiet placeholder so the
 * browser's broken-image glyph never appears. Card layout stays identical
 * whether or not the image loads (fixed aspect container).
 */
function SafeMenuImage({ url, alt }: { url: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <UtensilsCrossed className="h-6 w-6 text-gray-300" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className="w-full h-full object-cover"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

// ============================================================
// Product Card
// ============================================================

const cardActionBase =
  "inline-flex items-center justify-center rounded-lg font-semibold transition-colors active:scale-[0.98] whitespace-nowrap select-none";

function ProductCard({
  product,
  quantity,
  onAdd,
  onCustomize,
  onEdit,
  onIncrease,
  onDecrease,
}: {
  product: Product;
  quantity: number;
  onAdd: () => void;
  onCustomize: () => void;
  onEdit: () => void;
  onIncrease: () => void;
  onDecrease: () => void;
}) {
  const needsCustomization = hasCustomization(product);
  const soldOut = isSoldOut(product);

  return (
    <div className="bg-white rounded-xl overflow-hidden flex flex-col relative">
      {/* Image — only when available; 4:3, object-cover, top corners rounded */}
      {product.imageUrl && (
        <div className="relative w-full aspect-[4/3] bg-gray-100 overflow-hidden flex-shrink-0">
          <SafeMenuImage url={product.imageUrl} alt={product.name} />
          {soldOut && (
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
              <span className="bg-black/70 text-white text-xs sm:text-sm font-bold px-3 py-1.5 rounded-md uppercase tracking-wider">
                Habis
              </span>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="p-3 sm:p-4 flex flex-col flex-1 min-w-0">
        <h3 className="text-sm sm:text-base font-semibold leading-snug line-clamp-2 text-gray-900">
          {product.name}
          {soldOut && !product.imageUrl && (
            <span className="ml-1.5 align-middle inline-block bg-gray-800 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
              Habis
            </span>
          )}
        </h3>
        {product.description && (
          <p className="text-xs sm:text-sm text-gray-400 mt-1 leading-relaxed line-clamp-2">
            {product.description}
          </p>
        )}

        {/* Footer — mt-auto keeps price + action aligned on each grid row */}
        <div className="mt-auto pt-2.5 sm:pt-3">
          <p className="text-sm sm:text-base font-bold text-gray-900 tabular-nums">
            Rp{Number(product.price).toLocaleString("id-ID")}
          </p>

          <div className="mt-2 sm:mt-2.5">
            {soldOut ? (
              <button
                type="button"
                disabled
                aria-label={`${product.name} habis`}
                className="w-full min-h-10 rounded-lg bg-gray-100 text-gray-400 text-xs sm:text-sm font-medium px-3 cursor-not-allowed"
              >
                Habis
              </button>
            ) : quantity === 0 ? (
              needsCustomization ? (
                <button
                  onClick={onCustomize}
                  aria-label={`Pilih ${product.name}`}
                  className={`${cardActionBase} w-full min-h-10 bg-brand-secondary text-brand-secondary-foreground hover:bg-brand-accent text-xs sm:text-sm px-3`}
                >
                  Pilih Produk
                </button>
              ) : (
                <button
                  onClick={onAdd}
                  aria-label={`Tambah ${product.name} ke keranjang`}
                  className={`${cardActionBase} w-full min-h-10 bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary/90 text-xs sm:text-sm px-3`}
                >
                  + Tambah
                </button>
              )
            ) : needsCustomization ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={onEdit}
                  className={`${cardActionBase} flex-1 min-w-0 min-h-10 bg-brand-secondary text-brand-secondary-foreground hover:bg-brand-accent text-xs sm:text-sm px-3`}
                >
                  Ubah
                </button>
                <div className="flex items-center bg-brand-primary rounded-lg overflow-hidden flex-shrink-0 h-10">
                  <button
                    onClick={onDecrease}
                    className="w-9 h-full flex items-center justify-center text-brand-primary-foreground hover:bg-brand-primary/90 transition-colors active:scale-95"
                    aria-label={`Kurangi ${product.name}`}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-7 px-1 text-center text-sm font-bold text-white tabular-nums">
                    {quantity}
                  </span>
                  <button
                    onClick={onIncrease}
                    className="w-9 h-full flex items-center justify-center text-brand-primary-foreground hover:bg-brand-primary/90 transition-colors active:scale-95"
                    aria-label={`Tambah ${product.name}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center bg-brand-primary rounded-lg overflow-hidden h-10">
                <button
                  onClick={onDecrease}
                  className="flex-1 h-full flex items-center justify-center text-brand-primary-foreground hover:bg-brand-primary/90 transition-colors active:scale-95"
                  aria-label={`Kurangi ${product.name}`}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-12 text-center text-sm font-bold text-white tabular-nums">
                  {quantity}
                </span>
                <button
                  onClick={onIncrease}
                  className="flex-1 h-full flex items-center justify-center text-brand-primary-foreground hover:bg-brand-primary/90 transition-colors active:scale-95"
                  aria-label={`Tambah ${product.name}`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

function MenuContent() {
  const router = useRouter();
  const {
    addItem,
    addCustomizedItem,
    updateCartItem,
    items,
    isHydrated,
    updateQuantity,
    removeItem,
    restaurantId,
    setRestaurantId,
    tableContext,
    clearTableContext,
    customerBranch,
    clearCustomerBranch,
  } = useCart();
  const { applyBranding } = useBranding();
  const { customer, isHydrated: authHydrated } = useCustomerAuth();
  const customerId = customer?.id ?? null;
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(
    null
  );
  const [editingCartItemIndex, setEditingCartItemIndex] = useState<number | null>(null);
  // F4 — product recommendations ("Rekomendasi Untuk Kamu" / "Produk Populer").
  const [recommended, setRecommended] = useState<Product[]>([]);
  const [recommendationSource, setRecommendationSource] = useState<
    "personalized" | "popular"
  >("popular");
  // F4 — "🔥 Terlaris" (real sales from the server-side aggregation).
  const [bestSellers, setBestSellers] = useState<Product[]>([]);

  // F5 — menu filtering (search, category, Terlaris/Rekomendasi quick views,
  // Tersedia / Sold Out). All filters are applied CLIENT-SIDE over the
  // already branch-scoped menu data — the server (branch → BranchProduct →
  // availability → stock) decides what this branch may sell in the first
  // place, so filtering never leaks another branch's products.
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string>("all");
  const [quickView, setQuickView] = useState<"all" | "best" | "recommended">("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<
    "all" | "available" | "soldout"
  >("all");

  const searchParams = useSearchParams();

  /**
   * Set true when a stale table context was auto-cleared so the effect below
   * does not immediately re-run and double-load the menu.
   */
  const staleContextSkipRef = useRef(false);

  // Load menu AFTER cart hydration so the QR table context is known.
  // When ordering from a table, that table's restaurant is authoritative for
  // the menu (multi-restaurant isolation). Without a table context we fall
  // back to the first active restaurant (valid guest/takeaway mode).
  //
  // Recovery: if the persisted table context references a restaurant that no
  // longer exists (deleted/inactive restaurant, or DB restored under new ids)
  // the explicit lookup returns 404. Instead of bricking the whole menu we
  // clear the stale dine-in context and fall back to the active restaurant.
  const loadMenu = useCallback(async (preferredRestaurantId?: string | null) => {
    setIsLoading(true);
    try {
      let restaurantData: RestaurantInfo;

      if (preferredRestaurantId) {
        try {
          const restaurantRes = await api.get("/public/restaurant", {
            params: { id: preferredRestaurantId },
          });
          restaurantData = restaurantRes.data.data;
        } catch (error) {
          const status = (error as { response?: { status?: number } })?.response
            ?.status;
          if (status !== 404) throw error;
          // Stale saved context. Determine whether it came from a table
          // (QR) or a generic customer branch selection and recover per
          // source — never silently fall back to a different branch.
          if (customerBranch && !tableContext) {
            clearCustomerBranch();
            router.replace("/pilih-cabang");
            return;
          }
          // Stale QR/table context (restaurant not found / inactive).
          staleContextSkipRef.current = true;
          clearTableContext();
          const fallbackRes = await api.get("/public/restaurant");
          restaurantData = fallbackRes.data.data;
        }
      } else {
        const restaurantRes = await api.get("/public/restaurant");
        restaurantData = restaurantRes.data.data;
      }

      setRestaurant(restaurantData);
      setRestaurantId(restaurantData.id);

      // Apply this restaurant's website branding (theme, logo, site name).
      // Client-side only — the server already validated all values.
      const branding = restaurantData.branding;
      if (branding) {
        applyBranding({
          siteName: branding.siteName,
          logoUrl: branding.logoUrl,
          primaryColor: branding.primaryColor,
          secondaryColor: branding.secondaryColor,
          accentColor: branding.accentColor,
        });
      }

      const menuRes = await api.get("/public/menu", {
        params: {
          restaurantId: restaurantData.id,
          branchCode: tableContext?.branchCode ?? customerBranch?.branchCode ?? undefined,
        },
      });
      setCategories(menuRes.data.data.categories);
      // Normalize Decimal-as-string fields (price, priceAdjustment) to numbers
      setProducts(
        (menuRes.data.data.products || []).map((p: Product) => normalizeProduct(p))
      );

      // Recommendations are a progressive enhancement — a failure must never
      // block the menu itself. Guest = popular products; logged-in customers
      // get personalized picks (the endpoint reads the session cookie
      // server-side and re-validates the restaurant scope).
      try {
        const recRes = await api.get("/public/menu/recommendations", {
          params: {
            restaurantId: restaurantData.id,
            limit: 8,
            branchCode: tableContext?.branchCode ?? customerBranch?.branchCode ?? undefined,
          },
        });
        const recProducts: Product[] = (
          recRes.data.data.products || []
        ).map((p: Product) => normalizeProduct(p));
        setRecommended(recProducts);
        setRecommendationSource(
          recRes.data.data.source === "personalized"
            ? "personalized"
            : "popular"
        );

        // Terlaris — real sales only (PAID orders, server-side). The
        // recommendation ids are excluded so the two sections don't repeat
        // the same products when enough different products exist.
        try {
          const exclIds = recProducts.map((p) => p.id).join(",");
          const bsRes = await api.get("/public/menu/best-sellers", {
            params: {
              restaurantId: restaurantData.id,
              limit: 8,
              excludeIds: exclIds,
              branchCode: tableContext?.branchCode ?? customerBranch?.branchCode ?? undefined,
            },
          });
          setBestSellers(
            (bsRes.data.data.products || []).map(
              (r: { product: Product }) => normalizeProduct(r.product)
            )
          );
        } catch {
          setBestSellers([]);
        }
      } catch {
        setRecommended([]);
        setBestSellers([]);
      }
    } catch (error) {
      console.error("Failed to load menu:", error);
      // A 404 /public/menu with a saved (tableless) branch context means the
      // customer's branch was deactivated/removed — clear it and re-ask
      // instead of showing a misleading generic error or a stale menu.
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status === 404 && customerBranch && !tableContext) {
        clearCustomerBranch();
        router.replace("/pilih-cabang");
        return;
      }
      if (status === 404 && !tableContext && !customerBranch) {
        toast.error("Cabang tidak tersedia");
        return;
      }
      toast.error("Gagal memuat menu");
    } finally {
      setIsLoading(false);
    }
  }, [clearTableContext, tableContext, customerBranch, clearCustomerBranch, router]);

  useEffect(() => {
    if (!isHydrated) return;
    // Defer so setState (loading flag) is not called synchronously in the effect
    const timer = setTimeout(() => {
      // Skip the re-run triggered by clearing the stale context (already
      // loaded via the fallback inside loadMenu).
      if (staleContextSkipRef.current) {
        staleContextSkipRef.current = false;
        return;
      }
      loadMenu(tableContext?.restaurantId ?? customerBranch?.restaurantId ?? null);
    }, 0);
    return () => clearTimeout(timer);
  }, [isHydrated, tableContext, customerBranch, loadMenu]);

  // "Ganti Cabang" — only reachable when NOT ordering from a QR table
  // (table context must stay the priority). Clears the customer branch
  // selection and re-opens the selector; picking a new branch reloads the
  // menu with that branch's stock/price/availability.
  const handleChangeBranch = useCallback(() => {
    clearCustomerBranch();
    router.push("/pilih-cabang");
  }, [clearCustomerBranch, router]);

  // Re-personalize recommendations after login/logout (cookie is sent
  // automatically; the server re-validates the session + restaurant scope).
  useEffect(() => {
    if (!authHydrated || !restaurant) return;
    (async () => {
      try {
        const recRes = await api.get("/public/menu/recommendations", {
          params: { restaurantId: restaurant.id, limit: 8 },
        });
        const recProducts: Product[] = (recRes.data.data.products || []).map(
          (p: Product) => normalizeProduct(p)
        );
        setRecommended(recProducts);
        setRecommendationSource(
          recRes.data.data.source === "personalized"
            ? "personalized"
            : "popular"
        );

        try {
          const exclIds = recProducts.map((p) => p.id).join(",");
          const bsRes = await api.get("/public/menu/best-sellers", {
            params: { restaurantId: restaurant.id, limit: 8, excludeIds: exclIds },
          });
          setBestSellers(
            (bsRes.data.data.products || []).map(
              (r: { product: Product }) => normalizeProduct(r.product)
            )
          );
        } catch {
          setBestSellers([]);
        }
      } catch {
        setRecommended([]);
        setBestSellers([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, authHydrated, restaurant?.id]);

  const editHandledRef = useRef(false);
  const pendingEditIndexRef = useRef<number | null>(null);

  // Handle ?edit=INDEX from cart page.
  // IMPORTANT: do NOT mark handled until the product has actually been
  // resolved — products load asynchronously, so the modal must open once
  // both items and products are available (see retry effect below).
  useEffect(() => {
    if (!isHydrated || items.length === 0 || editHandledRef.current) return;
    const editIndex = searchParams.get("edit");
    if (editIndex !== null) {
      const idx = parseInt(editIndex, 10);
      if (!isNaN(idx) && idx >= 0 && idx < items.length) {
        pendingEditIndexRef.current = idx;
      }
      // Clean up URL
      window.history.replaceState({}, '', '/menu');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, isHydrated, items]);

  // Retry opening the edit modal once products have loaded (products fetch
  // completes after hydration, so the first effect may not have them yet).
  useEffect(() => {
    if (pendingEditIndexRef.current === null) return;
    const idx = pendingEditIndexRef.current;
    const item = items[idx];
    const product = item && products.find((p) => p.id === item.productId);
    if (!product) return;

    pendingEditIndexRef.current = null;
    editHandledRef.current = true;
    // Defer state updates to avoid synchronous setState in effect
    requestAnimationFrame(() => {
      setEditingCartItemIndex(idx);
      setCustomizingProduct(product);
    });
  }, [products, items]);

  /**
   * Get total quantity of a simple product in cart (no customization).
   * For customized products, we count all items with that productId.
   */
  const getItemQuantity = (productId: string) => {
    return items
      .filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + item.quantity, 0);
  };

  const handleAdd = (product: Product) => {
    if (isSoldOut(product)) {
      toast.error(`${product.name} sudah habis`);
      return;
    }
    // Defensive: never direct-add a product that needs customization
    if (hasCustomization(product)) {
      setEditingCartItemIndex(null);
      setCustomizingProduct(product);
      return;
    }
    addItem({
      id: product.id,
      name: product.name,
      price: Number(product.price),
      imageUrl: product.imageUrl,
      category: product.category,
    });
    toast.success(`${product.name} ditambahkan`);
  };

  const handleCustomizeAdd = (product: Product, state: CustomizationState) => {
    if (isSoldOut(product)) {
      toast.error(`${product.name} sudah habis`);
      setCustomizingProduct(null);
      setEditingCartItemIndex(null);
      return;
    }
    // Build selections array (prices are numbers — Prisma Decimal is coerced on load)
    const selections = product.optionGroups
      .map((group) => {
        const selectedVal = state.selections[group.id];
        if (!selectedVal) return null;

        if (group.type === "MULTI") {
          const optionIds = Array.isArray(selectedVal) ? selectedVal : [selectedVal];
          return optionIds.map((optId) => {
            const option = group.options.find((o) => o.id === optId);
            if (!option) return null;
            return {
              groupId: group.id,
              groupName: group.name,
              optionId: option.id,
              optionName: option.name,
              priceAdjustment: Number(option.priceAdjustment) || 0,
            };
          });
        }

        const optionId = typeof selectedVal === "string" ? selectedVal : selectedVal[0];
        if (!optionId) return null;
        const option = group.options.find((o) => o.id === optionId);
        if (!option) return null;
        return [{
          groupId: group.id,
          groupName: group.name,
          optionId: option.id,
          optionName: option.name,
          priceAdjustment: Number(option.priceAdjustment) || 0,
        }];
      })
      .flat()
      .filter(Boolean) as Array<{
      groupId: string;
      groupName: string;
      optionId: string;
      optionName: string;
      priceAdjustment: number;
    }>;

    // Build addons array (prices are numbers — coerced on load)
    const addons = product.addons
      .map((addon) => {
        const qty = state.addons[addon.id] || 0;
        if (qty <= 0) return null;
        return {
          addonId: addon.id,
          name: addon.name,
          price: Number(addon.price) || 0,
          quantity: qty,
        };
      })
      .filter(Boolean) as Array<{
      addonId: string;
      name: string;
      price: number;
      quantity: number;
    }>;

    if (editingCartItemIndex !== null) {
      // Editing existing cart item
      updateCartItem(editingCartItemIndex, {
        productId: product.id,
        name: product.name,
        price: Number(product.price),
        quantity: state.quantity,
        imageUrl: product.imageUrl,
        categoryName: product.category?.name,
        selections,
        addons,
        notes: state.notes || undefined,
      });
      toast.success(`${product.name} diperbarui`);
    } else {
      // Adding new cart item
      addCustomizedItem({
        productId: product.id,
        name: product.name,
        price: Number(product.price),
        quantity: state.quantity,
        imageUrl: product.imageUrl,
        categoryName: product.category?.name,
        selections,
        addons,
        notes: state.notes || undefined,
      });
      toast.success(`${product.name} ditambahkan`);
    }

    setCustomizingProduct(null);
    setEditingCartItemIndex(null);
  };

  /**
   * For customized products, find items by productId and handle quantity changes.
   * For simple products, find by configKey.
   */
  const handleEditFromMenu = (product: Product) => {
    // For customizable products, ANY cart item with this productId is a
    // customized item (even if it has empty selections/addons/notes).
    const idx = items.findLastIndex((item) => item.productId === product.id);
    if (idx >= 0) {
      setEditingCartItemIndex(idx);
      setCustomizingProduct(product);
    } else {
      // No item in cart, just open for new
      setEditingCartItemIndex(null);
      setCustomizingProduct(product);
    }
  };

  const handleIncrease = (product: Product) => {
    if (isSoldOut(product)) {
      toast.error(`${product.name} sudah habis`);
      return;
    }
    const isCustomizable = hasCustomization(product);
    // For customizable products, any item with this productId is customized
    const idx = isCustomizable
      ? items.findLastIndex((item) => item.productId === product.id)
      : items.findIndex((item) => item.productId === product.id);

    if (idx >= 0) {
      updateQuantity(idx, items[idx].quantity + 1);
    }
  };

  const handleDecrease = (product: Product) => {
    const isCustomizable = hasCustomization(product);
    const idx = isCustomizable
      ? items.findLastIndex((item) => item.productId === product.id)
      : items.findIndex((item) => item.productId === product.id);

    if (idx >= 0) {
      if (items[idx].quantity <= 1) {
        removeItem(idx);
        // Clear edit state if the removed item was being edited
        if (editingCartItemIndex === idx) {
          setEditingCartItemIndex(null);
          setCustomizingProduct(null);
        } else if (editingCartItemIndex !== null && editingCartItemIndex > idx) {
          // Shift edit index if a previous item was removed
          setEditingCartItemIndex(editingCartItemIndex - 1);
        }
      } else {
        updateQuantity(idx, items[idx].quantity - 1);
      }
    }
  };

  // Group products by category, preserving the API category order.
  // Sections with zero products are skipped entirely; products without a
  // category fall back to a "Lainnya" section instead of crashing.
  /**
   * Client-side filter predicate. Applied over the branch-scoped product
   * list: search text, category chip, and Tersedia / Sold Out toggle.
   */
  const matchesFilters = useCallback(
    (p: Product) => {
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const hay = `${p.name} ${p.description || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (activeCategoryId !== "all" && p.category?.id !== activeCategoryId) {
        return false;
      }
      if (availabilityFilter === "available" && isSoldOut(p)) return false;
      if (availabilityFilter === "soldout" && !isSoldOut(p)) return false;
      return true;
    },
    [searchQuery, activeCategoryId, availabilityFilter]
  );

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    activeCategoryId !== "all" ||
    quickView !== "all" ||
    availabilityFilter !== "all";

  const sections = useMemo(() => {
    const list: { id: string; name: string; products: Product[] }[] = [];
    const indexById = new Map<string, number>();
    for (const cat of categories) {
      indexById.set(cat.id, list.length);
      list.push({ id: cat.id, name: cat.name, products: [] });
    }
    const uncategorized: Product[] = [];
    for (const product of products) {
      const cat = product.category;
      if (cat && indexById.has(cat.id)) {
        list[indexById.get(cat.id)!].products.push(product);
      } else if (cat) {
        // Product references a category missing from the active list
        // (e.g. just deactivated) — show it under its own heading.
        indexById.set(cat.id, list.length);
        list.push({ id: cat.id, name: cat.name, products: [product] });
      } else {
        uncategorized.push(product);
      }
    }
    if (uncategorized.length > 0) {
      list.push({
        id: "__uncategorized__",
        name: "Lainnya",
        products: uncategorized,
      });
    }
    return list.filter((s) => s.products.length > 0);
  }, [categories, products]);

  // ============================================================
  // Loading
  // ============================================================

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="text-center pt-1 pb-2">
          <Skeleton className="h-6 w-40 mx-auto" />
          <Skeleton className="h-3 w-32 mx-auto mt-1.5" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // ============================================================
  // Render
  // ============================================================

  const totalCartItems = items.reduce((s, i) => s + i.quantity, 0);
  const totalCartPrice = items.reduce(
    (s, i) => s + (i.displayPrice || i.price) * i.quantity,
    0
  );

  // Filtered sections: the marketing sections (Rekomendasi / Terlaris) stay
  // visible only in the default "Semua" view without an active search; the
  // category sections always respect search/category/availability.
  const recVisible =
    quickView === "all" && searchQuery.trim() === ""
      ? recommended.filter(matchesFilters)
      : [];
  const bestVisible =
    quickView === "all" && searchQuery.trim() === ""
      ? bestSellers.filter(matchesFilters)
      : [];
  const quickProducts =
    quickView === "best"
      ? bestSellers.filter(matchesFilters)
      : quickView === "recommended"
        ? recommended.filter(matchesFilters)
        : [];

  const resetFilters = () => {
    setSearchQuery("");
    setActiveCategoryId("all");
    setQuickView("all");
    setAvailabilityFilter("all");
  };

  return (
    <div>
      {/* Restaurant Header — website branding (logo + site name) */}
      {restaurant && (
        <div className="text-center pt-2 pb-3 sm:pb-4">
          {restaurant.branding?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={restaurant.branding.logoUrl}
              alt={restaurant.branding.siteName || restaurant.name}
              className="mx-auto h-12 w-12 object-contain mb-2"
              onError={(e) => {
                // Hide broken logos instead of showing the broken-image icon.
                e.currentTarget.style.display = "none";
              }}
            />
          )}
          <h1 className="text-xl sm:text-2xl font-bold text-brand-primary">
            {restaurant.branding?.siteName || restaurant.name}
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Pesan langsung dari website
          </p>
          {customerBranch && !tableContext && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-brand-secondary px-3 py-1">
              <span className="text-[11px] font-semibold text-gray-700">
                {customerBranch.branchName}
              </span>
              <span className="text-gray-300">•</span>
              <button
                type="button"
                onClick={handleChangeBranch}
                className="text-[11px] font-bold text-brand-primary hover:underline"
              >
                Ganti Cabang
              </button>
            </div>
          )}
        </div>
      )}

      {/* F5 — Filter bar: search, category, quick views (Rekomendasi /
          Terlaris), Tersedia / Sold Out. Filtering stays client-side over the
          branch-scoped menu; the server decides availability per branch. */}
      <div className="space-y-2.5">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari produk..."
            className="w-full border border-gray-200 rounded-full pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-white"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Bersihkan pencarian"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Quick views + availability */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <button
            onClick={() => setQuickView("all")}
            className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors ${
              quickView === "all"
                ? "bg-brand-primary text-brand-primary-foreground border-brand-primary"
                : "bg-white text-gray-600 border-gray-200 hover:border-brand-accent"
            }`}
          >
            Semua
          </button>
          <button
            onClick={() => setQuickView("recommended")}
            className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors ${
              quickView === "recommended"
                ? "bg-brand-primary text-brand-primary-foreground border-brand-primary"
                : "bg-white text-gray-600 border-gray-200 hover:border-brand-accent"
            }`}
          >
            ⭐ Rekomendasi
          </button>
          <button
            onClick={() => setQuickView("best")}
            className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors ${
              quickView === "best"
                ? "bg-brand-primary text-brand-primary-foreground border-brand-primary"
                : "bg-white text-gray-600 border-gray-200 hover:border-brand-accent"
            }`}
          >
            🔥 Terlaris
          </button>
          <span className="w-px h-5 bg-gray-200 flex-shrink-0" />
          <button
            onClick={() => setAvailabilityFilter("all")}
            className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors ${
              availabilityFilter === "all"
                ? "bg-brand-primary text-brand-primary-foreground border-brand-primary"
                : "bg-white text-gray-600 border-gray-200 hover:border-brand-accent"
            }`}
          >
            Tersedia &amp; Habis
          </button>
          <button
            onClick={() => setAvailabilityFilter("available")}
            className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors ${
              availabilityFilter === "available"
                ? "bg-brand-primary text-brand-primary-foreground border-brand-primary"
                : "bg-white text-gray-600 border-gray-200 hover:border-brand-accent"
            }`}
          >
            Tersedia
          </button>
          <button
            onClick={() => setAvailabilityFilter("soldout")}
            className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors ${
              availabilityFilter === "soldout"
                ? "bg-brand-primary text-brand-primary-foreground border-brand-primary"
                : "bg-white text-gray-600 border-gray-200 hover:border-brand-accent"
            }`}
          >
            Habis
          </button>
        </div>

        {/* Category chips */}
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          <button
            onClick={() => setActiveCategoryId("all")}
            className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
              activeCategoryId === "all"
                ? "bg-brand-primary text-brand-primary-foreground border-brand-primary"
                : "bg-white text-gray-600 border-gray-200 hover:border-brand-accent"
            }`}
          >
            Semua Kategori
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategoryId(cat.id)}
              className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
                activeCategoryId === cat.id
                  ? "bg-brand-primary text-brand-primary-foreground border-brand-primary"
                  : "bg-white text-gray-600 border-gray-200 hover:border-brand-accent"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Promo — F3: tenant-scoped promos; claim requires login. */}
      {restaurant && (
        <PromoSection
          restaurantId={restaurant.id}
          branchCode={
            tableContext?.branchCode ?? customerBranch?.branchCode ?? undefined
          }
        />
      )}

      {/* Rekomendasi — F4: personalized (login) or popular products,
          rendered with the same ProductCard as the category sections. Hidden
          while a search or a quick view (Terlaris/Rekomendasi) is active. */}
      {recVisible.length > 0 && (
        <section aria-label="Rekomendasi">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-3 sm:mb-4 flex items-center gap-1.5">
            <span aria-hidden>⭐</span>
            {recommendationSource === "personalized"
              ? "Rekomendasi Untuk Kamu"
              : "Produk Populer"}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 mb-8 sm:mb-10">
            {recVisible.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                quantity={getItemQuantity(product.id)}
                onAdd={() => handleAdd(product)}
                onCustomize={() => {
                  setEditingCartItemIndex(null);
                  setCustomizingProduct(product);
                }}
                onEdit={() => handleEditFromMenu(product)}
                onIncrease={() => handleIncrease(product)}
                onDecrease={() => handleDecrease(product)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Terlaris — F4: real sales (PAID orders), separate section, placed
          right after Rekomendasi and before the category sections. Hidden
          while a search or a quick view is active. */}
      {bestVisible.length > 0 && (
        <section aria-label="Terlaris">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-3 sm:mb-4 flex items-center gap-1.5">
            <span aria-hidden>🔥</span>
            Terlaris
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 mb-8 sm:mb-10">
            {bestVisible.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                quantity={getItemQuantity(product.id)}
                onAdd={() => handleAdd(product)}
                onCustomize={() => {
                  setEditingCartItemIndex(null);
                  setCustomizingProduct(product);
                }}
                onEdit={() => handleEditFromMenu(product)}
                onIncrease={() => handleIncrease(product)}
                onDecrease={() => handleDecrease(product)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Products — quick view (Terlaris / Rekomendasi) or category sections */}
      {quickView !== "all" ? (
        quickProducts.length === 0 ? (
          <NoResults hasFilters={hasActiveFilters} onReset={resetFilters} />
        ) : (
          <section aria-label={quickView === "best" ? "Terlaris" : "Rekomendasi"}>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-3 sm:mb-4 flex items-center gap-1.5">
              <span aria-hidden>{quickView === "best" ? "🔥" : "⭐"}</span>
              {quickView === "best" ? "Terlaris" : "Rekomendasi"}
            </h2>
            <div
              className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 ${
                totalCartItems > 0 ? "pb-24" : "pb-6"
              }`}
            >
              {quickProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  quantity={getItemQuantity(product.id)}
                  onAdd={() => handleAdd(product)}
                  onCustomize={() => {
                    setEditingCartItemIndex(null);
                    setCustomizingProduct(product);
                  }}
                  onEdit={() => handleEditFromMenu(product)}
                  onIncrease={() => handleIncrease(product)}
                  onDecrease={() => handleDecrease(product)}
                />
              ))}
            </div>
          </section>
        )
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-3">
            <UtensilsCrossed className="h-6 w-6 text-gray-300" />
          </div>
          <p className="text-gray-500 text-sm font-medium">
            Menu belum tersedia
          </p>
        </div>
      ) : sections.some((s) => s.products.some(matchesFilters)) ? (
        <div
          className={`flex flex-col gap-8 sm:gap-10 ${
            totalCartItems > 0 ? "pb-24" : "pb-6"
          }`}
        >
          {sections.map((section) => {
            const visible = section.products.filter(matchesFilters);
            if (visible.length === 0) return null;
            return (
              <section key={section.id} aria-label={section.name}>
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-3 sm:mb-4">
                  {section.name}
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {visible.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      quantity={getItemQuantity(product.id)}
                      onAdd={() => handleAdd(product)}
                      onCustomize={() => { setEditingCartItemIndex(null); setCustomizingProduct(product); }}
                      onEdit={() => handleEditFromMenu(product)}
                      onIncrease={() => handleIncrease(product)}
                      onDecrease={() => handleDecrease(product)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <NoResults hasFilters={hasActiveFilters} onReset={resetFilters} />
      )}

      {/* Floating Cart Bar */}
      {totalCartItems > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 pb-[env(safe-area-inset-bottom)]">
          <div className="bg-brand-primary text-brand-primary-foreground px-4 py-3">
            <div className="max-w-4xl mx-auto flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <ShoppingCart className="h-5 w-5" />
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-[10px] flex items-center justify-center font-bold px-1">
                    {totalCartItems}
                  </span>
                </div>
                <div>
                  <span className="text-sm font-medium">
                    {totalCartItems} item
                  </span>
                </div>
              </div>
              <Link
                href="/cart"
                className="flex items-center gap-3 active:scale-95 transition-transform"
              >
                <span className="text-sm font-bold tabular-nums">
                  Rp{totalCartPrice.toLocaleString("id-ID")}
                </span>
                <span className="bg-white text-gray-900 text-xs font-bold px-3 py-1.5 rounded-lg">
                  Lihat
                </span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Customization Modal */}
      {customizingProduct && (
        <CustomizationModal
          product={customizingProduct}
          onClose={() => { setCustomizingProduct(null); setEditingCartItemIndex(null); }}
          onAdd={(state) => handleCustomizeAdd(customizingProduct, state)}
          initialSelections={
            editingCartItemIndex !== null && items[editingCartItemIndex]
              ? (() => {
                  const item = items[editingCartItemIndex];
                  const map: Record<string, string | string[]> = {};
                  for (const s of item.selections || []) {
                    // MULTI groups can have multiple options — collect as array
                    const group = customizingProduct.optionGroups.find(
                      (g) => g.id === s.groupId
                    );
                    if (group?.type === "MULTI") {
                      const existing = map[s.groupId];
                      map[s.groupId] = Array.isArray(existing)
                        ? [...existing, s.optionId]
                        : [s.optionId];
                    } else {
                      map[s.groupId] = s.optionId;
                    }
                  }
                  return map;
                })()
              : undefined
          }
          initialAddons={
            editingCartItemIndex !== null && items[editingCartItemIndex]
              ? Object.fromEntries(
                  (items[editingCartItemIndex].addons || []).map((a) => [a.addonId, a.quantity])
                )
              : undefined
          }
          initialQuantity={
            editingCartItemIndex !== null && items[editingCartItemIndex]
              ? items[editingCartItemIndex].quantity
              : undefined
          }
          initialNotes={
            editingCartItemIndex !== null && items[editingCartItemIndex]
              ? items[editingCartItemIndex].notes
              : undefined
          }
        />
      )}
    </div>
  );
}

export default function MenuPage() {
  return (
    <Suspense fallback={
      <div className="space-y-4">
        <div className="text-center pt-1 pb-2">
          <Skeleton className="h-6 w-40 mx-auto" />
          <Skeleton className="h-3 w-32 mx-auto mt-1.5" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
    }>
      <MenuContent />
    </Suspense>
  );
}
