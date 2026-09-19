import "dotenv/config";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import {
  buildReservationWhatsAppMessage,
  dispatchReservationWhatsApp,
  reservationWhatsAppGateway,
  resolveReservationWhatsAppTarget,
  type ReservationWhatsAppView,
} from "./reservation-whatsapp";

// ============================================================
// PHASE R7 — RESERVATION -> WHATSAPP notifier unit tests.
//
// Covers the three exported R7 seams with ZERO engine I/O:
//   • buildReservationWhatsAppMessage   — pure template builder.
//   • resolveReservationWhatsAppTarget — pure target resolution.
//   • dispatchReservationWhatsApp      — best-effort dispatcher whose
//     failure-isolation is proven by swapping the exported gateway seam
//     (reservationWhatsAppGateway.enqueue) and stubbing the server-side
//     restaurant lookup (prisma.restaurant.findUnique) — the queue never
//     touches BullMQ/Baileys and no database is needed.
// Run: npx tsx --test src/services/reservation/reservation-whatsapp.unit.test.ts
// ============================================================

interface ViewOverrides {
  [key: string]: unknown;
}

function makeView(overrides: Partial<ReservationWhatsAppView> = {}): ReservationWhatsAppView {
  return {
    id: "res_1",
    restaurantId: "resto_a",
    code: "RSV-ABC123",
    guestName: "Dina Puspita",
    guestPhone: "081280001234",
    partySize: 4,
    reservationDate: "2026-09-17",
    startMinutes: 19 * 60, // 19:00
    durationMinutes: 120, // sampai 21:00
    status: "CONFIRMED",
    cancelReason: null,
    branch: { code: "CBD", name: "Sudirman" },
    table: { number: 7, name: "Fenik" },
    customer: { phone: "085155556666" },
    ...overrides,
  };
}

describe("buildReservationWhatsAppMessage", () => {
  it("renders a CONFIRMED message with server-side details only", () => {
    const message = buildReservationWhatsAppMessage(makeView(), "CONFIRMED", "Restoran Senja");
    assert.match(message, /Halo Dina Puspita,/);
    assert.match(message, /Restoran Senja/);
    assert.match(message, /Sudirman \(CBD\)/);
    assert.match(message, /RSV-ABC123/);
    assert.match(message, /17 Sep 2026/);
    assert.match(message, /19:00.{1,5}21:00/);
    assert.match(message, /Dina Puspita/);
    assert.match(message, /4 orang/);
    assert.match(message, /Meja 7 \(Fenik\)/);
    assert.match(message, /Dikonfirmasi/);
    assert.match(message, /telah dikonfirmasi/);
  });

  it("omits the table line when no table is assigned", () => {
    const message = buildReservationWhatsAppMessage(
      makeView({ table: null }),
      "CONFIRMED",
      "Restoran Senja"
    );
    assert.doesNotMatch(message, /Meja/);
  });

  it("renders CANCELLED with the server-side reason when present", () => {
    const message = buildReservationWhatsAppMessage(
      makeView({ cancelReason: "Permintaan pelanggan" }),
      "CANCELLED",
      "Restoran Senja"
    );
    assert.match(message, /telah dibatalkan/);
    assert.match(message, /Permintaan pelanggan/);
  });

  it("omits the reason when there is none", () => {
    const message = buildReservationWhatsAppMessage(
      makeView({ cancelReason: null }),
      "CANCELLED",
      "Restoran Senja"
    );
    assert.doesNotMatch(message, /Permintaan pelanggan/);
  });
});

describe("resolveReservationWhatsAppTarget", () => {
  it("normalizes the guest phone to international format", () => {
    assert.equal(resolveReservationWhatsAppTarget(makeView()), "6281280001234");
  });

  it("falls back to the customer phone when the guest phone is unusable", () => {
    assert.equal(
      resolveReservationWhatsAppTarget(
        makeView({ guestPhone: "", customer: { phone: "085155556666" } })
      ),
      "6285155556666"
    );
  });

  it("returns null when there is no usable target", () => {
    assert.equal(
      resolveReservationWhatsAppTarget(
        makeView({ guestPhone: "", customer: null })
      ),
      null
    );
  });
});

describe("dispatchReservationWhatsApp", () => {
  it("returns false (never throws) when the WhatsApp queue fails", async () => {
    const original = reservationWhatsAppGateway.enqueue;
    reservationWhatsAppGateway.enqueue = async () => {
      throw new Error("queue down");
    };

    let result = true;
    try {
      result = await dispatchReservationWhatsApp(makeView(), "CONFIRMED");
    } finally {
      reservationWhatsAppGateway.enqueue = original;
    }

    assert.equal(result, false);
  });

  it("does NOT enqueue when there is no usable target", async () => {
    const original = reservationWhatsAppGateway.enqueue;
    let enqueued = 0;
    reservationWhatsAppGateway.enqueue = async () => {
      enqueued += 1;
    };

    let result = true;
    try {
      result = await dispatchReservationWhatsApp(
        makeView({ guestPhone: "", customer: null }),
        "CONFIRMED"
      );
    } finally {
      reservationWhatsAppGateway.enqueue = original;
    }

    assert.equal(result, false);
    assert.equal(enqueued, 0);
  });

  it("enqueues the built message with the resolved target on success", async () => {
    const originalGateway = reservationWhatsAppGateway.enqueue;
    const originalFindUnique = prisma.restaurant.findUnique;
    let target = "";
    let message = "";
    reservationWhatsAppGateway.enqueue = async (
      restaurantId: string,
      reservationId: string,
      status: string,
      to: string,
      msg: string
    ) => {
      target = to;
      message = msg;
    };
    prisma.restaurant.findUnique = async () =>
      ({ name: "Restoran Senja" }) as never;

    let result = false;
    try {
      result = await dispatchReservationWhatsApp(makeView(), "CONFIRMED");
    } finally {
      reservationWhatsAppGateway.enqueue = originalGateway;
      prisma.restaurant.findUnique = originalFindUnique;
    }

    assert.equal(result, true);
    assert.equal(target, "6281280001234");
    assert.match(message, /Restoran Senja/);
  });
});
