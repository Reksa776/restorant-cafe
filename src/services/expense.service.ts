// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into
// /api/admin/accounting/*. The server-side implementation lives in
// ./accounting/expense.service.ts.
// ============================================================
import api from "@/lib/axios";

export type ExpenseMethod = "CASH" | "TRANSFER" | "QRIS" | "CARD" | "OTHER";

export interface Expense {
  id: string;
  amount: number;
  spentAt: string; // YYYY-MM-DD
  method: ExpenseMethod;
  methodLabel: string;
  note: string | null;
  categoryId: string;
  categoryName: string | null;
  categoryActive: boolean;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  createdByUserId: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  isActive: boolean;
  expenseCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseListParams {
  page?: number;
  limit?: number;
  branchId?: string;
  categoryId?: string;
  method?: ExpenseMethod;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface ExpenseListResult {
  items: Expense[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: {
    totalAmount: number;
    count: number;
    byCategory: Array<{
      categoryId: string;
      categoryName: string;
      total: number;
      count: number;
    }>;
  };
}

export interface CreateExpenseData {
  branchId?: string;
  categoryId: string;
  amount: number;
  spentAt: string;
  method: ExpenseMethod;
  note?: string | null;
}

export type UpdateExpenseData = Partial<CreateExpenseData>;

/** Build the CSV export URL from the same filters used by the list. */
export function expenseExportUrl(params: ExpenseListParams): string {
  const qs = new URLSearchParams();
  if (params.branchId) qs.set("branchId", params.branchId);
  if (params.categoryId) qs.set("categoryId", params.categoryId);
  if (params.method) qs.set("method", params.method);
  if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
  if (params.dateTo) qs.set("dateTo", params.dateTo);
  if (params.search) qs.set("search", params.search);
  const suffix = qs.toString();
  return `/api/admin/accounting/expenses/export${suffix ? `?${suffix}` : ""}`;
}

export const expenseService = {
  async list(params?: ExpenseListParams): Promise<ExpenseListResult> {
    const response = await api.get("/admin/accounting/expenses", { params });
    return response.data.data;
  },

  async get(id: string): Promise<Expense> {
    const response = await api.get(`/admin/accounting/expenses/${id}`);
    return response.data.data;
  },

  async create(data: CreateExpenseData): Promise<Expense> {
    const response = await api.post("/admin/accounting/expenses", data);
    return response.data.data;
  },

  async update(id: string, data: UpdateExpenseData): Promise<Expense> {
    const response = await api.patch(`/admin/accounting/expenses/${id}`, data);
    return response.data.data;
  },

  async remove(id: string): Promise<{ id: string }> {
    const response = await api.delete(`/admin/accounting/expenses/${id}`);
    return response.data.data;
  },

  async listCategories(): Promise<{ items: ExpenseCategory[] }> {
    const response = await api.get("/admin/accounting/expense-categories");
    return response.data.data;
  },

  async createCategory(name: string): Promise<ExpenseCategory> {
    const response = await api.post("/admin/accounting/expense-categories", { name });
    return response.data.data;
  },

  async updateCategory(
    id: string,
    data: { name?: string; isActive?: boolean }
  ): Promise<ExpenseCategory> {
    const response = await api.patch(
      `/admin/accounting/expense-categories/${id}`,
      data
    );
    return response.data.data;
  },
};
