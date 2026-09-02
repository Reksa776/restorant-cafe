"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/hooks/use-cart";
import Link from "next/link";
import { Plus, Minus, ShoppingCart, UtensilsCrossed, X } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/axios";
import { Skeleton } from "@/components/ui/skeleton";

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
  options: Array<{
    id: string;
    name: string;
    priceAdjustment: number;
  }>;
}

interface Addon {
  id: string;
  name: string;
  price: number;
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
  price: string;
  imageUrl?: string;
  isAvailable: boolean;
  category: { id: string; name: string };
  optionGroups: OptionGroup[];
  addons: Addon[];
}

interface RestaurantInfo {
  id: string;
  name: string;
}

interface CustomizationState {
  selections: Record<string, string>; // groupId -> optionId
  addons: Record<string, number>; // addonId -> quantity
  quantity: number;
  notes: string;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Determine if a product requires customization modal.
 * Checks for ACTIVE option groups (with active options) or ACTIVE addons.
 * Defensive: handles null/undefined, empty arrays, and inactive items.
 */
function hasCustomization(product: Product): boolean {
  // Check for active option groups that have at least one active option
  if (product.optionGroups && product.optionGroups.length > 0) {
    const hasActiveGroup = product.optionGroups.some(
      (group) => group && group.options && group.options.length > 0
    );
    if (hasActiveGroup) return true;
  }

  // Check for active addons
  if (product.addons && product.addons.length > 0) {
    return true;
  }

  return false;
}

function calculateCustomizedPrice(
  product: Product,
  state: CustomizationState
): number {
  let price = Number(product.price);

  // Add selection price adjustments
  for (const group of product.optionGroups) {
    const selectedOptionId = state.selections[group.id];
    if (selectedOptionId) {
      const option = group.options.find((o) => o.id === selectedOptionId);
      if (option) {
        price += option.priceAdjustment;
      }
    }
  }

  // Add addon prices
  for (const addon of product.addons) {
    const qty = state.addons[addon.id] || 0;
    price += addon.price * qty;
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
    selections: initialSelections ? Object.fromEntries(
      Object.entries(initialSelections).map(([k, v]) => [k, Array.isArray(v) ? v[0] || "" : v])
    ) : {},
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
    (groupId: string, optionId: string, isMulti: boolean) => {
      if (isMulti) {
        setState((prev) => {
          const current = prev.selections[groupId];
          const currentArray = Array.isArray(current) ? current : current ? [current] : [];
          const isSelected = currentArray.includes(optionId);
          const nextArray = isSelected
            ? currentArray.filter((id) => id !== optionId)
            : [...currentArray, optionId];
          return {
            ...prev,
            selections: { ...prev.selections, [groupId]: nextArray as unknown as string },
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

  // Validate required groups (supports SINGLE and MULTI
  const is_valid = product.optionGroups.every((group) => {
    if (!group.isRequired) return true;
    const selected = state.selections[group.id];
    if (!selected) return false;
    if (group.type === "MULTI") {
      const arr = Array.isArray(selected) ? selected : selected ? [selected] : [];
      return arr.length >= group.minSelect;
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
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
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
                      onClick={() => handleGroupSelect(group.id, option.id, isMulti)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-colors text-sm ${
                        isOptionSelected
                          ? "border-gray-900 bg-gray-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isMulti ? (
                          <div
                            className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                              isOptionSelected
                                ? "border-gray-900 bg-gray-900"
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
                                ? "border-gray-900"
                                : "border-gray-300"
                            }`}
                          >
                            {isOptionSelected && (
                              <div className="w-2 h-2 rounded-full bg-gray-900" />
                            )}
                          </div>
                        )}
                        <span>{option.name}</span>
                      </div>
                      {option.priceAdjustment !== 0 && (
                        <span className="text-gray-500 text-xs">
                          {option.priceAdjustment > 0 ? "+" : ""} Rp{Math.abs(option.priceAdjustment).toLocaleString("id-ID")}
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
                              ? "border-gray-900 bg-gray-900"
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
                        + Rp{addon.price.toLocaleString("id-ID")}
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
                className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
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
                className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center hover:bg-black transition-colors"
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
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent resize-none"
            />
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-3">
          <button
            onClick={handleAdd}
            disabled={!is_valid}
            className="w-full bg-gray-900 text-white py-3 rounded-xl font-medium hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
      <Skeleton className="w-full aspect-[4/3] rounded-none" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Product Card
// ============================================================

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

  return (
    <div className="bg-white rounded-xl overflow-hidden flex flex-col">
      {/* Image */}
      <div className="relative w-full aspect-[4/3] bg-gray-100 overflow-hidden">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-50">
            <UtensilsCrossed className="h-10 w-10 text-gray-300" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 flex flex-col flex-1">
        <h3 className="font-semibold text-[13px] leading-snug line-clamp-1 text-gray-900">
          {product.name}
        </h3>
        {product.description && (
          <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">
            {product.description}
          </p>
        )}

        <div className="mt-auto pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-gray-900 tabular-nums">
              Rp{Number(product.price).toLocaleString("id-ID")}
            </p>

            {/* Button */}
            {needsCustomization ? (
              quantity === 0 ? (
                <button
                  onClick={onCustomize}
                  className="flex-shrink-0 bg-gray-900 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black transition-colors active:scale-95 min-h-[36px]"
                >
                  Pilih Produk
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={onEdit}
                    className="bg-gray-100 text-gray-700 px-2 py-1.5 rounded-lg text-[10px] font-medium hover:bg-gray-200 transition-colors"
                  >
                    Ubah
                  </button>
                  <div className="flex items-center bg-gray-900 rounded-lg overflow-hidden flex-shrink-0">
                    <button
                      onClick={onDecrease}
                      className="w-8 h-8 flex items-center justify-center text-white hover:bg-gray-800 transition-colors active:scale-95"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-7 text-center text-sm font-bold text-white tabular-nums">
                      {quantity}
                    </span>
                    <button
                      onClick={onIncrease}
                      className="w-8 h-8 flex items-center justify-center text-white hover:bg-gray-800 transition-colors active:scale-95"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            ) : quantity === 0 ? (
              <button
                onClick={onAdd}
                className="flex-shrink-0 bg-gray-900 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black transition-colors active:scale-95 min-h-[36px]"
                aria-label={`Tambah ${product.name} ke keranjang`}
              >
                + Tambah
              </button>
            ) : (
              <div className="flex items-center bg-gray-900 rounded-lg overflow-hidden flex-shrink-0">
                <button
                  onClick={onDecrease}
                  className="w-9 h-9 flex items-center justify-center text-white hover:bg-gray-800 transition-colors active:scale-95"
                  aria-label={`Kurangi ${product.name}`}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-8 text-center text-sm font-bold text-white tabular-nums">
                  {quantity}
                </span>
                <button
                  onClick={onIncrease}
                  className="w-9 h-9 flex items-center justify-center text-white hover:bg-gray-800 transition-colors active:scale-95"
                  aria-label={`Tambah ${product.name}`}
                >
                  <Plus className="h-3.5 w-3.5" />
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
  } = useCart();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(
    null
  );
  const [editingCartItemIndex, setEditingCartItemIndex] = useState<number | null>(null);

  const searchParams = useSearchParams();

  useEffect(() => {
    loadMenu();
  }, []);

  const editHandledRef = useRef(false);

  // Handle ?edit=INDEX from cart page
  useEffect(() => {
    if (!isHydrated || items.length === 0 || editHandledRef.current) return;
    const editIndex = searchParams.get("edit");
    if (editIndex !== null) {
      editHandledRef.current = true;
      const idx = parseInt(editIndex, 10);
      if (!isNaN(idx) && idx >= 0 && idx < items.length) {
        const item = items[idx];
        const product = products.find((p) => p.id === item.productId);
        if (product) {
          // Defer state updates to avoid synchronous setState in effect
          requestAnimationFrame(() => {
            setEditingCartItemIndex(idx);
            setCustomizingProduct(product);
          });
        }
      }
      // Clean up URL
      window.history.replaceState({}, '', '/menu');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, isHydrated, items, products]);

  const loadMenu = async () => {
    setIsLoading(true);
    try {
      const restaurantRes = await api.get("/public/restaurant");
      const restaurantData = restaurantRes.data.data;
      setRestaurant(restaurantData);
      setRestaurantId(restaurantData.id);

      const menuRes = await api.get("/public/menu", {
        params: { restaurantId: restaurantData.id },
      });
      setCategories(menuRes.data.data.categories);
      setProducts(menuRes.data.data.products);
    } catch (error) {
      console.error("Failed to load menu:", error);
      toast.error("Gagal memuat menu");
    } finally {
      setIsLoading(false);
    }
  };

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
    // Build selections array
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
              priceAdjustment: option.priceAdjustment,
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
          priceAdjustment: option.priceAdjustment,
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

    // Build addons array
    const addons = product.addons
      .map((addon) => {
        const qty = state.addons[addon.id] || 0;
        if (qty <= 0) return null;
        return {
          addonId: addon.id,
          name: addon.name,
          price: addon.price,
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
    // Find the last customized item with this productId
    const idx = items.findLastIndex(
      (item) => item.productId === product.id &&
        ((item.selections && item.selections.length > 0) || (item.addons && item.addons.length > 0))
    );
    if (idx >= 0) {
      setEditingCartItemIndex(idx);
      setCustomizingProduct(product);
    } else {
      // No customized item found, just open for new
      setEditingCartItemIndex(null);
      setCustomizingProduct(product);
    }
  };

  const handleIncrease = (product: Product) => {
    const isCustomizable = hasCustomization(product);
    if (isCustomizable) {
      // Find the last item with this productId that has customization data
      const idx = items.findLastIndex(
        (item) => item.productId === product.id &&
          ((item.selections && item.selections.length > 0) || (item.addons && item.addons.length > 0))
      );
      if (idx >= 0) {
        updateQuantity(idx, items[idx].quantity + 1);
      }
    } else {
      const idx = items.findIndex(
        (item) => item.productId === product.id
      );
      if (idx >= 0) {
        updateQuantity(idx, items[idx].quantity + 1);
      }
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

  const filteredProducts =
    selectedCategory === "all"
      ? products
      : products.filter((p) => p.category.id === selectedCategory);

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
        <div className="flex gap-2 overflow-hidden scrollbar-hide -mx-4 px-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-16 rounded-full flex-shrink-0" />
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
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

  return (
    <div className="space-y-4">
      {/* Restaurant Header */}
      {restaurant && (
        <div className="text-center pt-1 pb-1">
          <h1 className="text-lg font-bold text-gray-900">
            {restaurant.name}
          </h1>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Pesan langsung dari website
          </p>
        </div>
      )}

      {/* Category Filter */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4 py-1">
        <button
          onClick={() => setSelectedCategory("all")}
          className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
            selectedCategory === "all"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-500 hover:bg-gray-200 active:bg-gray-200"
          }`}
        >
          Semua
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              selectedCategory === cat.id
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200 active:bg-gray-200"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      {filteredProducts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-3">
            <UtensilsCrossed className="h-6 w-6 text-gray-300" />
          </div>
          <p className="text-gray-500 text-sm font-medium">
            {selectedCategory === "all"
              ? "Menu belum tersedia"
              : "Belum ada menu di kategori ini"}
          </p>
          {selectedCategory !== "all" && (
            <button
              onClick={() => setSelectedCategory("all")}
              className="mt-3 text-xs text-gray-400 underline underline-offset-2 hover:text-gray-600 transition-colors"
            >
              Lihat semua menu
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 pb-24">
          {filteredProducts.map((product) => (
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
      )}

      {/* Floating Cart Bar */}
      {totalCartItems > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 pb-[env(safe-area-inset-bottom)]">
          <div className="bg-gray-900 text-white px-4 py-3">
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
              ? Object.fromEntries(
                  (items[editingCartItemIndex].selections || []).map((s) => [s.groupId, s.optionId])
                )
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
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
