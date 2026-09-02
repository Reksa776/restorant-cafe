import api from "@/lib/axios";

export interface RestaurantTable {
  id: string;
  number: number;
  name: string;
  capacity: number;
  status: "AVAILABLE" | "OCCUPIED" | "MAINTENANCE";
  qrCode?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTableData {
  number: number;
  name: string;
  capacity?: number;
}

export const tableService = {
  async getTables(params?: {
    status?: string;
    isActive?: boolean;
  }): Promise<RestaurantTable[]> {
    const response = await api.get("/tables", { params });
    return response.data.data;
  },

  async getTable(id: string): Promise<RestaurantTable> {
    const response = await api.get(`/tables/${id}`);
    return response.data.data;
  },

  async createTable(data: CreateTableData): Promise<RestaurantTable> {
    const response = await api.post("/tables", data);
    return response.data.data;
  },

  async updateTable(
    id: string,
    data: Partial<CreateTableData>
  ): Promise<RestaurantTable> {
    const response = await api.put(`/tables/${id}`, data);
    return response.data.data;
  },

  async deleteTable(id: string): Promise<void> {
    await api.delete(`/tables/${id}`);
  },

  async updateTableStatus(
    id: string,
    status: "AVAILABLE" | "OCCUPIED" | "MAINTENANCE"
  ): Promise<RestaurantTable> {
    const response = await api.patch(`/tables/${id}/status`, { status });
    return response.data.data;
  },

  async generateQrCode(id: string): Promise<string> {
    const response = await api.post(`/tables/${id}/qr`);
    return response.data.data.qrCode;
  },
};
