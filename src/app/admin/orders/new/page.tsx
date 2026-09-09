"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  QrCode,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  UtensilsCrossed,
  ShoppingBag,
  Truck,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBranchContext } from "@/hooks/use-branch-context";
import type { Order } from "@/services/order.service";
import { paymentService } from "@/services/payment.service";
import { customerService } from "@/services/customer.service";
import { KasirQrisScreen } from "@/components/admin/orders/kasir-qris-screen";

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
}

interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  category: { id: string; name: string } | null;
  optionGroups: OptionGroup[];
  addons: Addon[];
  stock: number | null;
}

interface TableRow {
  id: string;
  number: number;
  name: string;
  capacity: number;
  status: string;
  branchId: string | null;
}

interface Selection {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceAdjustment: number;
}

interface CartLine {
  key: string;
  productId: string;
  name: string;
  basePrice: number;
  quantity: number;
  selections?: Selection[];
  addons?: Array<{ addonId: string; name: string; price: number; quantity: number }>;
  notes?: string;
}

interface CustomizationState {
  selections: Record<string, string | string[]>;
  addons: Record<string, number>;
  quantity: number;
  notes: string;
}

// ============================================================
// Helpers
// ============================================================

const rupiah = (v: string | number) =>
  `Rp${Number(v).toLocaleString("id-ID")}`;

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

function hasCustomization(product: Product): boolean {
  const hasActiveGroup = (product.optionGroups || []).some(
    (group) =>
      Array.isArray(group.options) && group.options.length > 0
  );
  const hasActiveAddon = (product.addons || []).length > 0;
  return hasActiveGroup || hasActiveAddon;
}

function isSoldOut(product: Product): boolean {
  return product.stock != null && product.stock <= 0;
}

function unitPriceOf(line: CartLine): number {
  const sel = (line.selections || []).reduce(
    (sum, s) => sum + Number(s.priceAdjustment || 0),
    0
  );
  const addons = (line.addons || []).reduce(
    (sum, a) => sum + Number(a.price || 0) * a.quantity,
    0
  );
  return line.basePrice + sel + addons;
}

function lineTotal(line: CartLine): number {
  return unitPriceOf(line) * line.quantity;
}

/**
 * Unique cart line key. Module-scope so it is not subject to the React
 * component purity rules (event handlers may call it freely).
 */
function makeCartKey(productId: string): string {
  return `${productId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function customizationLabel(line: CartLine): string {
  const parts: string[] = [];
  for (const s of line.selections || []) {
    parts.push(s.optionName);
  }
  for (const a of line.addons || []) {
    parts.push(`+${a.name} x${a.quantity}`);
  }
  if (line.notes) parts.push(`Catatan: ${line.notes}`);
  return parts.join(" · ");
}

// ============================================================
// Customization Modal (variants / addons / notes)
// ============================================================

function CustomizeModal({
  product,
  initial,
  onClose,
  onConfirm,
}: {
  product: Product;
  initial?: CartLine | null;
  onClose: () => void;
  onConfirm: (state: CustomizationState) => void;
}) {
  const [state, setState] = useState<CustomizationState>(() => {
    const selections: Record<string, string | string[]> = {};
    for (const s of initial?.selections || []) {
      const group = product.optionGroups.find((g) => g.id === s.groupId);
      if (group?.type === "MULTI") {
        const existing = selections[s.groupId];
        selections[s.groupId] = Array.isArray(existing)
          ? [...existing, s.optionId]
          : [s.optionId];
      } else {
        selections[s.groupId] = s.optionId;
      }
    }
    // Auto-select the first option of required SINGLE groups when adding new.
    if (!initial) {
      for (const group of product.optionGroups) {
        if (group.isRequired && group.type === "SINGLE" && group.options.length > 0) {
          selections[group.id] = group.options[0].id;
        }
      }
    }
    const addons: Record<string, number> = {};
    for (const a of initial?.addons || []) addons[a.addonId] = a.quantity;
    return {
      selections,
      addons,
      quantity: initial?.quantity || 1,
      notes: initial?.notes || "",
    };
  });

  const unitPrice =
    Number(product.price) +
    (() => {
      let adj = 0;
      for (const group of product.optionGroups) {
        const selected = state.selections[group.id];
        if (!selected) continue;
        const ids = Array.isArray(selected) ? selected : [selected];
        for (const oid of ids) {
          const opt = group.options.find((o) => o.id === oid);
          if (opt) adj += Number(opt.priceAdjustment) || 0;
        }
      }
      return adj;
    })() +
    Object.entries(state.addons).reduce(
      (sum, [id, qty]) =>
        sum + (Number(product.addons.find((a) => a.id === id)?.price) || 0) * qty,
      0
    );

  const isMulti = (group: OptionGroup) => group.type === "MULTI";

  const handleGroupSelect = (groupId: string, optionId: string, group: OptionGroup) => {
    if (isMulti(group)) {
      setState((prev) => {
        const current = prev.selections[groupId];
        const arr = Array.isArray(current) ? current : current ? [current] : [];
        const selected = arr.includes(optionId);
        if (!selected && arr.length >= group.maxSelect) {
          toast.error(`Maksimal pilih ${group.maxSelect} opsi`);
          return prev;
        }
        const next = selected
          ? arr.filter((id) => id !== optionId)
          : [...arr, optionId];
        return { ...prev, selections: { ...prev.selections, [groupId]: next } };
      });
    } else {
      setState((prev) => ({
        ...prev,
        selections: { ...prev.selections, [groupId]: optionId },
      }));
    }
  };

  const toggleAddon = (addonId: string) => {
    setState((prev) => ({
      ...prev,
      addons: { ...prev.addons, [addonId]: prev.addons[addonId] ? 0 : 1 },
    }));
  };

  const isValid = product.optionGroups.every((group) => {
    if (!group.isRequired) return true;
    const selected = state.selections[group.id];
    if (!selected) return false;
    if (isMulti(group)) {
      const arr = Array.isArray(selected) ? selected : [selected];
      return arr.length >= group.minSelect && arr.length <= group.maxSelect;
    }
    return true;
  });

  const total = unitPrice * state.quantity;

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-base">{product.name}</h2>
            <p className="text-sm text-gray-500">{rupiah(product.price)}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-5">
          {product.optionGroups.map((group) => (
            <div key={group.id}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-medium">{group.name}</h3>
                {group.isRequired && (
                  <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full font-medium">
                    Wajib
                  </span>
                )}
                {isMulti(group) && (
                  <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                    {group.minSelect > 0
                      ? `Pilih ${group.minSelect}-${group.maxSelect}`
                      : `Hingga ${group.maxSelect}`}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {group.options.map((option) => {
                  const isSelected = isMulti(group)
                    ? (() => {
                        const val = state.selections[group.id];
                        const arr = Array.isArray(val) ? val : val ? [val] : [];
                        return arr.includes(option.id);
                      })()
                    : state.selections[group.id] === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => handleGroupSelect(group.id, option.id, group)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-colors text-sm ${
                        isSelected
                          ? "border-brand-primary bg-brand-secondary text-brand-primary"
                          : "border-gray-200 hover:border-brand-primary/40"
                      }`}
                    >
                      <span>{option.name}</span>
                      {Number(option.priceAdjustment) !== 0 && (
                        <span className="text-gray-500 text-xs">
                          {Number(option.priceAdjustment) > 0 ? "+" : ""}
                          Rp{Math.abs(Number(option.priceAdjustment)).toLocaleString("id-ID")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

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
                          onClick={() => toggleAddon(addon.id)}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                            qty > 0 ? "border-brand-primary bg-brand-primary" : "border-gray-300"
                          }`}
                        >
                          {qty > 0 && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <span className="text-sm">{addon.name}</span>
                      </div>
                      <span className="text-xs text-gray-500">
                        + {rupiah(addon.price)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
                className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-10 text-center text-lg font-bold">{state.quantity}</span>
              <button
                onClick={() =>
                  setState((prev) => ({ ...prev, quantity: prev.quantity + 1 }))
                }
                className="w-10 h-10 rounded-full bg-brand-primary text-brand-primary-foreground flex items-center justify-center hover:bg-brand-primary/90"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">
              Catatan <span className="text-gray-400 font-normal">(opsional)</span>
            </h3>
            <textarea
              value={state.notes}
              onChange={(e) => setState((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Contoh: Es batu sedikit, tanpa sambal..."
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent resize-none"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-3">
          <button
            onClick={() => onConfirm(state)}
            disabled={!isValid}
            className="w-full bg-brand-primary text-brand-primary-foreground py-3 rounded-xl font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <span>{initial ? "Simpan Perubahan" : "Tambah ke Pesanan"}</span>
            <span className="font-bold">{rupiah(total)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main Page — Kasir Buat Pesanan Manual
// ============================================================

export default function KasirManualOrderPage() {
  const { session, branchId, branches, isLoading: ctxLoading } = useBranchContext();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [tables, setTables] = useState<TableRow[]>([]);

  // Product picker filters
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string>("all");

  // Cart
  const [cart, setCart] = useState<CartLine[]>([]);

  // Customization modal
  const [customizing, setCustomizing] = useState<{ product: Product; line?: CartLine } | null>(null);

  // Order details
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderType, setOrderType] = useState<"DINE_IN" | "TAKEAWAY" | "DELIVERY">("DINE_IN");
  const [tableId, setTableId] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "QRIS">("CASH");

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<"pick" | "cash" | "qris" | "cash-success">("pick");
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);
  const [cashierPaymentId, setCashierPaymentId] = useState<string | null>(null);
  const [cashReceivedRaw, setCashReceivedRaw] = useState("");

  const workingBranch =
    branchId
      ? branches.find((b) => b.id === branchId) ?? null
      : branches.length === 1
        ? branches[0]
        : null;

  // ============================================================
  // Data loading — branch-scoped menu (reuses /api/public/menu so the kasir
  // sees exactly what the customer sees at this branch: BranchProduct
  // availability → price override → stock, never another branch's products).
  // ============================================================
  useEffect(() => {
    if (ctxLoading || !workingBranch || !session) return;
    let alive = true;
    (async () => {
      setMenuLoading(true);
      setMenuError(null);
      try {
        const res = await api.get("/public/menu", {
          params: {
            restaurantId: session.restaurantId,
            branchCode: workingBranch.code,
          },
        });
        if (!alive) return;
        setCategories(res.data.data.categories || []);
        setProducts(
          (res.data.data.products || []).map((p: Product) => normalizeProduct(p))
        );
      } catch (error) {
        if (!alive) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = (error as any)?.response?.data?.message;
        setMenuError(
          typeof msg === "string" && msg ? msg : "Gagal memuat menu cabang"
        );
      } finally {
        if (alive) setMenuLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ctxLoading, workingBranch, session]);

  // Tables (admin-scoped endpoint; filtered to the working branch so the
  // picker never offers a table the server would reject as cross-branch).
  useEffect(() => {
    if (!workingBranch) return;
    let alive = true;
    (async () => {
      try {
        const res = await api.get("/tables");
        if (!alive) return;
        setTables(
          (res.data.data || []).filter(
            (t: TableRow) => !t.branchId || t.branchId === workingBranch.id
          )
        );
      } catch {
        if (!alive) return;
        setTables([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [workingBranch]);

  // ============================================================
  // Cart operations
  // ============================================================

  const cartQtyForProduct = useCallback(
    (productId: string) =>
      cart
        .filter((l) => l.productId === productId)
        .reduce((sum, l) => sum + l.quantity, 0),
    [cart]
  );

  const addSimple = (product: Product) => {
    if (isSoldOut(product)) {
      toast.error(`${product.name} sudah habis`);
      return;
    }
    if (hasCustomization(product)) {
      setCustomizing({ product });
      return;
    }
    const key = makeCartKey(product.id);
    setCart((prev) => [...prev, { key, productId: product.id, name: product.name, basePrice: product.price, quantity: 1 }]);
  };

  const confirmCustomize = (state: CustomizationState) => {
    if (!customizing) return;
    const { product, line } = customizing;
    if (isSoldOut(product)) {
      toast.error(`${product.name} sudah habis`);
      setCustomizing(null);
      return;
    }
    const selections: Selection[] = product.optionGroups
      .map((group) => {
        const selectedVal = state.selections[group.id];
        if (!selectedVal) return null;
        const ids = Array.isArray(selectedVal) ? selectedVal : [selectedVal];
        return ids
          .map((oid) => {
            const option = group.options.find((o) => o.id === oid);
            if (!option) return null;
            return {
              groupId: group.id,
              groupName: group.name,
              optionId: option.id,
              optionName: option.name,
              priceAdjustment: Number(option.priceAdjustment) || 0,
            };
          })
          .filter(Boolean) as Selection[];
      })
      .flat()
      .filter(Boolean) as Selection[];

    const addons = product.addons
      .map((addon) => {
        const qty = state.addons[addon.id] || 0;
        if (qty <= 0) return null;
        return { addonId: addon.id, name: addon.name, price: Number(addon.price) || 0, quantity: qty };
      })
      .filter(Boolean) as Array<{ addonId: string; name: string; price: number; quantity: number }>;

    const nextLine: CartLine = {
      key: line?.key || makeCartKey(product.id),
      productId: product.id,
      name: product.name,
      basePrice: product.price,
      quantity: state.quantity,
      selections,
      addons,
      notes: state.notes || undefined,
    };

    setCart((prev) =>
      line ? prev.map((l) => (l.key === line.key ? nextLine : l)) : [...prev, nextLine]
    );
    setCustomizing(null);
    toast.success(`${product.name} ditambahkan`);
  };

  const changeQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.key !== key) return l;
          const product = products.find((p) => p.id === l.productId);
          const stock = product?.stock;
          const next = l.quantity + delta;
          if (next < 1) return null; // remove at 0
          if (stock != null && next > stock) {
            toast.error(`Stok ${l.name} tersisa ${stock}`);
            return l;
          }
          return { ...l, quantity: next };
        })
        .filter(Boolean) as CartLine[]
    );
  };

  const removeLine = (key: string) => {
    setCart((prev) => prev.filter((l) => l.key !== key));
  };

  // ============================================================
  // Derived totals (display-only; server recomputes everything)
  // ============================================================
  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0);
  const isDineIn = orderType === "DINE_IN";
  const tax = isDineIn ? 0 : Math.round(subtotal * 0.1);
  const serviceCharge = isDineIn ? 0 : Math.round(subtotal * 0.05);
  const grandTotal = subtotal + tax + serviceCharge;

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCategoryId !== "all" && p.category?.id !== activeCategoryId) return false;
      if (q) {
        const hay = `${p.name} ${p.description || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, searchQuery, activeCategoryId]);

  // ============================================================
  // Order + payment submission (reuses existing engines)
  // ============================================================

  const handleSubmit = async () => {
    if (cart.length === 0) {
      toast.error("Keranjang kosong");
      return;
    }
    if (!customerName.trim()) {
      toast.error("Nama pelanggan wajib diisi");
      return;
    }
    if (isDineIn && !tableId) {
      toast.error("Pilih meja untuk dine-in");
      return;
    }
    setSubmitting(true);
    try {
      // 1. Find-or-create the customer (restaurant from session, server-side).
      const customer = await customerService.findOrCreateCustomer({
        name: customerName.trim(),
        phone: customerPhone.trim() || undefined,
      });

      // 2. Create the order — server validates products, branch stock,
      //    variants/addons and recomputes all prices.
      const items = cart.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        ...(l.selections && l.selections.length > 0 ? { selections: l.selections } : {}),
        ...(l.addons && l.addons.length > 0 ? { addons: l.addons } : {}),
        ...(l.notes ? { notes: l.notes } : {}),
      }));
      const orderRes = await api.post("/orders", {
        customerId: customer.id,
        orderType,
        tableId: isDineIn ? tableId : undefined,
        items,
        notes: notes.trim() || undefined,
      });
      const order = orderRes.data.data as Order;
      setCreatedOrder(order);
      setPhase(paymentMethod === "CASH" ? "cash" : "qris");
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (error as any)?.response?.data?.message;
      toast.error(typeof msg === "string" && msg ? msg : "Gagal membuat pesanan");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCashSubmit = async () => {
    if (!createdOrder) return;
    const due = Number(createdOrder.grandTotal);
    const digits = cashReceivedRaw.replace(/[^\d]/g, "");
    const received = digits ? Number(digits) : 0;
    if (!received || received < due) {
      toast.error("Uang yang diterima kurang dari total tagihan");
      return;
    }
    setSubmitting(true);
    try {
      let paymentId = cashierPaymentId;
      if (!paymentId) {
        const created = await paymentService.createPayment(createdOrder.id, {
          method: "KASIR",
        });
        paymentId = created.id;
        setCashierPaymentId(paymentId);
      }
      await paymentService.markCashierPaymentPaid(paymentId, received);
      setPhase("cash-success");
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (error as any)?.response?.data?.message;
      toast.error(typeof msg === "string" && msg ? msg : "Gagal memproses pembayaran kasir");
    } finally {
      setSubmitting(false);
    }
  };

  const resetAll = () => {
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setTableId("");
    setNotes("");
    setCashReceivedRaw("");
    setCashierPaymentId(null);
    setCreatedOrder(null);
    setPhase("pick");
  };

  // ============================================================
  // Loading / branch guard
  // ============================================================

  if (ctxLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!workingBranch) {
    return (
      <div className="space-y-4 max-w-md mx-auto py-16 text-center">
        <Store className="h-10 w-10 mx-auto text-muted-foreground" />
        <h1 className="text-2xl font-bold">Buat Pesanan</h1>
        <p className="text-sm text-muted-foreground">
          Pilih cabang terlebih dahulu untuk membuat pesanan. Kasir hanya dapat
          membuat pesanan pada cabang yang diizinkan.
        </p>
        <Link href="/admin/orders">
          <Button variant="outline">Kembali ke Pesanan</Button>
        </Link>
      </div>
    );
  }

  // ============================================================
  // QRIS payment screen (full page after order creation)
  // ============================================================
  if (phase === "qris" && createdOrder) {
    return (
      <div className="max-w-md mx-auto py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Pembayaran QRIS</h1>
        </div>
        <KasirQrisScreen
          orderNumber={createdOrder.orderNumber}
          amount={createdOrder.grandTotal}
          backHref="/admin/orders"
          backLabel="Kembali ke Pesanan"
          onPaid={() => {
            toast.success("Pembayaran QRIS berhasil");
          }}
        />
        <div className="mt-6 text-center">
          <Button variant="outline" size="sm" onClick={resetAll}>
            Buat Pesanan Baru
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================
  // Cash payment screen
  // ============================================================
  if (phase === "cash" && createdOrder) {
    const due = Number(createdOrder.grandTotal);
    const digits = cashReceivedRaw.replace(/[^\d]/g, "");
    const received = digits ? Number(digits) : 0;
    const change = Math.max(0, received - due);
    const hasInput = cashReceivedRaw.trim().length > 0;
    const insufficient = hasInput && received < due;
    const canSubmit = hasInput && !insufficient && received >= due && !submitting;

    return (
      <div className="max-w-md mx-auto py-6">
        <h1 className="text-2xl font-bold mb-4">Pembayaran Cash</h1>
        <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Nomor Pesanan</span>
            <span className="font-mono font-semibold">{createdOrder.orderNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Tagihan</span>
            <span className="font-bold text-base tabular-nums">{rupiah(due)}</span>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="cash-received">Uang Diterima (Rp)</Label>
          <Input
            id="cash-received"
            inputMode="numeric"
            autoFocus
            placeholder="0"
            value={cashReceivedRaw}
            onChange={(e) => setCashReceivedRaw(e.target.value)}
            className={insufficient ? "border-red-400" : ""}
          />
          {insufficient && (
            <p className="text-xs font-medium text-red-600">
              Uang yang diterima kurang dari total tagihan
            </p>
          )}
          <Button variant="outline" size="sm" onClick={() => setCashReceivedRaw(String(due))}>
            Uang Pas
          </Button>
        </div>

        <div className="mt-4 rounded-xl bg-gray-100 p-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Banknote className="h-4 w-4" />
            Kembalian
          </span>
          <span className={`text-xl font-bold tabular-nums ${insufficient ? "text-red-600" : "text-green-700"}`}>
            {hasInput ? rupiah(change) : "Rp0"}
          </span>
        </div>

        <Button
          className="mt-4 w-full bg-green-600 hover:bg-green-700"
          disabled={!canSubmit}
          onClick={handleCashSubmit}
        >
          {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
          Konfirmasi Pembayaran
        </Button>
        <div className="mt-3 text-center">
          <Button variant="ghost" size="sm" onClick={resetAll}>
            Batalkan
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================
  // Cash success
  // ============================================================
  if (phase === "cash-success" && createdOrder) {
    return (
      <div className="max-w-md mx-auto py-6">
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 mx-auto flex items-center justify-center">
            <CheckCircle2 className="h-9 w-9 text-green-600" />
          </div>
          <h3 className="text-xl font-bold text-green-700 mt-3">Pembayaran Berhasil</h3>
          <p className="text-sm text-muted-foreground font-mono mt-1">
            {createdOrder.orderNumber}
          </p>
          <div className="mt-3 rounded-lg bg-white border border-green-200 px-4 py-3">
            <p className="text-sm font-semibold text-green-800">
              {rupiah(createdOrder.grandTotal)} dibayar tunai
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Link href={`/admin/orders/${createdOrder.orderNumber}`}>
            <Button className="w-full">Lihat Pesanan</Button>
          </Link>
          <Button variant="outline" onClick={resetAll}>
            Buat Pesanan Baru
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================
  // Main POS render
  // ============================================================
  const totalItems = cart.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/admin/orders" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold">Buat Pesanan</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-secondary border border-brand-accent px-2.5 py-1 text-xs font-medium text-brand-primary">
            <Store className="h-3.5 w-3.5" />
            {workingBranch.name} ({workingBranch.code})
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* ---------------- Product picker ---------------- */}
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari produk..."
              className="pl-9"
            />
          </div>

          {/* Category chips */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setActiveCategoryId("all")}
              className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
                activeCategoryId === "all"
                  ? "bg-brand-primary text-brand-primary-foreground border-brand-primary"
                  : "bg-white text-gray-700 border-gray-200 hover:border-brand-primary/40"
              }`}
            >
              Semua
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategoryId(cat.id)}
                className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
                  activeCategoryId === cat.id
                    ? "bg-brand-primary text-brand-primary-foreground border-brand-primary"
                    : "bg-white text-gray-700 border-gray-200 hover:border-brand-primary/40"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Product grid */}
          {menuLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : menuError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
              <p className="text-sm text-red-700">{menuError}</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              Tidak ada produk yang cocok
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredProducts.map((product) => {
                const soldOut = isSoldOut(product);
                const qtyInCart = cartQtyForProduct(product.id);
                const needsCustomization = hasCustomization(product);
                return (
                  <div
                    key={product.id}
                    className="bg-white rounded-xl border border-gray-200 p-3 flex flex-col min-w-0"
                  >
                    <h3 className="text-sm font-semibold leading-snug line-clamp-2">
                      {product.name}
                      {soldOut && (
                        <span className="ml-1.5 align-middle inline-block bg-gray-800 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                          Habis
                        </span>
                      )}
                    </h3>
                    <p className="text-sm font-bold text-gray-900 mt-1 tabular-nums">
                      {rupiah(product.price)}
                    </p>
                    <div className="mt-auto pt-2.5">
                      {soldOut ? (
                        <button
                          type="button"
                          disabled
                          className="w-full min-h-10 rounded-lg bg-gray-100 text-gray-400 text-sm font-medium px-3 cursor-not-allowed"
                        >
                          Habis
                        </button>
                      ) : qtyInCart === 0 ? (
                        <button
                          type="button"
                          onClick={() => addSimple(product)}
                          className="w-full min-h-10 rounded-lg bg-brand-primary text-brand-primary-foreground text-sm font-medium hover:bg-brand-primary/90 active:scale-[0.98]"
                        >
                          {needsCustomization ? "Pilih Produk" : "+ Tambah"}
                        </button>
                      ) : (
                        <div className="flex items-center bg-brand-primary rounded-lg overflow-hidden h-10">
                          <button
                            type="button"
                            onClick={() => {
                              const line = cart.find((l) => l.productId === product.id);
                              if (line) changeQty(line.key, -1);
                            }}
                            className="flex-1 h-full flex items-center justify-center text-brand-primary-foreground hover:bg-brand-primary/90 active:scale-95"
                            aria-label={`Kurangi ${product.name}`}
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-12 text-center text-sm font-bold text-white tabular-nums">
                            {qtyInCart}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const line = cart.find((l) => l.productId === product.id);
                              if (line) changeQty(line.key, 1);
                            }}
                            className="flex-1 h-full flex items-center justify-center text-brand-primary-foreground hover:bg-brand-primary/90 active:scale-95"
                            aria-label={`Tambah ${product.name}`}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---------------- Cart + order details ---------------- */}
        <div className="space-y-4 lg:sticky lg:top-6 self-start">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Pesanan ({totalItems})
              </h2>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  className="text-xs text-gray-400 hover:text-red-600"
                >
                  Kosongkan
                </button>
              )}
            </div>

            {cart.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                Belum ada item — pilih produk dari menu
              </p>
            ) : (
              <div className="mt-3 space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {cart.map((line) => (
                  <div key={line.key} className="rounded-lg border border-gray-100 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">
                        {line.name}
                        <span className="text-gray-400"> x{line.quantity}</span>
                      </p>
                      <button
                        onClick={() => removeLine(line.key)}
                        className="text-gray-300 hover:text-red-600"
                        aria-label={`Hapus ${line.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {customizationLabel(line) && (
                      <p className="text-[11px] text-gray-400 truncate">
                        {customizationLabel(line)}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center justify-between">
                      <div className="flex items-center bg-gray-100 rounded-md overflow-hidden h-7">
                        <button
                          onClick={() => changeQty(line.key, -1)}
                          className="w-7 h-full flex items-center justify-center text-gray-600 hover:bg-gray-200"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-7 text-center text-xs font-bold tabular-nums">
                          {line.quantity}
                        </span>
                        <button
                          onClick={() => changeQty(line.key, 1)}
                          className="w-7 h-full flex items-center justify-center text-gray-600 hover:bg-gray-200"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">
                        {rupiah(lineTotal(line))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Totals */}
            <div className="mt-3 border-t pt-2 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span className="tabular-nums">{rupiah(subtotal)}</span>
              </div>
              {!isDineIn && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Pajak (10%)</span>
                    <span className="tabular-nums">{rupiah(tax)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Service Charge (5%)</span>
                    <span className="tabular-nums">{rupiah(serviceCharge)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between font-bold text-base pt-1">
                <span>Grand Total</span>
                <span className="tabular-nums">{rupiah(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Customer */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <User className="h-4 w-4" />
              Pelanggan
            </h2>
            <div className="space-y-1">
              <Label htmlFor="cust-name">Nama</Label>
              <Input
                id="cust-name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nama pelanggan"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cust-phone">No. HP / WhatsApp (opsional)</Label>
              <Input
                id="cust-phone"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="081234567890"
                inputMode="tel"
              />
            </div>
          </div>

          {/* Order type + table */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h2 className="font-semibold">Tipe Pesanan</h2>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: "DINE_IN" as const, label: "Dine In", icon: UtensilsCrossed },
                  { value: "TAKEAWAY" as const, label: "Takeaway", icon: ShoppingBag },
                  { value: "DELIVERY" as const, label: "Delivery", icon: Truck },
                ]
              ).map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setOrderType(opt.value)}
                    className={`flex flex-col items-center gap-1 rounded-lg border-2 p-2.5 text-xs font-medium transition-colors ${
                      orderType === opt.value
                        ? "border-brand-primary bg-brand-secondary text-brand-primary"
                        : "border-gray-200 hover:border-brand-primary/40 text-gray-600"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {isDineIn && (
              <div className="space-y-1">
                <Label htmlFor="table-select">Meja</Label>
                <select
                  id="table-select"
                  value={tableId}
                  onChange={(e) => setTableId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                >
                  <option value="">Pilih meja...</option>
                  {tables
                    .filter((t) => t.status !== "MAINTENANCE")
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.status === "OCCUPIED" ? "(Terisi)" : ""}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="order-notes">Catatan Pesanan (opsional)</Label>
              <textarea
                id="order-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Catatan untuk dapur / kurir"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary resize-none"
              />
            </div>
          </div>

          {/* Payment method */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h2 className="font-semibold">Metode Pembayaran</h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod("CASH")}
                className={`flex items-center gap-2 rounded-xl border-2 p-3 text-sm font-medium transition-colors ${
                  paymentMethod === "CASH"
                    ? "border-green-500 bg-green-50 text-green-700"
                    : "border-gray-200 hover:border-green-300 text-gray-600"
                }`}
              >
                <Banknote className="h-5 w-5" />
                Cash / Tunai
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("QRIS")}
                className={`flex items-center gap-2 rounded-xl border-2 p-3 text-sm font-medium transition-colors ${
                  paymentMethod === "QRIS"
                    ? "border-brand-primary bg-brand-secondary text-brand-primary"
                    : "border-gray-200 hover:border-brand-primary/40 text-gray-600"
                }`}
              >
                <QrCode className="h-5 w-5" />
                QRIS
              </button>
            </div>
            <Button
              className="w-full"
              size="lg"
              disabled={submitting || cart.length === 0}
              onClick={handleSubmit}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              Buat Pesanan &amp; {paymentMethod === "CASH" ? "Bayar Cash" : "Bayar QRIS"}
            </Button>
            <p className="text-[11px] text-gray-400 text-center">
              Stok &amp; harga divalidasi server — stok berkurang saat pesanan
              selesai (COMPLETED).
            </p>
          </div>
        </div>
      </div>

      {/* Customization modal */}
      {customizing && (
        <CustomizeModal
          product={customizing.product}
          initial={customizing.line || null}
          onClose={() => setCustomizing(null)}
          onConfirm={confirmCustomize}
        />
      )}
    </div>
  );
}