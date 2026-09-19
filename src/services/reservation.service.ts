// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./reservation/reservation.service.ts
// (Prisma). Keeping the two trees distinct avoids importing Prisma into
// client components. R4 admin UI consumes ONLY the R3 admin endpoints.
// ============================================================
import api from "@/lib/axios";
import type { ReservationStatusValue } from "./reservation/reservation.types";

/**
 * Shape of a reservation as returned by the admin reservation endpoints
 * (ReservationView on the server). Deliberately mirrors the server fields so
 * the UI never guesses; the server keep an explicit allow-list per DTO.
 */
export interface ReservationTableView {
  id: string;
  restaurantId: string;
  branchId: string;
  code: string;
  customerId: string | null;
  tableId: string | null;
  guestName: string;
  guestPhone: string;
  partySize: number;
  /** Already `YYYY-MM-DD` (date-only — render as-is, no timezone math). */
  reservationDate: string;
  startMinutes: number;
  durationMinutes: number;
  status: ReservationStatusValue;
  notes: string | null;
  source: string;
  orderId: string | null;
  confirmedAt: string | null;
  seatedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  table: { id: string; number: number; name: string; capacity: number } | null;
  branch: { id: string; code: string; name: string } | null;
  customer: { id: string; name: string; phone: string | null } | null;
}

export interface ReservationListResult {
  items: ReservationTableView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReservationListParams {
  page?: number;
  limit?: number;
  /** Explicit branch filter — server-validated (assertBranchInScope). */
  branchId?: string;
  /** `YYYY-MM-DD` */
  date?: string;
  status?: string;
  search?: string;
  sort?: "board" | "newest";
}

/**
 * Thin R3 admin reservation client. Branch scoping via the global
 * x-branch-id header is applied by the shared axios interceptor; an explicit
 * `branchId` param here is an additional validated view filter.
 */
export const reservationService = {
  async list(
    params: ReservationListParams = {}
  ): Promise<ReservationListResult> {
    const response = await api.get("/admin/reservations", { params });
    return response.data.data as ReservationListResult;
  },

  async getById(id: string): Promise<ReservationTableView> {
    const response = await api.get(`/admin/reservations/${id}`);
    return response.data.data as ReservationTableView;
  },

  async updateStatus(
    id: string,
    status: ReservationStatusValue
  ): Promise<ReservationTableView> {
    const response = await api.patch(`/admin/reservations/${id}/status`, {
      status,
    });
    return response.data.data as ReservationTableView;
  },

  async cancel(
    id: string,
    cancelReason?: string
  ): Promise<ReservationTableView> {
    const response = await api.post(`/admin/reservations/${id}/cancel`, {
      cancelReason: cancelReason?.trim() || undefined,
    });
    return response.data.data as ReservationTableView;
  },
};