// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin typed HTTP calls into /api.
// The server-side implementation lives in ./layout/layout.service.ts (Prisma).
// This file holds NO layout logic — it only wires the three endpoints, using
// the existing axios wrapper (branch header + 401 recovery are applied by the
// shared interceptor). UI (admin editor / customer floor map) comes later.
// ============================================================
import api from "@/lib/axios";
import type { SaveBranchLayoutInput } from "./layout/layout.types";

/** One placed table as returned by the layout endpoints (allow-listed). */
export interface BranchLayoutItemView {
  tableId: string;
  number: number;
  name: string;
  capacity: number;
  shape: "RECTANGLE" | "CIRCLE";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** Admin GET/PUT /admin/branches/:branchId/layout response data. */
export interface BranchLayoutView {
  branchId: string;
  version: number;
  canvas: { width: number; height: number };
  items: BranchLayoutItemView[];
}

/** Public GET /public/branches/:branchCode/layout response data. */
export interface PublicBranchLayoutView extends BranchLayoutView {
  branchCode: string;
}

export const layoutService = {
  /** Fetch a branch's floor plan (ADMIN/CASHIER). */
  async getAdminBranchLayout(branchId: string): Promise<BranchLayoutView> {
    const response = await api.get(`/admin/branches/${branchId}/layout`);
    return response.data.data as BranchLayoutView;
  },

  /** Replace a branch's floor plan (full-state PUT, optimistic version lock). */
  async saveAdminBranchLayout(
    branchId: string,
    payload: SaveBranchLayoutInput
  ): Promise<BranchLayoutView> {
    const response = await api.put(
      `/admin/branches/${branchId}/layout`,
      payload
    );
    return response.data.data as BranchLayoutView;
  },

  /** Fetch a branch's floor map for customers, addressed by branchCode. */
  async getPublicBranchLayout(
    branchCode: string
  ): Promise<PublicBranchLayoutView> {
    const response = await api.get(`/public/branches/${branchCode}/layout`);
    return response.data.data as PublicBranchLayoutView;
  },
};