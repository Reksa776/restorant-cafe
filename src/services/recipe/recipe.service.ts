import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type {
  RecipeDto,
  RecipeItemDto,
  RecipeItemInput,
  SaveRecipeInput,
} from "./recipe.types";

// ============================================================
// Recipe Service (F.3) — restaurant-level BOM composition.
// Stores composition only. HPP/COGS is DERIVED later (F.4+) from
// RecipeItem.quantity × BranchIngredient.averageCost — nothing is
// computed here and no stock/order logic is touched.
// ============================================================

class RecipeService {
  /** Map a single ingredient row to its public composition item. */
  private toItemDto(item: {
    id: string;
    ingredientId: string;
    quantity: Prisma.Decimal;
    unit: string;
    ingredient: { id: string; name: string; baseUnit: string };
  }): RecipeItemDto {
    return {
      id: item.id,
      ingredientId: item.ingredientId,
      ingredientName: item.ingredient.name,
      baseUnit: item.ingredient.baseUnit,
      quantity: item.quantity.toString(),
      unit: item.unit,
    };
  }

  /**
   * GET recipe composition for a product. Restaurant-scoped.
   * An INACTIVE (deleted) recipe is treated as "no recipe" → null.
   * Never exposes averageCost / lastPurchaseCost / supplier / stock.
   */
  async getRecipe(productId: string, restaurantId: string): Promise<RecipeDto | null> {
    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundError("Produk tidak ditemukan");
    }

    const recipe = await prisma.recipe.findFirst({
      where: { productId, restaurantId, isActive: true },
      include: {
        items: {
          include: { ingredient: { select: { id: true, name: true, baseUnit: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!recipe) return null;

    return {
      id: recipe.id,
      productId: recipe.productId,
      isActive: recipe.isActive,
      createdAt: recipe.createdAt.toISOString(),
      updatedAt: recipe.updatedAt.toISOString(),
      items: recipe.items.map((i) => this.toItemDto(i)),
    };
  }

  /**
   * PUT — atomically create (or fully replace) the recipe for a product.
   *
   * Validation (all restaurant-scoped):
   * - product belongs to ctx restaurant
   * - ≥ 1 item, no duplicate ingredient
   * - every ingredient exists in the same restaurant
   * - quantity is a valid Decimal > 0 (never Number())
   * - unit matches ingredient.baseUnit (no conversion)
   *
   * Single transaction: deleteMany + createMany inside a recipe upsert —
   * a partial save is impossible.
   */
  async saveRecipe(
    productId: string,
    restaurantId: string,
    input: SaveRecipeInput
  ): Promise<RecipeDto | null> {
    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundError("Produk tidak ditemukan");
    }

    const items = input.items;
    if (!items.length) {
      throw new ValidationError("Recipe minimal harus memiliki 1 bahan baku");
    }

    const ingredientIds = items.map((i) => i.ingredientId);
    if (new Set(ingredientIds).size !== ingredientIds.length) {
      throw new ValidationError("Bahan baku tidak boleh duplikat");
    }

    const ingredients = await prisma.ingredient.findMany({
      where: { id: { in: ingredientIds }, restaurantId },
      select: { id: true, name: true, baseUnit: true },
    });
    if (ingredients.length !== ingredientIds.length) {
      throw new ValidationError("Satu atau lebih bahan baku tidak valid");
    }
    const ingredientById = new Map(ingredients.map((i) => [i.id, i]));

    const data = items.map((item: RecipeItemInput) => {
      let qty: Prisma.Decimal;
      try {
        qty = new Prisma.Decimal(item.quantity);
      } catch {
        throw new ValidationError("Quantity harus berupa angka desimal yang valid");
      }
      if (!qty.isFinite() || qty.isNegative() || qty.isZero()) {
        throw new ValidationError("Quantity harus lebih besar dari 0");
      }

      const ingredient = ingredientById.get(item.ingredientId)!;
      if (item.unit !== ingredient.baseUnit) {
        throw new ValidationError(
          `Unit untuk ${ingredient.name} harus ${ingredient.baseUnit}`
        );
      }

      return {
        ingredientId: item.ingredientId,
        quantity: qty,
        unit: item.unit,
      };
    });

    await prisma.$transaction(async (tx) => {
      await tx.recipe.upsert({
        where: { productId },
        create: {
          restaurantId,
          productId,
          isActive: true,
          items: { createMany: { data } },
        },
        update: {
          isActive: true,
          items: {
            deleteMany: {},
            createMany: { data },
          },
        },
      });
    });

    return this.getRecipe(productId, restaurantId);
  }

  /**
   * DELETE — soft delete (isActive = false). Never hard-deletes the recipe
   * or any ingredient. Idempotent: no recipe → nothing changes, still ok.
   */
  async deleteRecipe(productId: string, restaurantId: string): Promise<void> {
    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundError("Produk tidak ditemukan");
    }

    await prisma.recipe.updateMany({
      where: { productId, restaurantId },
      data: { isActive: false },
    });
  }
}

export const recipeService = new RecipeService();