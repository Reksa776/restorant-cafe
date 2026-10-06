import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { auditService } from "./audit.service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";

// ============================================================
// AUDIT LOG VIEWER — service layer (real local DB).
//
// Covers server-side filtering, pagination, tenant + branch isolation, the
// safe DTO, and the read-time redaction of sensitive `details` keys.
//
// Run with: npx tsx --test --test-force-exit src/services/audit/audit.service.test.ts
// ============================================================

let restA = "";
let restB = "";
let branchA1 = "";
let branchA2 = "";
let userA = "";

async function log(input: {
  restaurantId: string;
  branchId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
  createdAt?: Date;
}) {
  return prisma.auditLog.create({
    data: {
      restaurantId: input.restaurantId,
      branchId: input.branchId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      details: input.details ? (input.details as object) : undefined,
      createdAt: input.createdAt ?? new Date(),
    },
  });
}

before(async () => {
  const tag = `QAAUD${Date.now()}`;
  const [ra, rb] = await Promise.all([
    prisma.restaurant.create({ data: { name: `${tag} A` } }),
    prisma.restaurant.create({ data: { name: `${tag} B` } }),
  ]);
  restA = ra.id;
  restB = rb.id;

  const [b1, b2] = await Promise.all([
    prisma.branch.create({
      data: { restaurantId: restA, code: "QA-AUD-1", name: "Audit 1" },
    }),
    prisma.branch.create({
      data: { restaurantId: restA, code: "QA-AUD-2", name: "Audit 2" },
    }),
  ]);
  branchA1 = b1.id;
  branchA2 = b2.id;

  const ua = await prisma.user.create({
    data: {
      restaurantId: restA,
      name: "Audit Admin",
      email: `${tag}-a@audit.test`,
      password: "x",
      role: "ADMIN",
      isActive: true,
      sessionVersion: 0,
    },
  });
  userA = ua.id;

  // Fixture rows (restaurant A).
  await log({
    restaurantId: restA,
    branchId: branchA1,
    userId: userA,
    action: "PAYMENT_RECEIVED",
    entityType: "Order",
    entityId: "ORD-1",
    details: {
      orderNumber: "ORD-1",
      amount: 50000,
      password: "supersecret",
      nested: { apiKey: "sk_live_x", amount: 123 },
    },
    createdAt: new Date("2026-10-01T10:00:00.000"),
  });
  await log({
    restaurantId: restA,
    branchId: branchA1,
    userId: null,
    action: "SHIFT_OPENED",
    entityType: "Shift",
    entityId: "SHIFT-1",
    createdAt: new Date("2026-10-02T10:00:00.000"),
  });
  await log({
    restaurantId: restA,
    branchId: branchA2,
    userId: userA,
    action: "BRANCH_UPDATED",
    entityType: "Branch",
    entityId: "BR-2",
    createdAt: new Date("2026-10-03T10:00:00.000"),
  });
  // Branch-less row (restaurant-scoped only).
  await log({
    restaurantId: restA,
    action: "RESTAURANT_UPDATED",
    entityType: "Restaurant",
    entityId: "REST-A",
    createdAt: new Date("2026-10-04T10:00:00.000"),
  });
  // Another tenant — must never appear for restA.
  await log({
    restaurantId: restB,
    action: "PAYMENT_RECEIVED",
    entityType: "Order",
    entityId: "ORD-B",
    createdAt: new Date("2026-10-01T10:00:00.000"),
  });
});

after(async () => {
  await prisma.auditLog.deleteMany({
    where: { restaurantId: { in: [restA, restB] } },
  });
  await prisma.user.deleteMany({
    where: { restaurantId: { in: [restA, restB] } },
  });
  await prisma.branch.deleteMany({
    where: { restaurantId: { in: [restA, restB] } },
  });
  await prisma.restaurant.deleteMany({ where: { id: { in: [restA, restB] } } });
  await prisma.$disconnect();
});

describe("auditService.list", () => {
  it("is tenant-scoped and returns a safe DTO with actor + branch names", async () => {
    const result = await auditService.list(restA, { limit: 50 });
    assert.equal(result.total, 4);
    for (const item of result.items) {
      assert.equal(item.restaurantId, restA);
      assert.equal(typeof item.createdAt, "string");
      assert.equal("password" in item, false); // no raw secret fields
    }
    const payment = result.items.find((i) => i.action === "PAYMENT_RECEIVED");
    assert.ok(payment);
    assert.equal(payment?.actor?.role, "ADMIN");
    assert.equal(payment?.branch?.name, "Audit 1");
  });

  it("filters by action / entityType / entityId / userId", async () => {
    const byAction = await auditService.list(restA, { action: "SHIFT_OPENED" });
    assert.equal(byAction.total, 1);
    assert.equal(byAction.items[0]?.entityType, "Shift");

    const byEntityType = await auditService.list(restA, { entityType: "Order" });
    assert.equal(byEntityType.total, 1);

    const byEntityId = await auditService.list(restA, { entityId: "BR-2" });
    assert.equal(byEntityId.total, 1);

    const byUser = await auditService.list(restA, { userId: userA });
    assert.equal(byUser.total, 2);
    for (const item of byUser.items) assert.equal(item.actor?.id, userA);
  });

  it("filters by date range (day-bounded) and free-text search", async () => {
    const range = await auditService.list(restA, {
      dateFrom: "2026-10-02",
      dateTo: "2026-10-03",
    });
    assert.equal(range.total, 2);

    const search = await auditService.list(restA, { search: "SHIFT" });
    assert.equal(search.total, 1);
    assert.equal(search.items[0]?.action, "SHIFT_OPENED");
  });

  it("enforces branch isolation via branchFilters", async () => {
    const scoped = await auditService.list(restA, {}, [branchA1]);
    assert.equal(scoped.total, 2);
    for (const item of scoped.items) assert.equal(item.branchId, branchA1);

    // Branch-less rows are excluded for a branch-scoped admin (filter is an
    // `in` list) — never widened to the whole restaurant.
    assert.equal(
      scoped.items.some((i) => i.branchId === null),
      false
    );

    await assert.rejects(
      auditService.list(restA, { branchId: branchA2 }, [branchA1]),
      ForbiddenError
    );
  });

  it("paginates server-side and rejects an out-of-range limit", async () => {
    const page1 = await auditService.list(restA, { page: 1, limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.equal(page1.total, 4);
    assert.equal(page1.totalPages, 2);

    const page2 = await auditService.list(restA, { page: 2, limit: 2 });
    assert.equal(page2.items.length, 2);
    assert.notEqual(page1.items[0]?.id, page2.items[0]?.id);

    await assert.rejects(
      auditService.list(restA, { limit: 500 }),
      ValidationError
    );
  });

  it("redacts sensitive details keys on read, keeping safe ones", async () => {
    const result = await auditService.list(restA, { action: "PAYMENT_RECEIVED" });
    const details = result.items[0]?.details as Record<string, unknown>;
    assert.equal(details.password, "[REDACTED]");
    assert.equal((details.nested as Record<string, unknown>).apiKey, "[REDACTED]");
    assert.equal((details.nested as Record<string, unknown>).amount, 123);
    assert.equal(details.orderNumber, "ORD-1");
    assert.equal(details.amount, 50000);
  });

  it("sorts newest first", async () => {
    const result = await auditService.list(restA, {});
    const times = result.items.map((i) => new Date(i.createdAt).getTime());
    const sorted = [...times].sort((a, b) => b - a);
    assert.deepEqual(times, sorted);
  });
});

describe("auditService.getById", () => {
  it("is tenant + branch scoped", async () => {
    const { items } = await auditService.list(restA, { action: "BRANCH_UPDATED" });
    const id = items[0]!.id;

    const view = await auditService.getById(id, restA);
    assert.equal(view.id, id);

    // Wrong tenant → not found.
    await assert.rejects(auditService.getById(id, restB), NotFoundError);
    // Branch scope that does not include the row's branch → not found.
    await assert.rejects(auditService.getById(id, restA, [branchA1]), NotFoundError);
  });
});
