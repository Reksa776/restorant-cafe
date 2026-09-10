"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { purchaseService } from "@/services/purchase.service";
import { supplierService, type Supplier } from "@/services/supplier.service";
import { menuService, type Product } from "@/services/menu.service";
import { useBranchContext } from "@/hooks/use-branch-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;

function apiErrorMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof msg === "string" && msg.trim() ? msg : fallback;
}

interface DraftItem {
  productId: string;
  quantity: string;
  unitCost: string;
}

function emptyItem(): DraftItem {
  return { productId: "", quantity: "1", unitCost: "" };
}

export default function NewPurchasePage() {
  const router = useRouter();
  const { branches, branchId, isLoading: ctxLoading } = useBranchContext();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [supplierId, setSupplierId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);

  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);

  useEffect(() => {
    if (ctxLoading) return;
    const defaultBranch = branchId ?? (branches.length === 1 ? branches[0].id : null);
    setSelectedBranchId((prev) => prev || defaultBranch || "");
    setLoadingOptions(true);
    Promise.all([
      supplierService.list(),
      menuService.getProducts(),
    ])
      .then(([supRes, prodRes]) => {
        setSuppliers(supRes.items.filter((s) => s.isActive));
        setProducts(prodRes);
      })
      .catch((error) => {
        console.error("Failed to load purchase options:", error);
        toast.error(apiErrorMessage(error, "Gagal memuat data pembelian"));
      })
      .finally(() => setLoadingOptions(false));
  }, [ctxLoading, branchId, branches]);

  const setItem = (index: number, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (index: number) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));

  const lineTotal = (it: DraftItem) => {
    const q = parseInt(it.quantity, 10);
    const c = parseFloat(it.unitCost);
    if (!Number.isInteger(q) || q <= 0 || Number.isNaN(c) || c < 0) return 0;
    return q * c;
  };

  const total = items.reduce((sum, it) => sum + lineTotal(it), 0);

  const validate = (): string | null => {
    if (!supplierId) return "Pilih supplier";
    if (!selectedBranchId) return "Pilih cabang untuk pembelian";
    if (items.length === 0 || items.some((it) => !it.productId)) {
      return "Setiap item wajib memilih produk";
    }
    for (const it of items) {
      const q = parseInt(it.quantity, 10);
      if (!Number.isInteger(q) || q <= 0) return "Jumlah item harus bilangan bulat positif (PCS)";
      const c = parseFloat(it.unitCost);
      if (Number.isNaN(c) || c < 0) return "Harga satuan tidak boleh negatif";
    }
    return null;
  };

  const handleSubmit = async () => {
    if (saveInFlight.current) return;
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    try {
      const created = await purchaseService.create({
        supplierId,
        branchId: selectedBranchId,
        notes: notes.trim() || null,
        items: items.map((it) => ({
          productId: it.productId,
          quantity: parseInt(it.quantity, 10),
          unitCost: parseFloat(it.unitCost),
        })),
      });
      toast.success("Pembelian draft berhasil dibuat");
      router.push(`/admin/purchasing/purchases/${created.id}`);
    } catch (error) {
      console.error("Failed to create purchase:", error);
      toast.error(apiErrorMessage(error, "Gagal membuat pembelian"));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  if (loadingOptions) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Buat Pembelian</h1>
        <p className="text-gray-500">Pembelian draft — belum memengaruhi stok hingga diterima</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informasi Pembelian</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Supplier *</Label>
              <Select value={supplierId} onValueChange={(v) => setSupplierId(v || "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Cabang Tujuan *</Label>
              <Select value={selectedBranchId} onValueChange={(v) => setSelectedBranchId(v || "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih cabang" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Catatan</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan pembelian (opsional)"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Item Pembelian</CardTitle>
            <Button variant="outline" size="sm" onClick={addItem}>
              <Plus className="mr-1 h-4 w-4" />
              Tambah Item
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((it, index) => {
            const lt = lineTotal(it);
            return (
              <div
                key={index}
                className="grid grid-cols-12 items-end gap-2 rounded-lg border border-gray-100 p-3"
              >
                <div className="col-span-12 sm:col-span-5 space-y-1">
                  <Label className="text-xs text-gray-500">Produk</Label>
                  <Select value={it.productId} onValueChange={(v) => setItem(index, { productId: v || "" })}>
                    <SelectTrigger size="sm">
                      <SelectValue placeholder="Pilih produk" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} — {rupiah(Number(p.price))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-4 sm:col-span-2 space-y-1">
                  <Label className="text-xs text-gray-500">Jumlah</Label>
                  <Input
                    type="number"
                    min={1}
                    value={it.quantity}
                    onChange={(e) => setItem(index, { quantity: e.target.value })}
                    className="h-9 text-right tabular-nums"
                    inputMode="numeric"
                  />
                </div>
                <div className="col-span-4 sm:col-span-2 space-y-1">
                  <Label className="text-xs text-gray-500">Harga Satuan</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={it.unitCost}
                    onChange={(e) => setItem(index, { unitCost: e.target.value })}
                    className="h-9 text-right tabular-nums"
                    inputMode="decimal"
                    placeholder="1000"
                  />
                </div>
                <div className="col-span-3 sm:col-span-2">
                  <p className="text-right text-sm font-medium tabular-nums text-gray-600">
                    {rupiah(lt)}
                  </p>
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-gray-400"
                    disabled={items.length === 1}
                    onClick={() => removeItem(index)}
                    aria-label="Hapus item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}

          <div className="flex flex-col items-end gap-3 border-t pt-4">
            <div className="text-right">
              <p className="text-sm text-gray-500">Total Pembelian</p>
              <p className="text-2xl font-bold tabular-nums">{rupiah(total)}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => router.push("/admin/purchasing/purchases")}>
                Batal
              </Button>
              <Button onClick={handleSubmit} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Simpan Draft
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}