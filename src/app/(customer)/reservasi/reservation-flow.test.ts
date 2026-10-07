import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RESERVATION_MAX_HORIZON_DAYS,
} from "@/services/reservation/reservation.slots";
import {
  PAYMENT_STATUS_LABELS,
  PURCHASE_EMPTY_MESSAGE,
  PURCHASE_STEP_TITLE,
  RESERVATION_CONFLICT_MESSAGE,
  RESERVATION_PAYMENT_METHOD_LABELS,
  RESERVATION_STEP_LABELS,
  RESERVATION_STATUS_LABELS,
  RESERVATION_WIZARD_STEPS,
  buildCandidateSlots,
  formatReservationDate,
  formatRupiah,
  formatStartMinutes,
  formatTimeSlot,
  localDateOnly,
  localReservationNow,
  maxReservationDate,
  minReservationDate,
  nextWizardStep,
  previousWizardStep,
  reservationPurchaseCount,
  reservationPurchaseLineNotes,
  reservationPurchaseLineTotal,
  reservationPurchaseSubtotal,
  reservationQrPayload,
  toReservationOrderItems,
} from "./reservation-flow";
import type { ReservationPurchaseLine } from "./reservation-flow";

const FIXED_NOW = new Date(2026, 8, 15, 9, 30, 0); // 2026-09-15 09:30 local

describe("reservation-flow (customer reservation UI pure helpers)", () => {
  describe("localDateOnly", () => {
    it("formats a local date as YYYY-MM-DD without UTC shifting", () => {
      assert.equal(localDateOnly(FIXED_NOW), "2026-09-15");
    });

    it("pads month and day to two digits", () => {
      assert.equal(localDateOnly(new Date(2026, 0, 5)), "2026-01-05");
    });

    it("is stable across UTC boundaries (uses local fields)", () => {
      // Local midnight vs UTC the previous day must not change the result.
      const localMidnight = new Date(2026, 8, 15, 0, 0, 0);
      assert.equal(localDateOnly(localMidnight), "2026-09-15");
    });
  });

  describe("localReservationNow", () => {
    it("produces the injected 'now' the slot engine expects", () => {
      const now = localReservationNow(FIXED_NOW);
      assert.equal(now.today, "2026-09-15");
      assert.equal(now.nowMinutes, 9 * 60 + 30);
    });
  });

  describe("min/max reservation date", () => {
    it("min is today, max is today + horizon days", () => {
      assert.equal(minReservationDate(FIXED_NOW), "2026-09-15");
      assert.equal(maxReservationDate(FIXED_NOW), "2026-11-14");
      // 2026-09-15 + 60 days = 2026-11-14
      assert.equal(maxReservationDate(FIXED_NOW), "2026-11-14");
    });

    it("max respects the shared engine horizon constant", () => {
      const max = maxReservationDate(FIXED_NOW);
      const year = Number(max.slice(0, 4));
      const month = Number(max.slice(5, 7));
      const day = Number(max.slice(8, 10));
      const days = Math.round(
        (Date.UTC(year, month - 1, day) - Date.UTC(2026, 8, 15)) / 86_400_000
      );
      assert.equal(days, RESERVATION_MAX_HORIZON_DAYS);
    });
  });

  describe("buildCandidateSlots", () => {
    it("lists hourly slots between opening and closing (10:00–20:00, 90 min)", () => {
      const slots = buildCandidateSlots("2026-09-15", localReservationNow(FIXED_NOW));
      const labels = slots.map((s) => s.label);
      assert.deepEqual(labels, [
        "10:00",
        "11:00",
        "12:00",
        "13:00",
        "14:00",
        "15:00",
        "16:00",
        "17:00",
        "18:00",
        "19:00",
        "20:00",
      ]);
    });

    it("drops already-elapsed slots for today", () => {
      const now = { today: "2026-09-15", nowMinutes: 13 * 60 }; // 13:00
      const slots = buildCandidateSlots("2026-09-15", now);
      const labels = slots.map((s) => s.label);
      assert.equal(labels.some((l) => l === "09:00"), false);
      assert.equal(labels.includes("10:00"), false);
      assert.equal(labels[0], "14:00");
    });

    it("does not drop slots for a future date even when now is supplied", () => {
      const now = { today: "2026-09-15", nowMinutes: 21 * 60 };
      const slots = buildCandidateSlots("2026-09-20", now);
      assert.equal(slots.length, 11);
      assert.equal(slots[0].label, "10:00");
    });

    it("produces an empty grid after the last valid start has elapsed", () => {
      const now = { today: "2026-09-15", nowMinutes: 21 * 60 };
      const slots = buildCandidateSlots("2026-09-15", now);
      assert.equal(slots.length, 0);
    });
  });

  describe("formatReservationDate", () => {
    it("formats YYYY-MM-DD to Indonesian long date with no TZ shift", () => {
      assert.equal(formatReservationDate("2026-09-15"), "15 Sep 2026");
      assert.equal(formatReservationDate("2026-01-05"), "5 Jan 2026");
    });

    it("passes through invalid values instead of corrupting them", () => {
      assert.equal(formatReservationDate("bukan-tanggal"), "bukan-tanggal");
      assert.equal(formatReservationDate("2026-02-30"), "2026-02-30");
    });
  });

  describe("formatTimeSlot / formatStartMinutes", () => {
    it("renders half-open start–end via minutesToLabel", () => {
      assert.equal(formatTimeSlot(10 * 60, 90), "10:00–11:30");
      assert.equal(formatTimeSlot(20 * 60, 90), "20:00–21:30");
    });

    it("formats start minute", () => {
      assert.equal(formatStartMinutes(13 * 60), "13:00");
    });
  });

  describe("status labels", () => {
    it("covers every reservation status with an Indonesian label", () => {
      for (const status of ["PENDING", "CONFIRMED", "SEATED", "COMPLETED", "CANCELLED", "NO_SHOW"]) {
        assert.ok(RESERVATION_STATUS_LABELS[status], `missing label for ${status}`);
      }
    });
  });

  describe("conflict copy", () => {
    it("is the exact customer-facing 409 message", () => {
      assert.equal(
        RESERVATION_CONFLICT_MESSAGE,
        "Meja/jam tersebut baru saja diambil. Silakan pilih waktu atau meja lain."
      );
    });
  });

  describe("reservation QR payload", () => {
    it("is EXACTLY the reservation code (trimmed + uppercased) and nothing else", () => {
      assert.equal(reservationQrPayload("R-AB12CD34"), "R-AB12CD34");
      assert.equal(reservationQrPayload("  r-ab12cd34 "), "R-AB12CD34");
      // No PII / ids / secrets: the payload equals the input code verbatim.
      assert.equal(reservationQrPayload("R-00000000"), "R-00000000");
    });
  });

  // ==========================================================
  // Reservation + purchase = ONE flow: the purchase is its OWN wizard step
  // (between the table and the guest data) and is picked INSIDE the wizard.
  // ==========================================================

  describe("wizard step order", () => {
    it("places the purchase step between the table and the guest data", () => {
      assert.deepEqual(RESERVATION_WIZARD_STEPS, [
        "branch",
        "date",
        "party",
        "time",
        "table",
        "purchase",
        "guest",
        "review",
      ]);
      const order = RESERVATION_WIZARD_STEPS;
      assert.equal(order.indexOf("purchase"), order.indexOf("table") + 1);
      assert.equal(order.indexOf("guest"), order.indexOf("purchase") + 1);
      assert.ok(order.indexOf("purchase") < order.indexOf("review"));
    });

    it("labels the step 'Pembelian'", () => {
      assert.equal(RESERVATION_STEP_LABELS.purchase, "Pembelian");
    });

    it("routes the table step to the in-wizard purchase step (never away)", () => {
      assert.equal(nextWizardStep("table"), "purchase");
      assert.notEqual(nextWizardStep("table"), "guest");
      assert.notEqual(nextWizardStep("table"), "review");
      assert.equal(nextWizardStep("purchase"), "guest");
      assert.equal(nextWizardStep("review"), null);
      assert.equal(nextWizardStep("success"), null);
    });

    it("walks back through every earlier step without skipping", () => {
      assert.equal(previousWizardStep("review"), "guest");
      assert.equal(previousWizardStep("guest"), "purchase");
      assert.equal(previousWizardStep("purchase"), "table");
      assert.equal(previousWizardStep("table"), "time");
      assert.equal(previousWizardStep("time"), "party");
      assert.equal(previousWizardStep("party"), "date");
      assert.equal(previousWizardStep("date"), "branch");
      assert.equal(previousWizardStep("branch"), null);
    });
  });

  describe("purchase step copy", () => {
    it("titles the step 'Pembelian untuk Reservasi' and requires >=1 product", () => {
      assert.equal(PURCHASE_STEP_TITLE, "Pembelian untuk Reservasi");
      assert.ok(PURCHASE_EMPTY_MESSAGE.toLowerCase().includes("minimal 1"));
    });

    it("exposes DINE-IN payment method labels for the EXISTING methods", () => {
      assert.equal(
        RESERVATION_PAYMENT_METHOD_LABELS.QRIS,
        "QRIS (bayar sekarang)"
      );
      assert.equal(RESERVATION_PAYMENT_METHOD_LABELS.KASIR, "Bayar di Kasir");
    });

    it("labels every payment status in Indonesian", () => {
      for (const status of [
        "UNPAID",
        "PENDING",
        "PAID",
        "FAILED",
        "EXPIRED",
        "REFUNDED",
        "CANCELLED",
      ]) {
        assert.ok(PAYMENT_STATUS_LABELS[status], `missing label for ${status}`);
      }
    });
  });

  describe("rupiah formatting (display only)", () => {
    it("formats with id-ID grouping", () => {
      assert.equal(formatRupiah(73000), "Rp73.000");
      assert.equal(formatRupiah(0), "Rp0");
      assert.equal(formatRupiah(1234567), "Rp1.234.567");
    });

    it("tolerates non-finite input without crashing the preview", () => {
      assert.equal(formatRupiah(Number.NaN), "Rp0");
    });
  });

  describe("local reservation purchase cart (NOT the global useCart)", () => {
    const line = (
      overrides: Partial<ReservationPurchaseLine>
    ): ReservationPurchaseLine => ({
      lineId: "l1",
      productId: "p1",
      name: "Burger",
      unitPrice: 35000,
      quantity: 1,
      selections: [],
      addons: [],
      ...overrides,
    });

    it("computes a line total, subtotal and count from DISPLAY prices", () => {
      const a = line({ lineId: "a", unitPrice: 35000, quantity: 1 });
      const b = line({ lineId: "b", unitPrice: 10000, quantity: 2 });
      assert.equal(reservationPurchaseLineTotal(a), 35000);
      assert.equal(reservationPurchaseLineTotal(b), 20000);
      assert.equal(reservationPurchaseSubtotal([a, b]), 55000);
      assert.equal(reservationPurchaseCount([a, b]), 3);
      assert.equal(reservationPurchaseSubtotal([]), 0);
    });

    it("summarises variant/addon choices for the review line", () => {
      const withChoices = line({
        selections: [
          {
            groupId: "g1",
            groupName: "Level",
            optionId: "o1",
            optionName: "Level 2",
            priceAdjustment: 0,
          },
        ],
        addons: [{ addonId: "a1", name: "Keju", price: 5000, quantity: 2 }],
      });
      assert.equal(
        reservationPurchaseLineNotes(withChoices),
        "Level 2, Keju ×2"
      );
      assert.equal(reservationPurchaseLineNotes(line({})), "");
    });

    it("builds the server payload with ids + quantities ONLY (never authoritative prices)", () => {
      const items = toReservationOrderItems([
        line({
          productId: "p1",
          quantity: 2,
          selections: [
            {
              groupId: "g1",
              groupName: "Level",
              optionId: "o1",
              optionName: "Level 2",
              priceAdjustment: 2000,
            },
          ],
          addons: [{ addonId: "a1", name: "Keju", price: 5000, quantity: 1 }],
          notes: "tanpa sambal",
        }),
        line({ lineId: "l2", productId: "p2" }),
      ]);

      assert.equal(items.length, 2);
      assert.deepEqual(items[0], {
        productId: "p1",
        quantity: 2,
        selections: [
          {
            groupId: "g1",
            groupName: "Level",
            optionId: "o1",
            optionName: "Level 2",
            priceAdjustment: 2000,
          },
        ],
        addons: [{ addonId: "a1", name: "Keju", price: 5000, quantity: 1 }],
        notes: "tanpa sambal",
      });
      // A plain line omits every optional key entirely.
      assert.deepEqual(items[1], { productId: "p2", quantity: 1 });
      // No client-authoritative field or internal identity is ever sent.
      for (const item of items) {
        assert.equal("unitPrice" in item, false);
        assert.equal("totalPrice" in item, false);
        assert.equal("restaurantId" in item, false);
        assert.equal("lineId" in item, false);
      }
    });
  });
});