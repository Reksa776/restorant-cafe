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

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string | null;
  categoryName?: string;
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
  }) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  subtotal: number;
  tax: number;
  serviceCharge: number;
  grandTotal: number;
  totalItems: number;
  restaurantId: string | null;
  setRestaurantId: (id: string) => void;
}

// ============================================================
// Constants
// ============================================================

const CART_STORAGE_KEY = "restaurant_cart";
const RESTAURANT_STORAGE_KEY = "restaurant_id";
const TAX_RATE = 0.1; // 10%
const SERVICE_CHARGE_RATE = 0.05; // 5%

// ============================================================
// localStorage Helpers
// ============================================================

/**
 * Validate a single cart item object.
 * Returns true if the item has the required structure.
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
 *
 * Returns [] if storage is unavailable, corrupt, or expired.
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

    // Unknown format — return empty
    return [];
  } catch {
    // Corrupted data — fail safely
    return [];
  }
}

/**
 * Save cart to localStorage with updatedAt timestamp.
 * Format: { items: CartItem[], updatedAt: number }
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
  const hydrationRef = useRef(false);

  // Hydrate from localStorage AFTER mount (client-side only).
  // Server render: items=[], isHydrated=false
  // Client initial render: items=[], isHydrated=false (matches server)
  // After mount: items=from localStorage, isHydrated=true (re-render)
  useEffect(() => {
    if (hydrationRef.current) return;
    hydrationRef.current = true;

    const storedItems = loadCartFromStorage();
    if (storedItems.length > 0) {
      // Hydrating external storage state into React — legitimate use of setState in effect
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(storedItems);
    }

    const storedRestaurantId = loadRestaurantIdFromStorage();
    if (storedRestaurantId) {
      setRestaurantIdState(storedRestaurantId);
    }

    setIsHydrated(true);
  }, []);

  // Persist cart to localStorage whenever items change (after hydration)
  useEffect(() => {
    if (!isHydrated) return;
    saveCartToStorage(items);
  }, [items, isHydrated]);

  // Multi-tab synchronization via storage event.
  // When another tab modifies localStorage, sync our state.
  useEffect(() => {
    function handleStorageChange(event: StorageEvent) {
      if (event.key !== CART_STORAGE_KEY) return;

      // If the value was removed (clear cart in another tab), reset to empty
      if (!event.newValue) {
        setItems([]);
        return;
      }

      // Parse the new value
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

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Persist restaurantId to localStorage
  const setRestaurantId = useCallback((id: string) => {
    setRestaurantIdState(id);
    saveRestaurantIdToStorage(id);
  }, []);

  const addItem = useCallback(
    (product: {
      id: string;
      name: string;
      price: number;
      imageUrl?: string | null;
      category?: { name: string };
    }) => {
      setItems((prev) => {
        const existing = prev.find((item) => item.productId === product.id);
        if (existing) {
          return prev.map((item) =>
            item.productId === product.id
              ? { ...item, quantity: item.quantity + 1 }
              : item
          );
        }
        return [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            price: product.price,
            quantity: 1,
            imageUrl: product.imageUrl,
            categoryName: product.category?.name,
          },
        ];
      });
    },
    []
  );

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((item) => item.productId !== productId));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((item) => item.productId !== productId));
      return;
    }
    setItems((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, quantity } : item
      )
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  // Calculate totals
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
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
        removeItem,
        updateQuantity,
        clearCart,
        subtotal,
        tax,
        serviceCharge,
        grandTotal,
        totalItems,
        restaurantId,
        setRestaurantId,
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
