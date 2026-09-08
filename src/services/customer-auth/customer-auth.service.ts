import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  NotFoundError,
  ConflictError,
  UnauthorizedError,
} from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import type {
  CustomerRegisterInput,
  CustomerLoginInput,
} from "./customer-auth.types";

// ============================================================
// Customer auth (F3) — bcrypt + tenant-scoped Customer rows.
//
// Deliberately separate from the staff NextAuth session: the staff Role
// enum / middleware / requireRoles all assume ADMIN|CASHIER, and mixing
// customers into that pipeline risks breaking the existing admin flows.
// Guest customers (no email/password) are untouched.
// ============================================================

export interface CustomerPublic {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

function toPublic(c: {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}): CustomerPublic {
  return { id: c.id, name: c.name, email: c.email, phone: c.phone };
}

export class CustomerAuthService {
  /**
   * Register a customer login for a restaurant. If a guest customer row
   * already exists with the same phone and has no login yet, it is upgraded
   * in place (existing order history stays linked).
   */
  async register(input: CustomerRegisterInput): Promise<CustomerPublic> {
    const restaurant = await prisma.restaurant.findFirst({
      where: { id: input.restaurantId, isActive: true },
      select: { id: true },
    });
    if (!restaurant) {
      throw new NotFoundError("Restaurant tidak ditemukan");
    }

    const normalizedPhone = input.phone
      ? normalizePhone(input.phone)
      : undefined;

    const hashedPassword = await bcrypt.hash(input.password, 12);

    // Existing guest with the same phone → upgrade it (keeps order history).
    if (normalizedPhone) {
      const guest = await prisma.customer.findFirst({
        where: { restaurantId: input.restaurantId, phone: normalizedPhone },
      });
      if (guest && !guest.email) {
        // Email must still be free for this restaurant.
        const emailTaken = await prisma.customer.findFirst({
          where: { restaurantId: input.restaurantId, email: input.email },
        });
        if (emailTaken) {
          throw new ConflictError("Email sudah terdaftar");
        }
        const updated = await prisma.customer.update({
          where: { id: guest.id },
          data: {
            email: input.email,
            password: hashedPassword,
            name: input.name || guest.name,
            isActive: true,
          },
        });
        return toPublic(updated);
      }
    }

    try {
      const customer = await prisma.customer.create({
        data: {
          restaurantId: input.restaurantId,
          name: input.name,
          phone: normalizedPhone || null,
          email: input.email,
          password: hashedPassword,
          isActive: true,
        },
      });
      return toPublic(customer);
    } catch (error) {
      // Unique constraint on (restaurantId, email).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError("Email sudah terdaftar");
      }
      throw error;
    }
  }

  /** Verify credentials and return the customer (throws otherwise). */
  async login(input: CustomerLoginInput): Promise<CustomerPublic> {
    const customer = await prisma.customer.findFirst({
      where: {
        restaurantId: input.restaurantId,
        email: input.email,
      },
    });

    if (!customer || !customer.password || !customer.isActive) {
      throw new UnauthorizedError("Email atau password salah");
    }

    const valid = await bcrypt.compare(input.password, customer.password);
    if (!valid) {
      throw new UnauthorizedError("Email atau password salah");
    }

    return toPublic(customer);
  }

  /** Fetch a customer by id (tenant-scoped) — for the /me endpoint. */
  async me(customerId: string, restaurantId: string): Promise<CustomerPublic> {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, restaurantId, isActive: true },
    });
    if (!customer) {
      throw new UnauthorizedError("Sesi customer tidak valid");
    }
    return toPublic(customer);
  }
}

export const customerAuthService = new CustomerAuthService();