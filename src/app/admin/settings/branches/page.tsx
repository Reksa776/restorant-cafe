"use client";

import { useCallback, useEffect, useState } from "react";
import { branchService, type Branch } from "@/services/branch.service";
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
};

const EMPTY_FORM: BranchForm = { code: "", name: "", address: "", phone: "" };

export default function BranchSettingsPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await branchService.getBranches();
      setBranches(items);
    } catch (err) {
      console.error("Failed to load branches:", err);
      toast.error("Gagal memuat cabang");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
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
              disabled={saving || codeInvalid || nameInvalid}
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
              disabled={saving || codeInvalid || nameInvalid}
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