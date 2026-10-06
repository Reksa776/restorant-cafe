import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";

// ============================================================
// TEST-ONLY fixtures for the reservation MINIMUM-PURCHASE gate.
//
// "Qualifying purchase" = an Order that is PAID, NOT CANCELLED and has at
// least one OrderItem — the exact rule the reservation create gate enforces.
// Creating one requires the minimal Product graph an OrderItem needs
// (restaurant → category → product → order → order_item).
//
// This module is imported by tests only; no app code depends on it.
// ============================================================

let sequence = 0;

export interface PurchaseSeedOverrides {
  /** Reuse an existing customer (logged-in flow) instead of creating one. */
  customerId?: string | null;
  /** Phone for the auto-created Customer (guest flow). */
  phone?: string | null;
  branchId?: string | null;
  paymentStatus?:
    | "UNPAID"
    | "PENDING"
    | "PAID"
    | "FAILED"
    | "EXPIRED"
    | "REFUNDED"
    | "CANCELLED";
  status?:
    | "PENDING"
    | "CONFIRMED"
    | "PROCESSING"
    | "READY"
    | "COMPLETED"
    | "CANCELLED";
  /** false → the order is created WITHOUT any OrderItem (fails >=1 item). */
  withItem?: boolean;
}

export async function seedQualifyingPurchase(
  restaurantId: string,
  overrides: PurchaseSeedOverrides = {}
): Promise<{ customerId: string; orderId: string; productId: string }> {
  sequence += 1;
  const stamp = `${Date.now()}-${sequence}`;

  let customerId = overrides.customerId ?? null;
  if (!customerId) {
    // Store the CANONICAL phone form — the reservation gate matches the
    // normalized `guestPhone` the Zod schema produces.
    const phone = overrides.phone ? normalizePhone(overrides.phone) : null;
    const customer = await prisma.customer.create({
      data: {
        restaurantId,
        phone,
        name: "QA Buyer",
      },
    });
    customerId = customer.id;
  }

  const category = await prisma.category.create({
    data: { restaurantId, name: `QA Cat ${stamp}`, sortOrder: 0 },
  });
  const product = await prisma.product.create({
    data: {
      restaurantId,
      categoryId: category.id,
      name: `QA Prod ${stamp}`,
      price: 10000,
    },
  });

  const order = await prisma.order.create({
    data: {
      restaurantId,
      branchId: overrides.branchId ?? null,
      orderNumber: `QA-${stamp}`,
      customerId,
      status: overrides.status ?? "COMPLETED",
      paymentStatus: overrides.paymentStatus ?? "PAID",
      subtotal: 10000,
      grandTotal: 10000,
      ...(overrides.withItem === false
        ? {}
        : {
            items: {
              create: [
                {
                  productId: product.id,
                  quantity: 1,
                  unitPrice: 10000,
                  totalPrice: 10000,
                },
              ],
            },
          }),
    },
    select: { id: true },
  });

  return { customerId, orderId: order.id, productId: product.id };
}

/** Remove the seeded purchase graph (call BEFORE deleting customers). */
export async function cleanupPurchases(restaurantIds: string[]): Promise<void> {
  const ids = restaurantIds.filter(Boolean);
  if (ids.length === 0) return;
  await prisma.orderItem.deleteMany({
    where: { order: { restaurantId: { in: ids } } },
  });
  await prisma.order.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.category.deleteMany({ where: { restaurantId: { in: ids } } });
}
