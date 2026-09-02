"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Clock, ChefHat, Package, CheckCircle } from "lucide-react";

interface OrderSummaryProps {
  pending: number;
  processing: number;
  ready: number;
  todayTotal: number;
}

export function OrderSummary({
  pending,
  processing,
  ready,
  todayTotal,
}: OrderSummaryProps) {
  const items = [
    {
      label: "Menunggu",
      value: pending,
      icon: Clock,
      color: "text-yellow-600",
      bg: "bg-yellow-50",
    },
    {
      label: "Diproses",
      value: processing,
      icon: ChefHat,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
    {
      label: "Siap",
      value: ready,
      icon: Package,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
    {
      label: "Hari Ini",
      value: todayTotal,
      icon: CheckCircle,
      color: "text-green-600",
      bg: "bg-green-50",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((item) => (
        <Card key={item.label} className="border shadow-sm">
          <CardContent className="p-3 flex items-center gap-3">
            <div className={`p-2 rounded-lg ${item.bg}`}>
              <item.icon className={`h-4 w-4 ${item.color}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-xl font-bold">{item.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
