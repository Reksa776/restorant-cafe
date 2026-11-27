import { requireAuth } from "@/lib/auth-helpers";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

// ============================================================
// SUPER ADMIN (SaaS owner) GUARD
//
// The platform owner is NOT a restaurant role: the same `User` row still
// belongs to one restaurant, but a small allow-list of emails
// (SUPERADMIN_EMAILS, comma separated) may operate cross-tenant payout
// actions. The list is server-only and read on every request — it is never
// sent to the browser as configuration (only a boolean flag is exposed for
// navigation, see /api/auth/session).
//
// SECURITY NOTES
// - The email is taken from the AUTHENTICATED session/DB row, never from a
//   header or body, so a client cannot claim to be the SaaS owner.
// - Matching is case-insensitive and trims whitespace around entries.
// - An empty/unset list fails CLOSED: nobody is a super admin.
// ============================================================

export interface SuperAdminContext {
  userId: string;
  restaurantId: string;
  email: string;
}

/** Parsed allow-list of super admin emails (lower-case, no blanks). */
export function getSuperAdminEmails(): string[] {
  return (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return getSuperAdminEmails().includes(email.trim().toLowerCase());
}

/**
 * Resolve the authenticated user and require their email to be on the
 * SUPERADMIN_EMAILS allow-list. Throws UnauthorizedError (401) when there is
 * no session and ForbiddenError (403) when the email is not allowed.
 */
export async function requireSuperAdmin(): Promise<SuperAdminContext> {
  const session = await requireAuth();
  if (!session.user.email) {
    throw new UnauthorizedError("Sesi tidak memiliki email");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      restaurantId: true,
      isActive: true,
      sessionVersion: true,
    },
  });

  if (
    !user ||
    !user.isActive ||
    user.sessionVersion !== session.user.sessionVersion
  ) {
    throw new UnauthorizedError("Sesi sudah berakhir, silakan masuk kembali");
  }

  if (!isSuperAdminEmail(user.email)) {
    throw new ForbiddenError(
      "Akun Anda tidak terdaftar sebagai Super Admin SaaS"
    );
  }

  return {
    userId: user.id,
    restaurantId: user.restaurantId,
    email: user.email,
  };
}
