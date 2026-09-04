import { auth } from "@/lib/auth";
import bcrypt from "bcryptjs";
import {
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from "@/lib/errors";

// ============================================================
// Session Types
// ============================================================

export interface AuthSession {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: string;
  };
}

export interface AuthenticatedContext {
  userId: string;
  restaurantId: string;
  role: string;
}

// ============================================================
// Auth Helpers
// ============================================================

/**
 * Get the current session. Throws UnauthorizedError if not authenticated.
 */
export async function requireAuth(): Promise<AuthSession> {
  const session = (await auth()) as AuthSession | null;

  if (!session?.user?.id) {
    throw new UnauthorizedError("Authentication required");
  }

  return session;
}

/**
 * Get the authenticated user's restaurant context.
 * Extracts restaurantId from the user's database record via JWT.
 */
export async function requireRestaurantContext(): Promise<AuthenticatedContext> {
  const session = await requireAuth();

  // Import prisma here to avoid edge runtime issues in middleware
  const { prisma } = await import("@/lib/prisma");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      restaurantId: true,
      role: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) {
    throw new UnauthorizedError("User not found or inactive");
  }

  return {
    userId: user.id,
    restaurantId: user.restaurantId,
    role: user.role,
  };
}

/**
 * Verify that the authenticated user has one of the given roles.
 * Roles are the DB enum names ("ADMIN" | "CASHIER").
 */
export async function requireRoles(
  roles: Array<"ADMIN" | "CASHIER">
): Promise<AuthenticatedContext> {
  const ctx = await requireRestaurantContext();

  if (!roles.includes(ctx.role as "ADMIN" | "CASHIER")) {
    throw new ForbiddenError("Access denied for your role");
  }

  return ctx;
}

/**
 * Verify that the authenticated user has the ADMIN role.
 */
export async function requireAdmin(): Promise<AuthenticatedContext> {
  return requireRoles(["ADMIN"]);
}

/**
 * Verify the plaintext `password` belongs to the authenticated ADMIN session.
 *
 * Used for sensitive financial actions (refund/cancel approval, shift
 * override, reopen/void) — an authenticated admin session alone is not
 * enough; the operator must re-confirm their password. Throws
 * ValidationError on an empty/missing password and ForbiddenError when the
 * password does not match.
 */
export async function verifyAdminPassword(
  sessionUserId: string,
  restaurantId: string,
  password?: string
): Promise<void> {
  if (!password) {
    throw new ValidationError("Password admin wajib diisi");
  }

  // Import prisma here to avoid edge runtime issues in middleware.
  const { prisma } = await import("@/lib/prisma");

  const admin = await prisma.user.findFirst({
    where: { id: sessionUserId, restaurantId, role: "ADMIN", isActive: true },
  });

  if (!admin) {
    throw new ForbiddenError("Session admin tidak ditemukan");
  }

  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) {
    throw new ForbiddenError("Password admin salah");
  }
}
