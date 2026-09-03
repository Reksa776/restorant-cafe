"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  customerService,
  type Customer,
} from "@/services/customer.service";
import { Search, Users, ShoppingCart, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadCustomers = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const result = await customerService.getCustomers({
        search: search || undefined,
      });
      setCustomers(result.items);
    } catch (error) {
      console.error("Failed to load customers:", error);
      toast.error("Gagal memuat data pelanggan");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  // Realtime: a new customer (e.g. from a QR-table order) appears without
  // refresh. Active search text is preserved (state in the closure).
  useRealtimeListener(
    [
      REALTIME_EVENT_TYPES.CUSTOMER_CREATED,
      REALTIME_EVENT_TYPES.CUSTOMER_UPDATED,
      REALTIME_EVENT_TYPES.OFFLINE_POLL,
    ],
    () => {
      if (!isLoading) loadCustomers(true);
    }
  );

  const handleSearch = () => {
    loadCustomers();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Pelanggan</h1>
        <p className="text-gray-500">Kelola data pelanggan</p>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari nama atau nomor telepon..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-10"
              />
            </div>
            <Button onClick={handleSearch} className="w-full sm:w-auto">
              Cari
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Customers List */}
      <Card>
        <CardHeader>
          <CardTitle>Daftar Pelanggan</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center text-gray-500 py-8">Loading...</p>
          ) : customers.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              Tidak ada pelanggan ditemukan
            </p>
          ) : (
            <div className="space-y-4">
              {customers.map((customer) => (
                <div
                  key={customer.id}
                  className="flex flex-col gap-3 border-b pb-4 last:border-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                      <Users className="h-5 w-5 text-gray-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {customer.name || "Tanpa Nama"}
                      </p>
                      <p className="text-sm text-gray-500">{customer.phone}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm sm:gap-8">
                    <div>
                      <div className="flex items-center gap-1 text-gray-500 whitespace-nowrap">
                        <ShoppingCart className="h-4 w-4" />
                        <span>{customer.orderCount || 0} pesanan</span>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 text-gray-500 whitespace-nowrap">
                        <DollarSign className="h-4 w-4" />
                        <span>
                          Rp
                          {Number(customer.totalSpent || 0).toLocaleString(
                            "id-ID"
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="text-gray-500">
                      {customer.lastOrderAt
                        ? new Date(customer.lastOrderAt).toLocaleDateString(
                            "id-ID"
                          )
                        : "Belum pernah order"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
