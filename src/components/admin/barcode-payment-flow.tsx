"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Label,
} from "@/components/ui/label";
import {
  Banknote,
  QrCode,
  Loader2,
  XCircle,
  CheckCircle2,
  ScanLine,
} from "lucide-react";
import { toast } from "sonner";
import { OrderScanner } from "@/components/admin/order-scanner";
import { paymentService, type Payment } from "@/services/payment.service";
import { orderService, type Order } from "@/services/order.service";

const rupiah = (v: string | number) =>
  `Rp${Number(v).toLocaleString("id-ID")}`;

type PaymentMethod = "CASH" | "QRIS" | null;
type PayStatus =
  | "choose"
  | "cash-form"
  | "qris-loading"
  | "qris-ready"
  | "success"
  | "error"
  | "paid";
type ScanStatus =
  | "idle"
  | "opening"
  | "scanning"
  | "order-found"
  | "invalid";

interface BarcodePaymentFlowProps {
  onPaymentCompleted?: (orderId: string, orderNumber: string) => void;
}

export function BarcodePaymentFlow({
  onPaymentCompleted,
}: BarcodePaymentFlowProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [order, setOrder] = useState<Order | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(null);
  const [payStatus, setPayStatus] = useState<PayStatus>("choose");
  const [pendingPayment, setPendingPayment] = useState<Payment | null>(null);
  const [receivedRaw, setReceivedRaw] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadOrder = useCallback(async (orderNumber: string) => {
    try {
      const data = await orderService.getOrderByNumber(orderNumber);
      setOrder(data);
      setScanStatus("order-found");
      setPaymentMethod(null);
      setPayStatus("choose");
      setPendingPayment(null);
      setReceivedRaw("");
      setErrorMsg(null);
    } catch {
      setErrorMsg("Pesanan tidak ditemukan.");
      setScanStatus("invalid");
    }
  }, []);

  const findCashierPayment = useCallback((ord: Order): Payment | undefined => {
    const payments = (ord.payments || [])
      .slice()
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
    return payments.find((p) => p.method === "KASIR" && p.status === "UNPAID");
  }, []);

  const onScan = useCallback(
    (orderNumber: string) => {
      setScanStatus("opening");
      loadOrder(orderNumber).then(() => {
        setScanStatus("order-found");
      });
    },
    [loadOrder]
  );

  useEffect(() => {
    if (!dialogOpen) {
      setOrder(null);
      setPaymentMethod(null);
      setPayStatus("choose");
      setPendingPayment(null);
      setReceivedRaw("");
      setErrorMsg(null);
      setScanStatus("idle");
    }
  }, [dialogOpen]);

  const resetToChoose = () => {
    setPaymentMethod(null);
    setPayStatus("choose");
    setPendingPayment(null);
    setReceivedRaw("");
    setErrorMsg(null);
  };

  const handleClose = () => {
    setDialogOpen(false);
  };

  const startScanner = () => {
    setScanStatus("scanning");
    setOrder(null);
    setPaymentMethod(null);
    setPayStatus("choose");
    setErrorMsg(null);
  };

  const cashAmountDue = order ? Number(order.grandTotal) : 0;
  const received = useMemo(() => {
    const digits = receivedRaw.replace(/[^\d]/g, "");
    return digits ? Number(digits) : 0;
  }, [receivedRaw]);

  const changeAmount = Math.max(0, received - cashAmountDue);
  const hasInput = receivedRaw.trim().length > 0;
  const insufficient = hasInput && received < cashAmountDue;
  const canSubmitCash =
    hasInput && !insufficient && received >= cashAmountDue && !isSubmitting;

  const handleCashSubmit = async () => {
    if (!canSubmitCash || !order) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const payments = (order.payments || [])
        .slice()
        .sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        });

      let cashierPayment = payments.find(
        (p) => p.method === "KASIR" && p.status === "UNPAID"
      );

      if (!cashierPayment) {
        const created = await paymentService.createPayment(order.id, {
          method: "KASIR",
        });
        cashierPayment = created;
      }

      const result = await paymentService.markCashierPaymentPaid(
        cashierPayment.id,
        received
      );

      if (result.alreadyPaid) {
        setPayStatus("paid");
        setErrorMsg(null);
        onPaymentCompleted?.(order.id, order.orderNumber);
        return;
      }

      setPayStatus("success");
      setPendingPayment(cashierPayment);
      onPaymentCompleted?.(order.id, order.orderNumber);
    } catch (error) {
      console.error("Cash payment failed:", error);
      const msg = (error as any)?.response?.data?.message;
      setErrorMsg(msg || "Gagal memproses pembayaran cash.");
      setPayStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQrisSelect = async () => {
    if (!order) return;
    setPayStatus("qris-loading");
    setErrorMsg(null);
    try {
      const result = await paymentService.createKasirQrisPayment(
        order.orderNumber
      );
      if (result.kind === "kasir_existing") {
        setPayStatus("cash-form");
        toast.info(
          "Pembayaran kasir sudah tercatat. Silakan masukkan uang diterima."
        );
        return;
      }
      if (result.kind === "pending_existing") {
        setPendingPayment(result.payment as unknown as Payment);
        setPayStatus("qris-ready");
        return;
      }
      setPendingPayment(result.payment as unknown as Payment);
      setPayStatus("qris-ready");
    } catch (error) {
      console.error("QRIS creation failed:", error);
      const msg = (error as any)?.response?.data?.message;
      setErrorMsg(msg || "Gagal membuat pembayaran QRIS.");
      setPayStatus("error");
    }
  };

  const handleQrisSuccess = () => {
    if (!order) return;
    setPayStatus("success");
    onPaymentCompleted?.(order.id, order.orderNumber);
  };

  const isQrisPayment = pendingPayment?.method === "QRIS";
  const isQrisPending = pendingPayment?.status === "PENDING";
  const isQrisFailedOrExpired =
    pendingPayment &&
    (pendingPayment.status === "FAILED" || pendingPayment.status === "EXPIRED");

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            Pembayaran dari Scan Barcode
          </DialogTitle>
          <DialogDescription>
            Scan QR pesanan, lalu pilih metode pembayaran.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {scanStatus === "scanning" && (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Memindai QR pesanan...
              </p>
              <OrderScanner
                onScan={onScan}
                triggerLabel="Mulai Scan"
                triggerVariant="default"
              />
            </div>
          )}

          {scanStatus === "order-found" && order && (
            <>
              <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nomor Pesanan</span>
                  <span className="font-mono font-semibold">
                    {order.orderNumber}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pelanggan</span>
                  <span className="font-medium">
                    {order.customer?.name || "Guest"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-bold text-base tabular-nums">
                    {rupiah(order.grandTotal)}
                  </span>
                </div>
              </div>

              {payStatus === "choose" && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-center">
                    Pilih Metode Pembayaran
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMethod("CASH");
                      setPayStatus("cash-form");
                    }}
                    className={`w-full flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors ${
                      paymentMethod === "CASH"
                        ? "border-green-500 bg-green-50"
                        : "border-gray-200 hover:border-green-300"
                    }`}
                  >
                    <Banknote
                      className={`h-8 w-8 ${
                        paymentMethod === "CASH"
                          ? "text-green-600"
                          : "text-gray-500"
                      }`}
                    />
                    <div className="text-center">
                      <p className="font-semibold text-sm">
                        {rupiah(order.grandTotal)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Cash / Tunai
                      </p>
                    </div>
                    {paymentMethod === "CASH" && (
                      <span className="text-xs text-green-600 font-medium">
                        Dipilih
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMethod("QRIS");
                      handleQrisSelect();
                    }}
                    disabled={isSubmitting}
                    className={`w-full flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors ${
                      paymentMethod === "QRIS"
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-blue-300"
                    }`}
                  >
                    <QrCode
                      className={`h-8 w-8 ${
                        paymentMethod === "QRIS"
                          ? "text-blue-600"
                          : "text-gray-500"
                      }`}
                    />
                    <div className="text-center">
                      <p className="font-semibold text-sm">QRIS</p>
                      <p className="text-xs text-muted-foreground">
                        Scan oleh customer
                      </p>
                    </div>
                    {paymentMethod === "QRIS" && (
                      <span className="text-xs text-blue-600 font-medium">
                        Dipilih
                      </span>
                    )}
                  </button>
                </div>
              )}

              {payStatus === "cash-form" && (
                <div className="space-y-3">
                  <div className="rounded-xl border bg-muted/30 p-2.5 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Tagihan</span>
                      <span className="font-bold tabular-nums">
                        {rupiah(order.grandTotal)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="cash-received">Uang Diterima (Rp)</Label>
                      <Input
                        id="cash-received"
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
                    </div>

                    <div className="flex gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setReceivedRaw(String(cashAmountDue))}
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

                  {errorMsg && (
                    <p className="text-xs text-red-600 text-center">{errorMsg}</p>
                  )}
                </div>
              )}

              {payStatus === "qris-loading" && (
                <div className="text-center py-4">
                  <Loader2 className="h-8 w-8 mx-auto animate-spin text-blue-500" />
                  <p className="text-sm text-muted-foreground mt-2">
                    Membuat QRIS...
                  </p>
                </div>
              )}

              {payStatus === "qris-ready" && pendingPayment && (
                <div className="space-y-3">
                  {isQrisPayment && (
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      {isQrisPending ? (
                        <div className="flex flex-col items-center gap-3 py-2">
                          <div className="w-48 h-48 flex items-center justify-center">
                            {pendingPayment.qrString && (
                              <img
                                src={pendingPayment.qrString}
                                alt="QRIS"
                                className="w-full h-auto object-contain"
                              />
                            )}
                            {!pendingPayment.qrString && (
                              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                                <QrCode className="h-8 w-8 text-gray-400" />
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-amber-600">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Menunggu pembayaran...
                          </div>
                          <p className="text-xs text-gray-500 text-center">
                            Scan QRIS dengan aplikasi mobile banking atau e-wallet
                          </p>
                        </div>
                      ) : isQrisFailedOrExpired ? (
                        <div className="text-center py-2">
                          <XCircle className="h-8 w-8 mx-auto text-red-500" />
                          <p className="text-sm text-red-600 mt-2">
                            QRIS{" "}
                            {pendingPayment.status === "FAILED"
                              ? "gagal"
                              : "kedaluwarsa"}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleQrisSelect()}
                          >
                            Buat QRIS Baru
                          </Button>
                        </div>
                      ) : (
                        <div className="text-center py-2">
                          <CheckCircle2 className="h-8 w-8 mx-auto text-green-500" />
                          <p className="text-sm text-green-600 mt-2">
                            QRIS berhasil dibuat
                          </p>
                          <div className="mt-2 rounded-xl bg-gray-100 p-2 text-xs text-center">
                            {pendingPayment.qrImage && (
                              <img
                                src={pendingPayment.qrImage}
                                alt="QRIS"
                                className="mx-auto max-w-xs"
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full bg-green-600 hover:bg-green-700"
                    onClick={handleQrisSuccess}
                  >
                    {isQrisPending ? "Tunggu Status Pembayaran" : "Lanjutkan"}
                  </Button>
                </div>
              )}

              {payStatus === "success" && (
                <div className="text-center space-y-4 py-4">
                  <div className="w-16 h-16 rounded-full bg-green-50 mx-auto flex items-center justify-center">
                    <CheckCircle2 className="h-9 w-9 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-green-700">
                      Pembayaran Berhasil
                    </h3>
                    <p className="text-sm text-muted-foreground font-mono mt-1">
                      {order.orderNumber}
                    </p>
                  </div>

                  <div className="rounded-xl border bg-muted/40 p-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-semibold tabular-nums">
                        {rupiah(order.grandTotal)}
                      </span>
                    </div>
                    {payStatus === "success" &&
                      receivedRaw &&
                      payStatus === "cash-form" && (
                        <>
                          <div className="flex justify-between text-sm mt-1.5 pt-1.5 border-t">
                            <span className="text-muted-foreground">Diterima</span>
                            <span className="font-semibold tabular-nums">
                              {rupiah(received)}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm mt-1.5">
                            <span className="text-muted-foreground">Kembalian</span>
                            <span
                              className={`font-bold tabular-nums ${
                                changeAmount > 0 ? "text-green-700" : "text-muted-foreground"
                              }`}
                            >
                              {rupiah(changeAmount)}
                            </span>
                          </div>
                        </>
                      )}
                  </div>
                </div>
              )}

              {payStatus === "error" && (
                <div className="text-center py-4">
                  <XCircle className="h-8 w-8 mx-auto text-red-500" />
                  <p className="text-sm text-red-600 mt-2">{errorMsg}</p>
                  <Button
                    variant="outline"
                    className="mt-3"
                    onClick={resetToChoose}
                  >
                    Coba Lagi
                  </Button>
                </div>
              )}

              {payStatus === "paid" && (
                <div className="text-center py-4">
                  <CheckCircle2 className="h-8 w-8 mx-auto text-green-500" />
                  <p className="text-sm text-green-600 mt-2 font-medium">
                    Order sudah dibayar
                  </p>
                </div>
              )}
            </>
          )}

          {scanStatus === "invalid" && (
            <div className="text-center py-4">
              <XCircle className="h-8 w-8 mx-auto text-red-500" />
              <p className="text-sm text-red-600 mt-2">{errorMsg}</p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setScanStatus("scanning");
                  setOrder(null);
                  setErrorMsg(null);
                }}
              >
                Scan Lagi
              </Button>
            </div>
          )}

          {scanStatus === "idle" && (
            <div className="space-y-2">
              <Button onClick={startScanner} className="w-full">
                <ScanLine className="h-4 w-4 mr-2" />
                Scan QR Pesanan
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Arahkan kamera ke QR pesanan pelanggan
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
