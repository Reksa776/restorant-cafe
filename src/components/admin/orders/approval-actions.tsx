"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shiftService } from "@/services/shift.service";
import { useUserRole } from "@/hooks/use-user-role";
import type { Order } from "@/services/order.service";

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

type ActionState =
  | null
  | { kind: "refund-request"; orderId: string }
  | { kind: "cancel-request"; orderId: string };

/**
 * Refund + cancellation actions with ADMIN PASSWORD confirmation.
 *
 * Flow:
 * - CASHIER clicks → a request is submitted (requestedByCashierId) and an
 *   admin must approve later from the review queue.
 * - ADMIN clicks → the request is created and immediately approved using the
 *   admin password typed in the modal (session alone is not enough).
 *
 * The server always verifies role + restaurant + password — this dialog is
 * only the UX layer.
 */
export function ApprovalActions({
  order,
  onDone,
  compact,
}: {
  order: Order;
  onDone?: () => void;
  compact?: boolean;
}) {
  const { role } = useUserRole();
  const isAdmin = role === "ADMIN";

  const [action, setAction] = useState<ActionState>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Terminal states are immutable — no refund/cancel actions.
  if (["COMPLETED", "CANCELLED"].includes(order.status)) return null;
  // Refund needs collected money; cancel needs a non-terminal, non-paid order
  // (a live PENDING intent can always be cancelled).
  const canRefund = order.paymentStatus === "PAID";
  const canCancel = order.status !== "COMPLETED" && order.status !== "CANCELLED";
  if (!canRefund && !canCancel) return null;

  const close = () => {
    setAction(null);
    setAmount("");
    setReason("");
    setAdminPassword("");
  };

  const submit = async () => {
    if (!action) return;
    if (!reason.trim() || reason.trim().length < 5) {
      toast.error("Alasan minimal 5 karakter");
      return;
    }
    if (action.kind === "refund-request") {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        toast.error("Jumlah refund tidak valid");
        return;
      }
      setSubmitting(true);
      try {
        const request = await shiftService.requestRefund(
          action.orderId,
          amt,
          reason.trim()
        );
        // Admin executing directly from the order detail: request + approve
        // with the password in one go.
        if (isAdmin && adminPassword) {
          await shiftService.decideRefund(request.id, true, adminPassword, reason.trim());
          toast.success("Refund disetujui dan diproses");
        } else {
          toast.success("Permintaan refund dikirim ke admin");
        }
        close();
        onDone?.();
      } catch (err) {
        toast.error(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err as any)?.response?.data?.message || "Gagal mengirim refund"
        );
      } finally {
        setSubmitting(false);
      }
    } else {
      setSubmitting(true);
      try {
        const request = await shiftService.requestCancellation(
          action.orderId,
          reason.trim()
        );
        if (isAdmin && adminPassword) {
          await shiftService.decideCancellation(
            request.id,
            true,
            adminPassword,
            reason.trim()
          );
          toast.success("Pembatalan disetujui dan diproses");
        } else {
          toast.success("Permintaan pembatalan dikirim ke admin");
        }
        close();
        onDone?.();
      } catch (err) {
        toast.error(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err as any)?.response?.data?.message || "Gagal mengirim pembatalan"
        );
      } finally {
        setSubmitting(false);
      }
    }
  };

  const showPasswordField =
    isAdmin && action && (action.kind === "refund-request" || action.kind === "cancel-request");

  return (
    <>
      {canRefund && (
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          onClick={() => setAction({ kind: "refund-request", orderId: order.id })}
        >
          <RotateCcw className="h-4 w-4 mr-1 text-red-600" />
          Refund
        </Button>
      )}
      {canCancel && (
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className="text-red-600"
          onClick={() => setAction({ kind: "cancel-request", orderId: order.id })}
        >
          <XCircle className="h-4 w-4 mr-1" />
          Batalkan Pesanan
        </Button>
      )}

      <Dialog open={!!action} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {action?.kind === "refund-request"
                ? "Refund Pesanan"
                : "Batalkan Pesanan"}
            </DialogTitle>
            <DialogDescription>
              {isAdmin
                ? "Tindakan sensitif — masukkan password admin untuk memproses."
                : "Permintaan akan dikirim ke admin untuk persetujuan."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Pesanan </span>
              <span className="font-mono font-semibold">
                {order.orderNumber}
              </span>
            </div>
            {action?.kind === "refund-request" && (
              <div className="space-y-1.5">
                <Label htmlFor="refund-amount">Jumlah Refund (Rp)</Label>
                <Input
                  id="refund-amount"
                  inputMode="numeric"
                  placeholder={`Maks ${Math.floor(
                    Number(order.grandTotal)
                  )}`}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Total tagihan:{" "}
                  <span className="font-medium">
                    {rupiah(Number(order.grandTotal))}
                  </span>
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="approval-reason">Alasan</Label>
              <Input
                id="approval-reason"
                placeholder={
                  action?.kind === "refund-request"
                    ? "Alasan refund"
                    : "Alasan pembatalan"
                }
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            {showPasswordField && (
              <div className="space-y-1.5">
                <Label htmlFor="admin-pw">Password Admin</Label>
                <Input
                  id="admin-pw"
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Wajib untuk memproses"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={submitting}>
              Batal
            </Button>
            <Button
              onClick={submit}
              disabled={
                submitting ||
                !reason.trim() ||
                reason.trim().length < 5 ||
                (!!showPasswordField && !adminPassword)
              }
              className={isAdmin ? "bg-red-600 hover:bg-red-700" : ""}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              {isAdmin ? "Proses" : "Kirim Permintaan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
