# PHASE R5 — LAPORAN PERUBAHAN BUSINESS RULE RESERVASI CUSTOMER
## "HANYA RESERVATION YANG MEMBLOCK MEJA"

Tanggal: 6 Oktober 2026
Scope: `src/services/reservation` + test terkait. UI customer (`reservasi/page.tsx`, floor map) TIDAK diubah karena sudah `available`-driven.
Status: Implementasi selesai & terverifikasi. **Belum commit / belum push.**

---

## 1. Root cause perubahan rule

Rule lama menggabungkan **dua sumber** untuk menentukan `available` meja:

1. Kapasitas + reservasi hidup (`remainingCapacity` / `canAccommodate`) — benar.
2. **Status operasional meja** lewat helper `operationalOccupancyBlocked()`:
   - `MAINTENANCE` → memblokir semua tanggal/jam.
   - `OCCUPIED` → memblokir slot same-day yang overlap horizon `[now, now + 120 menit)`.

Akibatnya, `Table.status` — yang sebenarnya milik lifecycle Order (di-set Order engine saat order dibuat dan direset `AVAILABLE` saat COMPLETED/CANCELLED) — dipakai sebagai **blocker reservasi**. Ini membuat meja yang sedang terisi (atau di-flag maintenance) **tidak bisa** direservasi padahal belum ada satu pun Reservation yang conflict. Business rule baru ingin alur sederhana: **hanya Reservation yang memblokir**; status operasional cukup ditampilkan sebagai warna/badge.

Perubahan yang dilakukan: `available` murni dari kapasitas + conflict Reservation. `operationalOccupancyBlocked()` dan konstanta `RESERVATION_OCCUPANCY_BLOCK_MINUTES` sudah **orphan** setelah diputus dari domain reservasi (tidak ada pemakai lain), sehingga dihapus.

---

## 2. Files yang diubah

```
 src/services/reservation/reservation.api.test.ts   |  41 ++-
 src/services/reservation/reservation.service.test.ts | 335 +++++++++++-------
 src/services/reservation/reservation.service.ts    |  81 ++---
 src/services/reservation/reservation.slots.ts      |  63 +---
 src/services/reservation/reservation.unit.test.ts  |  86 +++---
 5 files changed, 323 insertions(+), 283 deletions(-)
```

Rincian:

- **`reservation.slots.ts`**
  - Hapus `operationalOccupancyBlocked()` (orphan → dihapus, bukan dibiarkan mati).
  - Hapus konstanta `RESERVATION_OCCUPANCY_BLOCK_MINUTES` (hanya dipakai helper tsb).
  - Update doc `TABLE_OPERATIONAL_STATUSES` & `resolveSlotTableStatus`: status sekarang **DISPLAY-ONLY**, tidak menentukan `available`.
- **`reservation.service.ts`**
  - Hapus import & seluruh pemakaian `operationalOccupancyBlocked` pada `checkAvailability` (per-table + scan) **dan** pada gate transaksional `createReservation`.
  - `available` = `partySize <= remainingCapacity(capacity, reservasi hidup yang overlap)`.
  - Gate `MAINTENANCE/OCCUPIED` (`TABLE_NOT_AVAILABLE`) dihapus dari `createReservation`.
  - Satu-satunya gate server-side sekarang adalah `canAccommodate()` (reservasi yang overlap), dan kegagalannya melempar `ConflictError("Meja yang dipilih sudah tidak tersedia.", "TABLE_NOT_AVAILABLE")` → 409.
  - Update doc comment availability + alur transaksi.
- **`reservation.service.test.ts`** — test OCCUPIED/MAINTENANCE blocking ditulis ulang ke rule baru (+ test conflict).
- **`reservation.api.test.ts`** — P2 & P15 disesuaikan; P2 kini juga memverifikasi availability = `RESERVED`/`false`.
- **`reservation.unit.test.ts`** — suite `operationalOccupancyBlocked` dihapus, diganti suite `resolveSlotTableStatus` (display-only).

**Tidak diubah** (sesuai constraint): `Table` schema/enum, Order lifecycle, Payment, Cashier, QRIS, WhatsApp, `TableLayout`/`TableLayoutItem`, `reservation.types.ts`, customer page, floor map component/helpers.

---

## 3. Logic availability baru

`checkAvailability()` (dan jalur tulis `createReservation` di bawah `FOR UPDATE`):

```
existing   = Reservation(table, tanggal) dengan status ∈ { PENDING, CONFIRMED, SEATED, COMPLETED }
remaining  = capacity - Σ partySize(existing yang overlap [start, start+duration))
available  = partySize <= remaining
status     = resolveSlotTableStatus({ tableStatus, hasOverlappingReservation })
```

- `CANCELLED` / `NO_SHOW` **tidak** memblokir (tidak di-eager).
- Overlap tetap **half-open** (reservasi 10:00–11:30 vs customer 12:00–13:00 → tidak conflict; 10:30–12:00 → conflict).
- `Table.status` (`OCCUPIED`/`MAINTENANCE`) **tidak** lagi masuk perhitungan `available`.
- DTO tetap: `{ tableId, number, name, capacity, remainingSeats, available, status }` (tidak ada field baru/breaking).
- `available` dan `status` bisa kombinasinya: `status=OCCUPIED, available=true` (valid); `status=OCCUPIED, available=false` hanya bila ada conflict reservasi / kapasitas kurang.
- Karena mesin kapasitas bersifat **parsial**, `status=RESERVED` bisa tetap `available=true` bila sisa kapasitas masih cukup (mis. kapasitas 6, terisi reservasi 2). Ini perilaku engine yang sudah ada dan dipertahankan (lihat test P12).

Race server-side tetap ditangani: `createReservation` mengunci baris branch + table, menghitung ulang reservasi overlap, dan melempar `TABLE_NOT_AVAILABLE` (409) bila slot baru saja diambil customer lain.

---

## 4. Status visual

Status visual dipertahankan apa adanya (tidak ada perubahan warna/badge/legenda):

| Status      | Badge     | Warna  | Sumber                                  |
|-------------|-----------|--------|-----------------------------------------|
| AVAILABLE   | Tersedia  | hijau  | tidak ada order & tidak ada conflict    |
| OCCUPIED    | Terisi    | merah  | `Table.status = OCCUPIED` (Order engine)|
| RESERVED    | Dipesan   | kuning | ada Reservation hidup yang overlap      |
| MAINTENANCE | Maintenance | abu  | `Table.status = MAINTENANCE`            |

Aturan selectable (map & list) tetap **hanya** `available`:
- OCCUPIED → merah "Terisi" tetapi **`disabled=false`** bila tidak ada conflict.
- RESERVED + kapasitas habis → kuning "Dipesan" dan **`disabled=true`**.
- AVAILABLE → hijau "Tersedia" dan selectable.
- MAINTENANCE → tetap tampil sebagai badge visual, tetapi tidak lagi memblokir (selectable bila tanpa conflict).

Precedence `resolveSlotTableStatus` tetap: `MAINTENANCE` → `OCCUPIED` → `RESERVED` → `AVAILABLE`. Jadi meja yang sekaligus OCCUPIED dan punya conflict reservasi ditampilkan "Terisi" namun tetap `disabled=true` (status hanya visual; `available` yang mengatur selectable). Floor map tetap merender **union** layout + availability (semua meja aktif terlihat, `hasLayout:false` masuk fallback), geometry murni dari `TableLayoutItem`.

---

## 5. Test result

Semua dijalankan dengan `npx tsx --test --test-force-exit <file>` terhadap DB lokal.

| Suite | Hasil |
|---|---|
| `reservation.unit.test.ts` | **44 pass / 0 fail** |
| `reservation.service.test.ts` | **47 pass / 0 fail** |
| `reservation.customer.test.ts` | **17 pass / 0 fail** |
| `reservation.api.test.ts` (real dev server) | **31 pass / 0 fail** |
| `reservation.customer-api.test.ts` | **12 pass / 0 fail** |
| `reservation-whatsapp.unit.test.ts` | **10 pass / 0 fail** |
| `reservation-floor-map.test.ts` | **23 pass / 0 fail** |

Quality gates:
- `npx tsc --noEmit` → exit **0**
- `npm run build` → exit **0**
- `git diff --check` → exit **0**
- `npx eslint <5 file berubah>` → exit **0** (tanpa warning baru)

### Test yang berubah (dan alasannya)

Test diubah **karena business rule-nya memang berubah**, bukan agar pass:

- **`reservation.unit.test.ts`**: suite `operationalOccupancyBlocked` dihapus karena helper-nya dihapus (orphan). Diganti suite `resolveSlotTableStatus` yang memverifikasi status tetap tren: MAINTENANCE > OCCUPIED > RESERVED > AVAILABLE, dan hanya display.
- **`reservation.service.test.ts`** — 5 test lama diganti 7 test baru:
  - NEW 1: OCCUPIED + tanpa conflict → `available=true` (status tetap OCCUPIED) & create sukses. *(sebelumnya: OCCUPIED future date available true; kini juga same-day)*
  - NEW 2: AVAILABLE + tanpa conflict → `available=true`.
  - NEW 3: OCCUPIED + **conflict reservasi** → `available=false`, status OCCUPIED; slot yang hanya menyentuh (20:00) kembali tersedia; create → 409 `TABLE_NOT_AVAILABLE`. *(sebelumnya test "OCCUPIED memblokir horizon" — kini diblokir oleh reservasi, bukan status)*
  - NEW 4: MAINTENANCE + tanpa conflict → `available=true` (status tetap MAINTENANCE) & create sukses. *(sebelumnya MAINTENANCE selalu unavailable + 409)*
  - NEW 5: MAINTENANCE + conflict reservasi → `available=false` (alasan = reservasi).
  - NEW 6: RESERVED menggerakkan availability — slot conflict kapasitas habis → `false`/`RESERVED` + create 409; slot non-overlap & hari lain → `true`/`AVAILABLE`.
  - NEW 7: scan mengembalikan **semua** meja aktif (OCCUPIED/MAINTENANCE ikut tampil); tabel conflict tetap tampil tetapi `available=false`/`RESERVED`.
- **`reservation.api.test.ts`**:
  - **P2**: kedua booking pada meja kapasitas-2 penuh kini 409 `TABLE_NOT_AVAILABLE` (sebelumnya `CONFLICT`) — ini memang perilaku baru: conflict reservasi = `TABLE_NOT_AVAILABLE`. Ditambah probe availability → `available=false`, `status=RESERVED`.
  - **P15**: dibalik dari "MAINTENANCE → 409" menjadi "MAINTENANCE **tidak lagi** memblokir" (availability `available=true` + status `MAINTENANCE`, POST 201). Komentar fixture `tMaint` disesuaikan.

---

## 6. Browser verification

Dev server `next dev -p 3100` (Chrome `/usr/bin/google-chrome` via `puppeteer-core`). Skenario: cabang **MAIN**, tanggal **2026-10-09**, party 2, slot **11:00**. Data sementara: 1 Reservation pada Meja 2 (kapasitas 4, party 4) → menjadikannya RESERVED.

Hasil (10 meja, semua terlihat):

| Meja | Status  | Selectable | DOM |
|------|---------|-----------|-----|
| 1    | Terisi  | **ya**    | `button` |
| 2    | Dipesan | **tidak** | `div[aria-disabled=true]` |
| 3,4,7,8 | Terisi | **ya** | `button` |
| 5,6,9,10 | Tersedia | **ya** | `button` |

- Legenda tampil: Tersedia / Terisi / Dipesan / Maintenance / Dipilih.
- **List** juga menampilkan 10 meja; Meja 2 disabled ("Dipesan"), sisanya `[Pilih]`.
- **Geometry identik 100%** dengan Admin/Kasir (`GET /api/public/branches/MAIN/layout`): #1 `x=39.9 y=30.7 w=68.3 h=45.4 rot=0`; #2 `174.1/18.6 110×70`; #3 `300/20`; #4 `440/20`; #5 `580/20`; #6 `720/20`; #7–#10 baris kedua `130` dst.
- API langsung (`checkAvailability` scan) mengonfirmasi: `OCCUPIED → available=true`, `#2 RESERVED → available=false rem=0`, `AVAILABLE → available=true`.
- Bukti tambahan: meja default yang terpilih otomatis adalah **Meja 1 (OCCUPIED)** — membuktikan OCCUPIED selectable.

**Cleanup:** Reservation sementara dihapus (`deleted: 1, leftTestRows: 0`); `scratch.ts`/`scratch-browser.cjs` dihapus; dev server 3100 dimatikan; `next-env.d.ts` direvert. Working tree hanya 5 file berubah.

---

## 7. Migration impact

- **Tidak ada migrasi Prisma/schema.** Tidak ada enum/kolom baru; `Table.status`, `Reservation.status`, dst. tidak berubah.
- **Tidak ada perubahan data.** Tidak ada backfill. Reservasi lama dengan status holding tetap berlaku sama.
- **Kompatibilitas API:** DTO availability tidak berubah bentuk; hanya **nilai** `available` yang berubah (OCCUPIED/MAINTENANCE tanpa conflict kini `true`). Field `status` dipertahankan untuk UI.
- **Kode error:** conflict reservasi/kapasitas pada create kini konsisten `TABLE_NOT_AVAILABLE` (409). `ConflictError` tetap; konsumen yang mengecek generik `409` tidak terpengaruh, yang mengecek string `"CONFLICT"` pada kasus ini perlu tahu (test P2 diperbarui).

---

## 8. Regression risk

| Risiko | Level | Mitigasi / catatan |
|---|---|---|
| Meja OCCUPIED/MAINTENANCE kini bisa direservasi padahal sedang dipakai | Sedang (by design) | Ini business rule yang diminta. Order engine tidak diubah; status tetap ditampilkan. |
| `status=RESERVED` tetapi `available=true` (kapasitas parsial) membingungkan | Rendah | Perilaku lama engine dipertahankan (P12). `disabled` mengikuti `available`, bukan status. |
| Konsumen lama yang mengandalkan status sebagai blocker | Rendah | Blocker satu-satunya kini reservasi; sudah diverifikasi di seluruh test reservasi. |
| Race double-booking setelah rule baru | Rendah | Gate `canAccommodate` + branch/table `FOR UPDATE` tetap jalan; diuji A16 & test concurrency. |
| Helper `operationalOccupancyBlocked` dihapus | Rendah | Diverifikasi orphan (hanya dipakai reservasi + test-nya). Tidak ada domain lain. |
| `TableLayout`/geometry berubah | Tidak ada | Geometry tetap dari `TableLayoutItem`; diverifikasi sama dengan Admin/Kasir. |
| WhatsApp / Cashier / Order / Payment | Tidak tersentuh | Tidak ada perubahan file terkait. |

**Target akhir tercapai:**
- SEMUA MEJA = TERLIHAT ✅
- OCCUPIED = TETAP BISA DIPILIH ✅
- AVAILABLE = BISA DIPILIH ✅
- RESERVED CONFLICT = TIDAK BISA DIPILIH ✅
- HANYA RESERVATION YANG MEMBLOCK MEJA ✅
