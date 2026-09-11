"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ingredientService,
  type Ingredient,
} from "@/services/ingredient.service";
import { useUserRole } from "@/hooks/use-user-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Leaf,
} from "lucide-react";
import { toast } from "sonner";

const UNITS = ["PCS", "GRAM", "KG", "ML", "LITER"] as const;

const UNIT_LABELS: Record<string, string> = {
  PCS: "Pcs",
  GRAM: "Gram",
  KG: "Kg",
  ML: "Ml",
  LITER: "Liter",
};

export default function IngredientsPage() {
  const { role, isLoading: roleLoading } = useUserRole();
  const isAdmin = role === "ADMIN";

  const [items, setItems] = useState<Ingredient[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState("");
  const [filterActive, setFilterActive] = useState<string>("");

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [formName, setFormName] = useState("");
  const [formUnit, setFormUnit] = useState("PCS");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ingredientService.list({
        page,
        limit: 20,
        search: search || undefined,
        isActive: filterActive || undefined,
      });
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (error) {
      console.error("Failed to load ingredients:", error);
      toast.error("Gagal memuat bahan baku");
    } finally {
      setLoading(false);
    }
  }, [page, search, filterActive]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormUnit("PCS");
    setDialogOpen(true);
  };

  const openEdit = (item: Ingredient) => {
    setEditing(item);
    setFormName(item.name);
    setFormUnit(item.baseUnit);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error("Nama bahan baku wajib diisi");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await ingredientService.update(editing.id, {
          name: formName.trim(),
          baseUnit: formUnit,
        });
        toast.success("Bahan baku berhasil diupdate");
      } else {
        await ingredientService.create({
          name: formName.trim(),
          baseUnit: formUnit,
        });
        toast.success("Bahan baku berhasil dibuat");
      }
      setDialogOpen(false);
      load();
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Gagal menyimpan bahan baku";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (item: Ingredient) => {
    try {
      await ingredientService.update(item.id, { isActive: !item.isActive });
      toast.success(
        item.isActive
          ? "Bahan baku dinonaktifkan"
          : "Bahan baku diaktifkan"
      );
      load();
    } catch {
      toast.error("Gagal mengubah status");
    }
  };

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Bahan Baku</h1>
          <p className="text-gray-500">Kelola daftar bahan baku restoran</p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" /> Tambah Bahan Baku
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs text-gray-500">Cari</Label>
              <Input
                placeholder="Nama bahan baku..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Status</Label>
              <Select
                value={filterActive || "all"}
                onValueChange={(v: string | null) => {
                  setFilterActive(v === "all" || !v ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-36 h-9">
                  <SelectValue>
                    {filterActive === ""
                      ? "Semua"
                      : filterActive === "true"
                        ? "Aktif"
                        : "Nonaktif"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  <SelectItem value="true">Aktif</SelectItem>
                  <SelectItem value="false">Nonaktif</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center">
              <Leaf className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Belum ada bahan baku</p>
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={openCreate}
                >
                  <Plus className="h-4 w-4 mr-1" /> Tambah Bahan Baku
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama</TableHead>
                      <TableHead>Satuan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Branch</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {UNIT_LABELS[item.baseUnit] || item.baseUnit}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              item.isActive
                                ? "bg-green-100 text-green-700 border-green-200"
                                : "bg-gray-100 text-gray-500"
                            }
                          >
                            {item.isActive ? "Aktif" : "Nonaktif"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm text-gray-500">
                          {item.branchCount} cabang
                        </TableCell>
                        <TableCell className="text-right">
                          {isAdmin && (
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEdit(item)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleActive(item)}
                              >
                                {item.isActive ? (
                                  <ToggleRight className="h-4 w-4 text-green-600" />
                                ) : (
                                  <ToggleLeft className="h-4 w-4 text-gray-400" />
                                )}
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-gray-500">
                    {total} bahan baku
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Bahan Baku" : "Tambah Bahan Baku"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Ubah informasi bahan baku"
                : "Tambahkan bahan baku baru ke daftar"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Nama</Label>
              <Input
                id="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Contoh: Daging Sapi, Tomat, Minyak Goreng"
              />
            </div>
            <div>
              <Label htmlFor="unit">Satuan Dasar</Label>
              <Select value={formUnit} onValueChange={(v: string | null) => { if (v) setFormUnit(v); }}>
                <SelectTrigger>
                  <SelectValue>
                    {UNIT_LABELS[formUnit] || formUnit}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {UNIT_LABELS[u]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setDialogOpen(false)}
            >
              Batal
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
