# PHASE R5.1 — FINAL VERIFICATION REPORT
## CUSTOMER RESERVATION: STATUS & AVAILABILITY HANYA DARI RESERVASI (BINARY)

Tanggal: 6 Oktober 2026
Keputusan yang diimplementasikan: **A — Binary Reservation Availability** + create gate diselaraskan + admin route ikut berubah.
Status: Selesai & terverifikasi. **Belum commit / belum push.**

---

## 1. Business rule yang diimplementasikan

Untuk CUSTOMER RESERVATION, satu-satunya penentu adalah **ada/tidaknya Reservation aktif yang overlap**:

```
hasOverlappingActiveReservation = existing(HOLDING).some(r => overlaps(r, slot))
available = !hasOverlappingActiveReservation
status    = hasOverlappingActiveReservation ? "RESERVED" : "AVAILABLE"
```

- HOLDING (memblokir): `PENDING`, `CONFIRMED`, `SEATED`, `COMPLETED`.
- Releasing (tidak memblokir): `CANCELLED`, `NO_SHOW`.
- Overlap memakai **half-open interval** existing (`overlaps`), TIDAK diubah.
- `Table.status` (OCCUPIED/MAINTENANCE), order aktif, dan operational occupancy **tidak pernah** dikonsultasi.
- **Capacity sharing / partial overlap DILARANG**: kapasitas 6 + reservasi 2 + baru 2 yang overlap → tetap `available=false` dan create ditolak `409 TABLE_NOT_AVAILABLE`.

Rasio fitur: `{ tableId, number, name, capacity, remainingSeats, available, status }` — bentuk DTO tidak berubah; `remainingSeats` dipertahankan (back-compat) tetapi **tidak lagi** menentukan `available`.

---

## 2. Files yang diubah

```
 src/app/(customer)/reservasi/page.tsx              |  12 +--
 .../reservation/reservation-floor-map.helpers.ts   |  18 ++--
 .../customer/reservation/reservation-floor-map.tsx |  27 ++---
 src/services/reservation/reservation.api.test.ts   |  27 +++--
 .../reservation/reservation.service.test.ts        |  91 +++++++++-------
 src/services/reservation/reservation.service.ts    | 117 ++++++++++-----------
 src/services/reservation/reservation.slots.ts      |  45 +++-----
 src/services/reservation/reservation.unit.test.ts  |  49 ++-------
 8 files changed, 169 insertions(+), 217 deletions(-)
```

- **`reservation.slots.ts`** — `TABLE_OPERATIONAL_STATUSES`/`TableOperationalStatus` (4 nilai) diganti `RESERVATION_TABLE_STATUSES`/`ReservationTableStatus` (`AVAILABLE|RESERVED`); `resolveSlotTableStatus({ hasOverlappingReservation })` tidak lagi menerima `tableStatus`.
- **`reservation.service.ts`** — `checkAvailability` (per-table & scan): `available = !hasOverlap`, `status` dari overlap; `table.status` dihapus dari `select`; gate `createReservation` ganti `canAccommodate()` → tolak **setiap** overlap (`TABLE_NOT_AVAILABLE`); import `canAccommodate` dilepas; doc comment diperbarui.
- **`reservasi/page.tsx`** — `TABLE_STATUS_LABEL/BADGE` → hanya `Tersedia`/`Dipesan`.
- **`reservation-floor-map.helpers.ts`** — `FloorMapStatus = "AVAILABLE" | "RESERVED"`; `normalizeStatus` hanya mengenal RESERVED.
- **`reservation-floor-map.tsx`** — `STATUS_STYLES` → 2 entri; legenda → Tersedia/Dipesan/Dipilih; figcaption disesuaikan.
- **Tests** — `reservation.unit.test.ts`, `reservation.service.test.ts`, `reservation.api.test.ts`.

**Tidak diubah:** `Table.status` (schema & lifecycle), Order engine, Payment, Cashier, QRIS, WhatsApp, `TableLayout`/`TableLayoutItem`, `reservation.types.ts`, route, `remainingCapacity` (masih dipakai untuk `remainingSeats`). Tidak ada migration.

---

## 3. Logic availability baru (ringkas)

| Kondisi | `available` | `status` | UI |
|---|---|---|---|
| Tidak ada overlap | `true` | `AVAILABLE` | Tersedia, selectable |
| Ada overlap (kapasitas sisa apa pun) | `false` | `RESERVED` | Dipesan, disabled |

Create path (transaksional, di bawah `SELECT … FOR UPDATE`):
```
BEGIN
  branch FOR UPDATE                      (serialize per cabang)
  validate window / customer
  table FOR UPDATE                       (tenant/branch/active/capacity)
  reject if ANY live reservation overlaps the slot → ConflictError TABLE_NOT_AVAILABLE (409)
  duplicate booking check
  INSERT
COMMIT
```
Lock order & proteksi race dipertahankan.

---

## 4. UI customer

- Hanya **2 status**: `AVAILABLE → "Tersedia"` (hijau, selectable) dan `RESERVED → "Dipesan"` (kuning, disabled).
- **"Terisi" dan "Maintenance" dihapus** dari surface reservasi customer (badge list, `STATUS_STYLES`, legenda).
- Floor map tetap menampilkan **semua meja aktif**, geometry tetap dari `TableLayoutItem` (union layout + availability, fallback `hasLayout:false`).
- Admin/Cashier memakai `Table.status` dari `GET /tables` secara terpisah — **tidak berubah**.

---

## 5. Test result

Semua dijalankan `npx tsx --test --test-force-exit <file>` (api test dengan `timeout 540`).

| Suite | Hasil |
|---|---|
| `reservation.unit.test.ts` | **43 pass / 0 fail** |
| `reservation.service.test.ts` | **47 pass / 0 fail** |
| `reservation.customer.test.ts` | **17 pass / 0 fail** |
| `reservation.api.test.ts` (real dev server) | **31 pass / 0 fail** |
| `reservation.customer-api.test.ts` | **12 pass / 0 fail** |
| `reservation-whatsapp.unit.test.ts` | **10 pass / 0 fail** |
| `reservation-floor-map.test.ts` | **23 pass / 0 fail** |

Quality gates: `npx tsc --noEmit` = 0 · `npm run build` = 0 · `git diff --check` = 0 · `npx eslint` (9 file berubah) = 0.

### Cakupan skenario yang diminta
- OCCUPIED + no reservation → AVAILABLE ✅ (NEW 1, NEW 7)
- MAINTENANCE + no reservation → AVAILABLE ✅ (NEW 4, NEW 7)
- AVAILABLE + no reservation → AVAILABLE ✅ (NEW 2)
- OCCUPIED + overlap → RESERVED ✅ (NEW 3)
- MAINTENANCE + overlap → RESERVED ✅ (NEW 5)
- AVAILABLE + overlap → RESERVED ✅ (NEW 6, P12)
- partial-capacity overlap → RESERVED/unavailable ✅ (half-open test: remainingSeats 2 tapi available=false)
- non-overlap → AVAILABLE ✅ (half-open test, NEW 6)
- CANCELLED tidak block ✅ (test 8) · NO_SHOW tidak block ✅ (test 9)
- double-booking race → 409 ✅ (concurrency; A16 HTTP)
- semua meja tetap muncul ✅ (NEW 7; floor-map test)
- Admin/Cashier behavior tidak berubah ✅ (tidak menyentuh `cashier-table-map.*`, `admin/tables`, order)
- tenant isolation ✅ (A3/A5-A10, service isolation)

### Test yang berubah (karena rule berubah, bukan demi pass)
- `unit.test.ts`: suite `resolveSlotTableStatus` → 2 nilai (dari 3 test jadi 2 test).
- `service.test.ts`:
  - test half-open: `during` (19:00 overlap 18:00–20:00) kini `available=false`/`RESERVED` (remainingSeats tetap 2).
  - test 7 & 7b: dari "capacity sharing boleh" → "overlap apa pun ditolak"; kontrol diganti ke slot non-overlap (20:00).
  - NEW 1/3/4/5 status: `OCCUPIED`/`MAINTENANCE` → `AVAILABLE`/`RESERVED`.
  - NEW 7: status OCCUPIED/MAINTENANCE → AVAILABLE (status reservation-only).
  - test admin list: booking kedua (Bob Board) dipindah ke 20:00 agar tidak overlap (test ini menguji paginasi, bukan kapasitas).
- `api.test.ts`: P12 `available=true` → `false` (+ tetap RESERVED); P15 status `MAINTENANCE` → `AVAILABLE`; P9 & A15 booking dipindah ke slot non-overlap (20:00) agar dibuat sukses.

---

## 6. Browser verification

Dev server `next dev -p 3100`, Chrome `/usr/bin/google-chrome` (puppeteer-core). Cabang **MAIN**, tanggal **2026-10-09**, party 2, slot **11:00**. Data sementara: 1 Reservation pada Meja 2 (cap 4, party 2 → partial) + Meja 10 diset MAINTENANCE sementara.

| Meja | `Table.status` | Reservation overlap | Hasil UI | Selectable |
|---|---|---|---|---|
| 1, 3, 4, 7, 8 | OCCUPIED | tidak | **Tersedia** | ya (`button`) |
| 10 | MAINTENANCE | tidak | **Tersedia** | ya (`button`) |
| 5, 6, 9 | AVAILABLE | tidak | **Tersedia** | ya (`button`) |
| 2 | AVAILABLE | ya (partial) | **Dipesan** | tidak (`div[aria-disabled=true]`) |

- 10 meja tetap terlihat di map & list.
- Legenda hanya: **Tersedia · Dipesan · Dipilih** (tidak ada Terisi/Maintenance).
- List: hanya Meja 2 yang disabled; sisanya `[Pilih]`/`[Dipilih]`.
- API langsung (`checkAvailability` scan) mengonfirmasi: `#2 RESERVED/false`, semua lainnya AVAILABLE/true (termasuk OCCUPIED & MAINTENANCE).
- **Geometry identik 100%** dengan `GET /api/public/branches/MAIN/layout`: #1 `39.9/30.7 68.3×45.4`, #2 `174.1/18.6 110×70`, #3 `300/20`, #4 `440/20`, #5 `580/20`, #6 `720/20`, #7–#10 baris `130`.

**Cleanup:** reservation sementara dihapus (`deleted 1, leftTestRows 0`); status Meja 10 dikembalikan ke `AVAILABLE`; state DB diverifikasi kembali ke awal (`1:OCCUPIED 2:AVAILABLE 3:OCCUPIED 4:OCCUPIED 5:AVAILABLE 6:AVAILABLE 7:OCCUPIED 8:OCCUPIED 9:AVAILABLE 10:AVAILABLE`, 0 reservation, 0 temp row); scratch dihapus; dev server 3100 dimatikan; `next-env.d.ts` bersih.

---

## 7. Database & API impact

- **Database:** nihil — tidak ada perubahan schema/enum/kolom, tidak ada migration, tidak ada backfill, tidak ada data yang ditinggalkan.
- **API:** bentuk DTO sama. Nilai berubah: `status` ⊆ `{AVAILABLE, RESERVED}`; `available` biner (overlap ⇒ false). Berlaku untuk `GET /api/public/reservations/availability` **dan** `GET /api/admin/reservations/availability` (memakai `checkAvailability` yang sama; belum ada UI admin yang memakainya).
- Error create tetap `409 TABLE_NOT_AVAILABLE` (kini dipicu oleh overlap, bukan kapasitas/status).

---

## 8. Regression risk

| Risiko | Level | Mitigasi |
|---|---|---|
| Berbagi meja per-kapasitas hilang (by design) | Sedang | Keputusan A disetujui; admin create ikut biner karena kernel sama |
| Admin availability semantics ikut berubah | Rendah | Keputusan disetujui; belum ada konsumen UI |
| `remainingSeats` tak lagi menentukan | Rendah | Field dipertahankan untuk back-compat/display |
| Race double-booking | Rendah | `FOR UPDATE` + recheck overlap di dalam transaksi (diuji A16 & concurrency) |
| Admin/Cashier/Order/Payment/QRIS/WhatsApp | Nihil | Tidak disentuh |

Target tercapai: **semua meja terlihat · OCCUPIED/MAINTENANCE tanpa conflict = Tersedia & selectable · reservation overlap = Dipesan & disabled · hanya Reservation yang memblokir.**
