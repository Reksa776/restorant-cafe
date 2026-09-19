import crypto from "crypto";
import { Prisma } from "@prisma/client";
import type { Reservation, ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { branchService } from "@/services/branch/branch.service";
import {
  RESERVATION_DEFAULT_DURATION_MINUTES,
  RESERVATION_HOLDING_STATUSES,
  RESERVATION_SLOT_CONFIG,
  canAccommodate,
  dateOnlyFromDb,
  remainingCapacity,
  validateReservationWindow,
  type ReservationCapacityRow,
  type ReservationNow,
} from "./reservation.slots";
import {
  CreateAdminReservationSchema,
  CreatePublicReservationSchema,
  DurationMinutesSchema,
  PartySizeSchema,
  ReservationDateOnlySchema,
  ReservationListQuerySchema,
  ReservationStatusUpdateSchema,
  StartMinutesSchema,
  type ReservationStatusValue,
} from "./reservation.types";
import { dispatchReservationWhatsApp } from "./reservation-whatsapp";

// ============================================================
// PHASE R2 — RESERVATION SERVICE (single source of truth).
//
// R1 shipped the PURE slot engine (overlap/capacity/window math) and the
// schemas. R2 layers the database + business rules on top WITHOUT touching
// the engine: every overlap/capacity decision still runs through
// `canAccommodate`/`remainingCapacity`, and every window decision through
// `validateReservationWindow` — there is exactly ONE source of truth, no
// duplicated math.
//
// Responsibilities:
//   - availability (per table / across the branch)
//   - transactional reservation creation (table FOR UPDATE gate)
//   - get by id / by code (tenant + branch scoped)
//   - admin list (server-side pagination + filters)
//   - status transitions + cancellation
//   - duplicate-booking protection (race-safe, inside the transaction)
//
// Conventions (inherited from the existing services):
//   - transport error classes from `@/lib/errors` (AppError family)
//   - missing auth helpers on purpose: R2 has NO request/route — the caller
//     (R3 public / R4 admin) derives restaurantId/branchId SERVER-SIDE via
//     `requireRestaurantContext`/`requireRoles` and passes them in; branch
//     authorization is enforced here through the optional `branchFilters`
//     argument (see `authorizedBranches` in `@/lib/auth-helpers`).
//   - interactive Prisma transactions + raw `FOR UPDATE` row locks (the same
//     pattern as payment/promo/stock services).
//
// Security contract (never trust the client):
//   - restaurantId is a REQUIRED argument, never derived from input.
//   - branchId is either resolved from the branch CODE (public) or validated
//     to belong to `restaurantId` + active (admin) INSIDE the transaction.
//   - customerId (if any) is cross-checked against the restaurant server-side.
//   - table capacity, availability and duplicate decisions are ALWAYS
//     recomputed in the transaction against the database.
//   - no password / auth secrets / payment / WhatsApp fields are touched.
// ============================================================

// ============================================================
// Created time — injected for determinism (mirrors ReservationNow).
// ============================================================

function currentReservationNow(now: Date = new Date()): ReservationNow {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return {
    today: `${year}-${month}-${day}`,
    nowMinutes: now.getHours() * 60 + now.getMinutes(),
  };
}

function resolveNow(now?: ReservationNow): ReservationNow {
  return now ?? currentReservationNow();
}

/** `YYYY-MM-DD` → the `@db.Date` value Prisma stores/compares (UTC midnight). */
function dbDateFromDateOnly(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

// ============================================================
// Status semantics — live (holding) vs released statuses
// ============================================================

// Live statuses whose reservations hold a slot (PENDING/CONFIRMED/SEATED/
// COMPLETED). CANCELLED/NO_SHOW are the RELEASING statuses — they are simply
// NOT in this list, so their intervals free the table. `Table.status` is never
// consulted: it is the order/QR lifecycle flag, unrelated to availability.
const HOLDING: ReservationStatus[] = [...RESERVATION_HOLDING_STATUSES];

/**
 * Legal status transitions.
 *
 *   PENDING   → CONFIRMED, CANCELLED
 *   CONFIRMED → SEATED, CANCELLED, NO_SHOW
 *   SEATED    → COMPLETED
 *   COMPLETED / CANCELLED / NO_SHOW → (terminal, no outgoing edges)
 *
 * PENDING → NO_SHOW is deliberately NOT allowed: nothing in the existing
 * architecture requires staff to mark an unacknowledged booking as a no-show
 * (the NO_SHOW path is CONFIRMED → NO_SHOW only).
 */
const VALID_RESERVATION_TRANSITIONS: Record<
  ReservationStatusValue,
  ReservationStatusValue[]
> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["SEATED", "CANCELLED", "NO_SHOW"],
  SEATED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

// ============================================================
// Reservation code — human-friendly and NON-sequential
// ============================================================

/**
 * `R-XXXXXXXX` from a cryptographically-random base-36 value. The order
 * service uses the same approach (crypto random entropy, no sequences) so a
 * code can never be enumerated; uniqueness is enforced per restaurant by the
 * `@@unique([restaurantId, code])` constraint with a bounded P2002 retry.
 */
function generateReservationCode(): string {
  const random = crypto
    .randomInt(0, 36 ** 8)
    .toString(36)
    .toUpperCase()
    .padStart(8, "0");
  return `R-${random}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function reservationCodeTarget(error: unknown): string {
  const meta = (error as Prisma.PrismaClientKnownRequestError)?.meta;
  const target = meta?.target;
  if (Array.isArray(target)) return target.join(",");
  return String(target ?? "");
}

/** Bounded retry for the (astronomically unlikely) code collision race. */
const UNIQUE_RETRY_ATTEMPTS = 5;

// ============================================================
// Enrichment — the Reservation model declares NO relations (R1: purely
// additive, plain scalars), so table/branch/customer names are resolved with
// a single batched lookup instead of Prisma `include`.
// ============================================================

async function reservationViews(rows: Reservation[]) {
  const tableIds = [
    ...new Set(
      rows.map((r) => r.tableId).filter((id): id is string => Boolean(id))
    ),
  ];
  const branchIds = [...new Set(rows.map((r) => r.branchId))];
  const customerIds = [
    ...new Set(
      rows.map((r) => r.customerId).filter((id): id is string => Boolean(id))
    ),
  ];

  const [tables, branches, customers] = await Promise.all([
    tableIds.length
      ? prisma.table.findMany({
          where: { id: { in: tableIds } },
          select: { id: true, number: true, name: true, capacity: true },
        })
      : Promise.resolve([]),
    branchIds.length
      ? prisma.branch.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, code: true, name: true },
        })
      : Promise.resolve([]),
    customerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true, phone: true },
        })
      : Promise.resolve([]),
  ]);

  const tableMap = new Map(tables.map((t) => [t.id, t]));
  const branchMap = new Map(branches.map((b) => [b.id, b]));
  const customerMap = new Map(customers.map((c) => [c.id, c]));

  return rows.map((r) => ({
    ...r,
    reservationDate: dateOnlyFromDb(r.reservationDate),
    table: r.tableId ? (tableMap.get(r.tableId) ?? null) : null,
    branch: branchMap.get(r.branchId) ?? null,
    customer: r.customerId ? (customerMap.get(r.customerId) ?? null) : null,
  }));
}

export type ReservationView = Awaited<ReturnType<typeof reservationViews>>[number];

// ============================================================
// Service-layer input for the shared create kernel
// ============================================================

interface CreateReservationData {
  branchId: string;
  reservationDate: string;
  startMinutes: number;
  durationMinutes: number;
  partySize: number;
  tableId?: string | null;
  guestName: string;
  guestPhone: string;
  customerId?: string | null;
  notes?: string | null;
  source: "PUBLIC" | "ADMIN";
}

// ============================================================
// Availability
// ============================================================

interface TableAvailability {
  tableId: string;
  number: number;
  name: string;
  capacity: number;
  /** Seats still free at the requested interval (may be negative). */
  remainingSeats: number;
  /** True when `partySize` fits into `remainingSeats`. */
  available: boolean;
}

export interface ReservationAvailabilityResult {
  /** Whether the requested booking fits (a specific table, or any branch table). */
  available: boolean;
  tableId: string | null;
  partySize: number;
  reservationDate: string;
  startMinutes: number;
  durationMinutes: number;
  /** Active tables of the branch — NEVER legacy branchId=NULL rows. */
  tables: TableAvailability[];
}

export class ReservationService {
  /**
   * R7 — best-effort WhatsApp notification for one reservation lifecycle
   * event. Called ONLY after a successful server-side create/transition, so
   * the reservation is always authoritative. Await-plus-catch mirrors the
   * order READY pattern (order.service.ts): a WhatsApp failure is logged and
   * NEVER fails/rolls back/alters the reservation.
   */
  private async notifyReservationWhatsApp(view: ReservationView): Promise<void> {
    try {
      await dispatchReservationWhatsApp(view, view.status);
    } catch (error) {
      console.error(
        `[Reservation] WhatsApp notification dispatch failed for reservation ${view.code}:`,
        error
      );
    }
  }

  /**
   * Availability for a specific slot.
   *
   * Scope: `restaurantId` + `branchId` are REQUIRED (server-derived). Only
   * ACTIVE tables of that exact branch are considered — legacy tables with
   * `branchId` NULL are never candidates. `Table.status` is deliberately NOT
   * consulted: it is the order/QR lifecycle flag; reservation availability is
   * computed purely from the table's capacity and the LIVE reservation rows
   * (PENDING/CONFIRMED/SEATED/COMPLETED hold the slot; CANCELLED/NO_SHOW do
   * not), using the engine's half-open overlap math.
   */
  async checkAvailability(
    restaurantId: string,
    branchId: string,
    input: {
      reservationDate: string;
      partySize: number;
      startMinutes: number;
      durationMinutes?: number;
      tableId?: string | null;
    }
  ): Promise<ReservationAvailabilityResult> {
    const dateParsed = ReservationDateOnlySchema.safeParse(input.reservationDate);
    if (!dateParsed.success) {
      throw new ValidationError("Tanggal reservasi tidak valid (format YYYY-MM-DD)");
    }
    const reservationDate = dateParsed.data;
    const startParsed = StartMinutesSchema.safeParse(input.startMinutes);
    if (!startParsed.success) {
      throw new ValidationError("Jam reservasi tidak valid");
    }
    const startMinutes = startParsed.data;
    const durationParsed = DurationMinutesSchema.safeParse(
      input.durationMinutes ?? RESERVATION_DEFAULT_DURATION_MINUTES
    );
    if (!durationParsed.success) {
      throw new ValidationError("Durasi reservasi tidak valid");
    }
    const durationMinutes = durationParsed.data;
    const partyParsed = PartySizeSchema.safeParse(input.partySize);
    if (!partyParsed.success) {
      throw new ValidationError("Jumlah orang tidak valid");
    }
    const partySize = partyParsed.data;
    const tableId = input.tableId?.trim() || null;

    const dbDate = dbDateFromDateOnly(reservationDate);

    // Requested-table resolution: it must exist in THIS restaurant and belong
    // to THIS branch (a branch-scoped availability can never leak another
    // branch's table).
    if (tableId) {
      const table = await prisma.table.findFirst({
        where: { id: tableId, restaurantId, branchId },
        select: {
          id: true,
          branchId: true,
          number: true,
          name: true,
          capacity: true,
          isActive: true,
        },
      });
      if (!table || table.branchId !== branchId) {
        throw new ForbiddenError("Meja tidak berada di cabang ini");
      }
      if (!table.isActive) {
        throw new ValidationError("Meja tidak aktif");
      }
      const existing = await this.holdingForTable(table.id, dbDate);
      const remaining = remainingCapacity(
        table.capacity,
        existing,
        { startMinutes, durationMinutes }
      );
      return {
        available: partySize <= remaining,
        tableId: table.id,
        partySize,
        reservationDate,
        startMinutes,
        durationMinutes,
        tables: [
          {
            tableId: table.id,
            number: table.number,
            name: table.name,
            capacity: table.capacity,
            remainingSeats: remaining,
            available: partySize <= remaining,
          },
        ],
      };
    }

    // No specific table → scan every ACTIVE table of the branch.
    const tables = await prisma.table.findMany({
      where: { branchId, restaurantId, isActive: true },
      select: { id: true, number: true, name: true, capacity: true },
      orderBy: { number: "asc" },
    });

    const availability: TableAvailability[] = [];
    for (const table of tables) {
      const existing = await this.holdingForTable(table.id, dbDate);
      const remaining = remainingCapacity(
        table.capacity,
        existing,
        { startMinutes, durationMinutes }
      );
      availability.push({
        tableId: table.id,
        number: table.number,
        name: table.name,
        capacity: table.capacity,
        remainingSeats: remaining,
        available: partySize <= remaining,
      });
    }

    return {
      available: availability.some((t) => t.available),
      tableId: null,
      partySize,
      reservationDate,
      startMinutes,
      durationMinutes,
      tables: availability,
    };
  }

  /** Live reservations holding the slot for a table on a given day. */
  private async holdingForTable(
    tableId: string,
    dbDate: Date
  ): Promise<ReservationCapacityRow[]> {
    const rows = await prisma.reservation.findMany({
      where: {
        tableId,
        reservationDate: dbDate,
        status: { in: HOLDING },
      },
      select: {
        partySize: true,
        startMinutes: true,
        durationMinutes: true,
        status: true,
      },
    });
    return rows.map((r) => ({
      partySize: r.partySize,
      startMinutes: r.startMinutes,
      durationMinutes: r.durationMinutes,
      status: r.status,
    }));
  }

  // ============================================================
  // Create — public guest entry point
  // ============================================================

  /**
   * Create a reservation from the public (customer menu/QR) flow.
   *
   * `restaurantId` is server-derived (domain/QR resolution happens in the
   * route). The branch is resolved HERE from the branch CODE (active branch
   * only) — the client can never pass a raw branch id. An optional linked
   * `customerId` (from the verified customer session) may be passed via
   * `opts`; guest bookings keep it null.
   */
  async createPublicReservation(
    restaurantId: string,
    raw: unknown,
    opts?: { now?: ReservationNow; customerId?: string | null }
  ): Promise<ReservationView> {
    const parsed = CreatePublicReservationSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const now = resolveNow(opts?.now);

    const branch = await branchService.findBranchByCode(
      restaurantId,
      parsed.data.branchCode
    );
    if (!branch) {
      throw new NotFoundError("Cabang tidak ditemukan");
    }

    return this.createReservation(
      restaurantId,
      {
        branchId: branch.id,
        reservationDate: parsed.data.reservationDate,
        startMinutes: parsed.data.startMinutes,
        durationMinutes: parsed.data.durationMinutes,
        partySize: parsed.data.partySize,
        tableId: parsed.data.tableId ?? null,
        guestName: parsed.data.guestName,
        guestPhone: parsed.data.guestPhone,
        customerId: opts?.customerId ?? null,
        notes: parsed.data.notes ?? null,
        source: parsed.data.source,
      },
      now
    );
  }

  /**
   * Create a reservation from the admin / kasir flow.
   *
   * `restaurantId` is server-derived (requireRoles/requireAdmin). `branchId`
   * must ALREADY be authorized by the caller (effectiveWriteBranchId /
   * assertBranchInScope); it is re-validated against the restaurant INSIDE
   * the transaction so a stale/wrong id can never slip through.
   */
  async createAdminReservation(
    restaurantId: string,
    raw: unknown,
    opts?: { now?: ReservationNow }
  ): Promise<ReservationView> {
    const parsed = CreateAdminReservationSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const now = resolveNow(opts?.now);

    return this.createReservation(
      restaurantId,
      {
        branchId: parsed.data.branchId,
        reservationDate: parsed.data.reservationDate,
        startMinutes: parsed.data.startMinutes,
        durationMinutes: parsed.data.durationMinutes,
        partySize: parsed.data.partySize,
        tableId: parsed.data.tableId ?? null,
        guestName: parsed.data.guestName,
        guestPhone: parsed.data.guestPhone,
        customerId: parsed.data.customerId ?? null,
        notes: parsed.data.notes ?? null,
        source: parsed.data.source,
      },
      now
    );
  }

  // ============================================================
  // Create — shared transactional kernel
  // ============================================================

  /**
   * The single transactional reservation-creation path.
   *
   * Concurrency strategy (mirrors payment/promo/stock FOR UPDATE pattern):
   *
   *   BEGIN
   *     SELECT branch row FOR UPDATE          ← serializes writes per branch,
   *                                              making the duplicate check
   *                                              race-safe even for bookings
   *                                              WITHOUT a table
   *     validate branch (restaurant, active)
   *     validate window (slot grid + horizon + past)   [pure engine]
   *     if tableId:
   *       SELECT table row FOR UPDATE         ← the capacity gate; a second
   *                                              concurrent booking for the
   *                                              same table BLOCKS here until
   *                                              the first commits, then reads
   *                                              the LATEST rows (locking read)
   *       validate owner/branch/active/capacity
   *       count overlapping LIVE reservations (PENDING/CONFIRMED/SEATED/
   *              COMPLETED — CANCELLED/NO_SHOW are ignored) via
   *              `canAccommodate` (half-open intervals)
   *     duplicate booking check (guestPhone or customerId,
   *              date + startMinutes, LIVE statuses only)
   *     INSERT Reservation
   *   COMMIT
   *
   * Lock order is ALWAYS branch → table, so two writers can never deadlock.
   * App errors (Validation/Conflict/NotFound/Forbidden) thrown inside the
   * transaction roll it back and are re-thrown unchanged.
   */
  private async createReservation(
    restaurantId: string,
    data: CreateReservationData,
    now: ReservationNow
  ): Promise<ReservationView> {
    const createInTx = (code: string) =>
      prisma.$transaction(async (tx) => {
        const dbDate = dbDateFromDateOnly(data.reservationDate);

        // Branch row lock — serializes every create in the branch so the
        // duplicate check below is race-safe (even for table-less bookings).
        const branchRows = await tx.$queryRaw<
          Array<{ id: string; restaurantId: string; isActive: boolean }>
        >(
          Prisma.sql`
            SELECT \`id\`, \`restaurantId\`, \`isActive\`
            FROM \`branch\`
            WHERE \`id\` = ${data.branchId}
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

        // Window / slot-grid / horizon / past validation (pure engine; the
        // request "now" is injected once at the request edge).
        const windowValidation = validateReservationWindow(
          {
            reservationDate: data.reservationDate,
            startMinutes: data.startMinutes,
            durationMinutes: data.durationMinutes,
          },
          now,
          RESERVATION_SLOT_CONFIG
        );
        if (!windowValidation.ok) {
          throw new ValidationError(windowValidation.message);
        }

        // Optional customer link must belong to this restaurant (admin flow).
        if (data.customerId) {
          const customer = await tx.customer.findFirst({
            where: { id: data.customerId, restaurantId },
            select: { id: true },
          });
          if (!customer) {
            throw new ValidationError("Pelanggan tidak ditemukan");
          }
        }

        // Table capacity gate — SELECT ... FOR UPDATE under the branch lock.
        if (data.tableId) {
          const tableRows = await tx.$queryRaw<
            Array<{
              id: string;
              restaurantId: string;
              branchId: string | null;
              capacity: number;
              isActive: boolean;
              number: number;
              name: string;
            }>
          >(
            Prisma.sql`
              SELECT \`id\`, \`restaurantId\`, \`branchId\`, \`capacity\`,
                     \`isActive\`, \`number\`, \`name\`
              FROM \`table\`
              WHERE \`id\` = ${data.tableId}
              FOR UPDATE
            `
          );
          const table = tableRows[0];
          if (!table || table.restaurantId !== restaurantId) {
            throw new NotFoundError("Meja tidak ditemukan");
          }
          // Legacy tables (branchId NULL) are NEVER bookable.
          if (table.branchId !== data.branchId) {
            throw new ForbiddenError("Meja tidak berada di cabang ini");
          }
          if (!table.isActive) {
            throw new ValidationError("Meja tidak aktif");
          }
          if (data.partySize > table.capacity) {
            throw new ConflictError(
              "Jumlah orang melebihi kapasitas meja"
            );
          }

          // Overlap capacity: every LIVE reservation that overlaps the
          // half-open interval [start, start+duration) counts. CANCELLED and
          // NO_SHOW release the slot and are NOT fetched.
          const existing = await tx.reservation.findMany({
            where: {
              tableId: data.tableId,
              reservationDate: dbDate,
              status: { in: HOLDING },
            },
            select: {
              partySize: true,
              startMinutes: true,
              durationMinutes: true,
              status: true,
            },
          });
          if (
            !canAccommodate(
              table.capacity,
              existing,
              {
                startMinutes: data.startMinutes,
                durationMinutes: data.durationMinutes,
                partySize: data.partySize,
              }
            )
          ) {
            throw new ConflictError(
              "Kapasitas meja tidak mencukupi pada waktu tersebut"
            );
          }
        }

        // Duplicate booking protection — race-safe because every create in
        // this branch is serialized by the branch row lock above.
        // Active statuses only: a previously CANCELLED/NO_SHOW booking with
        // the same keys does NOT block a fresh attempt.
        const dupWhere: Prisma.ReservationWhereInput = {
          restaurantId,
          branchId: data.branchId,
          reservationDate: dbDate,
          startMinutes: data.startMinutes,
          status: { in: HOLDING },
        };
        if (data.customerId) {
          dupWhere.customerId = data.customerId;
        } else {
          dupWhere.guestPhone = data.guestPhone;
        }
        const duplicate = await tx.reservation.findFirst({
          where: dupWhere,
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictError(
            "Reservasi dengan data yang sama sudah ada"
          );
        }

        const created = await tx.reservation.create({
          data: {
            restaurantId,
            branchId: data.branchId,
            code,
            customerId: data.customerId ?? null,
            tableId: data.tableId ?? null,
            guestName: data.guestName,
            guestPhone: data.guestPhone,
            partySize: data.partySize,
            reservationDate: dbDate,
            startMinutes: data.startMinutes,
            durationMinutes: data.durationMinutes,
            status: "PENDING",
            notes: data.notes ?? null,
            source: data.source,
          },
        });
        return created;
      });

    let reservation: Awaited<ReturnType<typeof createInTx>> | null = null;
    for (let attempt = 0; attempt < UNIQUE_RETRY_ATTEMPTS; attempt++) {
      try {
        reservation = await createInTx(generateReservationCode());
        break;
      } catch (error) {
        // Only retry a collision on the reservation code itself — a fresh
        // code is the only thing that can fix it. Everything else (capacity,
        // duplicate, invalid window, ownership) must propagate immediately.
        const isCodeCollision =
          isUniqueViolation(error) &&
          reservationCodeTarget(error).includes("code");
        if (!isCodeCollision || attempt === UNIQUE_RETRY_ATTEMPTS - 1) {
          throw error;
        }
      }
    }
    if (!reservation) {
      throw new Error("Failed to create reservation after retries");
    }

    const view = (await reservationViews([reservation]))[0];

    // R7 — reservation is persisted and resolved; dispatch the created
    // (PENDING) WhatsApp notification best-effort.
    await this.notifyReservationWhatsApp(view);

    return view;
  }

  // ============================================================
  // Read — single reservation by id (tenant + branch scoped)
  // ============================================================

  /**
   * Get a reservation by its primary id. ALWAYS restaurant-scoped, and when
   * `branchFilters` (authorizedBranches(ctx)) is provided the reservation
   * must belong to one of those branches.
   */
  async getReservationById(
    id: string,
    restaurantId: string,
    branchFilters?: string[] | null
  ): Promise<ReservationView> {
    const reservation = await prisma.reservation.findFirst({
      where: {
        id,
        restaurantId,
        branchId: branchFilters?.length ? { in: branchFilters } : undefined,
      },
    });
    if (!reservation) {
      throw new NotFoundError("Reservasi tidak ditemukan");
    }
    const view = (await reservationViews([reservation]))[0];
    return view;
  }

  // ============================================================
  // Read — by code (admin, tenant + branch scoped)
  // ============================================================

  /**
   * Get an admin reservation by its non-sequential code. Codes are unique per
   * restaurant (`@@unique([restaurantId, code])`), so the code alone can
   * never cross into another restaurant's data.
   */
  async getReservationByCode(
    restaurantId: string,
    code: string,
    branchFilters?: string[] | null
  ): Promise<ReservationView> {
    const reservation = await prisma.reservation.findFirst({
      where: {
        restaurantId,
        code,
        branchId: branchFilters?.length ? { in: branchFilters } : undefined,
      },
    });
    if (!reservation) {
      throw new NotFoundError("Reservasi tidak ditemukan");
    }
    const view = (await reservationViews([reservation]))[0];
    return view;
  }

  // ============================================================
  // Read — guest primitive (public self-service lookup)
  // ============================================================

  /**
   * Guest lookup: `restaurantId` + `code` + `guestPhone`. The phone is
   * normalized (same canonical form every flow uses) and must MATCH the
   * stored reservation. Returns an explicit public DTO only — it never
   * exposes customer/order columns, phone is echoed back (it is the caller's
   * own) but internal fields (orderId, customerId, source, notes) are not.
   */
  async getReservationByCodeForGuest(
    restaurantId: string,
    code: string,
    guestPhone: string
  ) {
    const normalized = normalizePhone(guestPhone);
    if (!normalized) {
      throw new ValidationError("Nomor WhatsApp tidak valid");
    }

    const reservation = await prisma.reservation.findFirst({
      where: { restaurantId, code },
      // Explicit scalar allow-list — the Reservation model declares no
      // relations, and nothing internal (orderId/customerId/source/notes) is
      // ever selected for a guest.
      select: {
        id: true,
        code: true,
        status: true,
        reservationDate: true,
        startMinutes: true,
        durationMinutes: true,
        partySize: true,
        guestName: true,
        guestPhone: true,
        branchId: true,
        tableId: true,
        createdAt: true,
      },
    });
    if (!reservation || reservation.guestPhone !== normalized) {
      throw new NotFoundError("Reservasi tidak ditemukan");
    }

    // Branch/table display names — separate batched lookup, never nested
    // relation traversal.
    const [branch, table] = await Promise.all([
      prisma.branch.findFirst({
        where: { id: reservation.branchId },
        select: { code: true, name: true },
      }),
      reservation.tableId
        ? prisma.table.findFirst({
            where: { id: reservation.tableId },
            select: { number: true, name: true },
          })
        : Promise.resolve(null),
    ]);

    return {
      id: reservation.id,
      code: reservation.code,
      status: reservation.status,
      reservationDate: dateOnlyFromDb(reservation.reservationDate),
      startMinutes: reservation.startMinutes,
      durationMinutes: reservation.durationMinutes,
      partySize: reservation.partySize,
      guestName: reservation.guestName,
      guestPhone: reservation.guestPhone,
      branch,
      table,
      createdAt: reservation.createdAt,
    };
  }

  // ============================================================
  // List — admin board (server-side pagination + filters)
  // ============================================================

  /**
   * Admin reservation list. Filters: branchId (hint, must be inside
   * `branchFilters` when the caller is branch-scoped), date, status, tableId,
   * and a free-text search over code/guestName/guestPhone. Pagination is
   * server-side (page/limit coerced from query strings). Default sort follows
   * the board (reservationDate ASC, startMinutes ASC); `sort: "newest"`
   * switches to createdAt DESC for dashboards.
   *
   * Tenant isolation is unconditional (restaurantId is required); branch
   * isolation is enforced through `branchFilters` from authorizedBranches.
   */
  async listReservations(
    restaurantId: string,
    raw: unknown,
    branchFilters?: string[] | null
  ): Promise<{
    items: ReservationView[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const parsed = ReservationListQuerySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Prisma.ReservationWhereInput = {
      restaurantId,
    };

    // A branch-scoped caller can never narrow a listing to another branch.
    const requestedBranchId = parsed.data.branchId ?? null;
    if (
      requestedBranchId &&
      branchFilters?.length &&
      !branchFilters.includes(requestedBranchId)
    ) {
      throw new ForbiddenError("Anda tidak memiliki akses ke cabang ini");
    }
    if (requestedBranchId) {
      where.branchId = requestedBranchId;
    } else if (branchFilters?.length) {
      where.branchId = { in: branchFilters };
    }

    if (parsed.data.date) {
      where.reservationDate = dbDateFromDateOnly(parsed.data.date);
    }
    if (parsed.data.status) {
      where.status = parsed.data.status;
    }
    if (parsed.data.tableId) {
      where.tableId = parsed.data.tableId;
    }
    if (parsed.data.search) {
      where.OR = [
        { code: { contains: parsed.data.search } },
        { guestName: { contains: parsed.data.search } },
        { guestPhone: { contains: parsed.data.search } },
      ];
    }

    const orderBy: Prisma.ReservationOrderByWithRelationInput[] =
      parsed.data.sort === "newest"
        ? [{ createdAt: "desc" }]
        : [{ reservationDate: "asc" }, { startMinutes: "asc" }];

    const [rows, total] = await Promise.all([
      prisma.reservation.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.reservation.count({ where }),
    ]);

    const items = await reservationViews(rows);
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ============================================================
  // Status transitions / cancellation
  // ============================================================

  /**
   * Transition a reservation to a new status using the legal-transition
   * matrix, guarded by a CONDITIONAL update so two concurrent requests can
   * never double-write the same transition (the loser gets a ConflictError).
   * Timestamps are set once per transition and never reset afterwards.
   *
   * Any transition attempt INTO a terminal status when already terminal, or a
   * reaction (COMPLETED → CONFIRMED), throws ConflictError.
   */
  async updateStatus(
    id: string,
    restaurantId: string,
    raw: unknown,
    branchFilters?: string[] | null
  ): Promise<ReservationView> {
    const parsed = ReservationStatusUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const target = parsed.data.status;
    const cancelReason = parsed.data.cancelReason?.trim() || null;

    return this.transitionReservation(
      id,
      restaurantId,
      target,
      cancelReason,
      branchFilters
    );
  }

  /**
   * Cancellation convenience: only PENDING/CONFIRMED may be cancelled (the
   * transition matrix enforces it). SEATED/COMPLETED/NO_SHOW/CANCELLED
   * bookings cannot be cancelled.
   */
  async cancelReservation(
    id: string,
    restaurantId: string,
    raw?: { cancelReason?: string | null },
    branchFilters?: string[] | null
  ): Promise<ReservationView> {
    const cancelReason = raw?.cancelReason?.trim() || null;
    return this.transitionReservation(
      id,
      restaurantId,
      "CANCELLED",
      cancelReason,
      branchFilters
    );
  }

  private async transitionReservation(
    id: string,
    restaurantId: string,
    target: ReservationStatusValue,
    cancelReason: string | null,
    branchFilters?: string[] | null
  ): Promise<ReservationView> {
    const current = await prisma.reservation.findFirst({
      where: {
        id,
        restaurantId,
        branchId: branchFilters?.length ? { in: branchFilters } : undefined,
      },
      select: {
        id: true,
        status: true,
        confirmedAt: true,
        seatedAt: true,
        completedAt: true,
        cancelledAt: true,
      },
    });
    if (!current) {
      throw new NotFoundError("Reservasi tidak ditemukan");
    }

    const allowed = VALID_RESERVATION_TRANSITIONS[current.status];
    if (!allowed.includes(target)) {
      throw new ConflictError(
        `Transisi status ${current.status} → ${target} tidak diizinkan`
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const data: Prisma.ReservationUpdateManyMutationInput = {
        status: target,
      };

      // Timestamps are only ever set ONCE (never reset historical values on
      // a repeated/late call).
      if (target === "CONFIRMED" && !current.confirmedAt) {
        data.confirmedAt = new Date();
      }
      if (target === "SEATED" && !current.seatedAt) {
        data.seatedAt = new Date();
      }
      if (target === "COMPLETED" && !current.completedAt) {
        data.completedAt = new Date();
      }
      if (target === "CANCELLED") {
        data.cancelledAt = current.cancelledAt ?? new Date();
        data.cancelReason = cancelReason;
      }

      // Conditional update: only succeeds when the row still has the status
      // we just validated. Two racing requests → the loser sees count 0.
      const result = await tx.reservation.updateMany({
        where: { id, status: current.status },
        data,
      });
      if (result.count === 0) {
        throw new ConflictError(
          "Status reservasi sudah berubah — silakan muat ulang"
        );
      }

      const fresh = await tx.reservation.findUnique({
        where: { id },
      });
      if (!fresh) {
        throw new NotFoundError("Reservasi tidak ditemukan");
      }
      return fresh;
    });

    const view = (await reservationViews([updated]))[0];

    // R7 — lifecycle transition is persisted and resolved; dispatch the
    // best-effort WhatsApp notification for the NEW server-side status
    // (CONFIRMED/SEATED/COMPLETED/NO_SHOW/CANCELLED). Best-effort: a
    // WhatsApp failure can NEVER alter or roll back the transition, which
    // is already committed and authoritative here.
    await this.notifyReservationWhatsApp(view);

    return view;
  }

  // ============================================================
  // Customer (account) — session-scoped reads + self-cancel (R6)
  // ============================================================
  //
  // These are the ONLY customer-entry points. `customerId` and `restaurantId`
  // are taken from the verified customer session cookie by the route and are
  // NEVER derived from a query/body; every query is double-scoped to both, so
  // a customer can neither read nor cancel another customer's (or another
  // restaurant's) reservation. Cancellation STILL flows through the SAME
  // transition/cancel kernel above (status matrix + conditional update), never
  // a second cancellation logic.
  // ============================================================

  /**
   * The session's customer must still exist, be ACTIVE and belong to the
   * same restaurant as the session (mirrors customer-account.service).
   */
  private async requireActiveCustomer(
    customerId: string,
    restaurantId: string
  ): Promise<void> {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, restaurantId, isActive: true },
      select: { id: true },
    });
    if (!customer) {
      throw new UnauthorizedError("Sesi customer tidak valid");
    }
  }

  /**
   * The logged-in customer's OWN reservations, newest first, paginated.
   * Restaurants are isolated unconditionally via `restaurantId`.
   */
  async listCustomerReservations(
    customerId: string,
    restaurantId: string,
    opts?: { page?: number; limit?: number }
  ): Promise<{
    items: ReservationView[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    await this.requireActiveCustomer(customerId, restaurantId);

    const rawPage = Math.floor(Number(opts?.page ?? 1));
    const rawLimit = Math.floor(Number(opts?.limit ?? 10));
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 50)
      : 10;

    const where: Prisma.ReservationWhereInput = {
      restaurantId,
      customerId,
    };

    const [rows, total] = await Promise.all([
      prisma.reservation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.reservation.count({ where }),
    ]);

    const items = await reservationViews(rows);
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /**
   * A single reservation of the logged-in customer, addressed by its
   * non-sequential code. Ownership + tenant isolation are unconditional
   * (customerId + restaurantId from the session); an existing reservation of
   * someone else's is reported the same way as a missing one (NotFound).
   */
  async getCustomerReservation(
    customerId: string,
    restaurantId: string,
    code: string
  ): Promise<ReservationView> {
    await this.requireActiveCustomer(customerId, restaurantId);

    const reservation = await prisma.reservation.findFirst({
      where: { restaurantId, customerId, code },
    });
    if (!reservation) {
      throw new NotFoundError("Reservasi tidak ditemukan");
    }
    const view = (await reservationViews([reservation]))[0];
    return view;
  }

  /**
   * Self-cancel: ownership is verified server-side BEFORE delegating to the
   * existing cancel kernel. `customerId` is immutable on a reservation, so a
   * single ownership-scoped read is sufficient; the kernel re-reads the row
   * at transition time and its conditional update makes a concurrent/duplicate
   * cancellation a ConflictError instead of a silent second write.
   */
  async cancelCustomerReservation(
    customerId: string,
    restaurantId: string,
    code: string,
    raw?: { cancelReason?: string | null }
  ): Promise<ReservationView> {
    await this.requireActiveCustomer(customerId, restaurantId);

    const reservation = await prisma.reservation.findFirst({
      where: { restaurantId, customerId, code },
      select: { id: true },
    });
    if (!reservation) {
      throw new NotFoundError("Reservasi tidak ditemukan");
    }
    return this.cancelReservation(reservation.id, restaurantId, raw);
  }
}

export const reservationService = new ReservationService();