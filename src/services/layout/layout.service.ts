import { Prisma } from "@prisma/client";
import type { TableShape } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  LAYOUT_CANVAS_HEIGHT,
  LAYOUT_CANVAS_WIDTH,
  SaveBranchLayoutSchema,
  normalizeLayoutRotation,
} from "./layout.types";

// ============================================================
// FLOOR LAYOUT SERVICE — single source of truth for a branch floor plan.
//
// PERSISTED STATE
//   - `TableLayout` (one per branch, versioned) + `TableLayoutItem` rows for
//     ONLY the tables the staff have EXPLICITLY placed on the canvas.
//   - Table metadata (number/name/capacity/status) is NEVER duplicated here;
//     it always comes from the `table` row (this schema block is purely
//     additive and changes no business rule).
//   - A layout row is created lazily on the first successful save; a branch
//     that was never edited has NO row and reads back as version 1 + empty
//     items (never 404). Tables not yet placed are offered by the UI through
//     the existing /tables endpoint — this service never fabricates items.
//
// CONVENTIONS (inherited from R2 reservation.service):
//   - transport error classes from `@/lib/errors` (AppError family).
//   - NO auth helpers here: the caller (route) derives restaurantId + branchId
//     SERVER-SIDE via requireRoles/requireRestaurantContext and passes them
//     in; branch authorization is enforced here through the optional
//     `branchFilters` argument (authorizedBranches in @/lib/auth-helpers).
//   - interactive Prisma transactions + branch row `FOR UPDATE` lock (same
//     pattern as createReservation) so saves of one branch serialize on the
//     version compare-and-increment.
//
// VERSION CONVENTION (internally consistent, never duplicating the DB truth):
//   - `version` describes the layout AS OF ITS LAST SAVE.
//   - an empty layout (no row) reads as version 1.
//   - a save must send `version` == the current stored version (1 when no
//     row); a mismatch throws ConflictError (409). Omitting `version` skips
//     the check but the response always carries the next version.
//   - every successful save stores AND returns `version + 1`.
//     GET v1 → PUT(v1) → 2 → PUT(v2) → 3 → ...
// ============================================================

/** Geometry-only item shape returned by the transaction (no internal ids). */
interface LayoutItemValue {
  tableId: string;
  shape: TableShape;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

function canvas(): { width: number; height: number } {
  return { width: LAYOUT_CANVAS_WIDTH, height: LAYOUT_CANVAS_HEIGHT };
}

export class LayoutService {
  // ============================================================
  // View enrichment — joins geometry with the live `table` metadata.
  // @prisma include can't reach the new scalars, so like R2's
  // reservationViews we do one batched lookup per restaurant.
  // ============================================================

  private async resolveLayoutView(
    branchId: string,
    version: number,
    items: LayoutItemValue[],
    restaurantId: string
  ) {
    const tableIds = items.map((item) => item.tableId);
    const tables = tableIds.length
      ? await prisma.table.findMany({
          where: { id: { in: tableIds }, restaurantId },
          select: { id: true, number: true, name: true, capacity: true },
        })
      : [];
    const tableMap = new Map(tables.map((t) => [t.id, t]));

    const viewItems = items
      .map((item) => {
        const table = tableMap.get(item.tableId);
        // A placed item whose table row is gone is a stale pointer (the FK
        // cascade should have removed it) — skip it defensively instead of
        // failing the whole read.
        if (!table) return null;
        return {
          tableId: item.tableId,
          number: table.number,
          name: table.name,
          capacity: table.capacity,
          shape: item.shape,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          rotation: item.rotation,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.number - b.number);

    return { branchId, version, canvas: canvas(), items: viewItems };
  }

  private assertBranchInScope(
    branchFilters: string[] | null | undefined,
    branchId: string
  ): void {
    if (branchFilters?.length && !branchFilters.includes(branchId)) {
      throw new ForbiddenError("Anda tidak memiliki akses ke cabang ini");
    }
  }

  // ============================================================
  // Read — branch floor plan
  // ============================================================

  /**
   * Get the floor plan for one branch. `restaurantId` is server-derived
   * (requireRoles/requireRestaurantContext); `branchFilters` is
   * `authorizedBranches(ctx)` so a branch-scoped caller can never read
   * another branch's layout. A never-edited branch returns version 1 with an
   * empty item list (NOT a 404).
   */
  async getBranchLayout(
    restaurantId: string,
    branchId: string,
    branchFilters?: string[] | null
  ) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, restaurantId },
      select: { id: true },
    });
    if (!branch) {
      throw new NotFoundError("Cabang tidak ditemukan");
    }
    this.assertBranchInScope(branchFilters, branchId);

    const layout = await prisma.tableLayout.findFirst({
      where: { restaurantId, branchId },
      include: { items: true },
    });
    if (!layout) {
      return { branchId, version: 1, canvas: canvas(), items: [] };
    }
    return this.resolveLayoutView(
      layout.branchId,
      layout.version,
      layout.items,
      restaurantId
    );
  }

  // ============================================================
  // Write — replace the branch floor plan (full-state PUT)
  // ============================================================

  /**
   * Persist the branch floor plan.
   *
   * The whole save runs in ONE transaction: branch ownership + activity are
   * re-validated under a `FOR UPDATE` branch lock (serializes concurrent
   * saves so the version check is race-safe), every submitted tableId is
   * re-checked (exists in this restaurant + branch, active), then the
   * existing items are replaced and the version incremented. ANY failure
   * rolls the entire save back — no partial layouts, no version bump.
   *
   * `restaurantId` and the caller's branch scope (`branchFilters`) are never
   * read from the client-supplied input.
   */
  async saveBranchLayout(
    restaurantId: string,
    branchId: string,
    raw: unknown,
    branchFilters?: string[] | null
  ) {
    const parsed = SaveBranchLayoutSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const data = parsed.data;
    this.assertBranchInScope(branchFilters, branchId);

    const view = await prisma.$transaction(async (tx) => {
      // Branch row lock — serializes every save of this branch so the version
      // compare-and-increment below is race-safe (mirrors createReservation).
      const branchRows = await tx.$queryRaw<
        Array<{ id: string; restaurantId: string; isActive: boolean }>
      >(
        Prisma.sql`
          SELECT \`id\`, \`restaurantId\`, \`isActive\`
          FROM \`branch\`
          WHERE \`id\` = ${branchId}
          FOR UPDATE
        `
      );
      const branch = branchRows[0];
      if (!branch || branch.restaurantId !== restaurantId) {
        throw new NotFoundError("Cabang tidak ditemukan");
      }
      if (!branch.isActive) {
        throw new ValidationError("Cabang tidak aktif");
      }

      const layout = await tx.tableLayout.findUnique({
        where: { branchId },
        include: { items: true },
      });
      const currentVersion = layout ? layout.version : 1;
      if (data.version !== undefined && data.version !== currentVersion) {
        throw new ConflictError(
          "Layout telah diubah oleh pengguna lain. Muat ulang sebelum menyimpan."
        );
      }

      // Every submitted tableId must belong to THIS restaurant + branch and
      // be active (legacy NULL-branch tables and foreign tables are refused).
      const submitted = data.items;
      if (submitted.length) {
        const tables = await tx.table.findMany({
          where: { id: { in: submitted.map((item) => item.tableId) }, restaurantId },
          select: { id: true, branchId: true, isActive: true },
        });
        const tableMap = new Map(tables.map((t) => [t.id, t]));
        for (const item of submitted) {
          const table = tableMap.get(item.tableId);
          if (!table) {
            throw new NotFoundError("Meja tidak ditemukan");
          }
          if (table.branchId !== branchId) {
            throw new ForbiddenError("Meja tidak berada di cabang ini");
          }
          if (!table.isActive) {
            throw new ValidationError("Meja tidak aktif");
          }
        }
      }

      const nextVersion = currentVersion + 1;
      const items: LayoutItemValue[] = submitted.map((item) => ({
        tableId: item.tableId,
        shape: item.shape,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: normalizeLayoutRotation(item.rotation),
      }));

      if (layout) {
        await tx.tableLayoutItem.deleteMany({ where: { layoutId: layout.id } });
        if (items.length) {
          await tx.tableLayoutItem.createMany({
            data: items.map((item) => ({ layoutId: layout.id, ...item })),
          });
        }
        await tx.tableLayout.update({
          where: { id: layout.id },
          data: { version: nextVersion },
        });
      } else {
        const created = await tx.tableLayout.create({
          data: { restaurantId, branchId, version: nextVersion },
        });
        if (items.length) {
          await tx.tableLayoutItem.createMany({
            data: items.map((item) => ({ layoutId: created.id, ...item })),
          });
        }
      }

      // The values just persisted are returned directly (createMany returns
      // no rows, so re-reading would be a wasted query).
      return { branchId, version: nextVersion, items };
    });

    return this.resolveLayoutView(
      view.branchId,
      view.version,
      view.items,
      restaurantId
    );
  }
}

export const layoutService = new LayoutService();