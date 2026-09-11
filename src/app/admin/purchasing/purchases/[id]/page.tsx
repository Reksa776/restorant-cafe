"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  purchaseService,
  type PurchaseDetail,
  type PurchaseItem,
  type PurchaseIngredientLine,
  type PurchaseIngredientMovement,
} from "@/services/purchase.service";
import { supplierService, type Supplier } from "@/services/supplier.service";
import { useUserRole } from "@/hooks/use-user-role";
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
import { Loader2, PackageOpen, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;

function apiErrorMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof msg === "string" && msg.trim() ? msg : fallback;
}

function statusBadge(status: PurchaseDetail["status"]) {
  if (status === "RECEIVED") {
    return <Badge className="bg-green-100 text-green-700 border border-green-200">Diterima</Badge>;
  }
  if (status === "CANCELLED") {
    return <Badge variant="secondary">Dibatalkan</Badge>;
  }
  return <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">Draft</Badge>;
}

interface EditableItem {
  quantity: string;
  unitCost: string;
}

export default function PurchaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { role, isLoading: roleLoading } = useUserRole();
  const isAdmin = role === "ADMIN";

  const [purchase, setPurchase] = useState<PurchaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [editing, setEditing] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<EditableItem[]>([]);
  const [ingredientEdits, setIngredientEdits] = useState<EditableItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState<null | "receive" | "cancel">(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await purchaseService.get(params.id);
      setPurchase(data);
      setSupplierId(data.supplierId);
      setNotes(data.notes ?? "");
      setItems(data.items.map((it) => ({ quantity: String(it.quantity), unitCost: String(it.unitCost) })));
      setIngredientEdits((data.purchaseIngredients ?? []).map((pi) => ({ quantity: String(pi.quantity), unitCost: String(pi.unitCost) })));
    } catch (error) {
      console.error("Failed to load purchase:", error);
      toast.error(apiErrorMessage(error, "Gagal memuat pembelian"));
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    if (roleLoading) return;
    load();
  }, [load, roleLoading]);

  const isDraft = purchase?.status === "DRAFT";
  const canEdit = isAdmin && isDraft && !loading;

  const lineTotal = (index: number) => {
    const it = items[index];
    if (!it || !purchase) return 0;
    const q = parseInt(it.quantity, 10);
    const c = parseFloat(it.unitCost);
    if (!Number.isInteger(q) || q <= 0 || Number.isNaN(c) || c < 0) return 0;
    return q * c;
  };

  const ingredientLineTotal = (index: number) => {
    const it = ingredientEdits[index];
    if (!it) return 0;
    const q = parseFloat(it.quantity);
    const c = parseFloat(it.unitCost);
    if (Number.isNaN(q) || q <= 0 || Number.isNaN(c) || c < 0) return 0;
    return q * c;
  };

  const productTotalCalc = items.reduce((sum, _, i) => sum + lineTotal(i), 0);
  const ingredientTotalCalc = ingredientEdits.reduce((sum, _, i) => sum + ingredientLineTotal(i), 0);
  const total = productTotalCalc + ingredientTotalCalc;

  const startEdit = () => {
    supplierService
      .list()
      .then((res) => setSuppliers(res.items.filter((s) => s.isActive)))
      .catch(() => {});
    setEditing(true);
  };

  const handleSave = async () => {
    if (!purchase) return;
    for (const [i, it] of items.entries()) {
      const q = parseInt(it.quantity, 10);
      if (!Number.isInteger(q) || q <= 0) {
        toast.error(`Jumlah item #${i + 1} harus bilangan bulat positif`);
        return;
      }
      const c = parseFloat(it.unitCost);
      if (Number.isNaN(c) || c < 0) {
        toast.error(`Harga satuan item #${i + 1} tidak boleh negatif`);
        return;
      }
    }
    setSaving(true);
    try {
      // Validate ingredient items
    for (const [i, it] of ingredientEdits.entries()) {
      const q = parseFloat(it.quantity);
      if (Number.isNaN(q) || q <= 0) {
        toast.error(`Jumlah bahan baku #${i + 1} harus bernilai positif`);
        return;
      }
      const c = parseFloat(it.unitCost);
      if (Number.isNaN(c) || c < 0) {
        toast.error(`Harga satuan bahan baku #${i + 1} tidak boleh negatif`);
        return;
      }
    }

    await purchaseService.updateDraft(purchase.id, {
        supplierId,
        notes,
        items: items.map((it, i) => ({
          productId: purchase.items[i].productId,
          quantity: parseInt(it.quantity, 10),
          unitCost: parseFloat(it.unitCost),
        })),
        purchaseIngredients: purchase.purchaseIngredients?.map((pi, i) => ({
          ingredientId: pi.ingredientId,
          quantity: parseFloat(ingredientEdits[i]?.quantity ?? String(pi.quantity)),
          unit: pi.unit,
          unitCost: parseFloat(ingredientEdits[i]?.unitCost ?? String(pi.unitCost)),
        })) ?? undefined,
      });
      toast.success("Draft pembelian diperbarui");
      setEditing(false);
      load();
    } catch (error) {
      console.error("Failed to update purchase:", error);
      toast.error(apiErrorMessage(error, "Gagal memperbarui pembelian"));
    } finally {
      setSaving(false);
    }
  };

  const handleReceive = async () => {
    if (!purchase) return;
    if (!window.confirm("Terima semua barang pada pembelian ini? Stok akan bertambah.")) return;
    setActionBusy("receive");
    try {
      await purchaseService.receive(purchase.id);
      toast.success("Barang diterima — stok bertambah");
      setEditing(false);
      load();
    } catch (error) {
      console.error("Failed to receive purchase:", error);
      toast.error(apiErrorMessage(error, "Gagal menerima pembelian"));
    } finally {
      setActionBusy(null);
    }
  };

  const handleCancel = async () => {
    if (!purchase) return;
    if (!window.confirm("Batalkan pembelian ini?")) return;
    setActionBusy("cancel");
    try {
      await purchaseService.cancel(purchase.id);
      toast.success("Pembelian dibatalkan");
      setEditing(false);
      load();
    } catch (error) {
      console.error("Failed to cancel purchase:", error);
      toast.error(apiErrorMessage(error, "Gagal membatalkan pembelian"));
    } finally {
      setActionBusy(null);
    }
  };

  if (loading || !purchase) {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      );
    }
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="text-gray-500" onClick={() => router.push("/admin/purchasing/purchases")} aria-label="Kembali">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Pembelian</h1>
              <span className="font-mono text-sm text-gray-400">{purchase.id.slice(-8).toUpperCase()}</span>
              {statusBadge(purchase.status)}
            </div>
            <p className="text-sm text-gray-500">
              {purchase.branchName ?? "—"} · dibuat{" "}
              {new Date(purchase.createdAt).toLocaleString("id-ID", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informasi Supplier</CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="max-w-sm space-y-1">
              <Label>Supplier *</Label>
              <Select value={supplierId} onValueChange={(v) => setSupplierId(v || "")}>
                <SelectTrigger>
                  <SelectValue>
                    {suppliers.find((s) => s.id === supplierId)?.name ??
                      "Pilih supplier"}
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
          ) : (
            <div className="flex items-center gap-3">
              <PackageOpen className="h-8 w-8 rounded-lg bg-gray-100 p-1.5 text-gray-500" />
              <div>
                <p className="font-medium">{purchase.supplierName ?? "—"}</p>
                {purchase.supplierPhone && (
                  <p className="text-sm text-gray-500">{purchase.supplierPhone}</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Item Pembelian</CardTitle>
            {canEdit && !editing && (
              <Button variant="outline" size="sm" onClick={startEdit}>
                Edit Draft
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="pb-2 pr-2 font-medium">Produk</th>
                  <th className="pb-2 pr-2 text-right font-medium">Jumlah</th>
                  <th className="pb-2 pr-2 text-right font-medium">Harga Satuan</th>
                  <th className="pb-2 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {purchase.items.map((it, index) => (
                  <tr key={it.id || it.productId} className="border-b last:border-none">
                    <td className="py-2 pr-2">
                      <p className="font-medium">{it.productName || it.productId}</p>
                      {it.productPrice != null && (
                        <p className="text-xs text-gray-400">Harga dasar {rupiah(it.productPrice)}</p>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {editing ? (
                        <Input
                          type="number"
                          min={1}
                          value={items[index]?.quantity ?? ""}
                          onChange={(e) =>
                            setItems((prev) => prev.map((row, i) => (i === index ? { ...row, quantity: e.target.value } : row)))
                          }
                          className="ml-auto h-8 w-24 text-right tabular-nums"
                          inputMode="numeric"
                        />
                      ) : (
                        <span className="tabular-nums">{it.quantity} PCS</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {editing ? (
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={items[index]?.unitCost ?? ""}
                          onChange={(e) =>
                            setItems((prev) => prev.map((row, i) => (i === index ? { ...row, unitCost: e.target.value } : row)))
                          }
                          className="ml-auto h-8 w-28 text-right tabular-nums"
                          inputMode="decimal"
                        />
                      ) : (
                        <span className="tabular-nums">{rupiah(it.unitCost)}</span>
                      )}
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {editing ? rupiah(lineTotal(index)) : rupiah(it.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bahan Baku section */}
          {purchase.purchaseIngredients && purchase.purchaseIngredients.length > 0 && (
            <div className="overflow-x-auto">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-600">Bahan Baku</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="pb-2 pr-2 font-medium">Bahan Baku</th>
                    <th className="pb-2 pr-2 text-right font-medium">Jumlah</th>
                    <th className="pb-2 pr-2 font-medium">Satuan</th>
                    <th className="pb-2 pr-2 text-right font-medium">Harga Satuan</th>
                    <th className="pb-2 text-right font-medium">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {purchase.purchaseIngredients.map((pi, index) => (
                    <tr key={pi.id || pi.ingredientId} className="border-b last:border-none">
                      <td className="py-2 pr-2">
                        <p className="font-medium">{pi.ingredientName || pi.ingredientId}</p>
                      </td>
                      <td className="py-2 pr-2 text-right">
                        {editing ? (
                          <Input
                            type="number"
                            min={0.001}
                            step="any"
                            value={ingredientEdits[index]?.quantity ?? ""}
                            onChange={(e) =>
                              setIngredientEdits((prev) => prev.map((row, i) => (i === index ? { ...row, quantity: e.target.value } : row)))
                            }
                            className="ml-auto h-8 w-24 text-right tabular-nums"
                            inputMode="decimal"
                          />
                        ) : (
                          <span className="tabular-nums">{pi.quantity}</span>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <span className="text-gray-600">{pi.unit}</span>
                      </td>
                      <td className="py-2 pr-2 text-right">
                        {editing ? (
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={ingredientEdits[index]?.unitCost ?? ""}
                            onChange={(e) =>
                              setIngredientEdits((prev) => prev.map((row, i) => (i === index ? { ...row, unitCost: e.target.value } : row)))
                            }
                            className="ml-auto h-8 w-28 text-right tabular-nums"
                            inputMode="decimal"
                          />
                        ) : (
                          <span className="tabular-nums">{rupiah(pi.unitCost)}</span>
                        )}
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums">
                        {editing ? rupiah(ingredientLineTotal(index)) : rupiah(pi.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="space-y-1 pt-2">
            <p className="text-xs uppercase tracking-wide text-gray-400">Catatan</p>
            {editing ? (
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Catatan" />
            ) : (
              <p className="text-sm text-gray-600">{purchase.notes || "—"}</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 border-t pt-3">
            {editing && purchase.purchaseIngredients && purchase.purchaseIngredients.length > 0 && (
              <div className="w-full max-w-xs space-y-1 text-sm text-gray-500">
                <div className="flex justify-between">
                  <span>Subtotal Produk</span>
                  <span className="tabular-nums">{rupiah(productTotalCalc)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Subtotal Bahan Baku</span>
                  <span className="tabular-nums">{rupiah(ingredientTotalCalc)}</span>
                </div>
              </div>
            )}
            <div className="text-right">
              <p className="text-sm text-gray-500">Total</p>
              <p className="text-2xl font-bold tabular-nums">{rupiah(editing ? total : purchase.total)}</p>
            </div>
            {editing ? (
              <div className="flex gap-2">
                <Button variant="outline" disabled={saving} onClick={() => { setEditing(false); load(); }}>
                  Batal
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  Simpan Perubahan
                </Button>
              </div>
            ) : isDraft && isAdmin ? (
              <div className="flex gap-2">
                <Button variant="destructive" onClick={handleCancel} disabled={actionBusy === "cancel" || actionBusy === "receive"}>
                  {actionBusy === "cancel" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <XCircle className="mr-1 h-4 w-4" />}
                  Batalkan
                </Button>
                <Button onClick={handleReceive} disabled={actionBusy === "cancel" || actionBusy === "receive"}>
                  {actionBusy === "receive" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                  Terima Barang
                </Button>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {purchase.status === "RECEIVED" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Riwayat Stok Masuk</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {(purchase.movements.length === 0 && (!purchase.ingredientMovements || purchase.ingredientMovements.length === 0)) ? (
              <p className="py-4 text-center text-sm text-gray-400">Tidak ada pergerakan stok</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className="pb-2 pr-2 font-medium">Item</th>
                      <th className="pb-2 pr-2 font-medium">Tipe</th>
                      <th className="pb-2 pr-2 text-right font-medium">Jumlah</th>
                      <th className="pb-2 pr-2 text-right font-medium">Saldo</th>
                      <th className="pb-2 pr-2 font-medium">Oleh</th>
                      <th className="pb-2 font-medium">Waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchase.movements.map((m) => {
                      const productName =
                        purchase.items.find((i) => i.productId === m.productId)
                          ?.productName ?? m.productId;
                      return (
                      <tr key={m.id} className="border-b last:border-none">
                        <td className="py-2 pr-2">
                          <span className="font-medium">{productName}</span>
                          <Badge variant="secondary" className="ml-2 text-[10px]">Produk</Badge>
                        </td>
                        <td className="py-2 pr-2">
                          <Badge className="bg-green-100 text-green-700 border border-green-200 text-[10px]">IN</Badge>
                        </td>
                        <td className="py-2 pr-2 text-right font-medium tabular-nums text-green-700">
                          +{m.quantity} PCS
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">{m.balanceAfter}</td>
                        <td className="py-2 pr-2 text-gray-500">{m.userName || "—"}</td>
                        <td className="py-2 text-gray-500">
                          {new Date(m.createdAt).toLocaleString("id-ID", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                      );
                    })}
                    {purchase.ingredientMovements?.map((m) => {
                      return (
                      <tr key={`ing-${m.id}`} className="border-b last:border-none">
                        <td className="py-2 pr-2">
                          <span className="font-medium">{m.ingredientName ?? m.ingredientId}</span>
                          <Badge variant="secondary" className="ml-2 text-[10px] bg-blue-50 text-blue-700">Bahan Baku</Badge>
                        </td>
                        <td className="py-2 pr-2">
                          <Badge className="bg-green-100 text-green-700 border border-green-200 text-[10px]">IN</Badge>
                        </td>
                        <td className="py-2 pr-2 text-right font-medium tabular-nums text-green-700">
                          +{m.quantity} {m.baseUnit ?? ""}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">{m.balanceAfter} {m.baseUnit ?? ""}</td>
                        <td className="py-2 pr-2 text-gray-500">{m.userName || "—"}</td>
                        <td className="py-2 text-gray-500">
                          {new Date(m.createdAt).toLocaleString("id-ID", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div>
        <Link
          href="/admin/purchasing/purchases"
          className="text-sm text-brand-primary hover:underline"
        >
          ← Kembali ke daftar pembelian
        </Link>
      </div>
    </div>
  );
}