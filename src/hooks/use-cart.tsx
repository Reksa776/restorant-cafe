"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";

// ============================================================
// Types
// ============================================================

export interface CartSelection {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceAdjustment: number;
}

export interface CartAddon {
  addonId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string | null;
  categoryName?: string;
  selections?: CartSelection[];
  addons?: CartAddon[];
  notes?: string;
  /** Unit price including all selections and addons (display only) */
  displayPrice: number;
}

export interface TableContext {
  tableId: string;
  tableNumber: number;
  tableName: string;
  restaurantId: string;
  visitorCount: number;
}

export interface CartContextType {
  items: CartItem[];
  isHydrated: boolean;
  addItem: (product: {
    id: string;
    name: string;
    price: number;
    imageUrl?: string | null;
    category?: { name: string };
    optionGroups?: Array<{
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
    }>;
    addons?: Array<{
      id: string;
      name: string;
      price: number;
    }>;
  }) => void;
  addCustomizedItem: (item: Omit<CartItem, "displayPrice">) => void;
  removeItem: (index: number) => void;
  updateQuantity: (index: number, quantity: number) => void;
  updateCartItem: (index: number, item: Omit<CartItem, "displayPrice">) => void;
  clearCart: () => void;
  subtotal: number;
  tax: number;
  serviceCharge: number;
  grandTotal: number;
  totalItems: number;
  restaurantId: string | null;
  setRestaurantId: (id: string) => void;
  tableContext: TableContext | null;
  setTableContext: (ctx: TableContext) => void;
  clearTableContext: () => void;
  hasCustomizations: (index: number) => boolean;
}

// ============================================================
// Constants
// ============================================================

const CART_STORAGE_KEY = "restaurant_cart";
const RESTAURANT_STORAGE_KEY = "restaurant_id";
const TABLE_CONTEXT_STORAGE_KEY = "table_context";
const TAX_RATE = 0.1; // 10%
const SERVICE_CHARGE_RATE = 0.05; // 5%

// ============================================================
// localStorage Helpers
// ============================================================

/**
 * Validate a single cart item object.
 */
function isValidCartItem(item: unknown): item is CartItem {
  if (!item || typeof item !== "object") return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.productId === "string" &&
    obj.productId.length > 0 &&
    typeof obj.quantity === "number" &&
    Number.isFinite(obj.quantity) &&
    Number.isInteger(obj.quantity) &&
    obj.quantity > 0
  );
}

/**
 * Load cart from localStorage.
 * Handles both formats:
 * - Legacy: CartItem[] (flat array)
 * - Current: { items: CartItem[], updatedAt: number }
 */
function loadCartFromStorage(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);

    // Current format: { items: [...], updatedAt: ... }
    if (
      parsed &&
      typeof parsed === "object" &&
      "items" in parsed &&
      Array.isArray(parsed.items)
    ) {
      return parsed.items.filter(isValidCartItem);
    }

    // Legacy format: CartItem[] (flat array)
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidCartItem);
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Save cart to localStorage with updatedAt timestamp.
 */
function saveCartToStorage(items: CartItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        items,
        updatedAt: Date.now(),
      })
    );
  } catch {
    // Storage full or unavailable — fail silently
  }
}

function loadRestaurantIdFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(RESTAURANT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveRestaurantIdToStorage(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) {
      localStorage.setItem(RESTAURANT_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(RESTAURANT_STORAGE_KEY);
    }
  } catch {
    // fail silently
  }
}

function loadTableContextFromStorage(): TableContext | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(TABLE_CONTEXT_STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as TableContext;
  } catch {
    return null;
  }
}

function saveTableContextToStorage(ctx: TableContext | null): void {
  if (typeof window === "undefined") return;
  try {
    if (ctx) {
      localStorage.setItem(TABLE_CONTEXT_STORAGE_KEY, JSON.stringify(ctx));
    } else {
      localStorage.removeItem(TABLE_CONTEXT_STORAGE_KEY);
    }
  } catch {
    // fail silently
  }
}

// ============================================================
// Configuration Key for Merging
// ============================================================

function getItemConfigKey(item: {
  productId: string;
  selections?: CartSelection[];
  addons?: CartAddon[];
  notes?: string;
}): string {
  const parts = [item.productId];

  // Sort selections by groupId for deterministic key
  if (item.selections && item.selections.length > 0) {
    const sorted = [...item.selections].sort((a, b) =>
      a.groupId.localeCompare(b.groupId)
    );
    for (const s of sorted) {
      parts.push(`g:${s.optionId}`);
    }
  }

  // Sort addons by addonId for deterministic key
  if (item.addons && item.addons.length > 0) {
    const sorted = [...item.addons].sort((a, b) =>
      a.addonId.localeCompare(b.addonId)
    );
    for (const a of sorted) {
      parts.push(`a:${a.addonId}:${a.quantity}`);
    }
  }

  // Notes differentiate items
  if (item.notes) {
    parts.push(`n:${item.notes}`);
  }

  return parts.join("|");
}

// ============================================================
// Context
// ============================================================

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  // IMPORTANT: Initialize state as empty on BOTH server and client.
  // This ensures server HTML === client initial HTML (no hydration mismatch).
  const [items, setItems] = useState<CartItem[]>([]);
  const [restaurantId, setRestaurantIdState] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [tableContext, setTableContextState] = useState<TableContext | null>(null);
  const hydrationRef = useRef(false);

  // Hydrate from localStorage AFTER mount (client-side only).
  useEffect(() => {
    if (hydrationRef.current) return;
    hydrationRef.current = true;

    const storedItems = loadCartFromStorage();
    if (storedItems.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(storedItems);
    }

    const storedRestaurantId = loadRestaurantIdFromStorage();
    if (storedRestaurantId) {
      setRestaurantIdState(storedRestaurantId);
    }

    const storedTableContext = loadTableContextFromStorage();
    if (storedTableContext) {
      setTableContextState(storedTableContext);
    }

    setIsHydrated(true);
  }, []);

  // Persist cart to localStorage whenever items change (after hydration)
  useEffect(() => {
    if (!isHydrated) return;
    saveCartToStorage(items);
  }, [items, isHydrated]);

  // Persist table context to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    saveTableContextToStorage(tableContext);
  }, [tableContext, isHydrated]);

  // Multi-tab synchronization via storage event.
  useEffect(() => {
    function handleStorageChange(event: StorageEvent) {
      if (event.key === CART_STORAGE_KEY) {
        if (!event.newValue) {
          setItems([]);
          return;
        }
        try {
          const parsed = JSON.parse(event.newValue);
          let newItems: CartItem[] = [];
          if (
            parsed &&
            typeof parsed === "object" &&
            "items" in parsed &&
            Array.isArray(parsed.items)
          ) {
            newItems = parsed.items.filter(isValidCartItem);
          } else if (Array.isArray(parsed)) {
            newItems = parsed.filter(isValidCartItem);
          }
          setItems(newItems);
        } catch {
          // Corrupted data from another tab — ignore
        }
      }
      if (event.key === TABLE_CONTEXT_STORAGE_KEY) {
        if (!event.newValue) {
          setTableContextState(null);
          return;
        }
        try {
          setTableContextState(JSON.parse(event.newValue));
        } catch {
          // ignore
        }
      }
    }

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Persist restaurantId to localStorage
  const setRestaurantId = useCallback((id: string) => {
    setRestaurantIdState(id);
    saveRestaurantIdToStorage(id);
  }, []);

  // Table context management
  const setTableContext = useCallback((ctx: TableContext) => {
    setTableContextState(ctx);
    saveTableContextToStorage(ctx);
  }, []);

  const clearTableContext = useCallback(() => {
    setTableContextState(null);
    saveTableContextToStorage(null);
  }, []);

  // Simple add (no customization) — for products without option groups
  const addItem = useCallback(
    (product: {
      id: string;
      name: string;
      price: number;
      imageUrl?: string | null;
      category?: { name: string };
    }) => {
      const configKey = getItemConfigKey({ productId: product.id });

      setItems((prev) => {
        // Find existing item with same config key
        const existingIndex = prev.findIndex(
          (item) => getItemConfigKey(item) === configKey
        );

        if (existingIndex >= 0) {
          // Same config — increment quantity
          return prev.map((item, i) =>
            i === existingIndex
              ? { ...item, quantity: item.quantity + 1 }
              : item
          );
        }

        // New item
        return [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            price: product.price,
            quantity: 1,
            imageUrl: product.imageUrl,
            categoryName: product.category?.name,
            selections: [],
            addons: [],
            notes: undefined,
            displayPrice: product.price,
          },
        ];
      });
    },
    []
  );

  // Customized add — with variants, addons, notes
  const addCustomizedItem = useCallback((item: Omit<CartItem, "displayPrice">) => {
    // Calculate displayPrice from selections and addons.
    // Defensive: Decimal values may arrive as strings (e.g. legacy cart
    // entries or API-serialized values), so coerce with Number().
    let displayPrice = Number(item.price) || 0;
    if (item.selections) {
      displayPrice += item.selections.reduce(
        (sum, s) => sum + (Number(s.priceAdjustment) || 0),
        0
      );
    }
    if (item.addons) {
      displayPrice += item.addons.reduce(
        (sum, a) => sum + (Number(a.price) || 0) * a.quantity,
        0
      );
    }

    const cartItem: CartItem = { ...item, displayPrice };
    const configKey = getItemConfigKey(cartItem);

    setItems((prev) => {
      // Find existing item with same config key
      const existingIndex = prev.findIndex(
        (existing) => getItemConfigKey(existing) === configKey
      );

      if (existingIndex >= 0) {
        // Same config — increment quantity
        return prev.map((existing, i) =>
          i === existingIndex
            ? { ...existing, quantity: existing.quantity + item.quantity }
            : existing
        );
      }

      // New item (add at end)
      return [...prev, cartItem];
    });
  }, []);

  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateCartItem = useCallback((index: number, item: Omit<CartItem, "displayPrice">) => {
    // Defensive: coerce Decimal-as-string values to numbers
    let displayPrice = Number(item.price) || 0;
    if (item.selections) {
      displayPrice += item.selections.reduce(
        (sum, s) => sum + (Number(s.priceAdjustment) || 0),
        0
      );
    }
    if (item.addons) {
      displayPrice += item.addons.reduce(
        (sum, a) => sum + (Number(a.price) || 0) * a.quantity,
        0
      );
    }
    const cartItem: CartItem = { ...item, displayPrice };

    setItems((prev) => {
      const updated = prev.map((existing, i) =>
        i === index ? cartItem : existing
      );
      // Check if the updated item's config matches another item
      const configKey = getItemConfigKey(cartItem);
      const duplicateIndex = updated.findIndex(
        (existing, i) => i !== index && getItemConfigKey(existing) === configKey
      );
      if (duplicateIndex >= 0) {
        // Merge quantities and remove the original
        const merged = updated.map((existing, i) =>
          i === duplicateIndex
            ? { ...existing, quantity: existing.quantity + cartItem.quantity }
            : existing
        ).filter((_, i) => i !== index);
        return merged;
      }
      return updated;
    });
  }, []);

  const updateQuantity = useCallback((index: number, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    setItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, quantity } : item
      )
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const hasCustomizations = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return false;
      return (
        (item.selections && item.selections.length > 0) ||
        (item.addons && item.addons.length > 0) ||
        !!item.notes
      );
    },
    [items]
  );

  // Calculate totals (display only — server is authoritative)
  const subtotal = items.reduce(
    (sum, item) => sum + (item.displayPrice || item.price) * item.quantity,
    0
  );
  const tax = Math.round(subtotal * TAX_RATE);
  const serviceCharge = Math.round(subtotal * SERVICE_CHARGE_RATE);
  const grandTotal = subtotal + tax + serviceCharge;
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        isHydrated,
        addItem,
        addCustomizedItem,
        removeItem,
        updateQuantity,
        clearCart,
        updateCartItem,
        subtotal,
        tax,
        serviceCharge,
        grandTotal,
        totalItems,
        restaurantId,
        setRestaurantId,
        tableContext,
        setTableContext,
        clearTableContext,
        hasCustomizations,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
