# PHASE R4 — ADMIN RESERVATION UI (REPORT)

**Status:** COMPLETE — VERDICT: PASS
**Scope:** `/admin/reservations` admin UI only. Consumes the R3 admin reservation API. No service/schema/migration changes.

---

## 1. Existing Admin UI Patterns Discovered

Audited before writing any code (`src/app/admin/**`, `src/components/admin/**`, `src/components/ui/**`, `src/hooks/*`, `src/lib/*`, `src/services/*.service.ts`):

- **Navigation** — single inline `navigation: NavEntry[]` in `src/app/admin/layout.tsx` (groups + leaf items filtered by `StaffRole`). "Operasional" group currently: Orders, Kitchen, Tables, Customers, Shifts.
- **Data fetching** — every admin page is `"use client"`, fetches in `useEffect` gated behind `useBranchContext().isLoading` (the "stale `admin_branch_id` 403" fix), uses a `load*` callback + state.
- **API client** — shared axios instance `src/lib/axios.ts` (reads `x-branch-id` from `localStorage`; 401 → session recovery). Client wrappers live in `src/services/*.service.ts` (thin, typed, no Prisma imports).
- **BranchSelector** — mounted ONCE in `src/app/admin/layout.tsx`; switching branch writes `admin_branch_id` then `window.location.reload()`. Server-side branch isolation originates from the `x-branch-id` header.
- **Design system** — shadcn-style over Base UI: `Card` (Header/Title/Action/Description/Content), `Button` (default/outline/ghost/destructive; sizes default/xs/sm/icon-sm), `Badge`, `Select`, `Input`, `Skeleton`, `Dialog` (Header/Description/Footer), `Textarea`, `DropdownMenu`, `Table` (wraps rows in `overflow-x-auto`).
- **Confirmations** — NO `AlertDialog` exists; the convention is `window.confirm(...)` (tables: "Hapus meja ini?", purchasing: "Batalkan pembelian ini?").
- **Cancel-with-reason** — no existing pattern; used the standard controlled `Dialog` (same as the table create/edit dialog) with footer `Batal` (outline) + `Konfirmasi Pembatalan` (destructive).
- **Toasts** — `sonner`, `<Toaster position="top-right" richColors/>` already mounted in root layout; pages call `toast.success/error`.
- **Error mapping** — `src/lib/api-error-handler.ts` (`normalizeApiError`, `getErrorMessage`, `getErrorStatus`, `isUnauthorized`).
- **Date/time idioms** — rows render `new Date(iso).toLocaleString("id-ID")`; `input type="date"` used across reports/marketing/shifts; phone via `formatPhoneDisplay` in `src/lib/phone.ts`.
- **Reservation-specific pure helpers** — `minutesToLabel` / `isValidDateOnly` in `src/services/reservation/reservation.slots.ts` (already client-importable; no Prisma/timezone).
- **Responsive** — `Table` scrolls horizontally on small screens; secondary columns hidden via `hidden sm:table-cell` etc.; header action rows use `flex flex-col gap-3 sm:flex-row`.

## 2. Files Changed

**Added**
- `src/app/admin/reservations/page.tsx` — reservation board (list + filters + pagination + actions + detail/cancel dialogs).
- `src/components/admin/reservations/reservation-filters.tsx` — reusable filter bar (search / status / branch / date).
- `src/components/admin/reservations/reservation-status-badge.tsx` — status pill (tables-page color style).
- `src/components/admin/reservations/reservation-detail.tsx` — detail dialog.
- `src/components/admin/reservations/reservation-cancel-dialog.tsx` — cancel-with-reason dialog.
- `src/components/admin/reservations/reservation-format.ts` — pure display helpers + status/source labels.
- `src/components/admin/reservations/reservation-format.test.ts` — node:test for the pure helpers.
- `src/services/reservation.service.ts` — client-side axios wrapper for the R3 admin endpoints.

**Modified**
- `src/app/admin/layout.tsx` — added `{ name: "Reservasi", href: "/admin/reservations", icon: CalendarDays, roles: ["ADMIN", "CASHIER"] }` to the "Operasional" group (after Tables). Nothing else in the navigation changed.

**Unchanged** — `reservation.service.ts` (server), `reservation.slots.ts`, `reservation.types.ts`, all R3 routes, Prisma schema, migrations.

## 3. Reservation Page Implemented

`/admin/reservations` follows the orders/customers layout: `<h1>Reservasi</h1>` header, filter Card, board Card with `Daftar Reservasi` title + "Muat Ulang" button. Server-side paginated fetch via `reservationService.list({ page, limit, search, status, branchId, date })` — **no browser-side filtering** of a full dataset.

Columns: Kode, Tamu (name + formatted phone), Tanggal/Jam, Jml, Meja, Status (badge), Dibuat (hidden `xl`), Aksi. Status badges map `PENDING/CONFIRMED/SEATED/COMPLETED/CANCELLED/NO_SHOW` → Menunggu/Dikonfirmasi/Sudah Duduk/Selesai/Dibatalkan/Tidak Hadir.

## 4. Filters Implemented

- **Search** — server-side (`code`/`guestName`/`guestPhone` `contains` on the R3 endpoint); applied on Enter; inline ✕ clears + re-submits (orders pattern).
- **Status** — server-side `status` param, one of the six reservation statuses.
- **Branch** — server-side `branchId` param, options = **session-authorized branches only** (`useBranchContext().branches`); server re-validates via `assertBranchInScope`. See §7.
- **Date** — server-side `date` param (`YYYY-MM-DD`).

All filter changes reset to page 1. `hasActiveFilters` drives the "Reset Filter" empty-state CTA.

## 5. Detail View

Dialog (matches the table create/edit dialog chrome) opened per row via the Eye button. Fields shown: Cabang (name + code), Status, Tanggal, Jam (`10:00–11:30`), Durasi, Jumlah Orang, Meja, Nama Tamu, No. WhatsApp, Pelanggan (if linked), Sumber (Website/Admin), Catatan, Dibuat, plus a **Riwayat Status** block (confirmedAt/seatedAt/completedAt/cancelledAt timestamps and cancel reason). On open it re-fetches `GET /admin/reservations/[id]` (best-effort) so timestamps are current; board data is shown instantly otherwise. **No internal ids and no auth/payment/WhatsApp data are rendered** — the R3 ReservationView carries none.

## 6. Status Actions

Actions per current status (UX convenience only — server stays authoritative):
- PENDING → **Konfirmasi**, **Batal**
- CONFIRMED → **Seat**, **Batal**, **No-show**
- SEATED → **Selesai**
- COMPLETED / CANCELLED / NO_SHOW → no actions

Transitions call `PATCH /admin/reservations/[id]/status`. **409 from the server** (e.g. "Status reservasi sudah berubah — silakan muat ulang", "Transisi status … tidak diizinkan") is surfaced verbatim via toast; the UI never forces a transition and never optimistically mutates status. After success: toast + list refetch (+ open detail updated). Confirm/Seat/Complete/No-show use `window.confirm` (existing convention); double-click is prevented by a single in-flight `mutatingKey` that disables all action buttons.

## 7. Branch Isolation

- Reused **global** `BranchSelector` from the admin layout — not re-embedded on the page.
- Branch **scoping comes from two server-validated inputs**: the `x-branch-id` header (axios interceptor, sent automatically for branch-scoped users) and the page's explicit `branchId` filter.
- **Explicit `branchId` is sent to the API whenever a branch is selected** in the page filter (spec §5), and the option list is restricted to the session's authorized branches, so a branch-scoped CASHIER can never pick a branch outside their assignment.
- No changes to `branchHintFrom` / `authorizedBranches` / `effectiveWriteBranchId` / `assertBranchInScope`. First fetch gated behind `branchCtxLoading` (stale-403 fix), same as Orders/Customers/Tables.

## 8. Loading / Error / Empty States

- **Loading** — initial/refetch shows a 6-row `Skeleton` table (no blank screen). Refresh button shows text-only while disabled.
- **Action loading** — action buttons disabled while any mutation is in flight (prevents double-click/double-submit).
- **Detail** — instant board data, background refetch; never blank.
- **Error** — `AlertCircle` + message + **Coba Lagi** button; 401 handled by the interceptor; 400/403/404/409/500 mapped to user-friendly Indonesian messages with the server message preferred (no stack traces).
- **Empty** — "Belum ada reservasi" vs "Reservasi tidak ditemukan untuk filter ini." + **Reset Filter** when filters are active.

## 9. Responsive Behavior

`Table` scrolls horizontally (existing wrapper); secondary columns (`Jml` sm, `Meja` md, `Dibuat` xl) collapse gracefully; filter bar stacks on mobile (`flex flex-col gap-3 md:flex-row`); action buttons wrap and remain accessible via horizontal scroll.

## 10. Tests

No new test framework (no Jest/Vitest — per spec §22). Added **8 lightweight `node:test` cases** for the pure display helpers (`npx tsx --test src/components/admin/reservations/reservation-format.test.ts`) covering date rendering without timezone shift, malformed-input fallback, `HH:mm` slot rendering, ISO timestamp, and status/source labels: **8/8 pass**.

Existing suites re-run green:
| Suite | Result |
|---|---|
| R1 reservation unit | 41/41 |
| R2 reservation service (DB) | 41/41 |
| R3 reservation HTTP API (real `next dev`) | 30/30 |
| simulation + menu-engineering + costing | 51/51 |
| R4 format helpers | 8/8 |
| **Total** | **171/171** |

(No DB fixtures left behind; no zombie dev servers after the R3 suite.)

## 11. tsc

`npx tsc --noEmit` → clean (0 errors), verified after all edits and after restoring the auto-generated `next-env.d.ts`.

## 12. eslint

`npx eslint src/app/admin/reservations src/components/admin/reservations src/services/reservation.service.ts src/app/admin/layout.tsx` → **0 problems**.

Notes:
- New components/dialogs reset state in event handlers (not effects) and perform only async setState inside effects, satisfying the repo's strict `react-hooks/set-state-in-effect` rule.
- The board's single mount-fetch uses the repo's established fetch-in-effect pattern (customers/tables/orders all trip the same rule today); one **targeted `eslint-disable-next-line`** documents that this matches the admin conventions.

## 13. build

`npm run build` → **Compiled successfully**; `/admin/reservations` listed in the static-page manifest; all 9 reservation API routes still listed; only pre-existing unlink-upload warnings (unrelated).

## 14. Regression Findings

- **No changes** to the reservation service, slot engine, R3 API contracts, Order/payment engines, table status lifecycle, customer auth, promo, WhatsApp, or realtime. The UI only *consumes* R3.
- Table status is never touched by the UI (no OCCUPIED/AVAILABLE/MAINTENANCE set) — reservation and live table/order lifecycles stay separate.
- **Realtime intentionally not implemented** (spec §16) — the board refreshes after mutations and via "Muat Ulang".
- WhatsApp / customer booking UI / order integration intentionally not implemented (R5–R7).
- Pre-existing admin pages still produce the same `react-hooks/set-state-in-effect` lint errors as before R4 (baseline, unchanged).

**VERDICT: PASS**