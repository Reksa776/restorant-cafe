"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  expenseService,
  expenseExportUrl,
  type Expense,
  type ExpenseCategory,
  type ExpenseMethod,
} from "@/services/expense.service";
import { normalizeApiError } from "@/lib/api-error-handler";
import { useBranchContext } from "@/hooks/use-branch-context";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  Download,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

const METHOD_OPTIONS: Array<{ value: ExpenseMethod; label: string }> = [
  { value: "CASH", label: "Tunai" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "QRIS", label: "QRIS" },
  { value: "CARD", label: "Kartu" },
  { value: "OTHER", label: "Lainnya" },
];

const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  METHOD_OPTIONS.map((m) => [m.value, m.label])
);

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStartStr = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};
const formatDay = (v: string) =>
  new Date(`${v}T00:00:00`).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

interface ExpenseForm {
  categoryId: string;
  amount: string;
  spentAt: string;
  method: ExpenseMethod;
  note: string;
  branchId: string;
}

const EMPTY_FORM = (branchId: string): ExpenseForm => ({
  categoryId: "",
  amount: "",
  spentAt: todayStr(),
  method: "CASH",
  note: "",
  branchId,
});

export default function ExpensesPage() {
  const { role, isLoading: roleLoading } = useUserRole();
  const isAdmin = role === "ADMIN";
  const {
    branches,
    branchId: currentBranchId,
    isLoading: branchCtxLoading,
  } = useBranchContext();

  // ---- list state ----
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<{
    totalAmount: number;
    count: number;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // ---- filters (date + category + method) ----
  const [dateFrom, setDateFrom] = useState(monthStartStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");

  // ---- reference data ----
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);

  // ---- expense form ----
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseForm>(EMPTY_FORM(""));
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);

  // ---- category manager ----
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [catSaving, setCatSaving] = useState(false);

  const activeCategories = useMemo(
    () => categories.filter((c) => c.isActive),
    [categories]
  );

  const defaultBranchId = currentBranchId ?? branches[0]?.id ?? "";

  const loadCategories = useCallback(async () => {
    try {
      const res = await expenseService.listCategories();
      setCategories(res.items);
    } catch (err) {
      console.error("Failed to load expense categories:", err);
    }
  }, []);

  const loadExpenses = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await expenseService.list({
          page,
          limit: 50,
          dateFrom,
          dateTo,
          categoryId: categoryFilter === "all" ? undefined : categoryFilter,
          method:
            methodFilter === "all" ? undefined : (methodFilter as ExpenseMethod),
        });
        setExpenses(res.items);
        setSummary({
          totalAmount: res.summary.totalAmount,
          count: res.summary.count,
        });
        setTotal(res.total);
        setTotalPages(res.totalPages);
      } catch (err) {
        console.error("Failed to load expenses:", err);
        setError(normalizeApiError(err).message);
      } finally {
        setLoading(false);
      }
    },
    [page, dateFrom, dateTo, categoryFilter, methodFilter]
  );

  useEffect(() => {
    if (branchCtxLoading || roleLoading) return;
    if (!isAdmin) return;
    loadCategories();
    loadExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchCtxLoading, roleLoading, isAdmin]);

  useEffect(() => {
    if (branchCtxLoading || roleLoading) return;
    if (!isAdmin) return;
    loadExpenses(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, dateFrom, dateTo, categoryFilter, methodFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...EMPTY_FORM(defaultBranchId),
      categoryId: activeCategories[0]?.id ?? "",
    });
    setDialogOpen(true);
  };

  const openEdit = (e: Expense) => {
    setEditing(e);
    setForm({
      categoryId: e.categoryId,
      amount: String(e.amount),
      spentAt: e.spentAt,
      method: e.method,
      note: e.note ?? "",
      branchId: e.branchId,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (saveInFlight.current) return;
    if (!form.categoryId) {
      toast.error("Kategori wajib dipilih");
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Nominal harus lebih dari 0");
      return;
    }
    if (!form.spentAt) {
      toast.error("Tanggal wajib diisi");
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    try {
      if (editing) {
        await expenseService.update(editing.id, {
          categoryId: form.categoryId,
          amount,
          spentAt: form.spentAt,
          method: form.method,
          note: form.note.trim() || null,
        });
        toast.success("Pengeluaran diperbarui");
      } else {
        await expenseService.create({
          branchId: form.branchId || undefined,
          categoryId: form.categoryId,
          amount,
          spentAt: form.spentAt,
          method: form.method,
          note: form.note.trim() || null,
        });
        toast.success("Pengeluaran berhasil dicatat");
      }
      setDialogOpen(false);
      setEditing(null);
      loadExpenses();
    } catch (err) {
      console.error("Failed to save expense:", err);
      toast.error(normalizeApiError(err).message);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async (e: Expense) => {
    if (
      !window.confirm(
        `Hapus pengeluaran ${rupiah(e.amount)} (${e.categoryName ?? "tanpa kategori"}) pada ${formatDay(e.spentAt)}?`
      )
    ) {
      return;
    }
    try {
      await expenseService.remove(e.id);
      toast.success("Pengeluaran dihapus");
      loadExpenses();
    } catch (err) {
      console.error("Failed to delete expense:", err);
      toast.error(normalizeApiError(err).message);
    }
  };

  const handleCreateCategory = async () => {
    const name = newCatName.trim();
    if (!name) {
      toast.error("Nama kategori wajib diisi");
      return;
    }
    setCatSaving(true);
    try {
      await expenseService.createCategory(name);
      toast.success("Kategori ditambahkan");
      setNewCatName("");
      loadCategories();
    } catch (err) {
      console.error("Failed to create category:", err);
      toast.error(normalizeApiError(err).message);
    } finally {
      setCatSaving(false);
    }
  };

  const handleToggleCategory = async (c: ExpenseCategory) => {
    try {
      await expenseService.updateCategory(c.id, { isActive: !c.isActive });
      loadCategories();
    } catch (err) {
      console.error("Failed to toggle category:", err);
      toast.error(normalizeApiError(err).message);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const url = expenseExportUrl({
        dateFrom,
        dateTo,
        categoryId: categoryFilter === "all" ? undefined : categoryFilter,
        method: methodFilter === "all" ? undefined : (methodFilter as ExpenseMethod),
      });
      const res = await fetch(url, {
        credentials: "same-origin",
        headers: currentBranchId ? { "x-branch-id": currentBranchId } : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Gagal mengekspor data");
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `expense-report-${todayStr()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error("Failed to export:", err);
      toast.error(err instanceof Error ? err.message : "Gagal mengekspor data");
    } finally {
      setIsExporting(false);
    }
  };

  if (!roleLoading && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3">
        <AlertCircle className="h-10 w-10 text-red-500" />
        <p className="text-gray-600">Halaman ini hanya untuk admin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pengeluaran</h1>
          <p className="text-gray-500">
            Catat biaya operasional restoran (bukan COGS/pembelian)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCatDialogOpen(true)}>
            <Settings2 className="mr-2 h-4 w-4" />
            Kategori
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Tambah Pengeluaran
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="expFrom" className="text-xs text-gray-500">
                Dari
              </Label>
              <input
                id="expFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="expTo" className="text-xs text-gray-500">
                Sampai
              </Label>
              <input
                id="expTo"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>

            <div className="space-y-1">
              <span className="text-xs text-gray-500">Kategori</span>
              <Select
                value={categoryFilter}
                onValueChange={(v) => {
                  if (v !== null) {
                    setCategoryFilter(v);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger className="w-[180px] h-9 text-sm">
                  <SelectValue>
                    {categoryFilter === "all"
                      ? "Semua Kategori"
                      : categories.find((c) => c.id === categoryFilter)?.name ??
                        "Semua Kategori"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kategori</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {!c.isActive ? " (nonaktif)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-gray-500">Metode</span>
              <Select
                value={methodFilter}
                onValueChange={(v) => {
                  if (v !== null) {
                    setMethodFilter(v);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger className="w-[150px] h-9 text-sm">
                  <SelectValue>
                    {methodFilter === "all"
                      ? "Semua Metode"
                      : METHOD_LABEL[methodFilter] ?? "Semua Metode"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Metode</SelectItem>
                  {METHOD_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadExpenses()}
                disabled={loading}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
              <Button size="sm" onClick={handleExport} disabled={isExporting}>
                {isExporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Pengeluaran (filter)
              </CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {rupiah(summary.totalAmount)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Jumlah Transaksi
              </CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.count}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Periode
              </CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-sm font-medium">
                {formatDay(dateFrom)} — {formatDay(dateTo)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Daftar Pengeluaran ({total})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <AlertCircle className="h-9 w-9 text-red-500" />
              <p className="text-gray-600">{error}</p>
              <Button variant="outline" onClick={() => loadExpenses()}>
                Coba Lagi
              </Button>
            </div>
          ) : expenses.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">
              Belum ada pengeluaran pada filter ini.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Cabang</TableHead>
                      <TableHead>Metode</TableHead>
                      <TableHead>Catatan</TableHead>
                      <TableHead className="text-right">Nominal</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDay(e.spentAt)}
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">
                            {e.categoryName ?? "—"}
                          </span>
                          {!e.categoryActive && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                              nonaktif
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {e.branchCode
                            ? `${e.branchCode} (${e.branchName})`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-sm">{e.methodLabel}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm text-gray-500">
                          {e.note || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {rupiah(e.amount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEdit(e)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(e)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 mt-4 border-t">
                  <p className="text-xs text-gray-500">
                    Halaman {page} dari {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Sebelumnya
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Berikutnya
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Expense form dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Pengeluaran" : "Tambah Pengeluaran"}
            </DialogTitle>
            <DialogDescription>
              Catat biaya operasional. Pembelian bahan baku tidak dicatat di sini.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {branches.length > 0 && (
              <div>
                <Label htmlFor="expBranch">Cabang *</Label>
                <Select
                  value={form.branchId}
                  onValueChange={(v) => {
                    if (v !== null) setForm((f) => ({ ...f, branchId: v }));
                  }}
                >
                  <SelectTrigger id="expBranch" className="w-full">
                    <SelectValue>
                      {branches.find((b) => b.id === form.branchId)?.name ??
                        "Pilih cabang"}
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
            )}

            <div>
              <Label htmlFor="expCategory">Kategori *</Label>
              <Select
                value={form.categoryId}
                onValueChange={(v) => {
                  if (v !== null) setForm((f) => ({ ...f, categoryId: v }));
                }}
              >
                <SelectTrigger id="expCategory" className="w-full">
                  <SelectValue>
                    {activeCategories.find((c) => c.id === form.categoryId)?.name ??
                      "Pilih kategori"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeCategories.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500">
                      Belum ada kategori. Tambahkan melalui tombol Kategori.
                    </div>
                  ) : (
                    activeCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="expAmount">Nominal *</Label>
                <Input
                  id="expAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, amount: e.target.value }))
                  }
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="expDate">Tanggal *</Label>
                <Input
                  id="expDate"
                  type="date"
                  value={form.spentAt}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, spentAt: e.target.value }))
                  }
                />
              </div>
            </div>

            <div>
              <Label htmlFor="expMethod">Metode Pembayaran</Label>
              <Select
                value={form.method}
                onValueChange={(v) => {
                  if (v !== null)
                    setForm((f) => ({ ...f, method: v as ExpenseMethod }));
                }}
              >
                <SelectTrigger id="expMethod" className="w-full">
                  <SelectValue>{METHOD_LABEL[form.method]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {METHOD_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="expNote">Catatan</Label>
              <Textarea
                id="expNote"
                value={form.note}
                onChange={(e) =>
                  setForm((f) => ({ ...f, note: e.target.value }))
                }
                placeholder="Keterangan opsional"
                rows={2}
              />
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
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category manager dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kelola Kategori Pengeluaran</DialogTitle>
            <DialogDescription>
              Kategori berlaku untuk seluruh cabang restoran ini.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Nama kategori baru"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateCategory();
                }}
              />
              <Button onClick={handleCreateCategory} disabled={catSaving}>
                {catSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>

            {categories.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400">
                Belum ada kategori.
              </p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {categories.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          c.isActive ? "font-medium" : "text-gray-400 line-through"
                        }
                      >
                        {c.name}
                      </span>
                      <span className="text-xs text-gray-400">
                        {c.expenseCount} transaksi
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleCategory(c)}
                    >
                      {c.isActive ? "Nonaktifkan" : "Aktifkan"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
