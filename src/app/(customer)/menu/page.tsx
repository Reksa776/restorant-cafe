"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/hooks/use-cart";
import Link from "next/link";
import { Plus, Minus, ShoppingCart, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/axios";
import { Skeleton } from "@/components/ui/skeleton";

// ============================================================
// Types
// ============================================================

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
}

interface RestaurantInfo {
  id: string;
  name: string;
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
  onIncrease,
  onDecrease,
}: {
  product: Product;
  quantity: number;
  onAdd: () => void;
  onIncrease: () => void;
  onDecrease: () => void;
}) {
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

            {/* Add Button / Quantity Controls */}
            {quantity === 0 ? (
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

export default function MenuPage() {
  const { addItem, items, updateQuantity, restaurantId, setRestaurantId } =
    useCart();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadMenu();
  }, []);

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

  const getItemQuantity = (productId: string) => {
    return items.find((item) => item.productId === productId)?.quantity || 0;
  };

  const handleAdd = (product: Product) => {
    addItem({
      id: product.id,
      name: product.name,
      price: Number(product.price),
      imageUrl: product.imageUrl,
      category: product.category,
    });
    toast.success(`${product.name} ditambahkan`);
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
  const totalCartPrice = items.reduce((s, i) => s + i.price * i.quantity, 0);

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
              onIncrease={() =>
                updateQuantity(
                  product.id,
                  getItemQuantity(product.id) + 1
                )
              }
              onDecrease={() =>
                updateQuantity(
                  product.id,
                  getItemQuantity(product.id) - 1
                )
              }
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
    </div>
  );
}
