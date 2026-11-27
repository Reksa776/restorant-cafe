"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { branchService, type Branch } from "@/services/branch.service";
import { billingService } from "@/services/billing.service";
import { refreshBranchContext } from "@/hooks/use-branch-context";
import { toast } from "sonner";
import { Loader2, Plus, Store, Pencil, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BranchForm = {
  code: string;
  name: string;
  address: string;
  phone: string;
  latitude: string;
  longitude: string;
  postalCode: string;
  contactPhone: string;
};

const EMPTY_FORM: BranchForm = {
  code: "",
  name: "",
  address: "",
  phone: "",
  latitude: "",
  longitude: "",
  postalCode: "",
  contactPhone: "",
};

/** Empty input → null (not configured); invalid input → NaN (blocked). */
function parseCoordinate(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number(trimmed.replace(",", "."));
}

function coordinateError(
  value: string,
  label: string,
  min: number,
  max: number
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = parseCoordinate(value);
  if (parsed === null || !Number.isFinite(parsed)) {
    return `${label} harus berupa angka`;
  }
  if (parsed < min || parsed > max) {
    return `${label} harus antara ${min} dan ${max}`;
  }
  return null;
}

/**
 * Courier pickup origin (instant delivery). A branch can only be a delivery
 * origin when BOTH coordinates are set; the API validates the same rules.
 */
function LocationFields({
  idPrefix,
  form,
  onChange,
}: {
  idPrefix: string;
  form: BranchForm;
  onChange: (patch: Partial<BranchForm>) => void;
}) {
  const latError = coordinateError(form.latitude, "Latitude", -90, 90);
  const lngError = coordinateError(form.longitude, "Longitude", -180, 180);

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div>
        <p className="text-sm font-medium">Lokasi Penjemputan Kurir</p>
        <p className="text-[11px] text-muted-foreground">
          Titik asal kurir instan (GrabExpress/Biteship). Isi latitude &amp;
          longitude agar cabang ini bisa melayani delivery.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-latitude`}>Latitude</Label>
          <Input
            id={`${idPrefix}-latitude`}
            inputMode="decimal"
            value={form.latitude}
            onChange={(e) => onChange({ latitude: e.target.value })}
            placeholder="-6.175392"
            aria-invalid={!!latError}
          />
          {latError && <p className="text-xs text-red-500">{latError}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-longitude`}>Longitude</Label>
          <Input
            id={`${idPrefix}-longitude`}
            inputMode="decimal"
            value={form.longitude}
            onChange={(e) => onChange({ longitude: e.target.value })}
            placeholder="106.827152"
            aria-invalid={!!lngError}
          />
          {lngError && <p className="text-xs text-red-500">{lngError}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-postal`}>Kode Pos</Label>
          <Input
            id={`${idPrefix}-postal`}
            value={form.postalCode}
            onChange={(e) => onChange({ postalCode: e.target.value })}
            placeholder="10110"
            maxLength={20}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-contact`}>Telepon Kurir</Label>
          <Input
            id={`${idPrefix}-contact`}
            type="tel"
            value={form.contactPhone}
            onChange={(e) => onChange({ contactPhone: e.target.value })}
            placeholder="081234567890"
            maxLength={30}
          />
        </div>
      </div>
    </div>
  );
}

export default function BranchSettingsPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // Phase 4 — branch quota from the tenant's subscription (display only; the
  // API enforces it with 403 PLAN_LIMIT_REACHED).
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Billing is a progressive enhancement here: a failure must never block
      // the branch list itself.
      const [items, overview] = await Promise.all([
        branchService.getBranches(),
        billingService.getOverview().catch(() => null),
      ]);
      setBranches(items);
      if (overview) {
        setQuota({
          used: overview.usage.branches.used,
          limit: overview.usage.branches.limit,
        });
      }
    } catch (err) {
      console.error("Failed to load branches:", err);
      toast.error("Gagal memuat cabang");
    } finally {
      setLoading(false);
    }
  }, []);

  // Deferred so `load`'s setState calls never run synchronously inside the
  // effect body (cascading-render guard).
  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setCreateOpen(true);
  };

  const openEdit = (branch: Branch) => {
    setEditing(branch);
    setForm({
      code: branch.code,
      name: branch.name,
      address: branch.address ?? "",
      phone: branch.phone ?? "",
      latitude: branch.latitude != null ? String(branch.latitude) : "",
      longitude: branch.longitude != null ? String(branch.longitude) : "",
      postalCode: branch.postalCode ?? "",
      contactPhone: branch.contactPhone ?? "",
    });
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await branchService.createBranch({
        code: form.code.trim(),
        name: form.name.trim(),
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        latitude: parseCoordinate(form.latitude),
        longitude: parseCoordinate(form.longitude),
        postalCode: form.postalCode.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
      });
      toast.success("Cabang berhasil dibuat");
      setCreateOpen(false);
      await load();
      refreshBranchContext();
    } catch (err) {
      toast.error(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.message || "Gagal membuat cabang"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await branchService.updateBranch(editing.id, {
        code: form.code.trim(),
        name: form.name.trim() || undefined,
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        latitude: parseCoordinate(form.latitude),
        longitude: parseCoordinate(form.longitude),
        postalCode: form.postalCode.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
      });
      toast.success("Cabang berhasil diperbarui");
      setEditing(null);
      await load();
      refreshBranchContext();
    } catch (err) {
      toast.error(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.message || "Gagal memperbarui cabang"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (branch: Branch) => {
    try {
      await branchService.setBranchActive(branch.id, !branch.isActive);
      toast.success(
        branch.isActive ? "Cabang dinonaktifkan" : "Cabang diaktifkan"
      );
      await load();
      refreshBranchContext();
    } catch (err) {
      toast.error(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.message || "Gagal mengubah status cabang"
      );
    }
  };

  const codeInvalid =
    form.code.trim() === "" || form.code.trim().length > 20 || /\s/.test(form.code);
  const nameInvalid = form.name.trim().length < 2;
  const locationInvalid =
    coordinateError(form.latitude, "Latitude", -90, 90) !== null ||
    coordinateError(form.longitude, "Longitude", -180, 180) !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cabang</h1>
          <p className="text-muted-foreground">
            Kelola outlet — kode cabang dipakai di QR meja (contoh: /t/JKT/01)
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Tambah Cabang
        </Button>
      </div>

      {quota && (
        <div
          className={`rounded-xl border p-4 ${
            quota.used >= quota.limit
              ? "border-amber-300 bg-amber-50"
              : "border-gray-200 bg-card"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              Kuota cabang:{" "}
              <span className="font-bold">
                terpakai {quota.used} dari {quota.limit} cabang
              </span>
            </p>
            {quota.used >= quota.limit && (
              <Link
                href="/admin/billing"
                className="text-sm font-semibold text-brand-primary hover:underline"
              >
                Beli Add-On Cabang Baru →
              </Link>
            )}
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className={`h-2 rounded-full ${
                quota.used >= quota.limit ? "bg-amber-500" : "bg-brand-primary"
              }`}
              style={{
                width: `${Math.min(
                  100,
                  Math.round((quota.used / Math.max(1, quota.limit)) * 100)
                )}%`,
              }}
            />
          </div>
          {quota.used >= quota.limit && (
            <p className="mt-2 text-xs text-amber-800">
              Kuota cabang penuh. Tambah kuota lewat menu Paket &amp; Billing
              sebelum membuat cabang baru.
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : branches.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
          Belum ada cabang. Tambahkan cabang pertama Anda.
        </div>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {branches.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100">
                  <Store className="h-5 w-5 text-gray-600" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{b.name}</p>
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {b.code}
                    </Badge>
                    {!b.isActive && (
                      <Badge
                        variant="outline"
                        className="text-red-600 border-red-200"
                      >
                        Nonaktif
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {b.address || "Tanpa alamat"}
                    {b.phone ? ` · ${b.phone}` : ""}
                  </p>
                  <p
                    className={`text-xs truncate ${
                      b.latitude != null && b.longitude != null
                        ? "text-emerald-600"
                        : "text-amber-600"
                    }`}
                  >
                    {b.latitude != null && b.longitude != null
                      ? `📍 ${b.latitude}, ${b.longitude} — siap delivery`
                      : "📍 Koordinat belum diisi — delivery nonaktif"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEdit(b)}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleToggleActive(b)}
                >
                  <Power className="h-3.5 w-3.5 mr-1" />
                  {b.isActive ? "Nonaktifkan" : "Aktifkan"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tambah Cabang</DialogTitle>
            <DialogDescription>
              Buat outlet baru. Kode dipakai pada URL QR meja.
            </DialogDescription>
          </DialogHeader>
          {quota && quota.used >= quota.limit && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Kuota cabang penuh ({quota.used}/{quota.limit}).{" "}
              <Link href="/admin/billing" className="font-semibold underline">
                Beli Add-On Cabang Baru
              </Link>{" "}
              untuk menambah kuota sebelum membuat cabang baru.
            </div>
          )}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="branch-code">Kode</Label>
              <Input
                id="branch-code"
                value={form.code}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    code: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="JKT"
                maxLength={20}
                className="font-mono uppercase"
              />
              {codeInvalid && (
                <p className="text-xs text-red-500">
                  Kode wajib diisi, maksimal 20 karakter tanpa spasi.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="branch-name">Nama</Label>
              <Input
                id="branch-name"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Jakarta Pusat"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="branch-address">Alamat</Label>
              <Input
                id="branch-address"
                value={form.address}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, address: e.target.value }))
                }
                placeholder="Jl. Sudirman No. 1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="branch-phone">Telepon</Label>
              <Input
                id="branch-phone"
                value={form.phone}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, phone: e.target.value }))
                }
                placeholder="021-123456"
              />
            </div>
            <LocationFields
              idPrefix="branch"
              form={form}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={saving}
            >
              Batal
            </Button>
                          <Button
                onClick={handleCreate}
                disabled={saving || codeInvalid || nameInvalid || locationInvalid}
              >
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Buat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Cabang</DialogTitle>
            <DialogDescription>
              Perbarui informasi outlet. Mengubah kode akan mengubah URL QR
              meja.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-branch-code">Kode</Label>
              <Input
                id="edit-branch-code"
                value={form.code}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    code: e.target.value.toUpperCase(),
                  }))
                }
                maxLength={20}
                className="font-mono uppercase"
              />
              {codeInvalid && (
                <p className="text-xs text-red-500">
                  Kode wajib diisi, maksimal 20 karakter tanpa spasi.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-branch-name">Nama</Label>
              <Input
                id="edit-branch-name"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-branch-address">Alamat</Label>
              <Input
                id="edit-branch-address"
                value={form.address}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, address: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-branch-phone">Telepon</Label>
              <Input
                id="edit-branch-phone"
                value={form.phone}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, phone: e.target.value }))
                }
              />
            </div>
            <LocationFields
              idPrefix="edit-branch"
              form={form}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              disabled={saving}
            >
              Batal
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={saving || codeInvalid || nameInvalid || locationInvalid}
            >
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}