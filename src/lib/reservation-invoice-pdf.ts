import {
  formatReservationDate,
  formatRupiah,
  formatTimeSlot,
  RESERVATION_STATUS_LABELS,
  reservationQrPayload,
} from "@/app/(customer)/reservasi/reservation-flow";
import QRCode from "qrcode";

export interface ReservationInvoiceData {
  code: string;
  status: string;
  reservationDate: string;
  startMinutes: number;
  durationMinutes: number;
  partySize: number;
  guestName: string;
  guestPhone?: string | null;
  branch?: { code?: string; name: string } | null;
  table?: { number: number; name?: string | null } | null;
  order?: {
    orderNumber: string;
    paymentStatus: string;
    paymentMethod?: string | null;
    subtotal: number;
    discount: number;
    tax: number;
    serviceCharge: number;
    grandTotal: number;
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }>;
  } | null;
  payment?: {
    method?: string | null;
    status: string;
    paidAt?: string | null;
  } | null;
}

type PdfLine = {
  text?: string;
  bold?: boolean;
  size?: number;
  align?: "left" | "center" | "right";
  rule?: boolean;
  gap?: number;
  qrSize?: number;
};

const PAYMENT_LABELS: Record<string, string> = {
  UNPAID: "BELUM DIBAYAR",
  PENDING: "MENUNGGU PEMBAYARAN",
  PAID: "LUNAS",
  FAILED: "PEMBAYARAN GAGAL",
  EXPIRED: "PEMBAYARAN KEDALUWARSA",
  REFUNDED: "DANA DIKEMBALIKAN",
  CANCELLED: "PEMBAYARAN DIBATALKAN",
};

function ascii(value: string): string {
  return value
    .replace(/×/g, "x")
    .replace(/[·•]/g, "-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ");
}

function escapePdfText(value: string): string {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(value: string, max = 43): string[] {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const output: string[] = [];
  let line = "";
  for (const word of words) {
    const chunks = word.length > max ? word.match(new RegExp(`.{1,${max}}`, "g")) ?? [word] : [word];
    for (const chunk of chunks) {
      if (line && `${line} ${chunk}`.length > max) {
        output.push(line);
        line = chunk;
      } else {
        line = line ? `${line} ${chunk}` : chunk;
      }
    }
  }
  if (line) output.push(line);
  return output.length ? output : [""];
}

function paymentMethodLabel(method?: string | null): string {
  if (method === "KASIR") return "Kasir / Tunai";
  if (method === "QRIS") return "QRIS";
  return method || "-";
}

function dateTimeLabel(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function buildInvoiceLines(
  reservation: ReservationInvoiceData,
  siteName: string
): PdfLine[] {
  const order = reservation.order;
  const paymentStatus = order?.paymentStatus ?? reservation.payment?.status;
  const paid = paymentStatus === "PAID";
  const lines: PdfLine[] = [
    { text: siteName || "Restoran", bold: true, size: 13, align: "center", gap: 2 },
    { text: "INVOICE RESERVASI", bold: true, size: 11, align: "center", gap: 2 },
    { text: reservation.code, bold: true, size: 12, align: "center" },
    { qrSize: 84, gap: 4 },
    { rule: true, gap: 3 },
    { text: `Nama: ${reservation.guestName}` },
  ];
  if (reservation.guestPhone) lines.push({ text: `WhatsApp: ${reservation.guestPhone}` });
  lines.push(
    { text: `Cabang: ${reservation.branch?.name ?? "-"}` },
    { text: `Tanggal: ${formatReservationDate(reservation.reservationDate)}` },
    { text: `Jam: ${formatTimeSlot(reservation.startMinutes, reservation.durationMinutes)}` },
    { text: `Jumlah tamu: ${reservation.partySize} orang` },
    { text: `Meja: ${reservation.table ? `Meja ${reservation.table.number}${reservation.table.name ? ` - ${reservation.table.name}` : ""}` : "Belum ditentukan"}` },
    { text: `Status reservasi: ${RESERVATION_STATUS_LABELS[reservation.status] ?? reservation.status}` },
    { rule: true, gap: 3 }
  );

  if (order) {
    lines.push({ text: `PESANAN ${order.orderNumber}`, bold: true, gap: 1 });
    for (const item of order.items) {
      lines.push(...wrap(item.name).map((text) => ({ text })));
      lines.push({ text: `${item.quantity} x ${formatRupiah(item.unitPrice)} = ${formatRupiah(item.totalPrice)}`, gap: 1 });
    }
    lines.push({ rule: true, gap: 2 });
    lines.push({ text: `Subtotal: ${formatRupiah(order.subtotal)}` });
    if (order.discount > 0) lines.push({ text: `Diskon: -${formatRupiah(order.discount)}` });
    if (order.tax > 0) lines.push({ text: `Pajak: ${formatRupiah(order.tax)}` });
    if (order.serviceCharge > 0) lines.push({ text: `Service charge: ${formatRupiah(order.serviceCharge)}` });
    lines.push({ text: `TOTAL: ${formatRupiah(order.grandTotal)}`, bold: true, size: 11, gap: 2 });
    lines.push({ rule: true, gap: 2 });
    lines.push({ text: `STATUS: ${PAYMENT_LABELS[paymentStatus ?? "UNPAID"] ?? paymentStatus ?? "BELUM DIBAYAR"}`, bold: true, size: 10 });
    lines.push({ text: `Metode: ${paymentMethodLabel(reservation.payment?.method ?? order.paymentMethod)}` });
    if (paid && reservation.payment?.paidAt) lines.push({ text: `Dibayar: ${dateTimeLabel(reservation.payment.paidAt)}` });
    if (!paid) lines.push({ text: "INI TAGIHAN, BUKAN BUKTI PEMBAYARAN.", bold: true, align: "center", gap: 2 });
  }

  lines.push(
    { rule: true, gap: 3 },
    { text: "Tunjukkan kode reservasi ini kepada kasir.", align: "center" },
    { text: "Simpan invoice ini untuk referensi Anda.", align: "center" }
  );
  return lines;
}

/** Create a one-page, 80 mm wide PDF using built-in PDF Type 1 fonts. */
export function createReservationInvoicePdf(
  reservation: ReservationInvoiceData,
  siteName: string
): Uint8Array {
  const pageWidth = 226.77; // 80 mm
  const margin = 14;
  const lines = buildInvoiceLines(reservation, siteName);
  const lineHeight = 12;
  const pageHeight = Math.max(300, 24 + lines.reduce((sum, line) => sum + (line.qrSize ?? 0) + (line.rule ? 5 : line.gap ?? 0) + lineHeight * (line.text ? wrap(line.text).length : 0), 0));
  let top = 14;
  const commands: string[] = [];
  const qr = QRCode.create(reservationQrPayload(reservation.code), {
    errorCorrectionLevel: "M",
  }).modules;

  for (const line of lines) {
    if (line.qrSize) {
      top += line.gap ?? 0;
      const moduleSize = line.qrSize / qr.size;
      const left = (pageWidth - line.qrSize) / 2;
      for (let row = 0; row < qr.size; row += 1) {
        for (let column = 0; column < qr.size; column += 1) {
          if (!qr.get(row, column)) continue;
          const x = left + column * moduleSize;
          const y = pageHeight - top - line.qrSize + (qr.size - row - 1) * moduleSize;
          commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${moduleSize.toFixed(2)} ${moduleSize.toFixed(2)} re f`);
        }
      }
      top += line.qrSize;
      continue;
    }
    if (line.rule) {
      top += line.gap ?? 0;
      const y = pageHeight - top;
      commands.push(`0.5 w ${margin} ${y.toFixed(2)} m ${(pageWidth - margin).toFixed(2)} ${y.toFixed(2)} l S`);
      top += 5;
      continue;
    }
    top += line.gap ?? 0;
    if (!line.text) continue;
    const fontSize = line.size ?? 8.5;
    for (const text of wrap(line.text)) {
      const widthEstimate = text.length * fontSize * 0.5;
      const x = line.align === "center"
        ? Math.max(margin, (pageWidth - widthEstimate) / 2)
        : line.align === "right"
          ? Math.max(margin, pageWidth - margin - widthEstimate)
          : margin;
      const y = pageHeight - top - fontSize;
      commands.push(`BT /${line.bold ? "F2" : "F1"} ${fontSize} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfText(text)}) Tj ET`);
      top += lineHeight;
    }
  }

  const content = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function downloadReservationInvoicePdf(
  reservation: ReservationInvoiceData,
  siteName: string
): void {
  const pdf = createReservationInvoicePdf(reservation, siteName);
  const url = URL.createObjectURL(
    new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `invoice-reservasi-${reservation.code}.pdf`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
