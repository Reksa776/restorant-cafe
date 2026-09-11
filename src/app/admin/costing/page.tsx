"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useBranchContext } from "@/hooks/use-branch-context";
import { menuService, type Category } from "@/services/menu.service";
import {
  costingService,
  type CostStatus,
  type CostingDetail,
  type CostingItem,
  type CostingListItem,
} from "@/services/costing.service";

function formatRupiah(n: number): string {
  return "Rp" + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n);
}

function formatPct(s: string | null): string {
  if (s == null) return "—";
  const num = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(
    Number(s)
  );
  return `${num}%`;
}

const statusLabels: Record<CostStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  COMPLETE: { label: "Complete", variant: "default" },
  INCOMPLETE: { label: "Incomplete", variant: "destructive" },
  NO_RECIPE: { label: "No Recipe", variant: "secondary" },
};

function StatusBadge({ status }: { status: CostStatus }) {
  const { label, variant } = statusLabels[status];
  return <Badge variant={variant}>{label}</Badge>;
}

// ============================================================
// Detail dialog — product summary + recipe cost lines.
// Never shows supplier / purchase / stock.
// ============================================================
function CostingDetailDialog({
  open,
  onOpenChange,
  productId,
  branchId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string | null;
  branchId: string | null;
}) {
  const [detail, setDetail] = useState<CostingDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !productId || !branchId) {
      setDetail(null);
      return;
    }
    let alive = true;
    setLoading(true);
    costingService
      .detail(productId, branchId)
      .then((res) => {
        if (alive) setDetail(res);
      })
      .catch((err) => {
        console.error("Failed to load costing detail:", err);
        toast.error("Gagal memuat detail costing");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, productId, branchId]);

  const num = (s: string | null): number | null => (s == null ? null : Number(s));
  const rupiah = (s: string | null): string => {
    const n = num(s);
    return n == null ? "—" : formatRupiah(n);
  };

  const summary: Array<{ label: string; value: string }> = detail
    ? [
        { label: "Selling Price", value: rupiah(detail.sellingPrice) },
        { label: "HPP", value: rupiah(detail.hpp) },
        { label: "Gross Profit", value: rupiah(detail.grossProfit) },
        { label: "Gross Margin", value: formatPct(detail.grossMarginPct) },
        { label: "Food Cost", value: formatPct(detail.foodCostPct) },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {detail ? (
              <>
                {detail.name}
                <span className="ml-2 align-middle">
                  <StatusBadge status={detail.costStatus} />
                </span>
              </>
            ) : (
              "Costing Detail"
            )}
          </DialogTitle>
          <DialogDescription>
            {detail ? detail.categoryName : "Memuat detail..."}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat...
          </div>
        )}

        {!loading && detail && (
          <div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-3">
              {summary.map((row) => (
                <div key={row.label}>
                  <dt className="text-xs text-gray-500">{row.label}</dt>
                  <dd className="mt-0.5 font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>

            <h4 className="mt-5 mb-2 text-sm font-semibold">RECIPE COST</h4>
            {detail.items.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-gray-500">
                Produk tidak memiliki recipe aktif.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ingredient</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">WAC</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((item) => (
                    <CostingItemRow key={item.ingredientId} item={item} />
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CostingItemRow({ item }: { item: CostingItem }) {
  const missing =
    item.missingReason === "MISSING_WAC"
      ? "WAC belum tersedia"
      : item.missingReason === "INACTIVE_INGREDIENT"
        ? "Ingredient tidak aktif"
        : null;

  return (
    <TableRow>
      <TableCell>
        <div>{item.ingredientName}</div>
        {missing && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            {missing}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right">{item.quantity}</TableCell>
      <TableCell>{item.unit}</TableCell>
      <TableCell className="text-right">
        {item.wac == null ? "—" : formatRupiah(Number(item.wac))}
      </TableCell>
      <TableCell className="text-right">
        {item.cost == null ? "—" : formatRupiah(Number(item.cost))}
      </TableCell>
    </TableRow>
  );
}

// ============================================================
// Page — PRODUCT COSTING
// ============================================================
export default function CostingPage() {
  const { branchId: ctxBranchId, branches, session } = useBranchContext();

  const workingBranchId = useMemo(() => {
    if (ctxBranchId) return ctxBranchId;
    return branches.length > 0 ? branches[0].id : null;
  }, [ctxBranchId, branches]);

  const workingBranch = useMemo(
    () => branches.find((b) => b.id === workingBranchId) ?? null,
    [branches, workingBranchId]
  );

  const defaultedBranch = session?.branchScoped === false && !ctxBranchId && branches.length > 1;

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<CostingListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [status, setStatus] = useState<CostStatus | "">("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  useEffect(() => {
    menuService
      .getCategories()
      .then(setCategories)
      .catch(() => toast.error("Gagal memuat kategori"));
  }, []);

  const load = useCallback(async () => {
    if (!workingBranchId) {
      setItems([]);
      setTotal(0);
      setTotalPages(1);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await costingService.list({
        branchId: workingBranchId,
        page,
        limit: 20,
        categoryId: categoryId || undefined,
        search: search || undefined,
        status: status || undefined,
      });
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      console.error("Failed to load costing:", err);
      setError("Gagal memuat data costing. Silakan coba lagi.");
      setItems([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [workingBranchId, page, categoryId, search, status]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [categoryId, status, search, workingBranchId]);

  const openDetail = (productId: string) => {
    setSelectedProductId(productId);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Product Costing</h1>
        <p className="text-sm text-gray-500">
          HPP saat ini per cabang dari Recipe × WAC — data cost bersifat internal.
        </p>
      </div>

      {defaultedBranch && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Menampilkan costing untuk cabang default:{" "}
            <strong>
              {workingBranch?.name} ({workingBranch?.code})
            </strong>
            . Pilih cabang pada selector di atas untuk melihat cabang lain.
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            Costing
            {workingBranch && (
              <Badge variant="secondary">
                {workingBranch.name} ({workingBranch.code})
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select value={categoryId || "ALL"} onValueChange={(v) => setCategoryId(v == null || v === "ALL" ? "" : v)}>
              <SelectTrigger className="h-9 w-auto min-w-[150px] text-sm">
                <SelectValue placeholder="Semua Kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua Kategori</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={status || "ALL"} onValueChange={(v) => setStatus(v === "ALL" ? "" : (v as CostStatus))}>
              <SelectTrigger className="h-9 w-auto min-w-[130px] text-sm">
                <SelectValue placeholder="Semua Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua Status</SelectItem>
                <SelectItem value="COMPLETE">Complete</SelectItem>
                <SelectItem value="INCOMPLETE">Incomplete</SelectItem>
                <SelectItem value="NO_RECIPE">No Recipe</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                className="h-9 pl-8 text-sm"
                placeholder="Cari produk..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
              <Button variant="outline" size="sm" className="ml-3" onClick={load}>
                Coba lagi
              </Button>
            </div>
          )}

          {/* Table */}
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">HPP</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Food Cost</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-sm text-gray-500">
                      <Loader2 className="mx-auto mb-1 h-5 w-5 animate-spin" />
                      Memuat...
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-sm text-gray-500">
                      {!workingBranch
                        ? "Pilih cabang untuk melihat data costing."
                        : error
                          ? "Terjadi kesalahan saat memuat data."
                          : "Belum ada data costing untuk cabang ini."}
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow
                      key={item.productId}
                      className="cursor-pointer"
                      onClick={() => openDetail(item.productId)}
                    >
                      <TableCell>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-gray-500">{item.categoryName}</div>
                      </TableCell>
                      <TableCell className="text-right">{formatRupiah(Number(item.sellingPrice))}</TableCell>
                      <TableCell className="text-right">
                        {item.hpp == null ? "—" : formatRupiah(Number(item.hpp))}
                      </TableCell>
                      <TableCell className="text-right">{formatPct(item.grossMarginPct)}</TableCell>
                      <TableCell className="text-right">{formatPct(item.foodCostPct)}</TableCell>
                      <TableCell>
                        <StatusBadge status={item.costStatus} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {!loading && items.length > 0 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-gray-500">{total} produk</p>
              {totalPages > 1 && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="self-center text-sm text-gray-500">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <CostingDetailDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        productId={selectedProductId}
        branchId={workingBranchId}
      />
    </div>
  );
}