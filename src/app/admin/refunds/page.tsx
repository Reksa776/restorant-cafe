"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCw, RotateCcw, Search, XCircle } from "lucide-react";
import { orderService, type Order } from "@/services/order.service";
import { shiftService, type RefundRequest } from "@/services/shift.service";
import { useBranchContext } from "@/hooks/use-branch-context";
import { useUserRole } from "@/hooks/use-user-role";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
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
  const { role, isLoading: roleLoading } = useUserRole();
  const isAdmin = role === "ADMIN";
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [myPendingRefunds, setMyPendingRefunds] = useState<RefundRequest[]>([]);
  const [pendingRefunds, setPendingRefunds] = useState<RefundRequest[]>([]);
  const [decision, setDecision] = useState<{
    refund: RefundRequest;
    approve: boolean;
  } | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  const loadOrders = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const [result, myRequests] = await Promise.all([
        orderService.getOrders({
          page: 1,
          limit: 100,
          search: searchTerm || undefined,
        }),
        shiftService.listMyPendingRefunds(),
      ]);
      setOrders(result.items.filter((order) => order.paymentStatus === "PAID"));
      setMyPendingRefunds(myRequests);
    } catch {
      toast.error("Gagal memuat pesanan lunas");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchTerm]);

  const loadRefunds = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const approvals = await shiftService.listPendingApprovals();
      setPendingRefunds(approvals.refunds ?? []);
    } catch {
      toast.error("Gagal memuat antrian refund");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (branchLoading || roleLoading || !role) return;
    if (role === "ADMIN") void loadRefunds();
    else void loadOrders();
  }, [branchLoading, roleLoading, role, loadOrders, loadRefunds]);

  useRealtimeListener(
    [REALTIME_EVENT_TYPES.REFUND_REQUESTED, REALTIME_EVENT_TYPES.REFUND_DECIDED],
    (event) => {
      if (isAdmin && event.type === REALTIME_EVENT_TYPES.REFUND_REQUESTED) {
        void loadRefunds(true);
      } else if (!isAdmin && event.type === REALTIME_EVENT_TYPES.REFUND_DECIDED) {
        void loadOrders(true);
      }
    }
  );

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
      await loadOrders(true);
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
    setSearchTerm(query.trim());
  };

  const decideRefund = async (event: FormEvent) => {
    event.preventDefault();
    if (!decision || !adminPassword) return;
    setDeciding(true);
    try {
      await shiftService.decideRefund(
        decision.refund.id,
        decision.approve,
        adminPassword,
        decisionNote.trim() || undefined
      );
      toast.success(decision.approve ? "Refund disetujui dan diproses" : "Refund ditolak");
      setDecision(null);
      setAdminPassword("");
      setDecisionNote("");
      await loadRefunds(true);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })
        ?.response?.data?.message;
      toast.error(message || "Gagal memproses keputusan refund");
    } finally {
      setDeciding(false);
    }
  };

  const refresh = () => void (isAdmin ? loadRefunds(true) : loadOrders(true));
  const closeDecision = () => {
    if (deciding) return;
    setDecision(null);
    setAdminPassword("");
    setDecisionNote("");
  };

  if (roleLoading || branchLoading || !role) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Refund</h1>
        <p className="text-muted-foreground">
          {isAdmin
            ? "Tinjau permintaan refund dari kasir dan putuskan dengan konfirmasi password admin."
            : "Cari pesanan lunas dan ajukan permintaan refund. Admin akan meninjau dan memutuskan."}
        </p>
      </div>

      {isAdmin ? (
        <Button
          type="button"
          variant="outline"
          onClick={refresh}
          disabled={loading || refreshing}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh Antrian
        </Button>
      ) : (
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
          <Button type="button" variant="outline" onClick={refresh} disabled={loading || refreshing} aria-label="Refresh daftar order">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </form>
      )}

      {!isAdmin && myPendingRefunds.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Pengajuan Saya Menunggu Admin ({myPendingRefunds.length})</h2>
          <div className="space-y-2">
            {myPendingRefunds.map((refund) => (
              <div key={refund.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <div>
                  <span className="font-mono font-medium">#{refund.order?.orderNumber || refund.orderId}</span>
                  <span className="ml-2 text-muted-foreground">{refund.reason}</span>
                </div>
                <span className="font-semibold">{rupiah(refund.amount)} · Menunggu</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : isAdmin && pendingRefunds.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Belum ada permintaan refund yang menunggu persetujuan.
        </div>
      ) : isAdmin ? (
        <div className="space-y-3">
          {pendingRefunds.map((refund) => (
            <div key={refund.id} className="flex flex-col gap-3 rounded-xl border border-red-200 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">#{refund.order?.orderNumber || refund.orderId}</span>
                  <Badge variant="secondary">Menunggu Persetujuan</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Diajukan kasir {refund.requester?.name || "kasir"} · {new Date(refund.requestedAt).toLocaleString("id-ID")}
                </p>
                <p className="text-sm">Alasan: {refund.reason}</p>
                <p className="font-semibold text-red-700">{rupiah(refund.amount)}</p>
              </div>
              <div className="flex gap-2">
                <Button className="bg-green-600 hover:bg-green-700" onClick={() => setDecision({ refund, approve: true })}>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Setujui
                </Button>
                <Button variant="outline" className="text-red-600" onClick={() => setDecision({ refund, approve: false })}>
                  <XCircle className="mr-2 h-4 w-4" /> Tolak
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Tidak ada pesanan lunas yang cocok dengan pencarian.
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const alreadyRequested =
              requested.has(order.id) ||
              myPendingRefunds.some((refund) => refund.orderId === order.id);
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

      <Dialog open={!!decision} onOpenChange={(open) => {
        if (!open) closeDecision();
      }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={decideRefund} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{decision?.approve ? "Setujui Refund" : "Tolak Refund"}</DialogTitle>
              <DialogDescription>
                Konfirmasi keputusan untuk order #{decision?.refund.order?.orderNumber || decision?.refund.orderId}.
              </DialogDescription>
            </DialogHeader>
            {decision && (
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm whitespace-pre-line">
                <p>Jumlah: {rupiah(decision.refund.amount)}</p>
                <p>Kasir: {decision.refund.requester?.name || "kasir"}</p>
                <p>Alasan: {decision.refund.reason}</p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="refund-admin-password">Password Admin</Label>
              <Input id="refund-admin-password" type="password" autoFocus value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="refund-decision-note">Catatan keputusan (opsional)</Label>
              <Input id="refund-decision-note" value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDecision} disabled={deciding}>Batal</Button>
              <Button type="submit" disabled={deciding || !adminPassword} className={decision?.approve ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}>
                {deciding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {decision?.approve ? "Konfirmasi Setujui" : "Konfirmasi Tolak"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
