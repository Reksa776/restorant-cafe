import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";

// ============================================================
// SUPPLIER SERVICE FOUNDATION (Phase B)
//
// Restaurant-scoped vendor master. Phase C adds the admin UI; the service
// layer (validation, tenant scoping, duplicate handling) is built here so the
// UI can only ever call into an already-safe API. isActive = soft
// disable/deletion — suppliers are never hard-deleted so Purchase history
// stays intact.
// ============================================================

export interface SupplierInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function normalizePhone(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

export async function listSuppliers(
  restaurantId: string,
  opts: { search?: string; isActive?: boolean } = {}
) {
  const where: Prisma.SupplierWhereInput = {
    restaurantId,
    ...(typeof opts.isActive === "boolean" ? { isActive: opts.isActive } : {}),
    ...(opts.search?.trim() ? { name: { contains: opts.search.trim() } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      take: 200,
    }),
    prisma.supplier.count({ where }),
  ]);

  return {
    items: items.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      email: s.email,
      address: s.address,
      notes: s.notes,
      isActive: s.isActive,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
    total,
  };
}

export async function getSupplier(restaurantId: string, id: string) {
  const supplier = await prisma.supplier.findFirst({
    where: { id, restaurantId },
  });
  if (!supplier) {
    throw new NotFoundError("Supplier tidak ditemukan");
  }
  return supplier;
}

export async function createSupplier(restaurantId: string, input: SupplierInput) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) {
    throw new ValidationError("Nama supplier wajib diisi");
  }
  const phone = normalizePhone(input.phone);

  try {
    const supplier = await prisma.supplier.create({
      data: {
        restaurantId,
        name,
        phone,
        email: input.email?.trim() || null,
        address: input.address?.trim() || null,
        notes: input.notes?.trim() || null,
      },
    });
    return supplier;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("Supplier dengan nama ini sudah ada");
    }
    throw error;
  }
}

export async function updateSupplier(
  restaurantId: string,
  id: string,
  input: Partial<SupplierInput>
) {
  const existing = await prisma.supplier.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    throw new NotFoundError("Supplier tidak ditemukan");
  }

  const data: Prisma.SupplierUpdateInput = {};
  if (input.name !== undefined) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) {
      throw new ValidationError("Nama supplier wajib diisi");
    }
    data.name = name;
  }
  if (input.phone !== undefined) {
    data.phone = normalizePhone(input.phone);
  }
  if (input.email !== undefined) {
    data.email = input.email?.trim() || null;
  }
  if (input.address !== undefined) {
    data.address = input.address?.trim() || null;
  }
  if (input.notes !== undefined) {
    data.notes = input.notes?.trim() || null;
  }

  try {
    const supplier = await prisma.supplier.update({
      where: { id },
      data,
    });
    return supplier;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("Supplier dengan nama ini sudah ada");
    }
    throw error;
  }
}

export async function setSupplierActive(
  restaurantId: string,
  id: string,
  isActive: boolean
) {
  const existing = await prisma.supplier.findFirst({ where: { id, restaurantId } });
  if (!existing) {
    throw new NotFoundError("Supplier tidak ditemukan");
  }
  return prisma.supplier.update({
    where: { id },
    data: { isActive },
  });
}