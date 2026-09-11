"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  purchaseService,
  type PurchaseListItem,
  type PurchaseStatus,
} from "@/services/purchase.service";
import { supplierService } from "@/services/supplier.service";
import { useBranchContext } from "@/hooks/use-branch-context";
import { useUserRole } from "@/hooks/use-user-role";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, PackageOpen, Search } from "lucide-react";
import { toast } from "sonner";

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;

function apiErrorMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof msg === "string" && msg.trim() ? msg : fallback;
}

function statusBadge(status: PurchaseStatus) {
  if (status === "RECEIVED") {
    return <Badge className="bg-green-100 text-green-700 border border-green-200">Diterima</Badge>;
  }
  if (status === "CANCELLED") {
    return <Badge variant="secondary">Dibatalkan</Badge>;
  }
  return <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">Draft</Badge>;
}

export default function PurchasesPage() {
  const { role, isLoading: roleLoading } = useUserRole();
  const isAdmin = role === "ADMIN";
  const { branchId, branches, isLoading: ctxLoading } = useBranchContext();

  const [items, setItems] = useState<PurchaseListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);

  const [status, setStatus] = useState<string>("all");
  const [supplierId, setSupplierId] = useState<string>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const workingBranchId = branchId ?? (branches.length === 1 ? branches[0].id : null);

  const loadSuppliers = useCallback(async () => {
    try {
      const res = await supplierService.list();
      setSuppliers(res.items.map((s) => ({ id: s.id, name: s.name })));
    } catch (error) {
      console.error("Failed to load suppliers:", error);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await purchaseService.list({
        status: status === "all" ? undefined : (status as PurchaseStatus),
        supplierId: supplierId === "all" ? undefined : supplierId,
        branchId: workingBranchId ?? undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      console.error("Failed to load purchases:", error);
      toast.error(apiErrorMessage(error, "Gagal memuat daftar pembelian"));
    } finally {
      setLoading(false);
    }
  }, [status, supplierId, workingBranchId, startDate, endDate]);

  useEffect(() => {
    if (roleLoading || ctxLoading) return;
    loadSuppliers();
  }, [roleLoading, ctxLoading, loadSuppliers]);

  useEffect(() => {
    if (roleLoading || ctxLoading) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, roleLoading, ctxLoading]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pembelian</h1>
          <p className="text-gray-500">Kelola transaksi pembelian barang</p>
        </div>
        {isAdmin && (
          <Link
            href="/admin/purchasing/purchases/new"
            className={cn(buttonVariants({ variant: "default" }), "w-full sm:w-auto")}
          >
            <Plus className="mr-1 h-4 w-4" />
            Buat Pembelian
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <CardTitle className="text-base">Daftar Pembelian</CardTitle>
            <div className="grid grid-cols-2 gap-3 lg:flex lg:items-end">
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v || "all")}>
                  <SelectTrigger size="sm" className="w-full lg:w-36">
                    <SelectValue>
                      {status === "all"
                        ? "Semua"
                        : status === "DRAFT"
                          ? "Draft"
                          : status === "RECEIVED"
                            ? "Diterima"
                            : "Dibatalkan"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua</SelectItem>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="RECEIVED">Diterima</SelectItem>
                    <SelectItem value="CANCELLED">Dibatalkan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Supplier</Label>
                <Select value={supplierId} onValueChange={(v) => setSupplierId(v || "all")}>
                  <SelectTrigger size="sm" className="w-full lg:w-44">
                    <SelectValue>
                      {suppliers.find((s) => s.id === supplierId)?.name ??
                        "Semua"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
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
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              Belum ada pembelian. {isAdmin ? "Klik \"Buat Pembelian\" untuk memulai." : ""}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pembelian</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Cabang</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Dibuat</TableHead>
                    <TableHead>Diterima</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link
                          href={`/admin/purchasing/purchases/${p.id}`}
                          className="flex items-center gap-2 font-medium text-brand-primary hover:underline"
                        >
                          <PackageOpen className="h-4 w-4 text-gray-400" />
                          <span className="font-mono text-xs">
                            {p.id.slice(-8).toUpperCase()}
                          </span>
                        </Link>
                        <p className="mt-1 text-xs text-gray-400">{p.itemCount} item</p>
                      </TableCell>
                      <TableCell className="text-sm">{p.supplierName || "—"}</TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {p.branchCode ? `${p.branchCode} (${p.branchName})` : "—"}
                      </TableCell>
                      <TableCell>{statusBadge(p.status)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{rupiah(p.total)}</TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {new Date(p.createdAt).toLocaleString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {p.receivedAt
                          ? new Date(p.receivedAt).toLocaleString("id-ID", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-gray-400">
            Menampilkan {items.length} dari {total} pembelian
          </p>
        </CardContent>
      </Card>
    </div>
  );
}