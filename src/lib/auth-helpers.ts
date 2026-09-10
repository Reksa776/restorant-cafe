import { auth } from "@/lib/auth";
import bcrypt from "bcryptjs";
import {
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ShiftNotOpenError,
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
    /** Session version embedded in the JWT — checked against the DB row. */
    sessionVersion?: number;
  };
}

export interface AuthenticatedContext {
  userId: string;
  restaurantId: string;
  role: string;
  /**
   * Branch IDs the user is explicitly assigned to (via UserBranch).
   *
   * Empty array means "all branches of the restaurant" — this is the
   * backward-compatible default: users created before multi-branch (or
   * new users that were not yet assigned) must not be locked out. After a
   * user is assigned, only those branches are allowed.
   */
  branchIds: string[];
  /**
   * True when the user has explicit branch assignments (user.scopedBranches).
   * When false, the user may access every branch of the restaurant.
   */
  branchScoped: boolean;
  /**
   * The branch context for the current request, if provided/validated.
   * null = no branch filter (see "all branches" rules).
   */
  branchId: string | null;
}

// ============================================================
// Auth Helpers
// ============================================================

/**
 * Read the client-supplied branch hint from the request. This is ONLY a
 * UX hint — it is never used as an authorization boundary; the server
 * validates it against the user's UserBranch assignments in
 * requireRestaurantContext.
 */
export function branchHintFrom(
  request: Readonly<{ headers: { get(name: string): string | null } }>
): string | null {
  return request.headers.get("x-branch-id");
}

/** Get the current session. Throws UnauthorizedError if not authenticated. */
export async function requireAuth(): Promise<AuthSession> {
  const session = (await auth()) as AuthSession | null;

  if (!session?.user?.id) {
    throw new UnauthorizedError("Authentication required");
  }

  return session;
}

/**
 * Get the authenticated user's restaurant + branch context.
 * Extracts restaurantId from the user's database record via JWT and
 * resolves the user's branch assignments (UserBranch) server-side.
 */
export async function requireRestaurantContext(
  requestedBranchId?: string | null
): Promise<AuthenticatedContext> {
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
      sessionVersion: true,
    },
  });

  if (!user || !user.isActive) {
    throw new UnauthorizedError("User not found or inactive");
  }

  // Session revocation (M3): a password change or account deactivation bumps
  // sessionVersion; the JWT carries the version from sign-in time, so any
  // older token is rejected here. (Middleware cannot check the DB, but every
  // API call goes through this guard and the axios interceptor turns the 401
  // into a clean single sign-out — no redirect loop.)
  if (user.sessionVersion !== session.user.sessionVersion) {
    throw new UnauthorizedError("Session expired — please sign in again");
  }

  // Resolve the user's explicit branch assignments.
  const assignments = await prisma.userBranch.findMany({
    where: { userId: user.id },
    select: { branchId: true },
  });
  const branchIds = assignments.map((a) => a.branchId);

  // Validate the requested branch (if given) against the assignments.
  let branchId: string | null = null;
  if (requestedBranchId) {
    if (branchIds.length > 0 && !branchIds.includes(requestedBranchId)) {
      throw new ForbiddenError("Anda tidak memiliki akses ke cabang ini");
    }
    // Confirm the branch actually belongs to the user's restaurant.
    const branch = await prisma.branch.findFirst({
      where: { id: requestedBranchId, restaurantId: user.restaurantId },
      select: { id: true },
    });
    if (!branch) {
      throw new ForbiddenError("Cabang tidak ditemukan");
    }
    branchId = branch.id;
  }

  return {
    userId: user.id,
    restaurantId: user.restaurantId,
    role: user.role,
    branchIds,
    branchScoped: branchIds.length > 0,
    branchId,
  };
}

/**
 * Verify that the authenticated user has one of the given roles.
 * Roles are the DB enum names ("ADMIN" | "CASHIER").
 *
 * `branchId` (optional) is a server-validated branch hint. When provided,
 * the user must have access to that branch, otherwise a 403 is thrown.
 */
export async function requireRoles(
  roles: Array<"ADMIN" | "CASHIER">,
  requestedBranchId?: string | null
): Promise<AuthenticatedContext> {
  const ctx = await requireRestaurantContext(requestedBranchId);

  if (!roles.includes(ctx.role as "ADMIN" | "CASHIER")) {
    throw new ForbiddenError("Access denied for your role");
  }

  return ctx;
}

/**
 * Verify that the authenticated user has the ADMIN role.
 */
export async function requireAdmin(
  requestedBranchId?: string | null
): Promise<AuthenticatedContext> {
  return requireRoles(["ADMIN"], requestedBranchId);
}

/**
 * The branch scope an authenticated user may READ / mutate EXISTING data in.
 *
 * - Branch-scoped with a validated `x-branch-id` header → that ONE branch.
 * - Branch-scoped with NO header → the user's full assigned branch list
 *   (never "all branches" — a headerless request must not widen a scoped
 *   user to the whole restaurant).
 * - Not branch-scoped → undefined (every branch of the restaurant,
 *   backward-compatible default for unassigned users).
 *
 * Callers pass this array to the service as a `branchFilters` param, applied
 * as `branchId: { in: [...] }` so a scoped user can never read or touch data
 * outside their assignments.
 */
export function authorizedBranches(
  ctx: AuthenticatedContext
): string[] | undefined {
  if (!ctx.branchScoped) return undefined;
  if (ctx.branchId) return [ctx.branchId];
  return ctx.branchIds.length > 0 ? ctx.branchIds : undefined;
}

/**
 * The concrete branch a NEW resource (order/table/shift/promo) is written to.
 *
 * A branch-scoped user MUST have an active branch context to create a
 * branch-bound resource: with a header the header branch wins; with a single
 * assignment the single branch is the default (keeps first-visit flows
 * working); with multiple assignments and no header the request is rejected
 * so a scoped user can never silently create/assign into a wrong branch.
 * Non-scoped users may pass an explicit branch (validated by the caller) or
 * `null` (legacy branch-less resource).
 */
export function effectiveWriteBranchId(
  ctx: AuthenticatedContext,
  explicit?: string | null
): string | null {
  if (ctx.branchScoped) {
    if (ctx.branchId) return ctx.branchId;
    if (ctx.branchIds.length === 1) return ctx.branchIds[0];
    throw new ForbiddenError("Pilih cabang terlebih dahulu");
  }
  // Non-scoped: the validated header branch wins (it already passed
  // requireRestaurantContext); otherwise an explicit branch validated by the
  // caller; else null (legacy branch-less resource).
  return ctx.branchId ?? explicit ?? null;
}

/**
 * Validate that a caller-supplied branch id is usable by this user: it must
 * belong to the user's restaurant AND, when the user is branch-scoped, be one
 * of their assigned branches. Throws ForbiddenError otherwise.
 *
 * Used for query-param / body branch hints on non-scoped (all-branch) flows so
 * an explicit branch can never cross the restaurant boundary.
 */
export async function assertBranchInScope(
  ctx: AuthenticatedContext,
  branchId: string
): Promise<void> {
  if (ctx.branchScoped && !ctx.branchIds.includes(branchId)) {
    throw new ForbiddenError("Anda tidak memiliki akses ke cabang ini");
  }
  const { prisma } = await import("@/lib/prisma");
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, restaurantId: ctx.restaurantId },
    select: { id: true },
  });
  if (!branch) {
    throw new ForbiddenError("Cabang tidak ditemukan");
  }
}

/**
 * Primitive shift guard for a user + branch (no AuthenticatedContext needed).
 *
 * Throws ShiftNotOpenError when the user has no OPEN shift for the branch.
 * Scoped by restaurantId + userId + branch (when given) — server-authoritative,
 * never trusting the client. Reuses the existing shift service lookup so this
 * is the ONE place a "shift must be open" decision is made.
 */
export async function requireOpenShiftForUser(
  restaurantId: string,
  userId: string,
  branchId?: string | null
): Promise<void> {
  const { shiftService } = await import("@/services/shift/shift.service");
  const openShift = await shiftService.getMyOpenShift(
    restaurantId,
    userId,
    branchId ? [branchId] : undefined
  );
  if (!openShift) {
    throw new ShiftNotOpenError();
  }
}

/**
 * Central shift guard for kasir transactions.
 *
 * - ADMIN never requires a shift (existing business rule: admins keep the
 *   unlinked quick-mark behaviour — see paymentService.markCashierPaymentPaid).
 * - CASHIER must have an OPEN shift for the branch the transaction targets.
 * - The target branch is resolved SERVER-SIDE via effectiveWriteBranchId
 *   (header branch / single assignment), never from an unvalidated client id.
 *
 * Call this at the TOP of every backend route that runs a kasir
 * order/transaction (create order, create payment, mark paid). Throwing
 * ShiftNotOpenError lets the route mapper emit `code: SHIFT_NOT_OPEN` so the
 * frontend can translate it into a "Shift belum dibuka" notification.
 */
export async function requireOpenShift(
  ctx: AuthenticatedContext,
  branchId?: string | null
): Promise<void> {
  if (ctx.role === "ADMIN") return;
  await requireOpenShiftForUser(
    ctx.restaurantId,
    ctx.userId,
    branchId ?? effectiveWriteBranchId(ctx)
  );
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