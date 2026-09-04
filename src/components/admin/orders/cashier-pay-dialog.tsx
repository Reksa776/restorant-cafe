"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Banknote, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { paymentService } from "@/services/payment.service";
import type { Order } from "@/services/order.service";

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

interface PaymentSnapshot {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  amountDue: number;
}

/**
 * Cashier payment form for a KASIR UNPAID payment.
 *
 * Shows the order summary (order number, customer, grand total, payment
 * status), takes the cash received (amountReceived), auto-calculates the
 * change (amountReceived − amountDue) and rejects amounts below the due
 * total with "Uang yang diterima kurang dari total tagihan" (the server
 * enforces the same rule). On success a receipt is shown inside the dialog.
 *
 * The payment data is snapshotted when the dialog OPENS — once the payment
 * succeeds the parent refetches the order (now PAID), so the receipt must not
 * depend on a still-UNPAID payment row to stay visible.
 *
 * Money rules are enforced server-side in markCashierPaymentPaid — this
 * dialog only drives the UI; the server never trusts the client amount.
 */
export function CashierPayDialog({
  order,
  open,
  onOpenChange,
  onCompleted,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: (
    paymentId: string,
    orderId: string,
    audit: { amountDue: number; amountReceived: number; changeAmount: number }
  ) => void;
}) {
  const [snapshot, setSnapshot] = useState<PaymentSnapshot | null>(null);
  const [receivedRaw, setReceivedRaw] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<{
    amountDue: number;
    amountReceived: number;
    changeAmount: number;
  } | null>(null);

  // Capture the payment at open time (parent may refetch it to PAID during
  // the success flow — the receipt keeps rendering from the snapshot).
  useEffect(() => {
    if (!open) return;
    const payments = (order?.payments || [])
      .slice()
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
    const unpaid = payments.find(
      (p) => p.method === "KASIR" && p.status === "UNPAID"
    );
    if (unpaid && order) {
      setSnapshot({
        paymentId: unpaid.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customer?.name || "Guest",
        amountDue: Math.round(Number(unpaid.amount) * 100) / 100,
      });
    } else {
      setSnapshot(null);
    }
    setReceivedRaw("");
    setReceipt(null);
    setIsSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const amountDue = snapshot?.amountDue ?? 0;

  const received = useMemo(() => {
    const digits = receivedRaw.replace(/[^\d]/g, "");
    return digits ? Number(digits) : 0;
  }, [receivedRaw]);

  const changeAmount = Math.max(0, received - amountDue);
  const hasInput = receivedRaw.trim().length > 0;
  const insufficient = hasInput && received < amountDue;
  const canSubmit =
    hasInput && !insufficient && received >= amountDue && !isSubmitting;

  if (!snapshot) return null;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const result = await paymentService.markCashierPaymentPaid(
        snapshot.paymentId,
        received
      );
      if (result.alreadyPaid) {
        toast.error("Payment already completed");
        onOpenChange(false);
        return;
      }
      setReceipt(result.audit);
      onCompleted?.(
        snapshot.paymentId,
        snapshot.orderId,
        result.audit
      );
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (error as any)?.response?.data?.message;
      if ((error as { response?: { status?: number } })?.response?.status === 409) {
        toast.error("Payment already completed");
        onOpenChange(false);
        return;
      }
      toast.error(msg || "Gagal memproses pembayaran kasir");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {receipt ? (
          // ============================================================
          // RECEIPT — payment was completed
          // ============================================================
          <div className="text-center space-y-4 py-2">
            <div className="w-16 h-16 rounded-full bg-green-50 mx-auto flex items-center justify-center">
              <CheckCircle2 className="h-9 w-9 text-green-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-green-700">
                Pembayaran Berhasil
              </h3>
              <p className="text-sm text-muted-foreground font-mono mt-1">
                {snapshot.orderNumber}
              </p>
            </div>
            <div className="rounded-xl border bg-muted/40 divide-y text-sm">
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold tabular-nums">
                  {rupiah(receipt.amountDue)}
                </span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Diterima</span>
                <span className="font-semibold tabular-nums">
                  {rupiah(receipt.amountReceived)}
                </span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Kembalian</span>
                <span
                  className={`font-bold tabular-nums ${
                    receipt.changeAmount > 0
                      ? "text-green-700"
                      : "text-muted-foreground"
                  }`}
                >
                  {rupiah(receipt.changeAmount)}
                </span>
              </div>
            </div>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Selesai
            </Button>
          </div>
        ) : (
          // ============================================================
          // FORM
          // ============================================================
          <>
            <DialogHeader>
              <DialogTitle>Proses Pembayaran Kasir</DialogTitle>
              <DialogDescription>
                Masukkan uang yang diterima dari pelanggan.
              </DialogDescription>
            </DialogHeader>

            {/* Order summary */}
            <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nomor Pesanan</span>
                <span className="font-mono font-semibold">
                  {snapshot.orderNumber}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pelanggan</span>
                <span className="font-medium">{snapshot.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Tagihan</span>
                <span className="font-bold text-base tabular-nums">
                  {rupiah(snapshot.amountDue)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium">UNPAID</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cashier-received">Uang Diterima (Rp)</Label>
                <Input
                  id="cashier-received"
                  inputMode="numeric"
                  autoFocus
                  placeholder="0"
                  value={receivedRaw}
                  onChange={(e) => setReceivedRaw(e.target.value)}
                  className={insufficient ? "border-red-400" : ""}
                />
                {insufficient && (
                  <p className="text-xs font-medium text-red-600">
                    Uang yang diterima kurang dari total tagihan
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setReceivedRaw(String(snapshot.amountDue))
                    }
                  >
                    Uang Pas
                  </Button>
                </div>
              </div>

              <div className="rounded-xl bg-gray-100 p-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Banknote className="h-4 w-4" />
                  Kembalian
                </span>
                <span
                  className={`text-xl font-bold tabular-nums ${
                    insufficient ? "text-red-600" : "text-green-700"
                  }`}
                >
                  {hasInput ? rupiah(changeAmount) : "Rp0"}
                </span>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Batal
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="bg-green-600 hover:bg-green-700"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : null}
                Konfirmasi Pembayaran
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
