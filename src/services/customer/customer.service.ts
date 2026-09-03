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
    }
  ) {
    const page = params?.page || 1;
    const limit = params?.limit || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      restaurantId,
    };

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
          orders: {
            select: {
              id: true,
              grandTotal: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.customer.count({ where }),
    ]);

    const customersWithStats = customers.map((customer) => ({
      ...customer,
      orderCount: customer.orders.length,
      totalSpent: customer.orders
        .reduce((sum, order) => sum + Number(order.grandTotal), 0)
        .toString(),
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
