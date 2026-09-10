"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUserRole } from "@/hooks/use-user-role";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  normalizeApiError,
  isUnauthorized,
  type NormalizedApiError,
} from "@/lib/api-error-handler";
import {
  shiftService,
  userService,
  type CashierShift,
  type ShiftOverride,
} from "@/services/shift.service";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { toast } from "sonner";
import {
  Loader2,
  Wallet,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Banknote,
  Smartphone,
  TrendingUp,
  Eye,
} from "lucide-react";
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

type ShiftWithBreakdown = CashierShift & {
  cashRevenue?: number;
  qrisRevenue?: number;
  totalRevenue?: number;
  transactionCount?: number;
};

const rupiah = (n: number | string) =>
  `Rp${Number(n || 0).toLocaleString("id-ID")}`;

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fmtDuration(openedAt: string, closedAt?: string | null) {
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  if (hours === 0) return `${minutes}m`;
  return `${hours}j ${minutes}m`;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function ShiftsPage() {
  const { role, isLoading: roleLoading } = useUserRole();
  const { isLoading: branchCtxLoading, branches } = useBranchContext();
  const isAdmin = role === "ADMIN";

  // Cashier drawer
  const [activeShift, setActiveShift] = useState<ShiftWithBreakdown | null>(
    null
  );
  const [myShifts, setMyShifts] = useState<ShiftWithBreakdown[]>([]);
  // Admin lists
  const [allShifts, setAllShifts] = useState<ShiftWithBreakdown[]>([]);
  const [pendingOverrides, setPendingOverrides] = useState<ShiftOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<NormalizedApiError | null>(null);

  // Filters (admin only)
  const [filterBranch, setFilterBranch] = useState("");
  const [filterCashier, setFilterCashier] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [cashiers, setCashiers] = useState<Array<{ id: string; name: string }>>(
    []
  );

  // Open/close dialogs
  const [openDialog, setOpenDialog] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Override flow
  const [overrideTarget, setOverrideTarget] =
    useState<ShiftWithBreakdown | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideProposed, setOverrideProposed] = useState("");
  const [overrideDialog, setOverrideDialog] = useState(false);

  // Admin approval dialog (password confirmation)
  const [approveTarget, setApproveTarget] = useState<{
    kind: "override";
    id: string;
    approve: boolean;
    title: string;
  } | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async () => {
    if (roleLoading || !role) return;
    if (branchCtxLoading) return;
    setLoading(true);
    setError(null);
    try {
      if (role === "ADMIN") {
        const filters: Record<string, string> = {};
        if (filterBranch) filters.branchId = filterBranch;
        if (filterCashier) filters.userId = filterCashier;
        if (filterStatus) filters.status = filterStatus;
        if (filterStartDate) filters.startDate = filterStartDate;
        if (filterEndDate) filters.endDate = filterEndDate;
        const [shiftsRes, pendingRes] = await Promise.all([
          shiftService.listShifts(
            Object.keys(filters).length ? filters : undefined
          ),
          shiftService.listPendingApprovals(),
        ]);
        setAllShifts(shiftsRes.items);
        setPendingOverrides(pendingRes.overrides);
      } else {
        const [activeRes, listRes] = await Promise.all([
          shiftService.getActiveShift(),
          shiftService.listShifts(),
        ]);
        setActiveShift(activeRes.shift as ShiftWithBreakdown | null);
        setMyShifts(listRes.items);
      }
    } catch (err) {
      if (isUnauthorized(err)) return;
      console.error("Failed to load shifts:", err);
      setError(normalizeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [role, roleLoading, branchCtxLoading, filterBranch, filterCashier, filterStatus, filterStartDate, filterEndDate]);

  useEffect(() => {
    load();
  }, [load]);

  // Admin cashier dropdown (authoritative user list, CASHIER role only).
  useEffect(() => {
    if (role !== "ADMIN") return;
    let alive = true;
    userService
      .listUsers()
      .then((res) => {
        if (!alive) return;
        setCashiers(
          (res.items || [])
            .filter((u) => u.role === "CASHIER")
            .map((u) => ({ id: u.id, name: u.name }))
        );
      })
      .catch(() => {
        // The user list is only needed for the filter dropdown — the page
        // still loads shifts even if it fails.
      });
    return () => {
      alive = false;
    };
  }, [role]);

  // Realtime: shift opens/closes/decisions refresh the page in place.
  useRealtimeListener(
    [
      REALTIME_EVENT_TYPES.SHIFT_OPENED,
      REALTIME_EVENT_TYPES.SHIFT_CLOSED,
      REALTIME_EVENT_TYPES.SHIFT_UPDATED,
      REALTIME_EVENT_TYPES.SHIFT_OVERRIDE_REQUESTED,
      REALTIME_EVENT_TYPES.SHIFT_OVERRIDE_DECIDED,
      REALTIME_EVENT_TYPES.REFUND_REQUESTED,
      REALTIME_EVENT_TYPES.CANCELLATION_REQUESTED,
      REALTIME_EVENT_TYPES.OFFLINE_POLL,
    ],
    () => load()
  );

  // Admin summary stats
  const summary = useMemo(() => {
    const shifts = isAdmin ? allShifts : myShifts;
    const openCount = shifts.filter((s) => s.status === "OPEN").length;
    const totalCashiers = new Set(shifts.map((s) => s.userId)).size;
    const today = todayStr();
    const todayShifts = shifts.filter(
      (s) => s.openedAt && s.openedAt.slice(0, 10) === today
    );
    const todayTransactions = todayShifts.reduce(
      (sum, s) => sum + (s.transactionCount ?? 0),
      0
    );
    const todayCash = todayShifts.reduce(
      (sum, s) => sum + (s.cashRevenue ?? 0),
      0
    );
    const todayQris = todayShifts.reduce(
      (sum, s) => sum + (s.qrisRevenue ?? 0),
      0
    );
    const todayRevenue = todayCash + todayQris;
    return {
      openCount,
      totalCashiers,
      todayTransactions,
      todayCash,
      todayQris,
      todayRevenue,
    };
  }, [allShifts, myShifts, isAdmin]);

  const handleOpen = async () => {
    const amount = Number(openingCash);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Jumlah kas awal tidak valid");
      return;
    }
    setSubmitting(true);
    try {
      const shift = await shiftService.openShift(amount, notes || undefined);
      toast.success(`Shift ${shift.shiftNumber} berhasil dibuka`);
      setOpenDialog(false);
      setOpeningCash("");
      setNotes("");
      await load();
    } catch (err) {
      toast.error(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.message || "Gagal membuka shift"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async () => {
    const amount = Number(actualCash);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Jumlah kas aktual tidak valid");
      return;
    }
    setSubmitting(true);
    try {
      const result = await shiftService.closeShift(amount, notes || undefined);
      toast.success(`Shift ditutup — selisih ${rupiah(result.difference)}`);
      setActualCash("");
      setNotes("");
      await load();
    } catch (err) {
      toast.error(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.message || "Gagal menutup shift"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitOverride = async () => {
    if (!overrideTarget) return;
    setSubmitting(true);
    try {
      const ov = await shiftService.requestOverride(
        overrideTarget.id,
        overrideReason,
        overrideProposed ? Number(overrideProposed) : undefined
      );
      toast.success("Permintaan override dikirim ke admin");
      setOverrideDialog(false);
      setOverrideReason("");
      setOverrideProposed("");
      await load();
    } catch (err) {
      toast.error(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.message || "Gagal mengirim override"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecide = async () => {
    if (!approveTarget) return;
    setDeciding(true);
    try {
      const { id, approve } = approveTarget;
      await shiftService.decideOverride(
        id,
        approve,
        adminPassword,
        decisionNote || undefined
      );
      toast.success(approve ? "Override disetujui" : "Override ditolak");
      setApproveTarget(null);
      setAdminPassword("");
      setDecisionNote("");
      await load();
    } catch (err) {
      toast.error(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.message || "Gagal memproses override"
      );
    } finally {
      setDeciding(false);
    }
  };

  const clearFilters = () => {
    setFilterBranch("");
    setFilterCashier("");
    setFilterStatus("");
    setFilterStartDate("");
    setFilterEndDate("");
  };

  if (roleLoading || loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">
            {isAdmin ? "Monitoring Shift" : "Shift Saya"}
          </h1>
        </div>
        <div className="flex flex-col items-center justify-center py-16 space-y-3 text-center">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <p className="text-sm text-gray-600">{error.message}</p>
          {error.retryable ? (
            <Button variant="outline" size="sm" onClick={() => load()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Coba Lagi
            </Button>
          ) : (
            <p className="text-xs text-gray-400">
              Silakan pilih cabang yang sesuai dengan akun Anda, atau hubungi
              admin.
            </p>
          )}
        </div>
      </div>
    );
  }

  const displayShifts = isAdmin ? allShifts : myShifts;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">
          {isAdmin ? "Monitoring Shift" : "Shift Saya"}
        </h1>
        <p className="text-muted-foreground">
          {isAdmin
            ? "Pantau aktivitas shift kasir di semua cabang"
            : "Buka, tutup, dan pantau shift kasir Anda"}
        </p>
      </div>

      {/* Admin Summary Stats */}
      {isAdmin && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Shift Aktif</p>
            <p className="text-2xl font-bold">{summary.openCount}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Total Kasir</p>
            <p className="text-2xl font-bold">{summary.totalCashiers}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Transaksi Hari Ini</p>
            <p className="text-2xl font-bold">{summary.todayTransactions}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Revenue Hari Ini</p>
            <p className="text-2xl font-bold">{rupiah(summary.todayRevenue)}</p>
            <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Banknote className="h-3 w-3" />
                {rupiah(summary.todayCash)}
              </span>
              <span className="flex items-center gap-1">
                <Smartphone className="h-3 w-3" />
                {rupiah(summary.todayQris)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Admin Filter Bar */}
      {isAdmin && (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Cabang</Label>
              <select
                value={filterBranch}
                onChange={(e) => setFilterBranch(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">Semua Cabang</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Kasir</Label>
              <select
                value={filterCashier}
                onChange={(e) => setFilterCashier(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">Semua Kasir</option>
                {cashiers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">Semua</option>
                <option value="OPEN">OPEN</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Dari</Label>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sampai</Label>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            {(filterStatus || filterStartDate || filterEndDate) && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Reset
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Cashier: current drawer status + actions */}
      {!isAdmin && activeShift && (
        <div className="rounded-xl border bg-green-50 border-green-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="h-4 w-4 text-green-600" />
            <span className="font-semibold text-green-900">Shift Aktif</span>
            <Badge className="bg-green-100 text-green-700 border-green-200">
              Buka
            </Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
            <div>
              <p className="text-xs text-green-700">Shift</p>
              <p className="font-mono font-semibold text-sm">
                {activeShift.shiftNumber}
              </p>
            </div>
            <div>
              <p className="text-xs text-green-700">Dibuka</p>
              <p className="text-sm">{fmtTime(activeShift.openedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-green-700">Durasi</p>
              <p className="text-sm font-medium">
                {fmtDuration(activeShift.openedAt)}
              </p>
            </div>
            <div>
              <p className="text-xs text-green-700">Kas Awal</p>
              <p className="text-sm font-medium">
                {rupiah(activeShift.openingCash)}
              </p>
            </div>
          </div>
          <div className="flex gap-4 mb-3">
            <div className="flex items-center gap-1 text-sm">
              <Banknote className="h-3.5 w-3.5 text-green-600" />
              <span className="text-muted-foreground">CASH</span>
              <span className="font-medium">{rupiah(activeShift.cashRevenue ?? 0)}</span>
            </div>
            <div className="flex items-center gap-1 text-sm">
              <Smartphone className="h-3.5 w-3.5 text-blue-600" />
              <span className="text-muted-foreground">QRIS</span>
              <span className="font-medium">{rupiah(activeShift.qrisRevenue ?? 0)}</span>
            </div>
            <div className="flex items-center gap-1 text-sm">
              <TrendingUp className="h-3.5 w-3.5 text-purple-600" />
              <span className="text-muted-foreground">Total</span>
              <span className="font-bold">{rupiah(activeShift.totalRevenue ?? 0)}</span>
            </div>
            <div className="flex items-center gap-1 text-sm">
              <span className="text-muted-foreground">Transaksi</span>
              <span className="font-medium">{activeShift.transactionCount ?? 0}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => setOpenDialog(true)}
            >
              Tutup Shift
            </Button>
          </div>
        </div>
      )}

      {/* Cashier: no active shift */}
      {!isAdmin && !activeShift && (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Belum ada shift aktif</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Buka shift sebelum menerima pembayaran kasir.
              </p>
            </div>
            <Button onClick={() => setOpenDialog(true)} disabled={submitting}>
              Buka Shift
            </Button>
          </div>
        </div>
      )}

      {/* Admin: pending override approvals */}
      {isAdmin && pendingOverrides.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            Permintaan Override Menunggu ({pendingOverrides.length})
          </h2>
          {pendingOverrides.map((ov) => (
            <div
              key={ov.id}
              className="rounded-lg border border-amber-200 bg-white p-3 text-sm"
            >
              <p className="font-medium">
                {ov.shift?.shiftNumber}{" "}
                <span className="text-muted-foreground">
                  oleh {ov.requester?.name || "kasir"}
                </span>
              </p>
              <p className="text-muted-foreground mt-0.5">{ov.reason}</p>
              {ov.proposedClosingCash != null && (
                <p className="text-xs mt-1">
                  Kas aktual usulan:{" "}
                  <span className="font-medium">
                    {rupiah(ov.proposedClosingCash)}
                  </span>
                </p>
              )}
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() =>
                    setApproveTarget({
                      kind: "override",
                      id: ov.id,
                      approve: true,
                      title: `Setujui override ${ov.shift?.shiftNumber}`,
                    })
                  }
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Setujui
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600"
                  onClick={() =>
                    setApproveTarget({
                      kind: "override",
                      id: ov.id,
                      approve: false,
                      title: `Tolak override ${ov.shift?.shiftNumber}`,
                    })
                  }
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Tolak
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Shift history table */}
      <div className="rounded-xl border bg-card overflow-x-auto">
        <div className="p-4 border-b">
          <h2 className="font-semibold">
            {isAdmin ? "Semua Shift" : "Riwayat Shift Saya"}
          </h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b">
              <th className="px-3 py-2">Shift</th>
              {isAdmin && <th className="px-3 py-2">Cabang</th>}
              {isAdmin && <th className="px-3 py-2">Kasir</th>}
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Dibuka</th>
              <th className="px-3 py-2">Ditutup</th>
              <th className="px-3 py-2">Durasi</th>
              <th className="px-3 py-2 text-right">Kas Awal</th>
              <th className="px-3 py-2 text-right">CASH</th>
              <th className="px-3 py-2 text-right">QRIS</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Selisih</th>
              {!isAdmin && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {displayShifts.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-mono font-medium">
                  <Link
                    href={`/admin/shifts/${s.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {s.shiftNumber}
                  </Link>
                </td>
                {isAdmin && (
                  <td className="px-3 py-2">
                    <span className="font-medium text-blue-700">
                      {s.branch?.name || s.branch?.code || "—"}
                    </span>
                  </td>
                )}
                {isAdmin && (
                  <td className="px-3 py-2">
                    <span className="font-medium">
                      {s.user?.name || "—"}
                    </span>
                  </td>
                )}
                <td className="px-3 py-2">
                  {s.status === "OPEN" ? (
                    <Badge className="bg-green-100 text-green-700 border-green-200">
                      Buka
                    </Badge>
                  ) : (
                    <Badge className="bg-gray-100 text-gray-600">Tutup</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {fmtTime(s.openedAt)}
                </td>
                <td className="px-3 py-2 text-xs">
                  {s.closedAt ? fmtTime(s.closedAt) : "—"}
                </td>
                <td className="px-3 py-2 text-xs tabular-nums">
                  {fmtDuration(s.openedAt, s.closedAt)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {rupiah(s.openingCash)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className="flex items-center justify-end gap-1">
                    <Banknote className="h-3 w-3 text-green-600" />
                    {rupiah(s.cashRevenue ?? 0)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className="flex items-center justify-end gap-1">
                    <Smartphone className="h-3 w-3 text-blue-600" />
                    {rupiah(s.qrisRevenue ?? 0)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {rupiah(s.totalRevenue ?? 0)}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums font-medium ${
                    s.difference != null && Number(s.difference) !== 0
                      ? "text-red-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {s.difference != null ? rupiah(s.difference) : "—"}
                </td>
                {!isAdmin && s.status === "CLOSED" && (
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setOverrideTarget(s);
                        setOverrideReason("");
                        setOverrideProposed("");
                        setOverrideDialog(true);
                      }}
                    >
                      Ajukan Koreksi
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {displayShifts.length === 0 && (
              <tr>
                <td
                  colSpan={isAdmin ? 12 : 9}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  Belum ada data shift
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Open/Close dialog */}
      <Dialog
        open={openDialog}
        onOpenChange={(o) => {
          setOpenDialog(o);
          if (!o) {
            setOpeningCash("");
            setActualCash("");
            setNotes("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {activeShift ? "Tutup Shift" : "Buka Shift"}
            </DialogTitle>
            <DialogDescription>
              {activeShift
                ? "Masukkan jumlah kas aktual di laci — sistem menghitung selisih."
                : "Masukkan jumlah kas awal di laci."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {activeShift ? (
              <div className="space-y-1.5">
                <Label htmlFor="close-actual">Kas Aktual di Laci (Rp)</Label>
                <Input
                  id="close-actual"
                  inputMode="numeric"
                  autoFocus
                  placeholder="0"
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Ekspektasi:{" "}
                  <span className="font-medium">
                    {rupiah(
                      Number(activeShift.openingCash) +
                        (activeShift.totalRevenue ?? 0)
                    )}
                  </span>
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="open-cash">Kas Awal (Rp)</Label>
                <Input
                  id="open-cash"
                  inputMode="numeric"
                  autoFocus
                  placeholder="500000"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="shift-notes">Catatan (opsional)</Label>
              <Input
                id="shift-notes"
                placeholder="Catatan shift"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpenDialog(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              onClick={activeShift ? handleClose : handleOpen}
              disabled={submitting}
              className={activeShift ? "bg-amber-600 hover:bg-amber-700" : ""}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              {activeShift ? "Tutup Shift" : "Buka Shift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cashier override request dialog */}
      <Dialog
        open={overrideDialog}
        onOpenChange={(o) => {
          setOverrideDialog(o);
          if (!o) {
            setOverrideTarget(null);
            setOverrideReason("");
            setOverrideProposed("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Ajukan Koreksi Shift</DialogTitle>
            <DialogDescription>
              {overrideTarget?.shiftNumber} sudah ditutup dan terkunci. Ajukan
              koreksi — admin harus menyetujui dengan password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="override-reason">Alasan</Label>
              <Input
                id="override-reason"
                placeholder="Misal: salah hitung uang kembalian"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="override-cash">
                Kas Aktual yang Benar (Rp, opsional)
              </Label>
              <Input
                id="override-cash"
                inputMode="numeric"
                placeholder="0"
                value={overrideProposed}
                onChange={(e) => setOverrideProposed(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOverrideDialog(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              onClick={submitOverride}
              disabled={submitting || !overrideReason.trim()}
            >
              Kirim Permintaan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin password confirmation dialog */}
      <Dialog
        open={!!approveTarget}
        onOpenChange={(o) => {
          if (!o) {
            setApproveTarget(null);
            setAdminPassword("");
            setDecisionNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{approveTarget?.title}</DialogTitle>
            <DialogDescription>
              Tindakan finansial sensitif — konfirmasi password admin Anda.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="admin-pw">Password Admin</Label>
              <Input
                id="admin-pw"
                type="password"
                autoFocus
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="decision-note">
                Catatan Keputusan (opsional)
              </Label>
              <Input
                id="decision-note"
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApproveTarget(null)}
              disabled={deciding}
            >
              Batal
            </Button>
            <Button
              onClick={handleDecide}
              disabled={deciding || !adminPassword}
              className={
                approveTarget?.approve
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-red-600 hover:bg-red-700"
              }
            >
              {deciding ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              {approveTarget?.approve ? "Setujui" : "Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
