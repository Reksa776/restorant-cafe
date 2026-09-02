import { prisma } from "@/lib/prisma";
import QRCode from "qrcode";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors";

export class TableService {
  async getTables(
    restaurantId: string,
    params?: { status?: string; isActive?: boolean }
  ) {
    const where: Record<string, unknown> = {
      restaurantId,
    };

    if (params?.status) {
      where.status = params.status;
    }

    if (params?.isActive !== undefined) {
      where.isActive = params.isActive;
    }

    return prisma.table.findMany({
      where,
      orderBy: { number: "asc" },
    });
  }

  async getTable(id: string, restaurantId: string) {
    const table = await prisma.table.findFirst({
      where: { id, restaurantId },
      include: {
        orders: {
          where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
          take: 1,
        },
      },
    });

    if (!table) {
      throw new NotFoundError("Table not found");
    }

    return table;
  }

  async createTable(
    restaurantId: string,
    data: {
      number: number;
      name: string;
      capacity?: number;
    }
  ) {
    // Check for duplicate table number
    const existing = await prisma.table.findFirst({
      where: {
        restaurantId,
        number: data.number,
      },
    });

    if (existing) {
      throw new ConflictError(`Table number ${data.number} already exists`);
    }

    return prisma.table.create({
      data: {
        restaurantId,
        ...data,
        capacity: data.capacity || 4,
      },
    });
  }

  async updateTable(
    id: string,
    restaurantId: string,
    data: { number?: number; name?: string; capacity?: number }
  ) {
    const table = await prisma.table.findFirst({
      where: { id, restaurantId },
    });

    if (!table) {
      throw new NotFoundError("Table not found");
    }

    // Check for duplicate table number if changing
    if (data.number && data.number !== table.number) {
      const existing = await prisma.table.findFirst({
        where: {
          restaurantId,
          number: data.number,
          id: { not: id },
        },
      });

      if (existing) {
        throw new ConflictError(`Table number ${data.number} already exists`);
      }
    }

    return prisma.table.update({
      where: { id },
      data,
    });
  }

  async deleteTable(id: string, restaurantId: string) {
    const table = await prisma.table.findFirst({
      where: { id, restaurantId },
      include: {
        orders: {
          where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
        },
      },
    });

    if (!table) {
      throw new NotFoundError("Table not found");
    }

    if (table.orders.length > 0) {
      throw new ConflictError(
        "Cannot delete table with active orders"
      );
    }

    return prisma.table.delete({ where: { id } });
  }

  async updateTableStatus(
    id: string,
    restaurantId: string,
    status: "AVAILABLE" | "OCCUPIED" | "MAINTENANCE"
  ) {
    const table = await prisma.table.findFirst({
      where: { id, restaurantId },
    });

    if (!table) {
      throw new NotFoundError("Table not found");
    }

    if (status === "MAINTENANCE" && table.status === "OCCUPIED") {
      throw new ValidationError(
        "Cannot set table to maintenance while occupied"
      );
    }

    return prisma.table.update({
      where: { id },
      data: { status },
    });
  }

  async generateQrCode(id: string, restaurantId: string) {
    const table = await prisma.table.findFirst({
      where: { id, restaurantId },
    });

    if (!table) {
      throw new NotFoundError("Table not found");
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const qrData = `${baseUrl}/t/${table.number}`;

    const qrCode = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });

    // Save QR code to table
    await prisma.table.update({
      where: { id },
      data: { qrCode },
    });

    return { qrCode, tableNumber: table.number };
  }
}

export const tableService = new TableService();
