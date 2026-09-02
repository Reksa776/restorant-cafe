import { auth } from "@/lib/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";

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
 * Verify that the authenticated user has the ADMIN role.
 */
export async function requireAdmin(): Promise<AuthenticatedContext> {
  const ctx = await requireRestaurantContext();

  if (ctx.role !== "ADMIN") {
    throw new ForbiddenError("Admin access required");
  }

  return ctx;
}
