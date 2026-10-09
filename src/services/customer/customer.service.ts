import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import { emitRealtime } from "@/lib/realtime/bus";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { computeCustomerRevenue } from "@/services/report/report.service";

// ============================================================
// PHASE 9B (C1) — the ONLY Customer scalars an admin/mobile endpoint may
// return. `password` (bcrypt hash) is deliberately absent and must never be
// added back. `whatsappId` is internal provider data and is also withheld.
// Every read/update path below uses this allow-list (or the equivalent nested
// select) so a raw Prisma `include` can never resurrect the hash.
// ============================================================
const CUSTOMER_PUBLIC_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class CustomerService {
  async getCustomers(
    restaurantId: string,
    params?: {
      page?: number;
      limit?: number;
      search?: string;
    },
    branchFilters?: string[] | null
  ) {
    const page = params?.page || 1;
    const limit = params?.limit || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      restaurantId,
    };

    // A branch-scoped list only surfaces customers who have ordered at one of
    // the caller's branches (customers themselves are restaurant-global).
    if (branchFilters?.length) {
      where.orders = { some: { branchId: { in: branchFilters } } };
    }

    if (params?.search) {
      where.OR = [
        { name: { contains: params.search } },
        { phone: { contains: params.search } },
      ];
    }

    // PHASE 9B (C3) — orderCount is scoped to the SAME branches as the spend
    // below. The unfiltered `_count` used to mix all-branch counts with a
    // branch-filtered total; both must now agree.
    const countSelect = branchFilters?.length
      ? { orders: { where: { branchId: { in: branchFilters } } } }
      : { orders: true };

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        select: {
          ...CUSTOMER_PUBLIC_SELECT,
          _count: { select: countSelect },
          orders: {
            where: branchFilters?.length ? { branchId: { in: branchFilters } } : undefined,
            select: { id: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.customer.count({ where }),
    ]);

    // PHASE 9B (C2) — canonical customer spend. Replaces the previous raw
    // Σ order.grandTotal (which counted CANCELLED orders and never subtracted
    // refunds). `computeCustomerRevenue` reuses the canonical revenue set and
    // refund math (productRevenue − refundRevenue). No date bound here: the
    // operational list shows all-time spending. One grouped query — never the
    // customer's order history.
    const ids = customers.map((c) => c.id);
    const revenue = await computeCustomerRevenue({
      restaurantId,
      branchFilters,
      customerIds: ids,
    });

    const customersWithStats = customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      isActive: customer.isActive,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      orderCount: customer._count.orders,
      totalSpent: (revenue.byCustomer.get(customer.id)?.netSales ?? 0).toString(),
      lastOrderAt: customer.orders[0]?.createdAt || null,
    }));

    return {
      items: customersWithStats,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * PHASE 9B (C3) — `branchFilters` is server-derived (authorizedBranches).
   * When a branch-scoped admin opens a customer, only orders from the
   * authorized branches are returned; a client-supplied branch id is never
   * trusted. Returns only public customer scalars (C1 — never the hash).
   */
  async getCustomer(
    id: string,
    restaurantId: string,
    branchFilters?: string[] | null
  ) {
    const customer = await prisma.customer.findFirst({
      where: { id, restaurantId },
      select: {
        ...CUSTOMER_PUBLIC_SELECT,
        orders: {
          where: branchFilters?.length
            ? { branchId: { in: branchFilters } }
            : undefined,
          orderBy: { createdAt: "desc" },
          take: 10,
          include: {
            items: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundError("Customer not found");
    }

    return customer;
  }

  async updateCustomer(
    id: string,
    restaurantId: string,
    data: { name?: string; phone?: string }
  ) {
    const customer = await prisma.customer.findFirst({
      where: { id, restaurantId },
    });

    if (!customer) {
      throw new NotFoundError("Customer not found");
    }

    const updated = await prisma.customer.update({
      where: { id },
      data,
      select: CUSTOMER_PUBLIC_SELECT,
    });

    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.CUSTOMER_UPDATED,
      id,
      { customerId: id }
    );

    return updated;
  }

  async findOrCreateCustomer(restaurantId: string, phone: string, name?: string) {
    let customer = await prisma.customer.findFirst({
      where: {
        restaurantId,
        phone,
      },
      select: CUSTOMER_PUBLIC_SELECT,
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          restaurantId,
          phone,
          name: name || undefined,
        },
        select: CUSTOMER_PUBLIC_SELECT,
      });
    } else if (name && !customer.name) {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: { name },
        select: CUSTOMER_PUBLIC_SELECT,
      });
    }

    return customer;
  }
}

export const customerService = new CustomerService();
