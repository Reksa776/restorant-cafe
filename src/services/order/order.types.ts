import { z } from "zod/v4";

// ============================================================
// Validation Schemas
// ============================================================

export const CreateOrderSchema = z.object({
  customerId: z.string().min(1),
  tableId: z.string().optional(),
  orderType: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]).default("DINE_IN"),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
  notes: z.string().optional(),
});

/**
 * Public customer order creation schema.
 * Does NOT require customerId — server creates/finds customer.
 */
export const CreateCustomerOrderSchema = z.object({
  customerName: z.string().min(1, "Nama harus diisi"),
  customerPhone: z.string().optional().nullable(),
  orderType: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]).default("DINE_IN"),
  tableId: z.string().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1, "Minimal 1 item harus dipilih"),
});

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "PROCESSING", "READY", "COMPLETED", "CANCELLED"]),
  notes: z.string().optional(),
});

export const GetOrdersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum(["PENDING", "CONFIRMED", "PROCESSING", "READY", "COMPLETED", "CANCELLED"])
    .optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// ============================================================
// Types
// ============================================================

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type CreateCustomerOrderInput = z.infer<typeof CreateCustomerOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusSchema>;
export type GetOrdersInput = z.infer<typeof GetOrdersSchema>;

export interface OrderItemData {
  productId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface OrderWithRelations {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  orderType: string;
  subtotal: string;
  discount: string;
  tax: string;
  serviceCharge: string;
  grandTotal: string;
  notes?: string | null;
  notifiedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  customer: {
    id: string;
    name: string | null;
    phone: string | null;
  };
  table?: {
    id: string;
    number: number;
    name: string;
  } | null;
  items: Array<{
    id: string;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
    product: {
      name: string;
    };
  }>;
}
