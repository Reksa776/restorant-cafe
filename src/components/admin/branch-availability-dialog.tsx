"use client";

import { useCallback, useEffect, useState } from "react";
import { branchService, type Branch } from "@/services/branch.service";
import { toast } from "sonner";
import { Loader2, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const rupiah = (v: number) => `Rp${v.toLocaleString("id-ID")}`;

interface BranchAvailabilityDialogProps {
  product: { id: string; name: string; price: number; isAvailable: boolean };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

type BranchState = {
  isAvailable: boolean;
  priceOverride: string; // "" = use base price
};

export function BranchAvailabilityDialog({
  product,
  open,
  onOpenChange,
  onSaved,
}: BranchAvailabilityDialogProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [rows, setRows] = useState<Record<string, BranchState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const branchList = await branchService.getBranches();
      setBranches(branchList);
      // Per-branch availability/price for this product.
      const statuses = await Promise.all(
        branchList.map(async (b) => {
          try {
            const all = await branchService.getBranchProducts(b.id);
            return {
              branchId: b.id,
              row: all.find((r) => r.productId === product.id) ?? null,
            };
          } catch {
            return { branchId: b.id, row: null };
          }
        })
      );
      const next: Record<string, BranchState> = {};
      for (const { branchId, row } of statuses) {
        next[branchId] = {
          isAvailable: row ? row.isAvailable : product.isAvailable,
          priceOverride:
            row?.priceOverride != null ? String(row.priceOverride) : "",
        };
      }
      setRows(next);
      setDirty(false);
    } catch (error) {
      console.error("Failed to load branch availability:", error);
      toast.error("Gagal memuat ketersediaan cabang");
    } finally {
      setLoading(false);
    }
  }, [product.id, product.isAvailable]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const update = (branchId: string, patch: Partial<BranchState>) => {
    setRows((prev) => ({ ...prev, [branchId]: { ...prev[branchId], ...patch } }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const b of branches) {
        const row = rows[b.id];
        if (!row) continue;
        const price = row.priceOverride === "" ? null : Number(row.priceOverride);
        if (price !== null && (!Number.isFinite(price) || price <= 0)) {
          throw new Error("Harga override tidak valid");
        }
        await branchService.updateBranchProduct(b.id, product.id, {
          isAvailable: row.isAvailable,
          priceOverride: price,
        });
      }
      toast.success("Ketersediaan cabang diperbarui");
      setDirty(false);
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (error as any)?.response?.data?.message;
      toast.error(typeof msg === "string" && msg ? msg : "Gagal menyimpan ketersediaan cabang");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ketersediaan per Cabang</DialogTitle>
          <DialogDescription>
            {product.name} — harga dasar {rupiah(product.price)} dapat
            dioverride per cabang.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : branches.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            Belum ada cabang. Tambahkan cabang dahulu di menu Cabang.
          </p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {branches.map((b) => {
              const row = rows[b.id];
              if (!row) return null;
              const override =
                row.priceOverride === "" ? null : Number(row.priceOverride);
              const effective = override ? override : product.price;
              return (
                <div
                  key={b.id}
                  className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Store className="h-4 w-4 shrink-0 text-gray-400" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {b.name}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({b.code})
                        </span>
                      </p>
                      {!b.isActive && (
                        <Badge
                          variant="outline"
                          className="mt-0.5 text-red-600 border-red-200"
                        >
                          Nonaktif
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={row.isAvailable}
                        onChange={(e) =>
                          update(b.id, { isAvailable: e.target.checked })
                        }
                        className="h-4 w-4 accent-gray-900"
                      />
                      Tersedia
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Harga</span>
                      <Input
                        type="number"
                        min={0}
                        value={row.priceOverride}
                        placeholder={String(product.price)}
                        onChange={(e) =>
                          update(b.id, { priceOverride: e.target.value })
                        }
                        className="h-8 w-28 text-sm"
                      />
                      <span className="w-14 text-right text-xs text-muted-foreground tabular-nums">
                        {rupiah(effective)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="justify-between">
          <span className="text-xs text-gray-400">
            Kosongkan harga = pakai harga dasar.
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Batal
            </Button>
            <Button onClick={handleSave} disabled={saving || !dirty || loading}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Simpan
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}