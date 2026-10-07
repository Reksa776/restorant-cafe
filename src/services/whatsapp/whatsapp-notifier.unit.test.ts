import "dotenv/config";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { whatsappSessionManager } from "@/services/whatsapp/session-manager";
import { sendWhatsAppNotification } from "./whatsapp-notifier";

// ============================================================
// OPSI A — WEB-side WhatsApp notification sender unit tests.
//
// Proves the contract the Order READY / Reservation seams rely on:
//   • a failed send returns false and NEVER throws (best-effort),
//   • a failed send writes NO `sent` row (no fake success),
//   • a successful send writes exactly one OUTGOING `sent` row,
//   • a bookkeeping failure after a delivered message still reports true.
//
// The session manager and Prisma are stubbed — no socket, no database.
// Run: npx tsx --test src/services/whatsapp/whatsapp-notifier.unit.test.ts
// ============================================================

describe("sendWhatsAppNotification", () => {
  it("returns false and records nothing when the session is not connected", async () => {
    const originalSend = whatsappSessionManager.sendMessage;
    const originalCreate = prisma.whatsAppMessage.create;
    let rows = 0;

    whatsappSessionManager.sendMessage = (async () => {
      throw new Error("WhatsApp not connected for restaurant resto_a");
    }) as unknown as typeof whatsappSessionManager.sendMessage;
    prisma.whatsAppMessage.create = (async () => {
      rows += 1;
      return {};
    }) as unknown as typeof prisma.whatsAppMessage.create;

    let result = true;
    try {
      result = await sendWhatsAppNotification("resto_a", "6281280001234", "hi");
    } finally {
      whatsappSessionManager.sendMessage = originalSend;
      prisma.whatsAppMessage.create = originalCreate;
    }

    assert.equal(result, false);
    assert.equal(rows, 0);
  });

  it("records one OUTGOING sent row when the send succeeds", async () => {
    const originalSend = whatsappSessionManager.sendMessage;
    const originalCreate = prisma.whatsAppMessage.create;
    const originalFindUnique = prisma.restaurant.findUnique;
    let sentTo = "";
    let created: Record<string, unknown> | null = null;

    whatsappSessionManager.sendMessage = (async (
      _restaurantId: string,
      to: string
    ) => {
      sentTo = to;
    }) as unknown as typeof whatsappSessionManager.sendMessage;
    prisma.restaurant.findUnique = (async () => ({
      phone: "628111222333",
    })) as unknown as typeof prisma.restaurant.findUnique;
    prisma.whatsAppMessage.create = (async (args: {
      data: Record<string, unknown>;
    }) => {
      created = args.data;
      return {};
    }) as unknown as typeof prisma.whatsAppMessage.create;

    let result = false;
    try {
      result = await sendWhatsAppNotification("resto_a", "6281280001234", "hi");
    } finally {
      whatsappSessionManager.sendMessage = originalSend;
      prisma.restaurant.findUnique = originalFindUnique;
      prisma.whatsAppMessage.create = originalCreate;
    }

    assert.equal(result, true);
    assert.equal(sentTo, "6281280001234");
    assert.ok(created, "expected one whatsappmessage row to be written");
    const data = created as Record<string, unknown>;
    assert.equal(data.restaurantId, "resto_a");
    assert.equal(data.direction, "OUTGOING");
    assert.equal(data.to, "6281280001234");
    assert.equal(data.content, "hi");
    assert.equal(data.status, "sent");
    assert.equal(data.from, "628111222333");
  });

  it("still reports true when only the bookkeeping write fails", async () => {
    const originalSend = whatsappSessionManager.sendMessage;
    const originalCreate = prisma.whatsAppMessage.create;
    const originalFindUnique = prisma.restaurant.findUnique;

    whatsappSessionManager.sendMessage = (async () => {
      return;
    }) as unknown as typeof whatsappSessionManager.sendMessage;
    prisma.restaurant.findUnique = (async () => ({
      phone: null,
    })) as unknown as typeof prisma.restaurant.findUnique;
    prisma.whatsAppMessage.create = (async () => {
      throw new Error("db down");
    }) as unknown as typeof prisma.whatsAppMessage.create;

    let result = false;
    try {
      result = await sendWhatsAppNotification("resto_a", "6281280001234", "hi");
    } finally {
      whatsappSessionManager.sendMessage = originalSend;
      prisma.restaurant.findUnique = originalFindUnique;
      prisma.whatsAppMessage.create = originalCreate;
    }

    assert.equal(result, true);
  });
});
