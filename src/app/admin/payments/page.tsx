"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { paymentService, type Payment } from "@/services/payment.service";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

const statusColors: Record<string, string> = {
  UNPAID: "bg-gray-100 text-gray-800",
  PENDING: "bg-yellow-100 text-yellow-800",
  PAID: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  EXPIRED: "bg-orange-100 text-orange-800",
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    loadPayments();
  }, [statusFilter]);

  const loadPayments = async () => {
    setIsLoading(true);
    try {
      const result = await paymentService.getPayments({
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setPayments(result.items);
    } catch (error) {
      console.error("Failed to load payments:", error);
      toast.error("Gagal memuat data pembayaran");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Pembayaran</h1>
        <p className="text-gray-500">Kelola pembayaran restoran</p>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value || "all")}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="UNPAID">Belum Bayar</SelectItem>
                <SelectItem value="PENDING">Menunggu</SelectItem>
                <SelectItem value="PAID">Lunas</SelectItem>
                <SelectItem value="FAILED">Gagal</SelectItem>
                <SelectItem value="EXPIRED">Kedaluwarsa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Payments List */}
      <Card>
        <CardHeader>
          <CardTitle>Daftar Pembayaran</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center text-gray-500 py-8">Loading...</p>
          ) : payments.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              Tidak ada pembayaran ditemukan
            </p>
          ) : (
            <div className="space-y-4">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between border-b pb-4 last:border-0"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
                        {payment.order.orderNumber}
                      </p>
                      <Badge className={statusColors[payment.status]}>
                        {payment.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-500">
                      {payment.method || "N/A"} • {payment.provider || "N/A"}
                    </p>
                    <p className="text-sm text-gray-400">
                      {new Date(payment.createdAt).toLocaleString("id-ID")}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="font-medium">
                      Rp{Number(payment.amount).toLocaleString("id-ID")}
                    </p>
                    {payment.paymentUrl &&
                      payment.status !== "PAID" &&
                      payment.status !== "FAILED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            window.open(payment.paymentUrl, "_blank")
                          }
                        >
                          <ExternalLink className="h-4 w-4 mr-1" />
                          Bayar
                        </Button>
                      )}
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
