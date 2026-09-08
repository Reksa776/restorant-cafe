"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Order } from "@/services/order.service";

// ============================================================
// Print Bill Dialog
// ============================================================
// Renders a print-ready bill for an order (A4 / thermal 58mm / thermal
// 80mm). Pure client-side: window.print() never mutates the order or its
// payments — the bill is built entirely from the already-loaded order data
// (admin endpoints are tenant-scoped server-side).
//
// The bill intentionally shows only safe data: restaurant header, order
// meta, items + customizations, totals, payment method/status and the
// cashier audit (received/change). It NEVER prints payment secrets
// (providerRef / qrString / paymentUrl).
// ============================================================

type PaperFormat = "a4" | "thermal80" | "thermal58";

const PAPER_OPTIONS: Array<{ value: PaperFormat; label: string }> = [
  { value: "a4", label: "A4" },
  { value: "thermal80", label: "Thermal 80mm" },
  { value: "thermal58", label: "Thermal 58mm" },
];

const rupiah = (v: string | number) => `Rp${Number(v).toLocaleString("id-ID")}`;

const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine In",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  UNPAID: "Belum Bayar",
  PENDING: "Menunggu Pembayaran",
  PAID: "Lunas",
  FAILED: "Gagal",
  EXPIRED: "Kedaluwarsa",
  REFUNDED: "Dikembalikan",
  CANCELLED: "Dibatalkan",
};

interface CustomizationSnapshot {
  selections?: Array<{
    groupName: string;
    optionName: string;
    priceAdjustment?: number;
  }>;
  addons?: Array<{ name: string; price: number; quantity: number }>;
  notes?: string;
}

function parseCustomizations(
  value?: string | Record<string, unknown> | null
): CustomizationSnapshot | null {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

/**
 * Pull the cashier audit (received / change) out of the payment
 * transactions — same convention the order detail page uses.
 */
function getCashierAudit(payment: NonNullable<Order["payments"]>[number]) {
  const cashierTxn = (payment.transactions || []).find(
    (t) => t.type === "cashier_payment" && t.status === "PAID"
  );
  if (!cashierTxn) return null;
  let rd = cashierTxn.rawData;
  if (typeof rd === "string") {
    try {
      rd = JSON.parse(rd);
    } catch {
      rd = null;
    }
  }
  if (rd && rd.amountReceived !== undefined) {
    return {
      amountReceived: Number(rd.amountReceived),
      changeAmount: Number(rd.changeAmount || 0),
    };
  }
  return null;
}

export function PrintBillDialog({
  order,
  open,
  onOpenChange,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [paper, setPaper] = useState<PaperFormat>("a4");

  if (!order) return null;

  const siteName =
    order.restaurant?.settings?.siteName || order.restaurant?.name || "Restoran";
  const logoUrl = order.restaurant?.settings?.logoUrl || null;
  const restAddress = order.restaurant?.address || null;
  const restPhone = order.restaurant?.phone || null;

  const orderDate = new Date(order.createdAt).toLocaleString("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const typeLabel = ORDER_TYPE_LABEL[order.orderType] || order.orderType;
  const payLabel =
    PAYMENT_STATUS_LABEL[order.paymentStatus] || order.paymentStatus;

  // Latest payment drives the method/audit line (KASIR received/change).
  const payments = (order.payments || [])
    .slice()
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime()
    );
  const latestPayment = payments[0] || null;
  const cashierAudit = latestPayment
    ? getCashierAudit(latestPayment)
    : null;

  const methodLabel = (() => {
    if (!latestPayment) return null;
    if (latestPayment.method === "KASIR") return "Kasir";
    if (latestPayment.method === "QRIS") return "QRIS";
    if (latestPayment.provider === "ipaymu" && !latestPayment.method)
      return "VA iPaymu";
    return latestPayment.method || "Pembayaran";
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {/* Toolbar (never printed) */}
        <div className="print:hidden flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {PAPER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPaper(opt.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  paper === opt.value
                    ? "bg-gray-900 text-white border-gray-900"
                    : "border-gray-300 text-gray-600 hover:bg-gray-100"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" />
            Cetak Bill
          </Button>
        </div>

        {/* ==================================================
            BILL — the only thing visible when printing
            ================================================== */}
        <div id="bill-print-root" className="print:absolute print:inset-0 print:w-full">
          <div
            className={`bill-inner mx-auto bg-white text-gray-900 ${
              paper === "thermal58"
                ? "w-full sm:w-[52mm]"
                : paper === "thermal80"
                  ? "w-full sm:w-[72mm]"
                  : "w-full sm:max-w-[190mm]"
            } px-1 py-2 text-[13px] leading-relaxed`}
          >
            {/* Header */}
            <div className="text-center border-b-2 border-dashed border-gray-300 pb-3 mb-3">
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={siteName}
                  className="mx-auto h-12 w-12 object-contain mb-1.5"
                />
              )}
              <h1 className="text-base font-bold uppercase tracking-wide">
                {siteName}
              </h1>
              {restAddress && <p className="text-xs text-gray-600">{restAddress}</p>}
              {restPhone && <p className="text-xs text-gray-600">Telp: {restPhone}</p>}
            </div>

            {/* Order meta */}
            <div className="space-y-0.5 text-[13px]">
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">No. Order</span>
                <span className="font-mono font-medium">{order.orderNumber}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Tanggal</span>
                <span>{orderDate}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Tipe</span>
                <span>{typeLabel}</span>
              </div>
              {order.orderType === "DINE_IN" && order.table && (
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">Meja</span>
                  <span>
                    {order.table.name} ({order.table.number})
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Customer</span>
                <span>{order.customer?.name || "Guest"}</span>
              </div>
            </div>

            {/* Items */}
            <div className="mt-3 border-t-2 border-dashed border-gray-300 pt-2">
              <div className="flex justify-between font-semibold text-[13px] border-b border-gray-200 pb-1 mb-1">
                <span>Item</span>
                <span>Total</span>
              </div>
              {(order.items || []).map((item) => {
                const customizations = parseCustomizations(item.customizations);
                return (
                  <div key={item.id} className="py-1">
                    <div className="flex justify-between gap-2">
                      <span>
                        <span className="font-medium">{item.quantity}x</span>{" "}
                        {item.product.name}
                      </span>
                      <span className="tabular-nums whitespace-nowrap">
                        {rupiah(item.totalPrice)}
                      </span>
                    </div>
                    {customizations?.selections &&
                      customizations.selections.length > 0 && (
                        <div className="pl-3 text-[12px] text-gray-600">
                          {customizations.selections.map((s, i) => (
                            <p key={i}>
                              {s.groupName}: {s.optionName}
                              {Number(s.priceAdjustment) !== 0 && (
                                <span>
                                  {" "}
                                  ({Number(s.priceAdjustment) > 0 ? "+" : ""}
                                  {rupiah(Math.abs(Number(s.priceAdjustment)))})
                                </span>
                              )}
                            </p>
                          ))}
                        </div>
                      )}
                    {customizations?.addons &&
                      customizations.addons.length > 0 && (
                        <div className="pl-3 text-[12px] text-gray-600">
                          {customizations.addons.map((a, i) => (
                            <p key={i}>
                              + {a.name} x{a.quantity}
                            </p>
                          ))}
                        </div>
                      )}
                    {item.notes && (
                      <p className="pl-3 text-[12px] text-gray-600 italic">
                        Catatan: {item.notes}
                      </p>
                    )}
                    {Number(item.unitPrice) !==
                      Number(item.totalPrice) / Math.max(item.quantity, 1) && (
                      <p className="pl-3 text-[11px] text-gray-500">
                        @ {rupiah(item.unitPrice)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Totals */}
            <div className="mt-2 border-t-2 border-dashed border-gray-300 pt-2 space-y-0.5">
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Subtotal</span>
                <span className="tabular-nums">{rupiah(order.subtotal)}</span>
              </div>
              {Number(order.discount) > 0 && (
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">Diskon</span>
                  <span className="tabular-nums">
                    -{rupiah(order.discount)}
                  </span>
                </div>
              )}
              {Number(order.tax) > 0 && (
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">Pajak (10%)</span>
                  <span className="tabular-nums">{rupiah(order.tax)}</span>
                </div>
              )}
              {Number(order.serviceCharge) > 0 && (
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">Service Charge</span>
                  <span className="tabular-nums">
                    {rupiah(order.serviceCharge)}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-2 font-bold text-[15px] border-t border-gray-300 pt-1 mt-1">
                <span>Total</span>
                <span className="tabular-nums">{rupiah(order.grandTotal)}</span>
              </div>
            </div>

            {/* Payment */}
            <div className="mt-3 border-t-2 border-dashed border-gray-300 pt-2 space-y-0.5">
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Status Pembayaran</span>
                <span className="font-medium">{payLabel}</span>
              </div>
              {latestPayment && (
                <>
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-500">Metode</span>
                    <span>{methodLabel || "—"}</span>
                  </div>
                  {latestPayment.paidAt && (
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-500">Dibayar</span>
                      <span>
                        {new Date(latestPayment.paidAt).toLocaleString("id-ID", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                  )}
                </>
              )}
              {cashierAudit && (
                <>
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-500">Uang Diterima</span>
                    <span className="tabular-nums">
                      {rupiah(cashierAudit.amountReceived)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-500">Kembalian</span>
                    <span className="tabular-nums">
                      {rupiah(cashierAudit.changeAmount)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="mt-4 pt-2 border-t-2 border-dashed border-gray-300 text-center text-xs text-gray-500">
              <p>Terima kasih atas kunjungan Anda</p>
              <p className="mt-0.5 font-mono text-[11px]">{order.orderNumber}</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}