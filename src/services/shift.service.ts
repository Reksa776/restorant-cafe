import api from "@/lib/axios";

export interface CashierShift {
  id: string;
  restaurantId: string;
  userId: string;
  shiftNumber: string;
  openingCash: string;
  closingCash?: string | null;
  expectedCash?: string | null;
  difference?: string | null;
  notes?: string | null;
  openedAt: string;
  closedAt?: string | null;
  status: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  user?: { id: string; name: string; email?: string };
  payments?: Array<{ id: string; amount: string; paidAt?: string | null }>;
  overrides?: Array<ShiftOverride>;
  _count?: { payments?: number };
}

export interface ShiftOverride {
  id: string;
  shiftId: string;
  reason: string;
  proposedClosingCash?: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decisionNote?: string | null;
  requestedByCashierId: string;
  requestedAt: string;
  decidedAt?: string | null;
  shift?: { id: string; shiftNumber: string };
  requester?: { id: string; name: string };
}

export interface RefundRequest {
  id: string;
  orderId: string;
  amount: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedByCashierId: string;
  requestedAt: string;
  order?: { id: string; orderNumber: string };
  requester?: { id: string; name: string };
}

export interface CancellationRequest {
  id: string;
  orderId: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedByCashierId: string;
  requestedAt: string;
  order?: { id: string; orderNumber: string };
  requester?: { id: string; name: string };
}

export const shiftService = {
  async listShifts(): Promise<{ items: CashierShift[] }> {
    const response = await api.get("/shifts");
    return response.data.data;
  },

  async getActiveShift(): Promise<{ shift: CashierShift | null }> {
    const response = await api.get("/shifts/active");
    return response.data.data;
  },

  async getShift(shiftId: string): Promise<{
    shift: CashierShift;
    totals: {
      openingCash: number;
      cashSales: number;
      refunds: number;
      expectedCash: number;
    };
  }> {
    const response = await api.get(`/shifts/${shiftId}`);
    return response.data.data;
  },

  async openShift(openingCash: number, notes?: string): Promise<CashierShift> {
    const response = await api.post("/shifts", { openingCash, notes });
    return response.data.data;
  },

  async closeShift(
    actualCash: number,
    notes?: string
  ): Promise<{
    shift: CashierShift;
    expectedCash: number;
    cashSales: number;
    refunds: number;
    difference: number;
  }> {
    const response = await api.post("/shifts/close", { actualCash, notes });
    return response.data.data;
  },

  async requestOverride(
    shiftId: string,
    reason: string,
    proposedClosingCash?: number
  ): Promise<ShiftOverride> {
    const response = await api.post(`/shifts/${shiftId}/override`, {
      reason,
      proposedClosingCash,
    });
    return response.data.data;
  },

  async decideOverride(
    overrideId: string,
    approve: boolean,
    password: string,
    decisionNote?: string
  ): Promise<ShiftOverride> {
    const response = await api.post(
      `/shifts/overrides/${overrideId}/decide`,
      { approve, password, decisionNote }
    );
    return response.data.data;
  },

  async reopenShift(
    shiftId: string,
    password: string,
    reason: string
  ): Promise<CashierShift> {
    const response = await api.post(`/shifts/${shiftId}/reopen`, {
      password,
      reason,
    });
    return response.data.data;
  },

  async requestRefund(orderId: string, amount: number, reason: string) {
    const response = await api.post("/refunds", { orderId, amount, reason });
    return response.data.data;
  },

  async decideRefund(
    refundId: string,
    approve: boolean,
    password: string,
    decisionNote?: string
  ) {
    const response = await api.post(`/refunds/${refundId}/decide`, {
      approve,
      password,
      decisionNote,
    });
    return response.data.data;
  },

  async requestCancellation(orderId: string, reason: string) {
    const response = await api.post("/cancellations", { orderId, reason });
    return response.data.data;
  },

  async decideCancellation(
    requestId: string,
    approve: boolean,
    password: string,
    decisionNote?: string
  ) {
    const response = await api.post(`/cancellations/${requestId}/decide`, {
      approve,
      password,
      decisionNote,
    });
    return response.data.data;
  },

  async listPendingApprovals(): Promise<{
    refunds: RefundRequest[];
    cancellations: CancellationRequest[];
    overrides: ShiftOverride[];
  }> {
    const response = await api.get("/refunds");
    return response.data.data;
  },
};

export const userService = {
  async listUsers(): Promise<{
    items: Array<{
      id: string;
      name: string;
      email: string;
      role: "ADMIN" | "CASHIER";
      isActive: boolean;
      createdAt: string;
    }>;
  }> {
    const response = await api.get("/users");
    return response.data.data;
  },

  async createUser(data: {
    name: string;
    email: string;
    password: string;
    role: "ADMIN" | "CASHIER";
  }) {
    const response = await api.post("/users", data);
    return response.data.data;
  },

  async setUserActive(userId: string, isActive: boolean) {
    const response = await api.patch(`/users/${userId}/status`, { isActive });
    return response.data.data;
  },

  async changeOwnPassword(currentPassword: string, newPassword: string) {
    const response = await api.patch("/users/me/password", {
      currentPassword,
      newPassword,
    });
    return response.data.data;
  },
};
