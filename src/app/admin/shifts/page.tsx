"use client";

import { useCallback, useEffect, useState } from "react";
import { useUserRole } from "@/hooks/use-user-role";
import {
  shiftService,
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

const rupiah = (n: number | string) =>
  `Rp${Number(n || 0).toLocaleString("id-ID")}`;

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function ShiftsPage() {
  const { role, isLoading: roleLoading } = useUserRole();
  const isAdmin = role === "ADMIN";

  // Cashier drawer
  const [activeShift, setActiveShift] = useState<CashierShift | null>(null);
  const [myShifts, setMyShifts] = useState<CashierShift[]>([]);
  // Admin lists
  const [allShifts, setAllShifts] = useState<CashierShift[]>([]);
  const [pendingOverrides, setPendingOverrides] = useState<ShiftOverride[]>([]);
  const [loading, setLoading] = useState(true);

  // Open/close dialogs
  const [openDialog, setOpenDialog] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Override flow
  const [overrideTarget, setOverrideTarget] = useState<CashierShift | null>(null);
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
    setLoading(true);
    try {
      if (role === "ADMIN") {
        const [shiftsRes, pendingRes] = await Promise.all([
          shiftService.listShifts(),
          shiftService.listPendingApprovals(),
        ]);
        setAllShifts(shiftsRes.items);
        setPendingOverrides(pendingRes.overrides);
      } else {
        const [activeRes, listRes] = await Promise.all([
          shiftService.getActiveShift(),
          shiftService.listShifts(),
        ]);
        setActiveShift(activeRes.shift);
        setMyShifts(listRes.items);
      }
    } catch (err) {
      console.error("Failed to load shifts:", err);
      toast.error("Gagal memuat data shift");
    } finally {
      setLoading(false);
    }
  }, [role, roleLoading]);

  useEffect(() => {
    load();
  }, [load]);

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

  if (roleLoading || loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">
          {isAdmin ? "Shift Kasir" : "Shift Saya"}
        </h1>
        <p className="text-muted-foreground">
          {isAdmin
            ? "Kelola shift semua kasir dan setujui override"
            : "Buka, tutup, dan pantau shift kasir Anda"}
        </p>
      </div>

      {/* Cashier: current drawer status + actions */}
      {!isAdmin && (
        <div className="rounded-xl border bg-card p-4">
          {activeShift ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-green-600" />
                  <span className="font-mono font-semibold">
                    {activeShift.shiftNumber}
                  </span>
                  <Badge className="bg-green-100 text-green-700 border-green-200">
                    Buka
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Dibuka {fmtTime(activeShift.openedAt)} · Kas awal{" "}
                  <span className="font-medium text-foreground">
                    {rupiah(activeShift.openingCash)}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="bg-amber-600 hover:bg-amber-700"
                  onClick={() => setOpenDialog(true)}
                >
                  Tutup Shift
                </Button>
              </div>
            </div>
          ) : (
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
          )}
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
              <th className="px-4 py-2">Shift</th>
              <th className="px-4 py-2">{isAdmin ? "Kasir" : "Dibuka"}</th>
              <th className="px-4 py-2 text-right">Kas Awal</th>
              <th className="px-4 py-2 text-right">Ekspektasi</th>
              <th className="px-4 py-2 text-right">Aktual</th>
              <th className="px-4 py-2 text-right">Selisih</th>
              <th className="px-4 py-2">Status</th>
              {!isAdmin && <th className="px-4 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {(isAdmin ? allShifts : myShifts).map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="px-4 py-2 font-mono font-medium">
                  {s.shiftNumber}
                </td>
                <td className="px-4 py-2">
                  {isAdmin ? s.user?.name || "—" : fmtTime(s.openedAt)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {rupiah(s.openingCash)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {s.expectedCash != null ? rupiah(s.expectedCash) : "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {s.closingCash != null ? rupiah(s.closingCash) : "—"}
                </td>
                <td
                  className={`px-4 py-2 text-right tabular-nums font-medium ${
                    s.difference != null && Number(s.difference) !== 0
                      ? "text-red-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {s.difference != null ? rupiah(s.difference) : "—"}
                </td>
                <td className="px-4 py-2">
                  {s.status === "OPEN" ? (
                    <Badge className="bg-green-100 text-green-700 border-green-200">
                      Buka
                    </Badge>
                  ) : (
                    <Badge className="bg-gray-100 text-gray-600">Tutup</Badge>
                  )}
                </td>
                {!isAdmin && s.status === "CLOSED" && (
                  <td className="px-4 py-2 text-right">
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
            {(isAdmin ? allShifts : myShifts).length === 0 && (
              <tr>
                <td
                  colSpan={8}
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
                        (activeShift.payments || []).reduce(
                          (s, p) => s + Number(p.amount),
                          0
                        )
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
              <Label htmlFor="override-cash">Kas Aktual yang Benar (Rp, opsional)</Label>
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
            <Button onClick={submitOverride} disabled={submitting || !overrideReason.trim()}>
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
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
              <Label htmlFor="decision-note">Catatan Keputusan (opsional)</Label>
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
