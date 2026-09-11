"use client";

import { useCallback, useEffect, useState } from "react";
import {
  stockMovementService,
  type StockMovementRow,
  type StockMovementType,
} from "@/services/stock-movement.service";
import { menuService } from "@/services/menu.service";
import { useBranchContext } from "@/hooks/use-branch-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

function apiErrorMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof msg === "string" && msg.trim() ? msg : fallback;
}

type Flow = "ALL" | StockMovementType;

function typeBadge(type: StockMovementType) {
  if (type === "IN") {
    return <Badge className="bg-green-100 text-green-700 border border-green-200">Masuk</Badge>;
  }
  if (type === "OUT") {
    return <Badge className="bg-red-100 text-red-700 border border-red-200">Keluar</Badge>;
  }
  return <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50">Penyesuaian</Badge>;
}

export default function InventoryPage() {
  const { branchId, branches, isLoading: ctxLoading } = useBranchContext();

  const [rows, setRows] = useState<StockMovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);

  const [filterBranch, setFilterBranch] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [filterType, setFilterType] = useState<Flow>("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const workingBranchId = branchId ?? (branches.length === 1 ? branches[0].id : null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await stockMovementService.list({
        branchId: filterBranch || workingBranchId || undefined,
        productId: filterProduct || undefined,
        type: filterType === "ALL" ? undefined : filterType,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        limit: 500,
      });
      setRows(result.items);
      setTotal(result.total);
    } catch (error) {
      console.error("Failed to load stock movements:", error);
      toast.error(apiErrorMessage(error, "Gagal memuat pergerakan stok"));
    } finally {
      setLoading(false);
    }
  }, [filterBranch, filterProduct, filterType, workingBranchId, startDate, endDate]);

  useEffect(() => {
    if (ctxLoading) return;
    const t = setTimeout(() => {
      menuService
        .getProducts()
        .then((prods) => setProducts(prods.map((p) => ({ id: p.id, name: p.name }))))
        .catch(() => {});
    }, 250);
    const t2 = setTimeout(load, 300);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [load, ctxLoading]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Inventory</h1>
        <p className="text-gray-500">
          Riwayat pergerakan stok: pembelian diterima, pesanan selesai, dan penyesuaian manual
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3">
            <CardTitle className="text-base">Riwayat Stok</CardTitle>
            <div className="grid grid-cols-2 gap-3 lg:flex lg:items-end">
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Jenis</Label>
                <Select value={filterType} onValueChange={(v) => setFilterType(v as Flow)}>
                  <SelectTrigger size="sm" className="w-full lg:w-36">
                    <SelectValue>
                      {filterType === "ALL"
                        ? "Semua"
                        : filterType === "IN"
                          ? "Masuk"
                          : filterType === "OUT"
                            ? "Keluar"
                            : "Penyesuaian"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Semua</SelectItem>
                    <SelectItem value="IN">Masuk</SelectItem>
                    <SelectItem value="OUT">Keluar</SelectItem>
                    <SelectItem value="ADJUSTMENT">Penyesuaian</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Cabang</Label>
                <Select value={filterBranch} onValueChange={(v) => setFilterBranch(v || "")}>
                  <SelectTrigger size="sm" className="w-full lg:w-40">
                    <SelectValue>
                      {branches.find((b) => b.id === filterBranch)?.name ??
                        "Semua cabang"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Semua cabang</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Produk</Label>
                <Select value={filterProduct} onValueChange={(v) => setFilterProduct(v || "")}>
                  <SelectTrigger size="sm" className="w-full lg:w-44">
                    <SelectValue>
                      {products.find((p) => p.id === filterProduct)?.name ??
                        "Semua produk"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Semua produk</SelectItem>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Dari</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Sampai</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              Belum ada pergerakan stok.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Produk</TableHead>
                    <TableHead>Cabang</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                    <TableHead className="text-right">Saldo Akhir</TableHead>
                    <TableHead>Referensi</TableHead>
                    <TableHead>Alasan</TableHead>
                    <TableHead>Oleh</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-xs text-gray-500">
                        {new Date(m.createdAt).toLocaleString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{m.productName || m.productId}</TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {m.branchCode ? `${m.branchCode} (${m.branchName})` : "—"}
                      </TableCell>
                      <TableCell>{typeBadge(m.type)}</TableCell>
                      <TableCell className={`text-right font-medium tabular-nums ${m.quantity < 0 ? "text-red-600" : "text-green-700"}`}>
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.balanceAfter}</TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {m.refType ? (
                          <span className="font-mono">
                            {m.refType}
                            {m.refId ? ` · ${m.refId.slice(-8).toUpperCase()}` : ""}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate text-sm text-gray-500">
                        {m.reason || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">{m.userName || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-gray-400">
            Menampilkan {rows.length} dari {total} pergerakan
          </p>
        </CardContent>
      </Card>
    </div>
  );
}