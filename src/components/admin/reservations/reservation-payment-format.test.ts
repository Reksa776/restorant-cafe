import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatReservationDateTime,
  formatRupiah,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_BADGE_CLASSES,
  PAYMENT_STATUS_LABELS,
  RESERVATION_STATUS_LABELS,
} from "./reservation-format";

// ============================================================
// PHASE 4 — admin reservation payment display helpers (pure).
//
// Verifies the payment STATUS vocabulary (derived from Order.paymentStatus)
// is fully covered by the label + badge maps, that currency/time formatting
// is null-safe, and that the payment and reservation status vocabularies stay
// DISTINCT (payment state is never derived from reservation status). No DOM,
// no network — node:test, same setup the project already uses.
//
// Run: npx tsx --test --test-force-exit src/components/admin/reservations/reservation-payment-format.test.ts
// ============================================================

/** The seven states the Phase 2 DTO can emit (Order.paymentStatus). */
const PAYMENT_STATES = [
  "UNPAID",
  "PENDING",
  "PAID",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
];

describe("PAYMENT_STATUS_LABELS / badges", () => {
  it("covers every derived payment state with a label and a pill style", () => {
    for (const status of PAYMENT_STATES) {
      assert.ok(PAYMENT_STATUS_LABELS[status], `missing label for ${status}`);
      assert.ok(
        PAYMENT_STATUS_BADGE_CLASSES[status],
        `missing badge classes for ${status}`
      );
    }
  });

  it("keeps the payment vocabulary distinct from the reservation vocabulary", () => {
    // ReservationStatus values that are NOT payment states must not leak into
    // the payment maps, and vice versa — payment state is never derived from
    // reservation status.
    assert.equal(PAYMENT_STATUS_LABELS.CONFIRMED, undefined);
    assert.equal(PAYMENT_STATUS_LABELS.SEATED, undefined);
    assert.equal(PAYMENT_STATUS_LABELS.NO_SHOW, undefined);
    assert.equal(RESERVATION_STATUS_LABELS.PAID, undefined);
    assert.equal(RESERVATION_STATUS_LABELS.UNPAID, undefined);
    assert.equal(RESERVATION_STATUS_LABELS.REFUNDED, undefined);
  });
});

describe("PAYMENT_METHOD_LABELS", () => {
  it("labels the known methods", () => {
    assert.equal(PAYMENT_METHOD_LABELS.QRIS, "QRIS");
    assert.equal(PAYMENT_METHOD_LABELS.KASIR, "Kasir");
  });
});

describe("formatRupiah", () => {
  it("formats with Indonesian thousands separators", () => {
    assert.equal(formatRupiah(125000), "Rp125.000");
    assert.equal(formatRupiah(0), "Rp0");
    assert.equal(formatRupiah(1234567), "Rp1.234.567");
  });

  it("is null/undefined/NaN safe (renders Rp0)", () => {
    assert.equal(formatRupiah(null), "Rp0");
    assert.equal(formatRupiah(undefined), "Rp0");
    assert.equal(formatRupiah(Number.NaN), "Rp0");
  });
});

describe("formatReservationDateTime (payment timestamps)", () => {
  it("renders '-' for null paidAt/expiresAt", () => {
    assert.equal(formatReservationDateTime(null), "-");
    assert.equal(formatReservationDateTime(undefined), "-");
  });

  it("formats an ISO payment timestamp", () => {
    const out = formatReservationDateTime("2026-10-07T15:20:00.000Z");
    assert.ok(out.length > 0 && out !== "-", `unexpected: ${out}`);
  });
});
