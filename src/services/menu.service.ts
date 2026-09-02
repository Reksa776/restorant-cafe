import api from "@/lib/axios";

export interface Category {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  price: string;
  imageUrl?: string;
  isAvailable: boolean;
  isActive: boolean;
  category: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductData {
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  isAvailable?: boolean;
}

export interface CreateCategoryData {
  name: string;
  description?: string;
  sortOrder?: number;
}

export interface OptionGroup {
  id: string;
  name: string;
  type: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
  options: ProductOption[];
}

export interface ProductOption {
  id: string;
  name: string;
  priceAdjustment: number;
  sortOrder: number;
  isActive: boolean;
}

export interface ProductAddon {
  id: string;
  name: string;
  price: number;
  sortOrder: number;
  isActive: boolean;
}

export interface ProductWithCustomization extends Product {
  optionGroups: OptionGroup[];
  addons: ProductAddon[];
}

export const menuService = {
  // Categories
  async getCategories(): Promise<Category[]> {
    const response = await api.get("/menu/categories");
    return response.data.data;
  },

  async createCategory(data: CreateCategoryData): Promise<Category> {
    const response = await api.post("/menu/categories", data);
    return response.data.data;
  },

  async updateCategory(
    id: string,
    data: Partial<CreateCategoryData>
  ): Promise<Category> {
    const response = await api.put(`/menu/categories/${id}`, data);
    return response.data.data;
  },

  async deleteCategory(id: string): Promise<void> {
    await api.delete(`/menu/categories/${id}`);
  },

  // Products
  async getProducts(params?: {
    categoryId?: string;
    isAvailable?: boolean;
    search?: string;
  }): Promise<Product[]> {
    const response = await api.get("/menu/products", { params });
    return response.data.data;
  },

  async getProduct(id: string): Promise<Product> {
    const response = await api.get(`/menu/products/${id}`);
    return response.data.data;
  },

  async getProductWithCustomization(id: string): Promise<ProductWithCustomization> {
    const response = await api.get(`/menu/products/${id}`);
    return response.data.data;
  },

  async createProduct(data: CreateProductData): Promise<Product> {
    const response = await api.post("/menu/products", data);
    return response.data.data;
  },

  async updateProduct(
    id: string,
    data: Partial<CreateProductData>
  ): Promise<Product> {
    const response = await api.put(`/menu/products/${id}`, data);
    return response.data.data;
  },

  async deleteProduct(id: string): Promise<void> {
    await api.delete(`/menu/products/${id}`);
  },

  async toggleProductAvailability(id: string): Promise<Product> {
    const response = await api.patch(`/menu/products/${id}/toggle-availability`);
    return response.data.data;
  },

  // Option Groups
  async getOptionGroups(productId: string): Promise<OptionGroup[]> {
    const response = await api.get(`/menu/products/${productId}/option-groups`);
    return response.data.data;
  },

  async createOptionGroup(
    productId: string,
    data: { name: string; type?: string; isRequired?: boolean; minSelect?: number; maxSelect?: number; sortOrder?: number }
  ): Promise<OptionGroup> {
    const response = await api.post(`/menu/products/${productId}/option-groups`, data);
    return response.data.data;
  },

  async updateOptionGroup(
    productId: string,
    groupId: string,
    data: Partial<{ name: string; type: string; isRequired: boolean; minSelect: number; maxSelect: number; sortOrder: number; isActive: boolean }>
  ): Promise<OptionGroup> {
    const response = await api.patch(`/menu/products/${productId}/option-groups/${groupId}`, data);
    return response.data.data;
  },

  async deleteOptionGroup(productId: string, groupId: string): Promise<void> {
    await api.delete(`/menu/products/${productId}/option-groups/${groupId}`);
  },

  // Options
  async getOptions(groupId: string): Promise<ProductOption[]> {
    const response = await api.get(`/menu/option-groups/${groupId}/options`);
    return response.data.data;
  },

  async createOption(
    groupId: string,
    data: { name: string; priceAdjustment?: number; sortOrder?: number }
  ): Promise<ProductOption> {
    const response = await api.post(`/menu/option-groups/${groupId}/options`, data);
    return response.data.data;
  },

  async updateOption(
    groupId: string,
    optionId: string,
    data: Partial<{ name: string; priceAdjustment: number; sortOrder: number; isActive: boolean }>
  ): Promise<ProductOption> {
    const response = await api.patch(`/menu/option-groups/${groupId}/options/${optionId}`, data);
    return response.data.data;
  },

  async deleteOption(groupId: string, optionId: string): Promise<void> {
    await api.delete(`/menu/option-groups/${groupId}/options/${optionId}`);
  },

  // Addons
  async getAddons(productId: string): Promise<ProductAddon[]> {
    const response = await api.get(`/menu/products/${productId}/addons`);
    return response.data.data;
  },

  async createAddon(
    productId: string,
    data: { name: string; price: number; sortOrder?: number }
  ): Promise<ProductAddon> {
    const response = await api.post(`/menu/products/${productId}/addons`, data);
    return response.data.data;
  },

  async updateAddon(
    productId: string,
    addonId: string,
    data: Partial<{ name: string; price: number; sortOrder: number; isActive: boolean }>
  ): Promise<ProductAddon> {
    const response = await api.patch(`/menu/products/${productId}/addons/${addonId}`, data);
    return response.data.data;
  },

  async deleteAddon(productId: string, addonId: string): Promise<void> {
    await api.delete(`/menu/products/${productId}/addons/${addonId}`);
  },
};
