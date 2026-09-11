"use client";

import { useEffect, useState } from "react";
import {
  branchService,
  type BranchProductRow,
} from "@/services/branch.service";
import { useBranchContext } from "@/hooks/use-branch-context";
import { useUserRole } from "@/hooks/use-user-role";
import { ingredientService } from "@/services/ingredient.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Minus, Plus, Store, Save, Lock } from "lucide-react";
import { toast } from "sonner";

/**
 * STOK PRODUK — per-branch inventory quantity management.
 *
 * Branch-aware: only shows the aktive/authorized cabang of the logged-in user.
 * - Single-branch user (e.g. kasir Jakarta) → auto-resolves to that branch.
 * - Multi-branch user → uses the branch selected in the branch selector.
 *
 * Server re-validates authorization on every read/write, so a forged
 * branchId or x-branch-id never exposes/edits another branch.
 *
 * D3: stok hanya bisa diubah ADMIN (penyesuaian manual tercatat sebagai
 * StockMovement ADJUSTMENT dengan alasan wajib). KASIR hanya membaca.
 */
export default function StockPage() {
  const [activeTab, setActiveTab] = useState("products");
  const { branchId, branches, isLoading: ctxLoading } = useBranchContext();
  const { role, isLoading: roleLoading } = useUserRole();
  const isAdmin = role === "ADMIN";

  const [items, setItems] = useState<BranchProductRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Resolve the working branch: active selection, else the single authorized
  // branch (kasir one-branch), else null (needs a selection).
  const workingBranchId =
    branchId ?? (branches.length === 1 ? branches[0].id : null);
  const workingBranch =
    branches.find((b) => b.id === workingBranchId) ?? null;

  useEffect(() => {
    if (!workingBranchId || ctxLoading || roleLoading) return;
    let alive = true;
    (async () => {
      try {
        const rows = await branchService.getBranchProducts(workingBranchId);
        if (!alive) return;
        setItems(rows);
        const next: Record<string, number> = {};
        const reasonMap: Record<string, string> = {};
        for (const r of rows) {
          next[r.productId] = r.stock;
          reasonMap[r.productId] = "";
        }
        setDrafts(next);
        setReasons(reasonMap);
      } catch (error) {
        if (!alive) return;
        console.error("Failed to load stock:", error);
        toast.error("Gagal memuat stok produk");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [workingBranchId, ctxLoading, roleLoading]);

  const setDraft = (productId: string, value: number) => {
    if (Number.isNaN(value) || value < 0) return;
    setDrafts((prev) => ({ ...prev, [productId]: value }));
  };

  const adjust = (productId: string, product: BranchProductRow, delta: number) => {
    const base = drafts[productId] ?? product.stock;
    const next = Math.max(0, base + delta);
    setDrafts((prev) => ({ ...prev, [productId]: next }));
  };

  const handleSave = async (product: BranchProductRow) => {
    if (!workingBranchId) return;
    const value = drafts[product.productId] ?? product.stock;
    if (value === product.stock) {
      toast.info("Nilai stok tidak berubah");
      return;
    }
    const reason = (reasons[product.productId] ?? "").trim();
    if (!reason) {
      toast.error("Alasan penyesuaian stok wajib diisi");
      return;
    }
    setSaving(product.productId);
    try {
      await branchService.updateBranchProduct(workingBranchId, product.productId, {
        stock: value,
        reason,
      });
      setItems((prev) =>
        prev.map((p) =>
          p.productId === product.productId ? { ...p, stock: value } : p
        )
      );
      setReasons((prev) => ({ ...prev, [product.productId]: "" }));
      toast.success(`Stok ${product.name} diperbarui`);
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (error as any)?.response?.data?.message;
      toast.error(typeof msg === "string" && msg ? msg : "Gagal mengubah stok");
    } finally {
      setSaving(null);
    }
  };

  const isDirty = (p: BranchProductRow) =>
    (drafts[p.productId] ?? p.stock) !== p.stock;

  if (ctxLoading || roleLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Stok</h1>
          <p className="text-gray-500">Kelola stok produk dan bahan baku per cabang</p>
        </div>
        {workingBranch && (
          <Badge className="inline-flex w-fit items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200">
            <Store className="h-3.5 w-3.5" />
            Cabang: {workingBranch.name} ({workingBranch.code})
          </Badge>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="products">Produk</TabsTrigger>
          <TabsTrigger value="ingredients">Bahan Baku</TabsTrigger>
        </TabsList>

        <TabsContent value="products">
      {!workingBranchId ? (
        <Card>
          <CardContent className="py-10 text-center text-gray-500">
            Pilih cabang terlebih dahulu untuk mengelola stok.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Daftar Stok</CardTitle>
              {!isAdmin && (
                <Badge variant="outline" className="gap-1 text-gray-500">
                  <Lock className="h-3 w-3" />
                  Hanya baca
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : items.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">
                Belum ada produk untuk cabang ini.
              </p>
            ) : (
              <ul className="space-y-2">
                {items.map((p) => (
                  <li
                    key={p.productId}
                    className="flex flex-col gap-2 rounded-lg border border-gray-100 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-gray-400">
                        {!p.isAvailable && (
                          <span className="text-red-500 mr-2">Tidak tersedia</span>
                        )}
                        Harga Rp
                        {p.effectivePrice.toLocaleString("id-ID")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isAdmin ? (
                        <>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-9 w-9"
                            onClick={() => adjust(p.productId, p, -1)}
                            aria-label={`Kurangi stok ${p.name}`}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <Input
                            type="number"
                            min={0}
                            value={drafts[p.productId] ?? p.stock}
                            onChange={(e) =>
                              setDraft(p.productId, parseInt(e.target.value, 10))
                            }
                            className="h-9 w-20 text-center tabular-nums"
                            inputMode="numeric"
                            aria-label={`Stok ${p.name}`}
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-9 w-9"
                            onClick={() => adjust(p.productId, p, 1)}
                            aria-label={`Tambah stok ${p.name}`}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="default"
                            size="sm"
                            className="h-9 w-9"
                            disabled={saving === p.productId || !isDirty(p)}
                            onClick={() => handleSave(p)}
                            aria-label={`Simpan stok ${p.name}`}
                          >
                            {saving === p.productId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                        </>
                      ) : (
                        <span className="text-right text-sm font-medium tabular-nums text-gray-600">
                          {p.stock} PCS
                        </span>
                      )}
                    </div>
                    {isAdmin && isDirty(p) && (
                      <Input
                        type="text"
                        value={reasons[p.productId] ?? ""}
                        onChange={(e) =>
                          setReasons((prev) => ({
                            ...prev,
                            [p.productId]: e.target.value,
                          }))
                        }
                        placeholder="Alasan penyesuaian stok (wajib)"
                        className="h-8 w-full text-sm sm:w-64"
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
        </TabsContent>

        <TabsContent value="ingredients">
          <IngredientStockTab workingBranchId={workingBranchId} isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// Ingredient Stock Tab
// ============================================================

const UNIT_LABELS: Record<string, string> = {
  PCS: "Pcs",
  GRAM: "Gram",
  KG: "Kg",
  ML: "Ml",
  LITER: "Liter",
};

function IngredientStockTab({
  workingBranchId,
  isAdmin,
}: {
  workingBranchId: string | null;
  isAdmin: boolean;
}) {
  const [items, setItems] = useState<
    Array<{
      id: string;
      ingredientId: string;
      ingredientName: string;
      baseUnit: string;
      stock: number;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [targetStock, setTargetStock] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  // ingredientService imported at top of file

  useEffect(() => {
    if (!workingBranchId) return;
    let alive = true;
    (async () => {
      try {
        const result = await ingredientService.getStock({
          branchId: workingBranchId,
        });
        if (!alive) return;
        setItems(result.items);
      } catch {
        // ignore
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [workingBranchId]);

  const handleAdjust = async (item: (typeof items)[number]) => {
    if (!workingBranchId) return;
    const target = parseFloat(targetStock[item.ingredientId] ?? "0");
    if (isNaN(target) || target < 0) {
      toast.error("Nilai stok tidak valid");
      return;
    }
    const reason = (reasons[item.ingredientId] ?? "").trim();
    if (!reason) {
      toast.error("Alasan penyesuaian wajib diisi");
      return;
    }
    setSaving(item.ingredientId);
    try {
      await ingredientService.adjustStock(item.ingredientId, {
        branchId: workingBranchId,
        targetStock: target,
        reason,
      });
      setItems((prev) =>
        prev.map((i) =>
          i.ingredientId === item.ingredientId ? { ...i, stock: target } : i
        )
      );
      setAdjusting(null);
      setReasons((prev) => ({ ...prev, [item.ingredientId]: "" }));
      toast.success(`Stok ${item.ingredientName} diperbarui`);
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Gagal mengubah stok";
      toast.error(msg);
    } finally {
      setSaving(null);
    }
  };

  if (!workingBranchId) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-gray-500">
          Pilih cabang terlebih dahulu.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Stok Bahan Baku</CardTitle>
          {!isAdmin && (
            <Badge variant="outline" className="gap-1 text-gray-500">
              <Lock className="h-3 w-3" />
              Hanya baca
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            Belum ada bahan baku untuk cabang ini.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.ingredientId}
                className="flex flex-col gap-2 rounded-lg border border-gray-100 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {item.ingredientName}
                  </p>
                  <p className="text-xs text-gray-400">
                    Satuan: {UNIT_LABELS[item.baseUnit] || item.baseUnit}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isAdmin && adjusting === item.ingredientId ? (
                    <>
                      <Input
                        type="number"
                        min={0}
                        step="0.001"
                        value={targetStock[item.ingredientId] ?? item.stock}
                        onChange={(e) =>
                          setTargetStock((prev) => ({
                            ...prev,
                            [item.ingredientId]: e.target.value,
                          }))
                        }
                        className="h-9 w-24 text-center tabular-nums"
                        inputMode="decimal"
                        aria-label={`Target stok ${item.ingredientName}`}
                      />
                      <Button
                        variant="default"
                        size="sm"
                        className="h-9"
                        disabled={saving === item.ingredientId}
                        onClick={() => handleAdjust(item)}
                      >
                        {saving === item.ingredientId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9"
                        onClick={() => setAdjusting(null)}
                      >
                        Batal
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-right text-sm font-medium tabular-nums text-gray-600">
                        {item.stock} {UNIT_LABELS[item.baseUnit] || item.baseUnit}
                      </span>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9"
                          onClick={() => {
                            setAdjusting(item.ingredientId);
                            setTargetStock((prev) => ({
                              ...prev,
                              [item.ingredientId]: String(item.stock),
                            }));
                          }}
                        >
                          Sesuaikan
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {isAdmin && adjusting === item.ingredientId && (
                  <Input
                    type="text"
                    value={reasons[item.ingredientId] ?? ""}
                    onChange={(e) =>
                      setReasons((prev) => ({
                        ...prev,
                        [item.ingredientId]: e.target.value,
                      }))
                    }
                    placeholder="Alasan penyesuaian (wajib)"
                    className="h-8 w-full text-sm sm:w-64"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}