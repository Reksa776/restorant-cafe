"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  supplierService,
  type Supplier,
} from "@/services/supplier.service";
import { useUserRole } from "@/hooks/use-user-role";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, Search, UserRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";

function apiErrorMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof msg === "string" && msg.trim() ? msg : fallback;
}

interface SupplierForm {
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

const EMPTY_FORM: SupplierForm = {
  name: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
};

export default function SuppliersPage() {
  const { role, isLoading: roleLoading } = useUserRole();
  const isAdmin = role === "ADMIN";

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const saveInFlight = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await supplierService.list({ search: search.trim() || undefined });
      setSuppliers(result.items);
    } catch (error) {
      console.error("Failed to load suppliers:", error);
      toast.error(apiErrorMessage(error, "Gagal memuat supplier"));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!roleLoading) load();
    }, 250);
    return () => clearTimeout(t);
  }, [load, roleLoading]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      name: s.name,
      phone: s.phone ?? "",
      email: s.email ?? "",
      address: s.address ?? "",
      notes: s.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (saveInFlight.current) return;
    if (!form.name.trim()) {
      toast.error("Nama supplier wajib diisi");
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    try {
      if (editing) {
        await supplierService.update(editing.id, {
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          notes: form.notes.trim() || null,
        });
        toast.success("Supplier berhasil diperbarui");
      } else {
        await supplierService.create({
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          notes: form.notes.trim() || null,
        });
        toast.success("Supplier berhasil ditambahkan");
      }
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setEditing(null);
      load();
    } catch (error) {
      console.error("Failed to save supplier:", error);
      toast.error(apiErrorMessage(error, "Gagal menyimpan supplier"));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const handleToggle = async (s: Supplier) => {
    if (!window.confirm(s.isActive ? "Nonaktifkan supplier ini?" : "Aktifkan supplier ini?")) return;
    setToggling(s.id);
    try {
      await supplierService.update(s.id, { isActive: !s.isActive });
      toast.success(s.isActive ? "Supplier dinonaktifkan" : "Supplier diaktifkan");
      load();
    } catch (error) {
      console.error("Failed to toggle supplier:", error);
      toast.error(apiErrorMessage(error, "Gagal mengubah status supplier"));
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Supplier</h1>
          <p className="text-gray-500">Kelola pemasok bahan baku restoran</p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            Tambah Supplier
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Daftar Supplier</CardTitle>
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama supplier..."
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : suppliers.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              Belum ada supplier. {isAdmin ? "Klik \"Tambah Supplier\" untuk memulai." : ""}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead>Kontak</TableHead>
                    <TableHead>Alamat</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((s) => (
                    <TableRow key={s.id} className={!s.isActive ? "opacity-60" : ""}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserRound className="h-4 w-4 text-gray-400" />
                          <span className="font-medium">{s.name}</span>
                        </div>
                        {s.notes && (
                          <p className="mt-0.5 max-w-xs truncate text-xs text-gray-400">{s.notes}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.phone && <p className="text-sm">{s.phone}</p>}
                        {s.email && (
                          <p className="text-xs text-gray-400">{s.email}</p>
                        )}
                        {!s.phone && !s.email && (
                          <p className="text-xs text-gray-400">—</p>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-sm text-gray-500">
                        {s.address || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={s.isActive ? "default" : "secondary"}
                          className={s.isActive ? "bg-green-100 text-green-700 border border-green-200" : ""}
                        >
                          {s.isActive ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isAdmin ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEdit(s)}>
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={toggling === s.id}
                              onClick={() => handleToggle(s)}
                            >
                              {toggling === s.id ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                              ) : s.isActive ? (
                                "Nonaktif"
                              ) : (
                                "Aktif"
                              )}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">Read-only</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Supplier" : "Tambah Supplier"}</DialogTitle>
            <DialogDescription>
              {editing ? "Perbarui informasi pemasok" : "Tambahkan pemasok baru"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="supName">Nama *</Label>
              <Input
                id="supName"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nama supplier"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="supPhone">Telepon</Label>
                <Input
                  id="supPhone"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="08xx"
                />
              </div>
              <div>
                <Label htmlFor="supEmail">Email</Label>
                <Input
                  id="supEmail"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="email@example.com"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="supAddress">Alamat</Label>
              <Textarea
                id="supAddress"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Alamat supplier"
                rows={2}
              />
            </div>
            <div>
              <Label htmlFor="supNotes">Catatan</Label>
              <Textarea
                id="supNotes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Catatan tambahan"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}