"use client";

import { UtensilsCrossed, ChefHat, PackageCheck } from "lucide-react";
import type { Order } from "@/services/order.service";
import { KitchenTicket } from "./kitchen-ticket";

// ============================================================
// Column definitions
// ============================================================

interface ColumnDef {
  key: string;
  label: string;
  Icon: typeof UtensilsCrossed;
  /** CSS class for the column header accent. */
  headerClass: string;
  /** CSS class for ticket top accent strip. */
  ticketAccent: string;
  /** Which statuses belong in this column. */
  statuses: string[];
  /** Action button config — derived per-ticket based on current status. */
  getAction: (
    order: Order
  ) => {
    label: string;
    targetStatus: string;
    intermediateStatus?: string;
  };
}

const COLUMNS: ColumnDef[] = [
  {
    key: "new",
    label: "BARU",
    Icon: UtensilsCrossed,
    headerClass: "bg-amber-500",
    ticketAccent: "bg-amber-400",
    statuses: ["PENDING", "CONFIRMED"],
    getAction: (order) => {
      // PENDING → CONFIRMED → PROCESSING (two-step)
      if (order.status === "PENDING") {
        return {
          label: "MULAI",
          targetStatus: "PROCESSING",
          intermediateStatus: "CONFIRMED",
        };
      }
      // CONFIRMED → PROCESSING (single-step)
      return {
        label: "MULAI",
        targetStatus: "PROCESSING",
      };
    },
  },
  {
    key: "preparing",
    label: "SEDANG DIBUAT",
    Icon: ChefHat,
    headerClass: "bg-blue-500",
    ticketAccent: "bg-blue-500",
    statuses: ["PROCESSING"],
    getAction: () => ({
      label: "SIAP",
      targetStatus: "READY",
    }),
  },
  {
    key: "ready",
    label: "SIAP",
    Icon: PackageCheck,
    headerClass: "bg-emerald-500",
    ticketAccent: "bg-emerald-500",
    statuses: ["READY"],
    getAction: () => ({
      label: "SELESAI",
      targetStatus: "COMPLETED",
    }),
  },
];

// ============================================================
// Board component
// ============================================================

interface KitchenBoardProps {
  orders: Order[];
  onActionDone: () => void;
}

export function KitchenBoard({ orders, onActionDone }: KitchenBoardProps) {
  // Group orders into columns
  const grouped = COLUMNS.map((col) => ({
    ...col,
    items: orders.filter((o) => col.statuses.includes(o.status)),
  }));

  const totalActive = orders.length;

  return (
    <div className="flex flex-col h-full">
      {/* Column headers with counts */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        {grouped.map((col) => (
          <div
            key={col.key}
            className="flex items-center justify-between rounded-lg bg-white border px-3 py-2.5"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`flex items-center justify-center h-7 w-7 rounded-md text-white shrink-0 ${col.headerClass}`}
              >
                <col.Icon className="h-4 w-4" />
              </div>
              <span className="font-semibold text-sm text-gray-800 truncate">
                {col.label}
              </span>
            </div>
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600">
              {col.items.length}
            </span>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {totalActive === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
          <ChefHat className="h-16 w-16 text-gray-300 mb-4" />
          <p className="text-lg font-medium text-gray-400">
            Belum ada pesanan di dapur
          </p>
          <p className="text-sm text-gray-300 mt-1">
            Pesanan baru akan muncul di sini
          </p>
        </div>
      )}

      {/* Kanban columns */}
      {totalActive > 0 && (
        <div className="grid grid-cols-3 gap-3 flex-1 min-h-0">
          {grouped.map((col) => (
            <div
              key={col.key}
              className="flex flex-col min-h-0"
            >
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 kitchen-scroll">
                {col.items.length === 0 && (
                  <div className="flex items-center justify-center h-24 text-xs text-gray-400">
                    Kosong
                  </div>
                )}
                {col.items.map((order) => (
                  <KitchenTicket
                    key={order.id}
                    order={order}
                    action={col.getAction(order)}
                    accentClass={col.ticketAccent}
                    onActionDone={onActionDone}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
