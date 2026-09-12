"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { purchaseService } from "@/services/purchase.service";
import { supplierService, type Supplier } from "@/services/supplier.service";
import { ingredientService, type Ingredient } from "@/services/ingredient.service";
import { useBranchContext } from "@/hooks/use-branch-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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

interface DraftIngredientItem {
  ingredientId: string;
  quantity: string;
  unit: string;
  unitCost: string;
}

function emptyIngredientItem(): DraftIngredientItem {
  return { ingredientId: "", quantity: "1", unit: "", unitCost: "" };
}

/**
 * Buat Pembelian — G.2: BAHAN BAKU ONLY.
 *
 * Supplier → Purchase → PurchaseIngredient → Receive → BranchIngredient.stock
 * → WAC. Produk/PurchaseItem tidak lagi menjadi pilihan di sini (jalur legacy
 * tetap tersimpan dan hanya bisa dibaca di riwayat).
 */
export default function NewPurchasePage() {
  const router = useRouter();
  const { branches, branchId, isLoading: ctxLoading } = useBranchContext();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [supplierId, setSupplierId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [notes, setNotes] = useState("");
  const [ingredientItems, setIngredientItems] = useState<DraftIngredientItem[]>([
    emptyIngredientItem(),
  ]);

  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);

  useEffect(() => {
    if (ctxLoading) return;
    const defaultBranch = branchId ?? (branches.length === 1 ? branches[0].id : null);
    setSelectedBranchId((prev) => prev || defaultBranch || "");
    setLoadingOptions(true);
    Promise.all([
      supplierService.list(),
      ingredientService.list({ limit: 200 }),
    ])
      .then(([supRes, ingRes]) => {
        setSuppliers(supRes.items.filter((s) => s.isActive));
        setIngredients(ingRes.items.filter((i) => i.isActive));
      })
      .catch((error) => {
        console.error("Failed to load purchase options:", error);
        toast.error(apiErrorMessage(error, "Gagal memuat data pembelian"));
      })
      .finally(() => setLoadingOptions(false));
  }, [ctxLoading, branchId, branches]);

  const setIngredientItem = (index: number, patch: Partial<DraftIngredientItem>) => {
    setIngredientItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it;
        const updated = { ...it, ...patch };
        // Unit is fixed to the ingredient's base unit (no conversion in F.2/G).
        if (patch.ingredientId) {
          const ing = ingredients.find((x) => x.id === patch.ingredientId);
          if (ing) updated.unit = ing.baseUnit;
        }
        return updated;
      })
    );
  };
  const addIngredientItem = () =>
    setIngredientItems((prev) => [...prev, emptyIngredientItem()]);
  const removeIngredientItem = (index: number) =>
    setIngredientItems((prev) =>
      prev.length <= 1 ? [emptyIngredientItem()] : prev.filter((_, i) => i !== index)
    );

  const ingredientLineTotal = (it: DraftIngredientItem) => {
    const q = parseFloat(it.quantity);
    const c = parseFloat(it.unitCost);
    if (Number.isNaN(q) || q <= 0 || Number.isNaN(c) || c < 0) return 0;
    return q * c;
  };

  const total = ingredientItems.reduce((sum, it) => sum + ingredientLineTotal(it), 0);
  const hasIngredientItems = ingredientItems.some((it) => it.ingredientId);

  const validate = (): string | null => {
    if (!supplierId) return "Pilih supplier";
    if (!selectedBranchId) return "Pilih cabang untuk pembelian";

    for (const it of ingredientItems) {
      if (!it.ingredientId) continue;
      const q = parseFloat(it.quantity);
      if (Number.isNaN(q) || q <= 0) return "Jumlah bahan baku harus bernilai positif";
      const c = parseFloat(it.unitCost);
      if (Number.isNaN(c) || c < 0) return "Harga satuan bahan baku tidak boleh negatif";
      if (!it.unit) return "Satuan bahan baku wajib diisi";
    }

    if (!hasIngredientItems) {
      return "Tambahkan minimal satu bahan baku";
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
      const ingredientLines = ingredientItems
        .filter((it) => it.ingredientId)
        .map((it) => ({
          ingredientId: it.ingredientId,
          quantity: parseFloat(it.quantity),
          unit: it.unit,
          unitCost: parseFloat(it.unitCost),
        }));

      const created = await purchaseService.create({
        supplierId,
        branchId: selectedBranchId,
        notes: notes.trim() || null,
        purchaseIngredients: ingredientLines,
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
        <h1 className="text-3xl font-bold">Buat Pembelian Bahan Baku</h1>
        <p className="text-gray-500">
          Pembelian draft — stok bahan baku dan WAC diperbarui setelah barang diterima
        </p>
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
                  <SelectValue>
                    {suppliers.find((s) => s.id === supplierId)?.name ?? "Pilih supplier"}
                  </SelectValue>
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
              <Select
                value={selectedBranchId}
                onValueChange={(v) => setSelectedBranchId(v || "")}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(() => {
                      const b = branches.find((x) => x.id === selectedBranchId);
                      return b ? `${b.name} (${b.code})` : "Pilih cabang";
                    })()}
                  </SelectValue>
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

      {/* ===== BAHAN BAKU ===== */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Bahan Baku</CardTitle>
              {hasIngredientItems && (
                <Badge variant="secondary" className="text-xs">
                  {rupiah(total)}
                </Badge>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={addIngredientItem}>
              <Plus className="mr-1 h-4 w-4" />
              Tambah Bahan Baku
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {ingredientItems.map((it, index) => {
            const lt = ingredientLineTotal(it);
            const selectedIng = ingredients.find((x) => x.id === it.ingredientId);
            return (
              <div
                key={index}
                className="grid grid-cols-12 items-end gap-2 rounded-lg border border-blue-50 p-3"
              >
                <div className="col-span-12 space-y-1 sm:col-span-4">
                  <Label className="text-xs text-gray-500">Bahan Baku</Label>
                  <Select
                    value={it.ingredientId}
                    onValueChange={(v) =>
                      setIngredientItem(index, { ingredientId: v || "" })
                    }
                  >
                    <SelectTrigger size="sm">
                      <SelectValue>
                        {selectedIng?.name ?? "Pilih bahan baku"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ingredients.map((ing) => (
                        <SelectItem key={ing.id} value={ing.id}>
                          {ing.name} ({ing.baseUnit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3 space-y-1 sm:col-span-2">
                  <Label className="text-xs text-gray-500">Jumlah</Label>
                  <Input
                    type="number"
                    min={0.001}
                    step="any"
                    value={it.quantity}
                    onChange={(e) =>
                      setIngredientItem(index, { quantity: e.target.value })
                    }
                    className="h-9 text-right tabular-nums"
                    inputMode="decimal"
                  />
                </div>
                <div className="col-span-3 space-y-1 sm:col-span-2">
                  <Label className="text-xs text-gray-500">Satuan</Label>
                  <div className="flex h-9 items-center rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700">
                    {it.unit || "—"}
                  </div>
                </div>
                <div className="col-span-3 space-y-1 sm:col-span-2">
                  <Label className="text-xs text-gray-500">Harga Beli</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={it.unitCost}
                    onChange={(e) =>
                      setIngredientItem(index, { unitCost: e.target.value })
                    }
                    className="h-9 text-right tabular-nums"
                    inputMode="decimal"
                    placeholder="18000"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-right text-sm font-medium tabular-nums text-gray-600">
                    {rupiah(lt)}
                  </p>
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-gray-400"
                    onClick={() => removeIngredientItem(index)}
                    aria-label="Hapus bahan baku"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ===== TOTAL & ACTIONS ===== */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-end gap-3">
            <div className="text-right">
              <p className="text-sm text-gray-500">Total Pembelian</p>
              <p className="text-2xl font-bold tabular-nums">{rupiah(total)}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => router.push("/admin/purchasing/purchases")}
              >
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
