"use client";

import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import type { ReservationTableView } from "@/services/reservation.service";

interface ReservationCancelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservation: ReservationTableView | null;
  pending: boolean;
  onConfirm: (cancelReason: string) => void;
}

/**
 * Cancel-with-reason dialog. The reason is OPTIONAL (the R2 cancel kernel and
 * the R3 cancel endpoint both accept an empty body); the server stays the
 * authority on whether the transition is legal (409 surfaces on the page).
 */
export function ReservationCancelDialog({
  open,
  onOpenChange,
  reservation,
  pending,
  onConfirm,
}: ReservationCancelDialogProps) {
  const [reason, setReason] = useState("");

  // Reset the draft reason whenever the dialog closes (open/close is the only
  // transition that touches the field — no effect needed, and never a stale
  // reason from the previous reservation on the next open).
  const handleOpenChange = (next: boolean) => {
    if (!next) setReason("");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Batalkan Reservasi</DialogTitle>
          <DialogDescription>
            Batalkan reservasi{" "}
            <span className="font-medium text-foreground">
              {reservation?.code ?? ""}
            </span>
            {" "}({reservation?.guestName ?? "—"})
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="cancel-reason">Alasan pembatalan (opsional)</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: tamu batal datang, jam berubah, dsb."
              maxLength={200}
              rows={3}
              className="mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Batal
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => onConfirm(reason)}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Konfirmasi Pembatalan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}