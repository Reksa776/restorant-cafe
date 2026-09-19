import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RESERVATION_SOURCE_LABELS,
  RESERVATION_STATUS_LABELS,
  formatReservationDate,
  formatReservationDateTime,
  formatStartMinutes,
  formatTimeSlot,
} from "./reservation-format";

// ============================================================
// R4 — PURE display-helper tests (node:test, no framework added).
//
// Run with: npx tsx --test src/components/admin/reservations/reservation-format.test.ts
// ============================================================

describe("formatReservationDate", () => {
  it("renders YYYY-MM-DD as Indonesian short date without timezone shift", () => {
    assert.equal(formatReservationDate("2026-09-17"), "17 Sep 2026");
    assert.equal(formatReservationDate("2026-01-05"), "5 Jan 2026");
    assert.equal(formatReservationDate("2025-12-31"), "31 Des 2025");
  });

  it("falls back to the raw string on malformed input", () => {
    assert.equal(formatReservationDate("nope"), "nope");
    assert.equal(formatReservationDate("2026-13-40"), "2026-13-40");
  });
});

describe("formatTimeSlot", () => {
  it("renders start–end from minute-of-day integers (no timezone conversion)", () => {
    assert.equal(formatTimeSlot(600, 90), "10:00–11:30");
    assert.equal(formatTimeSlot(660, 60), "11:00–12:00");
    assert.equal(formatTimeSlot(1140, 120), "19:00–21:00");
    assert.equal(formatTimeSlot(0, 60), "00:00–01:00");
  });
});

describe("formatStartMinutes", () => {
  it("renders minute-of-day as HH:mm", () => {
    assert.equal(formatStartMinutes(600), "10:00");
    assert.equal(formatStartMinutes(1140), "19:00");
  });
});

describe("formatReservationDateTime", () => {
  it("renders an ISO timestamp", () => {
    const out = formatReservationDateTime("2026-09-17T08:30:00.000Z");
    assert.notEqual(out, "-");
    assert.match(out, /2026/);
  });

  it("returns '-' for null/undefined", () => {
    assert.equal(formatReservationDateTime(null), "-");
    assert.equal(formatReservationDateTime(undefined), "-");
  });
});

describe("status/source labels", () => {
  it("maps every reservation status to an Indonesian label", () => {
    assert.equal(RESERVATION_STATUS_LABELS.PENDING, "Menunggu");
    assert.equal(RESERVATION_STATUS_LABELS.CONFIRMED, "Dikonfirmasi");
    assert.equal(RESERVATION_STATUS_LABELS.SEATED, "Sudah Duduk");
    assert.equal(RESERVATION_STATUS_LABELS.COMPLETED, "Selesai");
    assert.equal(RESERVATION_STATUS_LABELS.CANCELLED, "Dibatalkan");
    assert.equal(RESERVATION_STATUS_LABELS.NO_SHOW, "Tidak Hadir");
  });

  it("maps reservation sources to Indonesian labels", () => {
    assert.equal(RESERVATION_SOURCE_LABELS.PUBLIC, "Website");
    assert.equal(RESERVATION_SOURCE_LABELS.ADMIN, "Admin");
  });
});