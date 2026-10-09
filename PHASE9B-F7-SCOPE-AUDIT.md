# PHASE 9B-F7 — SCOPE CONFIRMATION & AUDIT

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (tidak berubah):** `d7f29ac` (`d7f29acecd0432c13a3d0d731f0869e72b9a1aef`)
**Jenis:** AUDIT ONLY — tanpa perubahan source/schema/migration/seed/data; tanpa commit/push/deploy; tanpa akses VPS/production.
**Tanggal:** 2026-10-09
**Sumber:** `PHASE9B-F2-F8-AUDIT.md` (definisi F7), `PHASE9B-F2-FIX-REPORT.md`,
`PHASE9B-F4-REVENUE-CONSOLIDATION-REPORT.md`, `PHASE9B-F5-CUSTOMER-REVENUE-ALIGNMENT-REPORT.md`,
`PHASE9B-F3-FIX-REPORT.md`, `PHASE9B-F6-SCOPE-AUDIT.md`, serta code saat ini.

---

## 1. Original finding dan acceptance criteria (verbatim scope)

Dari `PHASE9B-F2-F8-AUDIT.md` §F7:

- **Judul:** Reservation revenue uses a different date basis than the reservation business date.
- **Severity:** INFO (documented design).
- **Status (audit):** CONFIRMED (intentional; NEEDS POLICY DECISION hanya bila bisnis menginginkan
  booking-period revenue yang sejajar dengan business date).
- **Root cause:** Report reservasi di-scope oleh `Reservation.reservationDate` (business day yang direservasi),
  tetapi revenue-nya diatribusikan ke `Order.createdAt` milik order terkait dan ke `Refund.approvedAt`
  (basis kanonik), yang dapat jatuh pada periode kalender berbeda — reservasi yang dipesan hari ini untuk
  minggu depan menyumbang **count** reservasi ke report minggu depan, tetapi revenue-nya ke report hari ini.
- **Exact file / query:** `src/services/report/report.service.ts`:
  - `resolveReservationDateRange` → `baseWhere.reservationDate` (scope report).
  - `getReservationReport` revenue call → `computeRefundRevenue({ start: range.start, end: range.end })`,
    yang membatasi order half dengan `o.createdAt` dan refund half dengan `r.approvedAt`.
- **Evidence (audit):** inspeksi code; satu-satunya reservasi tidak punya order terkait, sehingga tidak ada
  kasus cross-period yang dapat diamati. Export mengekspos `createdAt` dan basis didokumentasikan di komentar code.
- **Impact aktual:** total revenue per periode report mungkin tidak sama dengan penjumlahan revenue dari
  “reservasi yang `reservationDate`-nya di periode tersebut”; ini **deliberate canonical-consistency**, dan
  identik dengan bagaimana semua report lain mengatribusikan revenue berdasarkan tanggal order/refund.
- **Rekomendasi minimal (verbatim):** “Keep the canonical basis (do not diverge). Ensure the UI label states
  ‘reservation revenue is attributed by order/payment date’ so users do not expect business-date alignment.
  Alternative (policy): a second, clearly-labelled ‘booked-in-period’ revenue view — not recommended in this
  phase.”
- **Tenant:** None. **Branch:** None. **Migration:** None. **Regression risk:** LOW.

**Acceptance criteria (sesuai framing audit):** pertahankan basis kanonik (jangan divergen) **dan** pastikan
label/penjelasan UI menyatakan bahwa revenue reservasi diatribusikan berdasarkan tanggal order/pembayaran —
atau (kebijakan) sediakan view terpisah “booked-in-period” yang dilabeli jelas (tidak direkomendasikan).

---

## 2. Bukti kondisi implementasi saat ini

**Service — `src/services/report/report.service.ts`:**
- `resolveReservationDateRange` (line 479) → `baseWhere.reservationDate` (line 3057) sebagai scope report:
  tetap **business date** (`Reservation.reservationDate`).
- Revenue reservasi (`getReservationReport`, line ~3190) masih memanggil:
  ```ts
  computeRefundRevenue({
    restaurantId,
    start: range.start,
    end: range.end,
    branchFilters,
    extraOrderFilter: Prisma.sql`AND o.`id` IN (${Prisma.join(orderIds)})`,
  })
  ```
  → order half dibatasi `o.createdAt` dan refund half dibatasi `r.approvedAt` (basis kanonik). **Tidak berubah.**
- Komentar code sudah mendokumentasikan basis ini (line 3034–3036):
  “Date semantics: scoped by Reservation.reservationDate (business date). Reservation revenue is attributed
  by Order.createdAt / refund approvedAt (canonical basis). createdAt is exposed separately as the booking date.”

**API/UI consumer:**
- `GET /api/reports/reservations` → `ReservationReport.summary.reservationRevenue / reservationRefund /
  reservationNetRevenue`, `range.start/end`, `byDate` (per `reservationDate`).
- UI `src/app/admin/reports/reservations/page.tsx`: kartu “Revenue Reservasi” (165), “Refund Reservasi” (166),
  “Net Revenue” (167, hint “Setelah dampak refund”). **Tidak ada** hint/label yang menyatakan basis atribusi
  tanggal order/pembayaran. Baris “Tanggal reservasi: …” hanya menampilkan rentang `reservationDate`.
- Tidak ada view “booked-in-period” / “booking-period” di code (`grep` → tidak ditemukan).

**Catatan relevan (efek F2/F4 pada konsistensi internal):** export reservasi (F2) dan revenue report (F4)
kini memakai basis kanonik yang sama (`o.createdAt` untuk product, `r.approvedAt` untuk refund; komentar line
3430–3431). Jadi ketidakkonsistenan report↔CSV yang dulu ada sudah hilang; yang tersisa hanyalah temuan inti F7
(basis business-date vs order-date), yang memang by-design.

---

## 3. Status dan alasan

**Status: OUTSTANDING** (documented design; sengaja dipertahankan, belum ada label UI).

- **Bukan FIXED:** basis revenue tetap `Order.createdAt`/`Refund.approvedAt`, dan acceptance criteria
  “UI label menyatakan basis order/payment date” **belum dipenuhi** (tidak ada hint di UI).
- **Bukan PARTIALLY FIXED terhadap F7 sendiri:** tidak ada bagian formula/basis F7 yang diubah. F2/F4 hanya
  menyelaraskan **export** ke basis kanonik yang sama (menghapus ketidakcocokan report↔CSV), bukan mengubah
  temuan inti.
- **Bukan OBSOLETE:** F2 (export scope), F3 (identity list customer), F4 (refactor SQL kanonik + predicate
  funnel `paid`), F5 (refund half `computeCustomerRevenue`), F6 (no-show timestamp) **tidak ada** yang mengubah
  basis tanggal revenue reservasi. Komentar line 3034–3036 dan pemanggilan `computeRefundRevenue` line 3190
  masih berlaku.
- **Sifat temuan:** INFO/by-design, dan audit asli memang merekomendasikan **jangan divergen** dari basis
  kanonik. Jadi ini bukan bug; yang tersisa hanya penyelarasan ekspektasi pengguna (label UI) atau keputusan
  kebijakan untuk view terpisah.

---

## 4. Minimal implementation plan (jika diperlukan)

**Tidak ada perubahan formula/query yang direkomendasikan.** Jika ingin menutup acceptance criteria:

- **Opsi C — paling kecil & aman (direkomendasikan):** tambahkan hint/label di UI reservations report yang
  menyatakan basis atribusi revenue, mis.
  - hint kartu “Revenue Reservasi”/“Net Revenue”: “Diatribusikan berdasarkan tanggal order/pembayaran”, atau
  - satu baris catatan di bawah ringkasan.
  - File yang berubah: **hanya** `src/app/admin/reports/reservations/page.tsx` (copy/label). Tanpa perubahan
    query, API, schema, atau angka.
- **Opsi A — kebijakan (tidak direkomendasikan fase ini):** tambahkan view/kolom kedua “booked-in-period”
  (revenue sejajar business date). Ini menambah query/metrik baru dan berpotensi membingungkan; butuh
  keputusan produk dan tidak minimal.
- **Opsi B — dokumentasi internal saja:** cukup andalkan komentar code (sudah ada) + dokumen ini. Tidak
  menyentuh UI, sehingga pengguna masih bisa salah mengira revenue sejajar business date.

---

## 5. Tenant / branch / date / finance / regression risks

- **Tenant:** tidak ada — semua query `restaurantId`-scoped; F7 tidak mengubah apa pun.
- **Branch:** tidak ada — revenue memakai `branchFilters` dari `computeRefundRevenue`; basis branch kanonik
  (F2/F4) tidak berubah.
- **Date:** ini inti F7. Scope report = `Reservation.reservationDate`; atribusi revenue = `Order.createdAt` +
  `Refund.approvedAt`. Konsekuensinya total revenue tidak selalu sama dengan jumlah revenue reservasi ber-
  `reservationDate` di periode. Tidak ada perubahan; tetap by-design.
- **Finance:** tidak ada perubahan formula/rounding; `computeRefundRevenue` tetap kanonik dan tidak disentuh.
- **Regression risk:** **LOW** untuk Opsi C (hanya copy UI). Opsi A berisiko lebih tinggi (metrik baru +
  kemungkinan kebingungan) dan **tidak** direkomendasikan pada fase ini.

---

## 6. Verdict: PASS / WARN / BLOCKER

| Item | Verdict | Alasan |
|---|---|---|
| Status F7 | **WARN** (OUTSTANDING, by-design) | Temuan desain yang dipahami; tidak ada bug finansial. Acceptance criteria (label UI basis order/payment date) belum dipenuhi. |
| Redundansi setelah F2–F6 | **PASS (tidak ada)** | F2/F4 hanya menyelaraskan export ke basis kanonik yang sama (report↔CSV kini konsisten); basis tanggal F7 tidak berubah. F3/F5/F6 orthogonal. |
| Tenant/branch/finance safety | **PASS** | Scope tenant/branch tidak berubah; tidak ada perubahan formula revenue/refund. |

**Kesimpulan:** Tidak ada BLOCKER. F7 tetap **OUTSTANDING** sebagai keputusan desain yang intentional; langkah
berikutnya yang paling kecil dan aman adalah **label UI** (Opsi C), tanpa perubahan query atau schema. Temuan
ini **tidak boleh** ditutup dengan mengubah basis kanonik ke business date tanpa persetujuan kebijakan.

---

## 7. Integrity statement

- **Perubahan yang dilakukan:** tidak ada. Tidak ada file di `src/`, `prisma/`, migration, seed, atau data yang
  diubah/dihapus. Tidak ada test framework baru dibuat.
- **Status migration/database:** tidak ada migration baru; tidak ada reset database; tidak ada data historis
  yang disentuh. `git diff -- prisma/` = **kosong**.
- **HEAD Git:** `d7f29ac` (tidak berubah). Tidak ada commit/push/deploy/VPS.
- Semua uncommitted work (F1, PHASE 9B, F2, F3, F4, F5) tetap utuh.
