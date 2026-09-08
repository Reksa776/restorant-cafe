import { z } from "zod/v4";

// ============================================================
// Customer auth (F3) — separate from the staff NextAuth session.
// ============================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CustomerRegisterSchema = z.object({
  restaurantId: z.string().min(1, "restaurantId wajib diisi"),
  name: z.string().min(1, "Nama wajib diisi").max(100),
  phone: z.string().optional().nullable(),
  email: z
    .string()
    .min(1, "Email wajib diisi")
    .max(191)
    .regex(EMAIL_RE, "Format email tidak valid")
    .toLowerCase(),
  password: z
    .string()
    .min(6, "Password minimal 6 karakter")
    .max(100),
});

export const CustomerLoginSchema = z.object({
  restaurantId: z.string().min(1, "restaurantId wajib diisi"),
  email: z
    .string()
    .min(1, "Email wajib diisi")
    .max(191)
    .regex(EMAIL_RE, "Format email tidak valid")
    .toLowerCase(),
  password: z.string().min(1, "Password wajib diisi").max(100),
});

export type CustomerRegisterInput = z.infer<typeof CustomerRegisterSchema>;
export type CustomerLoginInput = z.infer<typeof CustomerLoginSchema>;