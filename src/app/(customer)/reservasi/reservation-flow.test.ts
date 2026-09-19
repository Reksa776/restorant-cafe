import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RESERVATION_MAX_HORIZON_DAYS,
} from "@/services/reservation/reservation.slots";
import {
  RESERVATION_CONFLICT_MESSAGE,
  RESERVATION_STATUS_LABELS,
  buildCandidateSlots,
  formatReservationDate,
  formatStartMinutes,
  formatTimeSlot,
  localDateOnly,
  localReservationNow,
  maxReservationDate,
  minReservationDate,
} from "./reservation-flow";

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
});