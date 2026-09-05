import { prisma } from "@/lib/prisma";
import { NotFoundError, ConflictError, ValidationError } from "@/lib/errors";
import { emitRealtime } from "@/lib/realtime/bus";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { normalizeProductImageUrl } from "@/lib/product-image";
import { productImageUploadService } from "@/services/upload/product-image-upload.service";

/**
 * Validate a user-supplied image value before persisting it.
 * - null  → cleared (image removed)
 * - valid string → returned trimmed (http/https URL or local /uploads asset
 *   belonging to THIS restaurant)
 * - invalid string → ValidationError (400)
 * Only called when the caller actually wants to SET/CHANGE the image.
 */
function validateProductImageValue(
  imageUrl: string | null | undefined,
  restaurantId: string,
  fieldName: string = "imageUrl"
): string | null {
  if (imageUrl === null || imageUrl === undefined) return null;
  const result = normalizeProductImageUrl(imageUrl);
  if (!result.ok) {
    throw new ValidationError(result.error.replace(/^/, `${fieldName}: `));
  }

  // Tenant isolation: an admin may only reference uploaded assets stored
  // under their own restaurant folder. Accepting another restaurant's path
  // would let tenant A later trigger deletion of tenant B's file (the old
  // URL is cleaned up on replace/remove).
  const value = result.value;
  if (value.startsWith("/uploads/products/")) {
    const ownPrefix = `/uploads/products/${restaurantId}/`;
    if (!value.startsWith(ownPrefix)) {
      throw new ValidationError(
        `${fieldName}: uploaded asset does not belong to this restaurant`
      );
    }
  }

  return value;
}

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

    const category = await prisma.category.create({
      data: {
        restaurantId,
        ...data,
      },
    });

    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.CATEGORY_CREATED,
      category.id,
      { categoryId: category.id, name: category.name }
    );

    return category;
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

    const updated = await prisma.category.update({
      where: { id },
      data,
    });

    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.CATEGORY_UPDATED,
      id,
      { categoryId: id, name: updated.name }
    );

    return updated;
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

    const deleted = await prisma.category.delete({ where: { id } });

    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.CATEGORY_DELETED,
      id,
      { categoryId: id }
    );

    return deleted;
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
      imageUrl?: string | null;
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

    // Validate imageUrl (string → http/https URL or local upload owned by
    // this restaurant; null/absent → no image)
    const imageUrl =
      data.imageUrl === undefined
        ? null
        : validateProductImageValue(data.imageUrl, restaurantId);

    const product = await prisma.product.create({
      data: {
        restaurantId,
        categoryId: data.categoryId,
        name: data.name,
        description: data.description,
        price: data.price,
        imageUrl,
        isAvailable: data.isAvailable ?? true,
      },
      include: {
        category: true,
      },
    });

    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.PRODUCT_CREATED,
      product.id,
      {
        productId: product.id,
        name: product.name,
        categoryId: product.categoryId,
        isAvailable: product.isAvailable,
      }
    );

    return product;
  }

  async updateProduct(
    id: string,
    restaurantId: string,
    data: {
      categoryId?: string;
      name?: string;
      description?: string;
      price?: number;
      imageUrl?: string | null;
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

    // imageUrl semantics:
    //  - absent        → keep the current image (backward compatible)
    //  - null          → remove the image
    //  - valid string  → set/replace the image
    const { imageUrl, ...restData } = data;
    let nextImageUrl: string | null | undefined;
    if (imageUrl !== undefined) {
      nextImageUrl =
        imageUrl === null
          ? null
          : validateProductImageValue(imageUrl, restaurantId);
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...restData,
        ...(nextImageUrl !== undefined ? { imageUrl: nextImageUrl } : {}),
        price: data.price,
      },
      include: {
        category: true,
      },
    });

    // Replace or removal → drop the previous locally stored file (best-effort,
    // only for files under OUR upload root AND this restaurant's folder;
    // remote URLs and other tenants' assets are never touched).
    const ownPrefix = `/uploads/products/${restaurantId}/`;
    if (
      nextImageUrl !== undefined &&
      nextImageUrl !== product.imageUrl &&
      product.imageUrl?.startsWith(ownPrefix)
    ) {
      await productImageUploadService.deleteByUrl(product.imageUrl);
    }

    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.PRODUCT_UPDATED,
      updated.id,
      {
        productId: updated.id,
        name: updated.name,
        categoryId: updated.categoryId,
        isAvailable: updated.isAvailable,
      }
    );

    return updated;
  }

  async deleteProduct(id: string, restaurantId: string) {
    const product = await prisma.product.findFirst({
      where: { id, restaurantId },
    });

    if (!product) {
      throw new NotFoundError("Product not found");
    }

    // Soft delete - set isActive to false
    const updated = await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.PRODUCT_DELETED,
      id,
      { productId: id }
    );

    return updated;
  }

  async toggleProductAvailability(id: string, restaurantId: string) {
    const product = await prisma.product.findFirst({
      where: { id, restaurantId },
    });

    if (!product) {
      throw new NotFoundError("Product not found");
    }

    const updated = await prisma.product.update({
      where: { id },
      data: { isAvailable: !product.isAvailable },
      include: {
        category: true,
      },
    });

    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.PRODUCT_UPDATED,
      updated.id,
      {
        productId: updated.id,
        name: updated.name,
        categoryId: updated.categoryId,
        isAvailable: updated.isAvailable,
      }
    );

    return updated;
  }

  // ============================================================
  // Product Detail (with customization)
  // ============================================================

  async getProductWithCustomization(id: string, restaurantId: string) {
    const product = await prisma.product.findFirst({
      where: { id, restaurantId },
      include: {
        category: true,
        optionGroups: {
          include: {
            options: { orderBy: { sortOrder: "asc" } },
          },
          orderBy: { sortOrder: "asc" },
        },
        addons: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!product) {
      throw new NotFoundError("Product not found");
    }

    return product;
  }

  // ============================================================
  // Option Groups
  // ============================================================

  async getOptionGroups(productId: string, restaurantId: string) {
    // Verify product belongs to restaurant
    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId },
    });
    if (!product) throw new NotFoundError("Product not found");

    return prisma.productOptionGroup.findMany({
      where: { productId },
      include: { options: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
  }

  async createOptionGroup(
    productId: string,
    restaurantId: string,
    data: {
      name: string;
      type?: string;
      isRequired?: boolean;
      minSelect?: number;
      maxSelect?: number;
      sortOrder?: number;
    }
  ) {
    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId },
    });
    if (!product) throw new NotFoundError("Product not found");

    const type = data.type || "SINGLE";
    if (type !== "SINGLE" && type !== "MULTI") {
      throw new ValidationError("type must be SINGLE or MULTI");
    }

    const isRequired = data.isRequired ?? true;
    const minSelect = data.minSelect ?? (type === "SINGLE" && isRequired ? 1 : 0);
    const maxSelect = data.maxSelect ?? (type === "SINGLE" ? 1 : 10);

    if (type === "SINGLE" && maxSelect !== 1) {
      throw new ValidationError("SINGLE type must have maxSelect = 1");
    }
    if (minSelect < 0) throw new ValidationError("minSelect must be >= 0");
    if (maxSelect < minSelect) throw new ValidationError("maxSelect must be >= minSelect");

    return prisma.productOptionGroup.create({
      data: {
        productId,
        name: data.name,
        type,
        isRequired,
        minSelect,
        maxSelect,
        sortOrder: data.sortOrder ?? 0,
      },
      include: { options: true },
    });
  }

  async updateOptionGroup(
    groupId: string,
    productId: string,
    restaurantId: string,
    data: {
      name?: string;
      type?: string;
      isRequired?: boolean;
      minSelect?: number;
      maxSelect?: number;
      sortOrder?: number;
      isActive?: boolean;
    }
  ) {
    // Verify product belongs to restaurant
    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId },
    });
    if (!product) throw new NotFoundError("Product not found");

    const group = await prisma.productOptionGroup.findFirst({
      where: { id: groupId, productId },
    });
    if (!group) throw new NotFoundError("Option group not found");

    if (data.type && data.type !== group.type) {
      if (data.type !== "SINGLE" && data.type !== "MULTI") {
        throw new ValidationError("type must be SINGLE or MULTI");
      }
      if (data.type === "SINGLE") {
        data.maxSelect = 1;
      }
    }

    return prisma.productOptionGroup.update({
      where: { id: groupId },
      data,
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
  }

  async deleteOptionGroup(
    groupId: string,
    productId: string,
    restaurantId: string
  ) {
    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId },
    });
    if (!product) throw new NotFoundError("Product not found");

    const group = await prisma.productOptionGroup.findFirst({
      where: { id: groupId, productId },
    });
    if (!group) throw new NotFoundError("Option group not found");

    // Delete group and cascade options
    await prisma.productOption.deleteMany({ where: { optionGroupId: groupId } });
    return prisma.productOptionGroup.delete({ where: { id: groupId } });
  }

  // ============================================================
  // Options
  // ============================================================

  async getOptions(groupId: string, restaurantId: string) {
    // Verify group exists and belongs to a product in this restaurant
    const group = await prisma.productOptionGroup.findFirst({
      where: { id: groupId },
      include: { product: { select: { restaurantId: true } } },
    });
    if (!group) throw new NotFoundError("Option group not found");
    if (group.product.restaurantId !== restaurantId) {
      throw new NotFoundError("Option group not found");
    }

    return prisma.productOption.findMany({
      where: { optionGroupId: groupId },
      orderBy: { sortOrder: "asc" },
    });
  }

  async createOption(
    groupId: string,
    restaurantId: string,
    data: {
      name: string;
      priceAdjustment?: number;
      sortOrder?: number;
    }
  ) {
    const group = await prisma.productOptionGroup.findFirst({
      where: { id: groupId },
      include: { product: { select: { restaurantId: true } } },
    });
    if (!group) throw new NotFoundError("Option group not found");
    if (group.product.restaurantId !== restaurantId) {
      throw new NotFoundError("Option group not found");
    }

    return prisma.productOption.create({
      data: {
        optionGroupId: groupId,
        name: data.name,
        priceAdjustment: data.priceAdjustment ?? 0,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async updateOption(
    optionId: string,
    groupId: string,
    restaurantId: string,
    data: {
      name?: string;
      priceAdjustment?: number;
      sortOrder?: number;
      isActive?: boolean;
    }
  ) {
    // Verify group belongs to restaurant
    const group = await prisma.productOptionGroup.findFirst({
      where: { id: groupId },
      include: { product: { select: { restaurantId: true } } },
    });
    if (!group) throw new NotFoundError("Option group not found");
    if (group.product.restaurantId !== restaurantId) {
      throw new NotFoundError("Option group not found");
    }

    const option = await prisma.productOption.findFirst({
      where: { id: optionId, optionGroupId: groupId },
    });
    if (!option) throw new NotFoundError("Option not found");

    return prisma.productOption.update({
      where: { id: optionId },
      data,
    });
  }

  async deleteOption(
    optionId: string,
    groupId: string,
    restaurantId: string
  ) {
    const group = await prisma.productOptionGroup.findFirst({
      where: { id: groupId },
      include: { product: { select: { restaurantId: true } } },
    });
    if (!group) throw new NotFoundError("Option group not found");
    if (group.product.restaurantId !== restaurantId) {
      throw new NotFoundError("Option group not found");
    }

    const option = await prisma.productOption.findFirst({
      where: { id: optionId, optionGroupId: groupId },
    });
    if (!option) throw new NotFoundError("Option not found");

    return prisma.productOption.delete({ where: { id: optionId } });
  }

  // ============================================================
  // Addons
  // ============================================================

  async getAddons(productId: string, restaurantId: string) {
    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId },
    });
    if (!product) throw new NotFoundError("Product not found");

    return prisma.productAddon.findMany({
      where: { productId },
      orderBy: { sortOrder: "asc" },
    });
  }

  async createAddon(
    productId: string,
    restaurantId: string,
    data: {
      name: string;
      price: number;
      sortOrder?: number;
    }
  ) {
    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId },
    });
    if (!product) throw new NotFoundError("Product not found");

    return prisma.productAddon.create({
      data: {
        productId,
        name: data.name,
        price: data.price,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async updateAddon(
    addonId: string,
    productId: string,
    restaurantId: string,
    data: {
      name?: string;
      price?: number;
      sortOrder?: number;
      isActive?: boolean;
    }
  ) {
    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId },
    });
    if (!product) throw new NotFoundError("Product not found");

    const addon = await prisma.productAddon.findFirst({
      where: { id: addonId, productId },
    });
    if (!addon) throw new NotFoundError("Addon not found");

    return prisma.productAddon.update({
      where: { id: addonId },
      data,
    });
  }

  async deleteAddon(
    addonId: string,
    productId: string,
    restaurantId: string
  ) {
    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId },
    });
    if (!product) throw new NotFoundError("Product not found");

    const addon = await prisma.productAddon.findFirst({
      where: { id: addonId, productId },
    });
    if (!addon) throw new NotFoundError("Addon not found");

    return prisma.productAddon.delete({ where: { id: addonId } });
  }
}

export const menuService = new MenuService();
