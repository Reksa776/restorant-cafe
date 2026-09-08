import { prisma } from "@/lib/prisma";
import QRCode from "qrcode";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors";
import { emitRealtime } from "@/lib/realtime/bus";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";

export class TableService {
  async getTables(
    restaurantId: string,
    params?: { status?: string; isActive?: boolean },
    branchFilters?: string[] | null
  ) {
    const where: Record<string, unknown> = {
      restaurantId,
    };

    if (branchFilters?.length) {
      where.branchId = { in: branchFilters };
    }

    if (params?.status) {
      where.status = params.status;
    }

    if (params?.isActive !== undefined) {
      where.isActive = params.isActive;
    }

    return prisma.table.findMany({
      where,
      include: {
        // Branch code needed by the admin UI to build the branch-scoped
        // customer URL / QR payload (/t/{branchCode}/{tableNumber}).
        branch: {
          select: { id: true, code: true, name: true },
        },
      },
      orderBy: { number: "asc" },
    });
  }

  async getTable(id: string, restaurantId: string, branchFilters?: string[] | null) {
    const table = await prisma.table.findFirst({
      where: { id, restaurantId, branchId: branchFilters?.length ? { in: branchFilters } : undefined },
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
    },
    branchId?: string | null
  ) {
    const resolvedBranchId = branchId || null;

    // A table may only be attached to a branch that belongs to this
    // restaurant (defense in depth — the route also validates).
    if (resolvedBranchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: resolvedBranchId, restaurantId },
        select: { id: true },
      });
      if (!branch) {
        throw new ValidationError("Cabang tidak ditemukan");
      }
    }

    // Check for duplicate table number within the same branch.
    const existing = await prisma.table.findFirst({
      where: {
        restaurantId,
        number: data.number,
        branchId: resolvedBranchId,
      },
    });

    if (existing) {
      throw new ConflictError(`Table number ${data.number} already exists`);
    }

    const table = await prisma.table.create({
      data: {
        restaurantId,
        branchId: resolvedBranchId,
        ...data,
        capacity: data.capacity || 4,
      },
    });

    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.TABLE_CREATED,
      table.id,
      { tableId: table.id, number: table.number, status: table.status }
    );

    return table;
  }

  async updateTable(
    id: string,
    restaurantId: string,
    data: { number?: number; name?: string; capacity?: number },
    branchFilters?: string[] | null
  ) {
    const table = await prisma.table.findFirst({
      where: { id, restaurantId, branchId: branchFilters?.length ? { in: branchFilters } : undefined },
    });

    if (!table) {
      throw new NotFoundError("Table not found");
    }

    // Check for duplicate table number if changing (same branch only).
    if (data.number && data.number !== table.number) {
      const existing = await prisma.table.findFirst({
        where: {
          restaurantId,
          number: data.number,
          branchId: table.branchId,
          id: { not: id },
        },
      });

      if (existing) {
        throw new ConflictError(`Table number ${data.number} already exists`);
      }
    }

    const updated = await prisma.table.update({
      where: { id },
      data,
    });

    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.TABLE_UPDATED,
      id,
      {
        tableId: id,
        number: updated.number,
        status: updated.status,
        capacity: updated.capacity,
      }
    );

    return updated;
  }

  async deleteTable(id: string, restaurantId: string, branchFilters?: string[] | null) {
    const table = await prisma.table.findFirst({
      where: { id, restaurantId, branchId: branchFilters?.length ? { in: branchFilters } : undefined },
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

    const deleted = await prisma.table.delete({ where: { id } });

    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.TABLE_DELETED,
      id,
      { tableId: id }
    );

    return deleted;
  }

  async updateTableStatus(
    id: string,
    restaurantId: string,
    status: "AVAILABLE" | "OCCUPIED" | "MAINTENANCE",
    branchFilters?: string[] | null
  ) {
    const table = await prisma.table.findFirst({
      where: { id, restaurantId, branchId: branchFilters?.length ? { in: branchFilters } : undefined },
    });

    if (!table) {
      throw new NotFoundError("Table not found");
    }

    if (status === "MAINTENANCE" && table.status === "OCCUPIED") {
      throw new ValidationError(
        "Cannot set table to maintenance while occupied"
      );
    }

    const updated = await prisma.table.update({
      where: { id },
      data: { status },
    });

    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.TABLE_STATUS_CHANGED,
      `${id}-${status}`,
      { tableId: id, number: updated.number, status }
    );

    return updated;
  }

  async generateQrCode(
    id: string,
    restaurantId: string,
    baseUrl?: string,
    branchFilters?: string[] | null
  ) {
    const table = await prisma.table.findFirst({
      where: { id, restaurantId, branchId: branchFilters?.length ? { in: branchFilters } : undefined },
      include: {
        branch: {
          select: { code: true, name: true, isActive: true },
        },
      },
    });

    if (!table) {
      throw new NotFoundError("Table not found");
    }

    // Prefer the caller-supplied origin (the domain the customer actually
    // reaches) so the QR encodes exactly the link shown in the admin UI.
    // Fall back to the configured public URL, then localhost for dev.
    const origin =
      baseUrl && /^https?:\/\//i.test(baseUrl)
        ? baseUrl.replace(/\/+$/, "")
        : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // Multi-branch QR: /t/{branchCode}/{tableNumber} disambiguates tables
    // that share the same number across branches. Tables without a branch
    // keep the legacy /t/{tableNumber} payload for backward compatibility.
    const qrData = table.branch?.code
      ? `${origin}/t/${encodeURIComponent(table.branch.code)}/${table.number}`
      : `${origin}/t/${table.number}`;

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
