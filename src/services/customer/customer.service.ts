import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import { emitRealtime } from "@/lib/realtime/bus";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";

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

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: {
          // Bounded (LOW-8): orderCount via _count and only the LATEST order
          // for lastOrderAt — never the customer's whole order history.
          _count: {
            select: { orders: true },
          },
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

    // Total spent per customer via a single grouped aggregation (indexed by
    // Order.customerId) instead of loading every order row.
    const ids = customers.map((c) => c.id);
    const spentRows = ids.length
      ? await prisma.order.groupBy({
          by: ["customerId"],
          where: {
            restaurantId,
            customerId: { in: ids },
            ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
          },
          _sum: { grandTotal: true },
        })
      : [];
    const spentByCustomer = new Map(
      spentRows.map((r) => [r.customerId, r._sum.grandTotal])
    );

    const customersWithStats = customers.map((customer) => ({
      ...customer,
      orderCount: customer._count.orders,
      totalSpent: spentByCustomer.get(customer.id)?.toString() || "0",
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

  async getCustomer(id: string, restaurantId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, restaurantId },
      include: {
        orders: {
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
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          restaurantId,
          phone,
          name: name || undefined,
        },
      });
    } else if (name && !customer.name) {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: { name },
      });
    }

    return customer;
  }
}

export const customerService = new CustomerService();
