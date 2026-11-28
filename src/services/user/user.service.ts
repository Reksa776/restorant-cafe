import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { emitRealtime } from "@/lib/realtime/bus";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { auditService } from "@/services/audit/audit.service";
import type { Role } from "@prisma/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class UserService {
  /**
   * Admin: list staff users of the restaurant (passwords never leave the
   * server — only a hasPassword flag is returned).
   */
  async listUsers(restaurantId: string) {
    const users = await prisma.user.findMany({
      where: { restaurantId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return { items: users };
  }

  /**
   * Admin: create a staff user (Co-Admin ADMIN, CASHIER or KITCHEN) and
   * optionally assign the new account to one branch (branchId).
   */
  async createUser(input: {
    restaurantId: string;
    adminId: string;
    name: string;
    email: string;
    password: string;
    role: "ADMIN" | "CASHIER" | "KITCHEN";
    /** Optional branch assignment; null/absent = access to all branches. */
    branchId?: string | null;
  }) {
    const name = input.name?.trim();
    const email = (input.email || "").trim().toLowerCase();
    if (!name || name.length < 2) {
      throw new ValidationError("Nama minimal 2 karakter");
    }
    if (!EMAIL_RE.test(email)) {
      throw new ValidationError("Email tidak valid");
    }
    if (!input.password || input.password.length < 6) {
      throw new ValidationError("Password minimal 6 karakter");
    }
    if (
      input.role !== "ADMIN" &&
      input.role !== "CASHIER" &&
      input.role !== "KITCHEN"
    ) {
      throw new ValidationError("Role harus ADMIN, CASHIER, atau KITCHEN");
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictError("Email sudah terdaftar");
    }

    // The branch must belong to THIS tenant — a client-supplied id can never
    // attach a staff account to another restaurant's branch.
    const branchId = input.branchId?.trim() || null;
    if (branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: branchId, restaurantId: input.restaurantId },
        select: { id: true },
      });
      if (!branch) {
        throw new ValidationError("Cabang tidak ditemukan");
      }
    }

    const password = await bcrypt.hash(input.password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          restaurantId: input.restaurantId,
          name,
          email,
          password,
          role: input.role as Role,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      if (branchId) {
        await tx.userBranch.create({
          data: { userId: created.id, branchId },
        });
      }

      return created;
    });

    emitRealtime(input.restaurantId, REALTIME_EVENT_TYPES.USER_CREATED, user.id, {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });

    await auditService.log({
      restaurantId: input.restaurantId,
      userId: input.adminId,
      action: "USER_CREATED",
      entityType: "User",
      entityId: user.id,
      details: {
        email: user.email,
        role: user.role,
        name: user.name,
        branchId,
      },
    });

    return user;
  }

  /**
   * Toggle a staff member active/inactive (admin). Never self-deactivate.
   */
  async setUserActive(input: {
    restaurantId: string;
    adminId: string;
    userId: string;
    isActive: boolean;
  }) {
    if (input.userId === input.adminId && !input.isActive) {
      throw new ValidationError("Tidak dapat menonaktifkan akun sendiri");
    }
    const user = await prisma.user.findFirst({
      where: { id: input.userId, restaurantId: input.restaurantId },
    });
    if (!user) {
      throw new NotFoundError("User tidak ditemukan");
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        isActive: input.isActive,
        // Invalidate every existing session for this user (M3): JWTs carry
        // the pre-bump sessionVersion and are rejected on the next request.
        sessionVersion: { increment: 1 },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    await auditService.log({
      restaurantId: input.restaurantId,
      userId: input.adminId,
      action: input.isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      entityType: "User",
      entityId: user.id,
      details: { email: user.email, role: user.role },
    });

    return updated;
  }

  /**
   * Current user changes their own password (requires the current password).
   */
  async changeOwnPassword(input: {
    restaurantId: string;
    userId: string;
    currentPassword: string;
    newPassword: string;
  }) {
    if (!input.currentPassword || !input.newPassword) {
      throw new ValidationError("Password wajib diisi");
    }
    if (input.newPassword.length < 6) {
      throw new ValidationError("Password baru minimal 6 karakter");
    }
    const user = await prisma.user.findFirst({
      where: { id: input.userId, restaurantId: input.restaurantId },
    });
    if (!user) {
      throw new NotFoundError("User tidak ditemukan");
    }
    const valid = await bcrypt.compare(input.currentPassword, user.password);
    if (!valid) {
      throw new ValidationError("Password saat ini salah");
    }
    const password = await bcrypt.hash(input.newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password,
        // Invalidate every existing session (M3) — including the current
        // one: the client is signed out cleanly after a successful change.
        sessionVersion: { increment: 1 },
      },
    });

    await auditService.log({
      restaurantId: input.restaurantId,
      userId: input.userId,
      action: "PASSWORD_CHANGED",
      entityType: "User",
      entityId: user.id,
    });

    return { success: true };
  }
}

export const userService = new UserService();
