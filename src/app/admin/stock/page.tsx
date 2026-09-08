"use client";

import { useEffect, useState } from "react";
import {
  branchService,
  type BranchProductRow,
} from "@/services/branch.service";
import { useBranchContext } from "@/hooks/use-branch-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Minus, Plus, Store, Save } from "lucide-react";
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
 */
export default function StockPage() {
  const { branchId, branches, isLoading: ctxLoading } = useBranchContext();

  const [items, setItems] = useState<BranchProductRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Resolve the working branch: active selection, else the single authorized
  // branch (kasir one-branch), else null (needs a selection).
  const workingBranchId =
    branchId ?? (branches.length === 1 ? branches[0].id : null);
  const workingBranch =
    branches.find((b) => b.id === workingBranchId) ?? null;

  useEffect(() => {
    if (!workingBranchId || ctxLoading) return;
    let alive = true;
    (async () => {
      try {
        const rows = await branchService.getBranchProducts(workingBranchId);
        if (!alive) return;
        setItems(rows);
        const next: Record<string, number> = {};
        for (const r of rows) next[r.productId] = r.stock;
        setDrafts(next);
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
  }, [workingBranchId, ctxLoading]);

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
    setSaving(product.productId);
    try {
      await branchService.updateBranchProduct(workingBranchId, product.productId, {
        stock: value,
      });
      setItems((prev) =>
        prev.map((p) =>
          p.productId === product.productId ? { ...p, stock: value } : p
        )
      );
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

  if (ctxLoading) {
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
          <h1 className="text-3xl font-bold">Stok Produk</h1>
          <p className="text-gray-500">Kelola stok produk per cabang</p>
        </div>
        {workingBranch && (
          <Badge className="inline-flex w-fit items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200">
            <Store className="h-3.5 w-3.5" />
            Cabang: {workingBranch.name} ({workingBranch.code})
          </Badge>
        )}
      </div>

      {!workingBranchId ? (
        <Card>
          <CardContent className="py-10 text-center text-gray-500">
            Pilih cabang terlebih dahulu untuk mengelola stok.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daftar Stok</CardTitle>
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
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
