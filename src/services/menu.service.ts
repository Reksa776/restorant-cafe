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
};
