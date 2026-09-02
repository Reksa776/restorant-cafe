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

interface OrderFiltersProps {
  search: string;
  statusFilter: string;
  typeFilter: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onStatusChange: (value: string) => void;
  onTypeChange: (value: string) => void;
}

export function OrderFilters({
  search,
  statusFilter,
  typeFilter,
  onSearchChange,
  onSearchSubmit,
  onStatusChange,
  onTypeChange,
}: OrderFiltersProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {/* Search */}
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Cari nomor pesanan / nama / WhatsApp..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearchSubmit()}
          className="pl-9 pr-8"
        />
        {search && (
          <button
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

      {/* Status Filter */}
      <Select value={statusFilter} onValueChange={(v) => onStatusChange(v || "all")}>
        <SelectTrigger className="w-full sm:w-[160px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Semua Status</SelectItem>
          <SelectItem value="PENDING">Menunggu</SelectItem>
          <SelectItem value="CONFIRMED">Dikonfirmasi</SelectItem>
          <SelectItem value="PROCESSING">Diproses</SelectItem>
          <SelectItem value="READY">Siap</SelectItem>
          <SelectItem value="COMPLETED">Selesai</SelectItem>
          <SelectItem value="CANCELLED">Dibatalkan</SelectItem>
        </SelectContent>
      </Select>

      {/* Order Type Filter */}
      <Select value={typeFilter} onValueChange={(v) => onTypeChange(v || "all")}>
        <SelectTrigger className="w-full sm:w-[150px]">
          <SelectValue placeholder="Tipe" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Semua Tipe</SelectItem>
          <SelectItem value="DINE_IN">🍽️ Dine In</SelectItem>
          <SelectItem value="TAKEAWAY">🥡 Takeaway</SelectItem>
          <SelectItem value="DELIVERY">🚚 Delivery</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
