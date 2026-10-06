import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RESERVATION_MAX_HORIZON_DAYS,
} from "@/services/reservation/reservation.slots";
import {
  PURCHASE_CTA_HREF,
  PURCHASE_ERROR_MESSAGE,
  PURCHASE_FOUND_MESSAGE,
  PURCHASE_IDLE_MESSAGE,
  PURCHASE_REQUIRED_CODE,
  PURCHASE_REQUIRED_CTA,
  PURCHASE_REQUIRED_MESSAGE,
  PURCHASE_REQUIRED_TITLE,
  RESERVATION_CONFLICT_MESSAGE,
  RESERVATION_DRAFT_STORAGE_KEY,
  RESERVATION_STEP_LABELS,
  RESERVATION_STATUS_LABELS,
  RESERVATION_WIZARD_STEPS,
  buildCandidateSlots,
  formatReservationDate,
  formatStartMinutes,
  formatTimeSlot,
  localDateOnly,
  localReservationNow,
  maxReservationDate,
  minReservationDate,
  nextWizardStep,
  parseReservationDraft,
  previousWizardStep,
  purchaseStepView,
  reservationQrPayload,
  serializeReservationDraft,
} from "./reservation-flow";
import type { ReservationDraft } from "./reservation-flow";

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

  describe("minimum-purchase gate copy", () => {
    it("matches the server's 409 business error", () => {
      assert.equal(PURCHASE_REQUIRED_CODE, "PURCHASE_REQUIRED");
      assert.equal(
        PURCHASE_REQUIRED_MESSAGE,
        "Reservasi hanya tersedia setelah Anda menyelesaikan minimal 1 pembelian."
      );
    });
  });

  // ==========================================================
  // R6.5 — the purchase requirement is its OWN wizard step, BEFORE Review
  // ==========================================================

  describe("wizard step order (R6.5)", () => {
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

    it("never routes the table step straight to the guest/review step", () => {
      // A guest without a purchase must land on the purchase step — never
      // skip ahead to Data Tamu / Review where the gate used to appear.
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

  describe("purchase step view (early UX feedback)", () => {
    it("eligible → 'Pembelian ditemukan' and may continue, with no CTA", () => {
      const view = purchaseStepView("eligible");
      assert.equal(view.tone, "eligible");
      assert.equal(view.title, "Pembelian ditemukan");
      assert.equal(view.message, PURCHASE_FOUND_MESSAGE);
      assert.equal(
        view.message,
        "Anda memenuhi syarat untuk melakukan reservasi."
      );
      assert.equal(view.canContinue, true);
      assert.equal(view.ctaLabel, null);
      assert.equal(view.ctaHref, null);
    });

    it("ineligible → required card + 'Pesan Menu Dulu' pointing at the menu flow", () => {
      const view = purchaseStepView("ineligible");
      assert.equal(view.tone, "required");
      assert.equal(view.title, PURCHASE_REQUIRED_TITLE);
      assert.equal(view.title, "Pembelian Diperlukan");
      assert.equal(view.message, PURCHASE_REQUIRED_MESSAGE);
      assert.equal(view.ctaLabel, PURCHASE_REQUIRED_CTA);
      assert.equal(view.ctaLabel, "Pesan Menu Dulu");
      assert.equal(view.ctaHref, PURCHASE_CTA_HREF);
      assert.equal(view.ctaHref, "/menu");
      assert.equal(view.canContinue, false);
    });

    it("idle → asks the guest for the WhatsApp number used when ordering", () => {
      const view = purchaseStepView("idle");
      assert.equal(view.tone, "idle");
      assert.equal(view.canContinue, false);
      assert.equal(view.ctaLabel, null);
      assert.equal(view.message, PURCHASE_IDLE_MESSAGE);
    });

    it("checking/error never allow advancing", () => {
      assert.equal(purchaseStepView("checking").canContinue, false);
      const errorView = purchaseStepView("error");
      assert.equal(errorView.canContinue, false);
      assert.equal(errorView.message, PURCHASE_ERROR_MESSAGE);
    });
  });

  describe("return-to-reservation draft (minimal)", () => {
    const draft: ReservationDraft = {
      branchCode: "MAIN",
      date: "2026-09-20",
      partySize: 4,
      selectedStart: 19 * 60,
      selectedTableId: "tbl-1",
      guestName: "Asep",
      guestPhone: "081234567890",
      notes: "dekat jendela",
    };

    it("round-trips a wizard snapshot", () => {
      assert.deepEqual(
        parseReservationDraft(serializeReservationDraft(draft)),
        draft
      );
      assert.equal(RESERVATION_DRAFT_STORAGE_KEY, "reservation_draft");
    });

    it("rejects junk instead of breaking the wizard", () => {
      assert.equal(parseReservationDraft(null), null);
      assert.equal(parseReservationDraft(""), null);
      assert.equal(parseReservationDraft("{not json"), null);
      assert.equal(
        parseReservationDraft(JSON.stringify({ date: "2026-09-20" })),
        null
      );
      assert.equal(
        parseReservationDraft(JSON.stringify({ branchCode: "MAIN" })),
        null
      );
      assert.equal(
        parseReservationDraft(
          JSON.stringify({ branchCode: "MAIN", date: "2026-02-30" })
        ),
        null
      );
    });

    it("carries only wizard selections — no auth/payment data", () => {
      const raw = serializeReservationDraft(draft);
      for (const forbidden of [
        "customerId",
        "orderId",
        "paymentStatus",
        "token",
        "password",
      ]) {
        assert.equal(raw.includes(forbidden), false);
      }
    });
  });
});