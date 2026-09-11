import { prisma } from "@/lib/prisma";
import { NotFoundError, ConflictError, ValidationError } from "@/lib/errors";
import type { CreateIngredientInput, UpdateIngredientInput, GetIngredientsInput } from "./ingredient.types";

// ============================================================
// Ingredient Service — CRUD (restaurant-scoped)
// ============================================================

export class IngredientService {
  /**
   * Create a new ingredient. Tenant-scoped via restaurantId.
   * Unique constraint: (restaurantId, name) prevents duplicates.
   */
  async createIngredient(
    input: CreateIngredientInput,
    restaurantId: string
  ) {
    // Check for duplicate name within restaurant
    const existing = await prisma.ingredient.findFirst({
      where: { restaurantId, name: input.name },
    });
    if (existing) {
      throw new ConflictError("Bahan baku dengan nama ini sudah ada");
    }

    const ingredient = await prisma.ingredient.create({
      data: {
        restaurantId,
        name: input.name,
        baseUnit: input.baseUnit,
      },
    });

    return ingredient;
  }

  /**
   * List ingredients with pagination, search, and active filter.
   * Tenant-scoped via restaurantId.
   */
  async listIngredients(
    input: GetIngredientsInput,
    restaurantId: string
  ) {
    const { page, limit, search, isActive } = input;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { restaurantId };

    if (search) {
      where.name = { contains: search };
    }

    if (isActive !== undefined) {
      where.isActive = isActive === "true";
    }

    const [items, total] = await Promise.all([
      prisma.ingredient.findMany({
        where,
        include: {
          _count: {
            select: { branchIngredients: true },
          },
        },
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.ingredient.count({ where }),
    ]);

    return {
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        baseUnit: i.baseUnit,
        isActive: i.isActive,
        branchCount: i._count.branchIngredients,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a single ingredient by ID. Tenant-scoped.
   */
  async getIngredient(id: string, restaurantId: string) {
    const ingredient = await prisma.ingredient.findFirst({
      where: { id, restaurantId },
      include: {
        branchIngredients: {
          include: {
            branch: { select: { id: true, name: true, code: true } },
          },
          orderBy: { branch: { name: "asc" } },
        },
      },
    });

    if (!ingredient) {
      throw new NotFoundError("Bahan baku tidak ditemukan");
    }

    return {
      id: ingredient.id,
      name: ingredient.name,
      baseUnit: ingredient.baseUnit,
      isActive: ingredient.isActive,
      createdAt: ingredient.createdAt,
      updatedAt: ingredient.updatedAt,
      branchStock: ingredient.branchIngredients.map((bi) => ({
        branchId: bi.branch.id,
        branchName: bi.branch.name,
        branchCode: bi.branch.code,
        stock: Number(bi.stock),
      })),
    };
  }

  /**
   * Update an ingredient. Tenant-scoped.
   * ADMIN only.
   */
  async updateIngredient(
    id: string,
    input: UpdateIngredientInput,
    restaurantId: string
  ) {
    const existing = await prisma.ingredient.findFirst({
      where: { id, restaurantId },
    });
    if (!existing) {
      throw new NotFoundError("Bahan baku tidak ditemukan");
    }

    // Check for name conflict if renaming
    if (input.name && input.name !== existing.name) {
      const conflict = await prisma.ingredient.findFirst({
        where: { restaurantId, name: input.name, id: { not: id } },
      });
      if (conflict) {
        throw new ConflictError("Bahan baku dengan nama ini sudah ada");
      }
    }

    const updated = await prisma.ingredient.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.baseUnit !== undefined && { baseUnit: input.baseUnit }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });

    return updated;
  }
}

export const ingredientService = new IngredientService();
