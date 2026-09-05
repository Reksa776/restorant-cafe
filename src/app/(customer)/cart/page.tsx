"use client";

import { useState } from "react";
import Link from "next/link";
import { useCart } from "@/hooks/use-cart";
import { Plus, Minus, Trash2, ArrowLeft, Table2, Pencil } from "lucide-react";

/** Cart item thumbnail with graceful fallback for empty/broken images. */
function CartItemThumb({ url, name }: { url?: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return <span className="text-xl">🍽️</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      className="w-12 h-12 rounded-lg object-cover"
      onError={() => setBroken(true)}
    />
  );
}

export default function CartPage() {
  const {
    items,
    updateQuantity,
    removeItem,
    clearCart,
    subtotal,
    tax,
    serviceCharge,
    grandTotal,
    totalItems,
    tableContext,
  } = useCart();

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <p className="text-gray-500 text-lg">Keranjang kosong</p>
        <Link
          href="/menu"
          className="bg-black text-white px-6 py-2 rounded-lg font-medium hover:bg-gray-800 transition-colors"
        >
          Lihat Menu
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/menu" className="text-gray-500 hover:text-black">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold">Keranjang</h1>
        </div>
        <button
          onClick={clearCart}
          className="text-sm text-red-500 hover:text-red-700"
        >
          Hapus Semua
        </button>
      </div>

      {/* Table Info */}
      {tableContext && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-3">
          <Table2 className="h-5 w-5 text-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-900">
              {tableContext.tableName} — Meja {tableContext.tableNumber}
            </p>
            <p className="text-xs text-blue-600">
              {tableContext.visitorCount} pengunjung
            </p>
          </div>
        </div>
      )}

      {/* Cart Items */}
      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={`${item.productId}-${index}`}
            className="bg-white rounded-lg border border-gray-200 p-4"
          >
            <div className="flex items-start gap-4">
              {/* Image */}
              <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <CartItemThumb url={item.imageUrl} name={item.name} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm">{item.name}</h3>
                <p className="text-sm text-gray-500">
                  Rp{item.price.toLocaleString("id-ID")}
                </p>

                {/* Customization Details */}
                {item.selections && item.selections.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {item.selections.map((s, i) => (
                      <p key={i} className="text-[11px] text-gray-500">
                        {s.groupName}: {s.optionName}
                        {s.priceAdjustment !== 0 && (
                          <span className="text-gray-400">
                            {" "}
                            {s.priceAdjustment > 0 ? "+" : ""}Rp{Math.abs(s.priceAdjustment).toLocaleString("id-ID")}
                          </span>
                        )}
                      </p>
                    ))}
                  </div>
                )}

                {item.addons && item.addons.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {item.addons.map((a, i) => (
                      <p key={i} className="text-[11px] text-gray-500">
                        + {a.name} x{a.quantity}
                        {a.price > 0 && (
                          <span className="text-gray-400">
                            {" "}
                            +Rp{(a.price * a.quantity).toLocaleString("id-ID")}
                          </span>
                        )}
                      </p>
                    ))}
                  </div>
                )}

                {item.notes && (
                  <p className="text-[11px] text-gray-400 mt-1 italic">
                    Catatan: {item.notes}
                  </p>
                )}
              </div>

              {/* Quantity Controls */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => updateQuantity(index, item.quantity - 1)}
                  className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-7 text-center text-sm font-medium">
                  {item.quantity}
                </span>
                <button
                  onClick={() => updateQuantity(index, item.quantity + 1)}
                  className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center hover:bg-gray-800 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Edit button for customized items */}
              {((item.selections && item.selections.length > 0) || (item.addons && item.addons.length > 0) || item.notes) && (
                <Link
                  href={`/menu?edit=${index}`}
                  className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5 mt-1"
                >
                  <Pencil className="h-2.5 w-2.5" />
                  Ubah
                </Link>
              )}

              {/* Item Total */}
              <div className="text-right flex-shrink-0">
                <p className="font-medium text-sm">
                  Rp{((item.displayPrice || item.price) * item.quantity).toLocaleString("id-ID")}
                </p>
                <button
                  onClick={() => removeItem(index)}
                  className="text-red-400 hover:text-red-600 mt-1"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Order Summary */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <h2 className="font-medium">Ringkasan Pesanan</h2>          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Subtotal ({totalItems} item)</span>
              <span>Rp{subtotal.toLocaleString("id-ID")}</span>
            </div>
            {/* QR dine-in orders are tax/service-free — subtotal = total */}
            {!tableContext && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500">Pajak (10%)</span>
                  <span>Rp{tax.toLocaleString("id-ID")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Service Charge (5%)</span>
                  <span>Rp{serviceCharge.toLocaleString("id-ID")}</span>
                </div>
              </>
            )}
            <div className="border-t pt-2 flex justify-between font-bold">
              <span>Total</span>
              <span>Rp{(tableContext ? subtotal : grandTotal).toLocaleString("id-ID")}</span>
            </div>
          </div>
      </div>

      {/* Checkout Button */}
      <Link
        href="/checkout"
        className="block w-full bg-black text-white text-center py-3 rounded-xl font-medium hover:bg-gray-800 transition-colors"
      >
        Checkout
      </Link>
    </div>
  );
}
