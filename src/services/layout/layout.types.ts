import { z } from "zod/v4";
import type { TableShape } from "@prisma/client";

// ============================================================
// FLOOR LAYOUT — validation schemas (Zod v4).
//
// Conventions follow the R1 reservation types (order.types.ts):
//   - plain Zod objects; `z.enum` derives from the Prisma `TableShape` enum
//     via `satisfies`, so the two can never drift silently.
//   - geometry is VIRTUAL-CANVAS pixels on the fixed 900×600 grid; `x`/`y`
//     is the table's top-left corner and `width`/`height` its axis-aligned
//     (pre-rotation) footprint.
//   - `rotation` is in DEGREES, any finite value; the service normalizes it
//     to [0, 360) before persisting (see normalizeLayoutRotation).
//   - `tableId` is validated but NEVER trusted: the service re-checks every
//     id against the restaurant + branch in the database.
//   - `restaurantId` is never accepted from the client at all.
// ============================================================

/** Virtual canvas the floor plan is laid out on. */
export const LAYOUT_CANVAS_WIDTH = 900;
export const LAYOUT_CANVAS_HEIGHT = 600;

/** Min/max table footprint on the canvas (guards against absurd values). */
export const LAYOUT_MIN_TABLE_DIMENSION = 20;
export const LAYOUT_MAX_TABLE_DIMENSION = 400;

/**
 * Mirrors the Prisma `TableShape` enum. `satisfies` fails to compile if a
 * value is renamed/removed in the schema, so the two cannot drift silently.
 */
export const TABLE_SHAPES = [
  "RECTANGLE",
  "CIRCLE",
] as const satisfies readonly TableShape[];

export type TableShapeValue = (typeof TABLE_SHAPES)[number];

/** Wrap any finite degree value into [0, 360). */
export function normalizeLayoutRotation(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * One placed table. The geometry describes the table's footprint on the
 * virtual canvas; all table semantics (number/name/capacity/status) live on
 * the `table` row and are resolved server-side.
 */
export const LayoutItemSchema = z
  .object({
    tableId: z.string().trim().min(1, "Meja wajib dipilih"),
    x: z
      .number()
      .finite("Koordinat X tidak valid")
      .min(0, "Meja berada di luar kanvas")
      .max(LAYOUT_CANVAS_WIDTH, "Meja berada di luar kanvas"),
    y: z
      .number()
      .finite("Koordinat Y tidak valid")
      .min(0, "Meja berada di luar kanvas")
      .max(LAYOUT_CANVAS_HEIGHT, "Meja berada di luar kanvas"),
    width: z
      .number()
      .finite("Ukuran meja tidak valid")
      .min(LAYOUT_MIN_TABLE_DIMENSION, "Meja terlalu kecil")
      .max(LAYOUT_MAX_TABLE_DIMENSION, "Meja terlalu besar"),
    height: z
      .number()
      .finite("Ukuran meja tidak valid")
      .min(LAYOUT_MIN_TABLE_DIMENSION, "Meja terlalu kecil")
      .max(LAYOUT_MAX_TABLE_DIMENSION, "Meja terlalu besar"),
    rotation: z.number().finite("Rotasi tidak valid"),
    shape: z.enum(TABLE_SHAPES),
  })
  .superRefine((item, ctx) => {
    if (item.x + item.width > LAYOUT_CANVAS_WIDTH) {
      ctx.addIssue({
        code: "custom",
        message: "Meja berada di luar kanvas",
        path: ["x"],
      });
    }
    if (item.y + item.height > LAYOUT_CANVAS_HEIGHT) {
      ctx.addIssue({
        code: "custom",
        message: "Meja berada di luar kanvas",
        path: ["y"],
      });
    }
  });

export type LayoutItemInput = z.infer<typeof LayoutItemSchema>;

/**
 * PUT /branches/:branchId/layout body.
 *
 * `version` is the optimistic-concurrency lock: when supplied it must equal
 * the current stored version (an empty layout counts as version 1), otherwise
 * the service rejects with a 409 so a concurrent edit can never be silently
 * overwritten. `items` is the FULL intended state — the service replaces all
 * existing persisted items with it (empty array clears the floor).
 */
export const SaveBranchLayoutSchema = z
  .object({
    version: z
      .number()
      .int("Versi layout tidak valid")
      .positive("Versi layout tidak valid")
      .optional(),
    items: z.array(LayoutItemSchema),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.items.forEach((item, index) => {
      if (seen.has(item.tableId)) {
        ctx.addIssue({
          code: "custom",
          message: "Meja tidak boleh didaftarkan lebih dari sekali",
          path: [index, "tableId"],
        });
      }
      seen.add(item.tableId);
    });
  });

export type SaveBranchLayoutInput = z.infer<typeof SaveBranchLayoutSchema>;