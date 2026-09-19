"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X } from "lucide-react";
import {
  RESERVATION_STATUS_LABELS,
} from "./reservation-format";

export interface BranchOption {
  id: string;
  name: string;
}

interface ReservationFiltersProps {
  search: string;
  statusFilter: string;
  branchFilter: string;
  dateFilter: string;
  branches: BranchOption[];
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onStatusChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  onDateChange: (value: string) => void;
}

/**
 * Filter bar for the reservation board. Search is applied on submit/Enter
 * (like Orders/Customers); status/branch/date apply immediately. Branch
 * options are the session's AUTHORIZED branches only, and the selected value
 * is sent to the API as an explicit (server-validated) `branchId`.
 */
export function ReservationFilters({
  search,
  statusFilter,
  branchFilter,
  dateFilter,
  branches,
  onSearchChange,
  onSearchSubmit,
  onStatusChange,
  onBranchChange,
  onDateChange,
}: ReservationFiltersProps) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center">
      {/* Search */}
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Cari kode / nama / no. telepon..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearchSubmit()}
          className="pl-9 pr-8"
        />
        {search && (
          <button
            type="button"
            onClick={() => {
              onSearchChange("");
              onSearchSubmit();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Status */}
      <Select
        value={statusFilter}
        onValueChange={(v) => onStatusChange(v || "all")}
      >
        <SelectTrigger className="w-full md:w-[160px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Semua Status</SelectItem>
          {Object.entries(RESERVATION_STATUS_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Branch (authorized only) */}
      <Select
        value={branchFilter}
        onValueChange={(v) => onBranchChange(v || "all")}
      >
        <SelectTrigger className="w-full md:w-[180px]">
          <SelectValue placeholder="Cabang" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Semua Cabang</SelectItem>
          {branches.map((branch) => (
            <SelectItem key={branch.id} value={branch.id}>
              {branch.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Date (date-only, no timezone) */}
      <Input
        type="date"
        value={dateFilter}
        onChange={(e) => onDateChange(e.target.value)}
        className="w-full md:w-[170px] h-8"
      />
    </div>
  );
}