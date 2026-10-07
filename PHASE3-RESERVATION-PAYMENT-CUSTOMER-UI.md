# PHASE 3 — RESERVATION QRIS CUSTOMER UI

> Scope: **customer UI only.** Admin UI (Phase 4) dan E2E/regression penuh (Phase 5)
> tidak diimplementasikan. Tidak ada commit/push/deploy, tidak ada migration, tidak ada
> live production payment, tidak ada file WhatsApp/worker/schema/ipaymu/order/rekening
> approval yang disentuh. Backend Phase 2 **tidak diubah**.
> Repo: `/home/reksa/restorant-cafe` · HEAD `5d82cf4`

---

## 1. EXISTING CUSTOMER PAYMENT FLOW (audit)

- Wizard `src/app/(customer)/reservasi/page.tsx` membuat reservasi via `POST /api/public/reservations`,
  lalu pada langkah **success** menampilkan ringkasan + CTA:
  - QRIS → **`/payment/[orderNumber]`** (halaman pembayaran **Order**),
  - KASIR → `/order/[orderNumber]`.
- Halaman `src/app/(customer)/payment/[orderNumber]/page.tsx` (697 baris) adalah pola QRIS existing:
  poll 4s `GET /api/public/payments/[orderNumber]`, `effectivePaymentStatus`, countdown dari `expiresAt`,
  QR dari `qrImage` atau `QrCodeDisplay` (lib `qrcode`), `regenerateQr` → `POST /api/public/payments`,
  `switchToCashier`. **Tidak diubah.**
- Komponen reusable: `src/components/qr-code-display.tsx` (render QR dari string), hooks `useCustomerAuth`.
- Endpoint publik reservasi yang ada: `GET /api/public/reservations/[code]?phone=` (lookup guest; **tanpa**
  order summary), `POST /api/public/reservations` (create; **dengan** order summary), dan (Phase 2)
  `GET|POST /api/public/reservations/[code]/payment` (payment state/QRIS).
- **Ditemukan:** order summary (items/total) tidak tersedia dari lookup guest → perlu snapshot dari create.

---

## 2. CHANGES IMPLEMENTED

1. **Success CTA (QRIS)** diarahkan ke **`/reservasi/[code]/payment`** — bukan `/payment/[orderNumber]`.
   KASIR tetap `/order/[orderNumber]` (flow existing, tidak dipaksa ke QRIS).
2. **Snapshot + ownership context** disimpan ke `sessionStorage` saat reservasi berhasil
   (phone + restaurantId + snapshot reservasi/order), sehingga halaman pembayaran tidak meminta
   nomor dua kali dan langsung punya ringkasan order.
3. **Halaman pembayaran reservasi baru** `/reservasi/[code]/payment` (mobile-first) dengan state machine:
   UNPAID → tombol "Bayar dengan QRIS" (POST); PENDING → QR + amount + ref + countdown + "Refresh Status"
   (GET polling, tanpa POST); PAID → success "Pembayaran Berhasil"/"Reservasi Dikonfirmasi"; FAILED → "Coba Lagi";
   EXPIRED → "Buat QRIS Baru"; CANCELLED → "Reservasi Dibatalkan" (tanpa tombol bayar); REFUNDED → info.
4. **Ownership adaptif:** phone dari sessionStorage → dipakai; jika tidak ada dan customer login → session;
   jika tidak ada keduanya → satu form verifikasi nomor (bukan flow auth baru).
5. **Pure state helpers** diekstrak (testable) + **focused tests**.

---

## 3. FILES MODIFIED

- `src/app/(customer)/reservasi/page.tsx` — success CTA QRIS → `/reservasi/[code]/payment`; simpan
  `saveReservationPaymentContext(code, { phone, restaurantId, details })` saat create sukses.

## 4. FILES CREATED

- `src/app/(customer)/reservasi/[code]/payment/page.tsx` — halaman pembayaran reservasi (customer UI).
- `src/app/(customer)/reservasi/reservation-payment-storage.ts` — helper sessionStorage (ownership context + snapshot).
- `src/app/(customer)/reservasi/reservation-payment-state.ts` — helper murni (`effectivePaymentStatus`,
  `formatCountdown`, `shouldPoll`, `isTerminalPaymentStatus`, `TERMINAL_PAYMENT_STATUSES`).
- `src/app/(customer)/reservasi/reservation-payment-state.test.ts` — 12 focused tests.

**Tidak disentuh:** `src/app/(customer)/payment/[orderNumber]/**`, `.../order/[orderNumber]/**`, `menu`, `cart`,
`checkout`, `src/services/**` (backend Phase 2), `src/services/payment/providers/ipaymu/**`,
`src/services/order/order.service.ts`, `src/services/whatsapp/**`, `src/workers/**`, `prisma/schema.prisma`.

---

## 5. API INTEGRATION

| UI action | Endpoint (existing) |
|---|---|
| Buka halaman / refresh / deep link | `GET /api/public/reservations/[code]?phone=…` (reservation info) |
| Semua state pembayaran | `GET /api/public/reservations/[code]/payment?phone=…[&restaurantId=…]` |
| "Bayar dengan QRIS" / "Coba Lagi" / "Buat QRIS Baru" | `POST /api/public/reservations/[code]/payment` body `{ method:"QRIS", phone?, restaurantId? }` |

Client **tidak** mengirim amount/orderId/paymentId/providerRef/status. `amount` ditampilkan dari respons server
(`payment.amount` / `grandTotal`); `restaurantId` hanya **hint** tenant (bukan security boundary).
QRIS dibuat oleh engine existing `paymentService.createPayment()` di balik endpoint Phase 2.

---

## 6. PAYMENT STATE HANDLING

`effectivePaymentStatus(dto)`: status server authoritative; **PENDING yang melewati `expiresAt` dianggap EXPIRED**
(gateway mungkin tidak mengirim webhook EXPIRED) — sama dengan aturan halaman Order existing.

| State | UI |
|---|---|
| UNPAID (tanpa intent) | "Pembayaran Belum Dibuat" + tombol **Bayar dengan QRIS** (POST) |
| PENDING | QR (`qrImage` → `<img>`; jika tidak ada → `QrCodeDisplay` dari `qrString`), amount, reference, countdown, **Refresh Status** |
| PAID | "Pembayaran Berhasil"; "Reservasi Dikonfirmasi" **hanya bila `reservationStatus === CONFIRMED`** (tidak membuat state konfirmasi sendiri) |
| FAILED | "Pembayaran Gagal" + **Coba Lagi** (POST) |
| EXPIRED | "QRIS Kedaluwarsa" + **Buat QRIS Baru** (POST) |
| CANCELLED (reservation atau payment) | "Reservasi Dibatalkan" — **tanpa** tombol bayar, tanpa POST |
| REFUNDED | info "Pembayaran Dikembalikan" |

---

## 7. QRIS UX

- Prioritas `qrImage` (gambar gateway); fallback `QrCodeDisplay` (lib `qrcode` existing) dari `qrString`;
  jika keduanya tidak ada → placeholder.
- Menampilkan amount (server), reservation code, tanggal/jam/meja, rincian pesanan (bila snapshot tersedia),
  status, reference (non-secret), dan countdown.
- Tidak mengekspos API key/VA/provider secret/internal id.

---

## 8. POLLING BEHAVIOR

- Poll **hanya** saat `shouldPoll(status)` (PENDING), interval 4000 ms (mengikuti pola halaman Order existing).
- Poll memakai **GET** (tidak pernah POST); tidak membuat payment baru saat polling.
- Berhenti otomatis pada status terminal (PAID/EXPIRED/FAILED/CANCELLED/REFUNDED); interval dibersihkan saat unmount.
- Tombol "Refresh Status" memanggil GET manual.

## 9. COUNTDOWN BEHAVIOR

- Berasal **hanya** dari `expiresAt` server (`formatCountdown`), tanpa durasi hardcode.
- Tick 1 detik; saat mencapai 0 → **refresh GET sekali** (`autoRefreshedRef`), **tidak** auto-create payment.
- Customer harus menekan "Buat QRIS Baru" (POST) untuk intent baru.

## 10. GUEST OWNERSHIP

- Wizard menyimpan `phone` (yang sudah dikumpulkan) di `sessionStorage` per code.
- Halaman memakainya sebagai `?phone=` (lookup + payment) — customer **tidak** diminta dua kali.
- Validation tetap **server-side** (`normalizePhone` vs `guestPhone`); salah → 404 generik.
- Tidak ada auth/OTP baru.

## 11. AUTHENTICATED CUSTOMER BEHAVIOR

- `useCustomerAuth` dipakai; jika phone tidak ada di sessionStorage tetapi customer login, halaman tetap
  memuat (session cookie dikirim pada request same-origin → ownership backend terpenuhi).
- Jika keduanya tidak ada → form verifikasi nomor sekali (bukan login flow baru).

## 12. SECURITY

- Frontend **consumer API** murni: tidak mengirim amount/orderId/paymentId, tidak menganggap `grandTotal`
  client authoritative, tidak menentukan PAID/CONFIRMED sendiri (webhook = authority), tidak bypass
  ownership/restaurant scope.
- Error 404 → pesan generik ("Reservasi tidak ditemukan atau Anda tidak memiliki akses.") tanpa membocorkan
  apakah code valid milik orang lain; 429 → "Terlalu banyak permintaan…"; 500 → "Tidak dapat memproses…".
- Tidak mengekspos credential/gateway secret/stack trace/internal id.

## 13. RESPONSIVE VERIFICATION

- Mobile-first: kontainer `max-w-md mx-auto`, baris teks `min-w-0` + `break-words`, kolom kiri `shrink-0`,
  QR lebar tetap 220 px (< 390 px), tombol full-width dalam kontainer.
- Render headless nyata:
  - viewport **390×844** → `PNG 390 x 844` (29.670 B) — halaman merender tanpa crash.
  - viewport **1280×800** → `PNG 1280 x 800` (34.070 B).
- `--dump-dom` deep-link (tanpa sessionStorage) → menampilkan **"Verifikasi Reservasi"** + "Masukkan nomor
  WhatsApp" + "Kembali ke Menu" (state ownership sesuai desain).
- Catatan jujur: verifikasi ini **bukan** audit piksel/overflow terukur via DevTools (tidak ada automation
  piksel); diukur secara struktural + screenshot pada dua viewport target.

## 14. TESTS

`npx tsx --test --test-force-exit src/app/(customer)/reservasi/reservation-payment-state.test.ts` → **12 pass / 0 fail**
(3 suites): UNPAID, PENDING, PAID, EXPIRED (via `expiresAt`), FAILED/CANCELLED/REFUNDED, derive dari
`paymentStatus`, countdown HH:MM:SS dari expiresAt, tidak negatif, null untuk expiry invalid, format jam,
`shouldPoll` hanya PENDING, klasifikasi terminal.

Cakupan daftar Step 15: (1) page load UNPAID ✅, (2) POST create QRIS → backend tested (Phase 2) + tombol wired,
(3) PENDING render QR ✅ (struktur), (4) polling GET ✅ (aturan `shouldPoll`), (5) PAID ✅, (6) EXPIRED ✅,
(7) FAILED ✅, (8) CANCELLED ✅, (9) refresh preserves state — sessionStorage + GET source of truth ✅ (struktur),
(10) guest phone ownership ✅ (backend Phase 2 test + DOM ownership form), (11) authenticated customer ✅ (session reuse),
(12) no amount sent ✅ (body hanya method/phone/restaurantId), (13) no order payment redirect ✅ (CTA diubah),
(14) no horizontal overflow — struktural + screenshot (bukan pengukuran DOM).

## 15. TSC

`npx tsc --noEmit` → **EXIT 0**.
`npx eslint` pada file yang diubah/dibuat → **EXIT 0** (0 error; 1 warning `@next/next/no-img-element` untuk
`<img>` QRIS — pola yang SAMA dengan halaman Order existing).

## 16. GIT DIFF CHECK

`git diff --check` → **EXIT 0**. `0 staged`; HEAD `5d82cf4`. **Tidak commit/push/deploy.**

## 17. KNOWN LIMITATIONS

1. **Order summary pada deep link.** Endpoint lookup guest existing mengembalikan data reservasi **tanpa**
   truck order. Solusi Phase 3: snapshot create disimpan di `sessionStorage` → summary lengkap saat flow normal
   dan saat refresh tab yang sama. Membuka URL di tab/device lain → summary order terbatas (payment tetap benar
   dari endpoint payment). Backend Phase 2 **tidak** diubah (sesuai instruksi).
2. **Verifikasi responsif** berbasis struktural + screenshot, bukan pengukuran overflow DOM otomatis.
3. **KASIR** tetap memakai flow order/kasir existing (sesuai Step 11).
4. Test komponen React penuh tidak dibuat (tidak ada React Testing Library; dilarang menambah infra test baru) —
   yang diuji adalah state machine murni + endpoint backend (Phase 2).

## 18. PHASE 4 PREREQUISITES

- Backend sudah menyediakan `payment` pada `ReservationView` (Phase 2) untuk admin.
- Admin detail existing: **modal** `src/components/admin/reservations/reservation-detail.tsx` (bukan route
  `/admin/reservations/[id]`); perlu blok Pembayaran: status, method, amount, provider, reference, paidAt,
  expiresAt, refund status — read-only, memakai engine existing.
- Client type `ReservationTableView` (`src/services/reservation.service.ts`) perlu ditambah `payment?`.
- Jangan membuat manajemen pembayaran baru; tetap `/api/payments/*`, `/api/refunds/*`, kasir QRIS.
- WhatsApp/worker/schema tetap **tidak** disentuh.

**STOP — Phase 3 selesai. Tidak implement admin UI/Phase 4, tidak commit/push/deploy.**
