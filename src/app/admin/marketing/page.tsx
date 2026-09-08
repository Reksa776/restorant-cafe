"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Plus,
  BadgePercent,
} from "lucide-react";
import { toast } from "sonner";
import {
  promoService,
  type AdminPromo,
} from "@/services/promo.service";

// ============================================================
// Marketing (ADMIN) — create/manage tenant-scoped promos (F3).
// Customers see active promos on the menu and claim/use them there.
// ============================================================

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;

interface FormState {
  code: string;
  name: string;
  description: string;
  type: "PERCENT" | "FIXED";
  value: string;
  minOrder: string;
  maxDiscount: string;
  startsAt: string;
  expiresAt: string;
  maxUsage: string;
  perCustomerLimit: string;
}

const emptyForm: FormState = {
  code: "",
  name: "",
  description: "",
  type: "PERCENT",
  value: "",
  minOrder: "0",
  maxDiscount: "",
  startsAt: "",
  expiresAt: "",
  maxUsage: "0",
  perCustomerLimit: "1",
};

export default function MarketingPage() {
  const [promos, setPromos] = useState<AdminPromo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isToggling, setIsToggling] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const loadPromos = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      setPromos(await promoService.getPromos());
    } catch (err) {
      console.error("Failed to load promos:", err);
      setError("Gagal memuat data promo");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPromos(true);
  }, [loadPromos]);

  const handleCreate = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("Kode dan nama promo wajib diisi");
      return;
    }
    setIsSaving(true);
    try {
      await promoService.createPromo({
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        type: form.type,
        value: Number(form.value),
        minOrder: Number(form.minOrder) || 0,
        maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : null,
        startsAt: form.startsAt ? `${form.startsAt}T00:00:00` : null,
        expiresAt: form.expiresAt ? `${form.expiresAt}T23:59:59` : null,
        maxUsage: Number(form.maxUsage) || 0,
        perCustomerLimit: Number(form.perCustomerLimit) || 1,
      });
      toast.success("Promo berhasil dibuat");
      setFormOpen(false);
      setForm(emptyForm);
      await loadPromos(true);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.message;
      toast.error(msg || "Gagal membuat promo");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = async (promo: AdminPromo) => {
    setIsToggling(promo.id);
    try {
      await promoService.setPromoActive(promo.id, !promo.isActive);
      toast.success(promo.isActive ? "Promo dinonaktifkan" : "Promo diaktifkan");
      await loadPromos(true);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.message;
      toast.error(msg || "Gagal mengubah status promo");
    } finally {
      setIsToggling(null);
    }
  };

  const set = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Marketing</h1>
          <p className="text-gray-500">Kelola promo &amp; voucher pelanggan</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadPromos()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Buat Promo
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <p className="text-gray-600">{error}</p>
          <Button variant="outline" onClick={() => loadPromos()}>
            Coba Lagi
          </Button>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Daftar Promo</CardTitle>
          </CardHeader>
          <CardContent>
            {promos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-3 text-center">
                <BadgePercent className="h-10 w-10 text-gray-300" />
                <p className="text-gray-500">
                  Belum ada promo. Buat promo pertama untuk pelanggan Anda.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {promos.map((promo) => {
                  const discountLabel =
                    promo.type === "PERCENT"
                      ? `Diskon ${promo.value}%${
                          promo.maxDiscount
                            ? ` · maks ${rupiah(promo.maxDiscount)}`
                            : ""
                        }`
                      : `Diskon ${rupiah(promo.value)}`;
                  return (
                    <div
                      key={promo.id}
                      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b pb-3 last:border-0"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{promo.name}</p>
                          <span className="text-[10px] font-mono font-semibold bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                            {promo.code}
                          </span>
                          <Badge
                            className={
                              promo.isActive
                                ? "bg-green-100 text-green-800"
                                : "bg-gray-200 text-gray-600"
                            }
                          >
                            {promo.isActive ? "Aktif" : "Nonaktif"}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {discountLabel}
                          {promo.minOrder > 0 &&
                            ` · Min. order ${rupiah(promo.minOrder)}`}
                          {promo.expiresAt &&
                            ` · s.d. ${new Date(promo.expiresAt).toLocaleDateString("id-ID")}`}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {promo.usageCount} dipakai · {promo.claimCount} diklaim
                          {promo.maxUsage > 0 && ` · Kuota ${promo.maxUsage}`}
                        </p>
                      </div>
                      <Button
                        variant={promo.isActive ? "outline" : "secondary"}
                        size="sm"
                        disabled={isToggling === promo.id}
                        onClick={() => handleToggle(promo)}
                      >
                        {isToggling === promo.id && (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        )}
                        {promo.isActive ? "Nonaktifkan" : "Aktifkan"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create promo dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle className="text-lg">Buat Promo Baru</DialogTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Kode <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => set("code", e.target.value.toUpperCase())}
                placeholder="HEMAT10"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nama <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Diskon 10%"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Deskripsi
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Tampil di halaman menu pelanggan"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tipe
              </label>
              <select
                value={form.type}
                onChange={(e) =>
                  set("type", e.target.value as "PERCENT" | "FIXED")
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                <option value="PERCENT">Persen (%)</option>
                <option value="FIXED">Nominal (Rp)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.type === "PERCENT" ? "Nilai (%)" : "Nilai (Rp)"}{" "}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={form.value}
                onChange={(e) => set("value", e.target.value)}
                min={form.type === "PERCENT" ? 1 : 1}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Min. Order (Rp)
              </label>
              <input
                type="number"
                value={form.minOrder}
                onChange={(e) => set("minOrder", e.target.value)}
                min={0}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Maks. Diskon (Rp, opsional)
              </label>
              <input
                type="number"
                value={form.maxDiscount}
                onChange={(e) => set("maxDiscount", e.target.value)}
                min={0}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mulai
              </label>
              <input
                type="date"
                value={form.startsAt}
                onChange={(e) => set("startsAt", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Berakhir
              </label>
              <input
                type="date"
                value={form.expiresAt}
                onChange={(e) => set("expiresAt", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Kuota Global (0 = tanpa batas)
              </label>
              <input
                type="number"
                value={form.maxUsage}
                onChange={(e) => set("maxUsage", e.target.value)}
                min={0}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Batas per Customer
              </label>
              <input
                type="number"
                value={form.perCustomerLimit}
                onChange={(e) => set("perCustomerLimit", e.target.value)}
                min={0}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleCreate} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Simpan Promo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}