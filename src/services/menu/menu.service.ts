import { prisma } from "@/lib/prisma";
import { NotFoundError, ConflictError } from "@/lib/errors";

export class MenuService {
  // ============================================================
  // Categories
  // ============================================================

  async getCategories(restaurantId: string) {
    const categories = await prisma.category.findMany({
      where: { restaurantId, isActive: true },
      include: {
        _count: {
          select: { products: true },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    return categories.map((cat) => ({
      ...cat,
      productCount: cat._count.products,
    }));
  }

  async createCategory(
    restaurantId: string,
    data: { name: string; description?: string; sortOrder?: number }
  ) {
    const existing = await prisma.category.findFirst({
      where: {
        restaurantId,
        name: data.name,
      },
    });

    if (existing) {
      throw new ConflictError("Category with this name already exists");
    }

    return prisma.category.create({
      data: {
        restaurantId,
        ...data,
      },
    });
  }

  async updateCategory(
    id: string,
    restaurantId: string,
    data: { name?: string; description?: string; sortOrder?: number }
  ) {
    const category = await prisma.category.findFirst({
      where: { id, restaurantId },
    });

    if (!category) {
      throw new NotFoundError("Category not found");
    }

    if (data.name && data.name !== category.name) {
      const existing = await prisma.category.findFirst({
        where: {
          restaurantId,
          name: data.name,
          id: { not: id },
        },
      });

      if (existing) {
        throw new ConflictError("Category with this name already exists");
      }
    }

    return prisma.category.update({
      where: { id },
      data,
    });
  }

  async deleteCategory(id: string, restaurantId: string) {
    const category = await prisma.category.findFirst({
      where: { id, restaurantId },
      include: { products: true },
    });

    if (!category) {
      throw new NotFoundError("Category not found");
    }

    if (category.products.length > 0) {
      throw new ConflictError(
        "Cannot delete category with existing products"
      );
    }

    return prisma.category.delete({ where: { id } });
  }

  // ============================================================
  // Products
  // ============================================================

  async getProducts(
    restaurantId: string,
    params?: {
      categoryId?: string;
      isAvailable?: boolean;
      search?: string;
    }
  ) {
    const where: Record<string, unknown> = {
      restaurantId,
      isActive: true,
    };

    if (params?.categoryId) {
      where.categoryId = params.categoryId;
    }

    if (params?.isAvailable !== undefined) {
      where.isAvailable = params.isAvailable;
    }

    if (params?.search) {
      where.OR = [
        { name: { contains: params.search } },
        { description: { contains: params.search } },
      ];
    }

    return prisma.product.findMany({
      where,
      include: {
        category: true,
      },
      orderBy: { name: "asc" },
    });
  }

  async getProduct(id: string, restaurantId: string) {
    const product = await prisma.product.findFirst({
      where: { id, restaurantId },
      include: {
        category: true,
      },
    });

    if (!product) {
      throw new NotFoundError("Product not found");
    }

    return product;
  }

  async createProduct(
    restaurantId: string,
    data: {
      categoryId: string;
      name: string;
      description?: string;
      price: number;
      imageUrl?: string;
      isAvailable?: boolean;
    }
  ) {
    // Validate category exists and belongs to this restaurant
    const category = await prisma.category.findFirst({
      where: { id: data.categoryId, restaurantId },
    });

    if (!category) {
      throw new NotFoundError("Category not found");
    }

    // Check for duplicate name in same category
    const existing = await prisma.product.findFirst({
      where: {
        restaurantId,
        categoryId: data.categoryId,
        name: data.name,
      },
    });

    if (existing) {
      throw new ConflictError(
        "Product with this name already exists in this category"
      );
    }

    return prisma.product.create({
      data: {
        restaurantId,
        ...data,
        price: data.price,
      },
      include: {
        category: true,
      },
    });
  }

  async updateProduct(
    id: string,
    restaurantId: string,
    data: {
      categoryId?: string;
      name?: string;
      description?: string;
      price?: number;
      imageUrl?: string;
      isAvailable?: boolean;
    }
  ) {
    const product = await prisma.product.findFirst({
      where: { id, restaurantId },
    });

    if (!product) {
      throw new NotFoundError("Product not found");
    }

    // Validate category if changing
    if (data.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: data.categoryId, restaurantId },
      });

      if (!category) {
        throw new NotFoundError("Category not found");
      }
    }

    // Check for duplicate name if changing
    if (data.name && data.name !== product.name) {
      const existing = await prisma.product.findFirst({
        where: {
          restaurantId,
          categoryId: data.categoryId || product.categoryId,
          name: data.name,
          id: { not: id },
        },
      });

      if (existing) {
        throw new ConflictError(
          "Product with this name already exists in this category"
        );
      }
    }

    return prisma.product.update({
      where: { id },
      data: {
        ...data,
        price: data.price,
      },
      include: {
        category: true,
      },
    });
  }

  async deleteProduct(id: string, restaurantId: string) {
    const product = await prisma.product.findFirst({
      where: { id, restaurantId },
    });

    if (!product) {
      throw new NotFoundError("Product not found");
    }

    // Soft delete - set isActive to false
    return prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async toggleProductAvailability(id: string, restaurantId: string) {
    const product = await prisma.product.findFirst({
      where: { id, restaurantId },
    });

    if (!product) {
      throw new NotFoundError("Product not found");
    }

    return prisma.product.update({
      where: { id },
      data: { isAvailable: !product.isAvailable },
      include: {
        category: true,
      },
    });
  }
}

export const menuService = new MenuService();
