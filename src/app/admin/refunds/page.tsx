"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, RotateCcw, Search } from "lucide-react";
import { orderService, type Order } from "@/services/order.service";
import { shiftService } from "@/services/shift.service";
import { useBranchContext } from "@/hooks/use-branch-context";
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

const rupiah = (amount: number | string) =>
  `Rp${Number(amount).toLocaleString("id-ID")}`;

export default function RefundsPage() {
  const { isLoading: branchLoading } = useBranchContext();
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requested, setRequested] = useState<Set<string>>(new Set());

  const loadOrders = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const result = await orderService.getOrders({
        page: 1,
        limit: 100,
        search: query.trim() || undefined,
      });
      setOrders(result.items.filter((order) => order.paymentStatus === "PAID"));
    } catch {
      toast.error("Gagal memuat pesanan lunas");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query]);

  useEffect(() => {
    if (!branchLoading) void loadOrders();
  }, [branchLoading, loadOrders]);

  const openRequest = (order: Order) => {
    setSelected(order);
    setAmount(String(Math.floor(Number(order.grandTotal))));
    setReason("");
  };

  const submitRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Jumlah refund tidak valid");
      return;
    }
    if (reason.trim().length < 5) {
      toast.error("Alasan refund minimal 5 karakter");
      return;
    }
    setSubmitting(true);
    try {
      await shiftService.requestRefund(selected.id, value, reason.trim());
      setRequested((prev) => new Set(prev).add(selected.id));
      toast.success("Permintaan refund dikirim ke admin untuk persetujuan");
      setSelected(null);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })
        ?.response?.data?.message;
      toast.error(message || "Gagal mengirim permintaan refund");
    } finally {
      setSubmitting(false);
    }
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void loadOrders();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Refund</h1>
        <p className="text-muted-foreground">
          Cari pesanan lunas dan ajukan refund dari halaman ini. Persetujuan tetap dilakukan admin.
        </p>
      </div>

      <form onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari nomor order atau nama customer"
          aria-label="Cari nomor order atau nama customer"
        />
        <Button type="submit" disabled={loading || refreshing}>
          <Search className="mr-2 h-4 w-4" /> Cari
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadOrders(true)}
          disabled={loading || refreshing}
          aria-label="Refresh daftar order"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </form>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Tidak ada pesanan lunas yang cocok dengan pencarian.
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const alreadyRequested = requested.has(order.id);
            return (
              <div
                key={order.id}
                className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">#{order.orderNumber}</span>
                    <Badge variant="secondary">Lunas</Badge>
                    <Badge variant="outline">
                      {order.status === "COMPLETED" ? "Selesai" : order.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {order.customer?.name || "Guest"} · {new Date(order.createdAt).toLocaleString("id-ID")}
                  </p>
                  <p className="text-sm font-medium">Total {rupiah(order.grandTotal)}</p>
                </div>
                <Button
                  variant="outline"
                  disabled={alreadyRequested}
                  onClick={() => openRequest(order)}
                >
                  <RotateCcw className="mr-2 h-4 w-4 text-red-600" />
                  {alreadyRequested ? "Menunggu Persetujuan" : "Ajukan Refund"}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitRequest} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Ajukan Refund</DialogTitle>
              <DialogDescription>
                Permintaan untuk order #{selected?.orderNumber} akan dikirim ke admin.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="refund-amount">Jumlah refund (Rp)</Label>
              <Input
                id="refund-amount"
                type="number"
                min="1"
                step="1"
                max={selected ? Math.floor(Number(selected.grandTotal)) : undefined}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
              {selected && (
                <p className="text-xs text-muted-foreground">
                  Maksimal sesuai tagihan {rupiah(selected.grandTotal)}. Sistem akan menolak jika sisa refund lebih kecil.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="refund-reason">Alasan refund</Label>
              <Input
                id="refund-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={5}
                placeholder="Contoh: item tidak tersedia"
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSelected(null)} disabled={submitting}>
                Batal
              </Button>
              <Button type="submit" disabled={submitting || reason.trim().length < 5}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Kirim Permintaan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
