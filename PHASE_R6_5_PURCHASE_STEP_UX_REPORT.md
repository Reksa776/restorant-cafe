# PHASE R6.5 — MINIMUM PURCHASE GATE: UX REPAIR (PURCHASE STEP BEFORE GUEST/REVIEW)

Perbaikan **posisi UX** validasi Minimum Purchase pada wizard reservasi customer.
Business rule & validasi backend **TIDAK diubah** — hanya posisi/langkah UX-nya.

Perintah penting yang dipenuhi: purchase requirement **JANGAN** muncul pertama kali
di langkah "Review Reservation".

---

## 1. STEP RESERVATION YANG DIUBAH

| Item | Sebelum | Sesudah |
| --- | --- | --- |
| `type Step` | `branch·date·party·time·table·guest·review·success` | + `purchase` (diantara `table` dan `guest`) |
| `WIZARD_STEPS` | 7 langkah | **8 langkah** (`RESERVATION_WIZARD_STEPS` di `reservation-flow.ts`) |
| `STEP_LABELS` | — | `RESERVATION_STEP_LABELS.purchase = "Pembelian"` |
| `selectTable()` | `setStep("guest")` | **`setStep("purchase")`** |
| BottomBar langkah Meja | `setStep("guest")` | **`setStep("purchase")`** |
| `canGoBack` | tanpa `purchase` | + `purchase` |
| `goBack()` | `switch` hardcoded | `previousWizardStep(step)` dari urutan kanonik |
| Progress header | 7 bar | **8 bar** (`Langkah N dari 8`) |

Urutan final terverifikasi (unit test + browser):

```
Branch → Date → Party → Time → Table → Pembelian → Guest → Review → Submit
```

Bukan lagi:

```
Branch → Date → Party → Time → Table → Guest → Review → PURCHASE_REQUIRED
```

---

## 2. UX FLOW SEBELUM

1. `Meja` dipilih → langsung ke **Data Tamu**.
2. `Data Tamu` → `Review Reservasi`.
3. Customer mengisi semua data, menekan **Konfirmasi Reservasi** (Submit).
4. Baru **setelah submit**, server menjawab `409 PURCHASE_REQUIRED` dan wizard
   menampilkan kartu "Minimal 1 Pembelian Diperlukan" **di dalam langkah Review**
   (state `purchaseBlocked`).

Artinya: requirement baru diketahui **paling akhir**, setelah seluruh effort
mengisi form — persis yang harus dihindari.

---

## 3. UX FLOW SESUDAH

1. `Meja` dipilih → langsung ke langkah **Pembelian** (step khusus).
2. Langkah **Pembelian** menampilkan status lebih awal:
   - **Punya pembelian** → kartu hijau **"✓ Pembelian ditemukan"** +
     *"Anda memenuhi syarat untuk melakukan reservasi."* + tombol
     **[ Lanjutkan Reservasi ]** (aktif).
   - **Belum punya** → kartu amber **"Pembelian Diperlukan"** +
     *"Reservasi hanya tersedia setelah Anda menyelesaikan minimal 1 pembelian."* +
     CTA **[ Pesan Menu Dulu ]** → flow menu/cart/checkout/payment existing.
     Tombol "Lanjutkan Reservasi" **disabled**.
   - **Guest belum isi nomor** → kartu info "Verifikasi Pembelian" meminta nomor
     WhatsApp yang dipakai saat memesan.
3. `Data Tamu` → `Review Reservasi` → Submit.
4. `Review Reservasi` kini **hanya** menampilkan konfirmasi kecil
   **"✓ Purchase requirement terpenuhi"** (bila terverifikasi) — bukan gate utama.
5. `PURCHASE_REQUIRED` dari server tetap ditangani sebagai *safety net*: bila
   terjadi pada Submit, wizard **kembali ke langkah Pembelian** (bukan menampilkan
   gate di Review).

---

## 4. FILES CHANGED

**Baru**

| File | Isi |
| --- | --- |
| `src/app/api/public/reservations/purchase-eligibility/route.ts` (66 baris) | `GET` read-only prob eligibility pembelian |

**Diubah**

| File | Perubahan |
| --- | --- |
| `src/app/(customer)/reservasi/reservation-flow.ts` (+238) | `ReservationWizardStep`, `RESERVATION_WIZARD_STEPS` (purchase diantara table & guest), `RESERVATION_STEP_LABELS`, `nextWizardStep`, `previousWizardStep`, `PurchaseCheckState`, copy purchase step, `purchaseStepView`, draft `serializeReservationDraft`/`parseReservationDraft` |
| `src/app/(customer)/reservasi/page.tsx` (+427/-91) | Langkah `Pembelian`, navigasi, efek probe eligibility, `handleGoToMenu` + draft restore, penanganan 409 ke langkah Pembelian, catatan kecil di Review |
| `src/services/reservation/reservation.service.ts` (+59/-…) | ekstraksi rule ke `hasQualifyingPurchase` (dipakai gate tulis **dan** probe baca) + `checkPurchaseEligibility` |
| `src/app/(customer)/reservasi/reservation-flow.test.ts` (+162) | +11 test (urutan langkah, purchase step view, draft) |
| `src/services/reservation/reservation.purchase.test.ts` (+89) | +6 test untuk probe read-only |

Tidak ada perubahan schema/migration. Tidak menyentuh Order/Payment/Cashier/QRIS/WhatsApp/TableLayout.

---

## 5. PURCHASE CHECK MECHANISM

**Sumber kebenaran tunggal = server.** Rule minimum purchase diekstrak menjadi satu
helper privat `hasQualifyingPurchase(client, restaurantId, data)` pada
`reservation.service.ts`, dipakai oleh:

1. `assertQualifyingPurchase` (gate **tulis**, di dalam transaksi `createReservation`) — **tetap tidak berubah perilakunya**.
2. `checkPurchaseEligibility` (probe **baca**, UX) — method publik baru.

Rule yang sama persis: `paymentStatus = PAID`, `status != CANCELLED`, `>= 1 OrderItem`,
`restaurantId` sama (branch boleh berbeda).

Endpoint baru:

```
GET /api/public/reservations/purchase-eligibility[?restaurantId=..&phone=..]
→ { success: true, data: { eligible: boolean } }
```

- **Tenant** di-resolve server-side lewat `resolvePublicReservationRestaurant`
  (reuse resolver existing) — `restaurantId` dari client tidak dipercaya.
- **Identitas logged-in**: `customerId` diambil dari **customer session cookie**
  (`tryGetCustomerSessionFromRequest`) di route, lalu diteruskan server-side.
- **Identitas guest**: `phone` dinormalisasi (`normalizePhone`) di service → dicocokkan
  ke `Customer.phone` kanonik — mekanisme ownership guest yang sama dengan gate tulis.
- Client **tidak pernah** mengirim/menentukan `customerId`, `orderId`, `paymentStatus`, `restaurantId`.
- Rate limit 60/menit. Respons hanya boolean (tanpa PII, tanpa id order/customer).

**Backend tetap authoritative:** `POST /api/public/reservations` masih menjalankan
`assertQualifyingPurchase` di dalam transaksinya → masih `409 PURCHASE_REQUIRED`.
Frontend check murni UX; race condition tetap aman (diuji).

**GAP yang tetap dilaporkan (tidak di-workaround):** nomor telepon guest **belum**
OTP-verified. Guest yang tahu nomor orang lain masih bisa memakai pembelian nomor itu.
Tidak ada OTP baru (sesuai instruksi).

---

## 6. RETURN-TO-RESERVATION BEHAVIOR

Arsitektur existing **tidak** memiliki mekanisme return-url/reservation-context
(sudah diaudit: tidak ada `returnTo`/`redirect` di flow menu/order). Karena itu
diimplementasikan **mekanisme MINIMAL** tanpa auth/cart/order baru:

1. Saat **[ Pesan Menu Dulu ]** ditekan, wizard menyimpan snapshot pilihan
   (`branchCode, date, partySize, selectedStart, selectedTableId, guestName, guestPhone, notes`)
   ke `sessionStorage` key `reservation_draft` (helper murni
   `serializeReservationDraft`; **tanpa** field auth/payment), lalu `router.push("/menu")`
   (flow menu/cart/checkout/payment existing).
2. Setelah pembayaran PAID, customer kembali ke `/reservasi` (link "Reservasi" sudah
   ada di header customer — tidak perlu navigasi baru).
3. Saat mount, draft dibaca **one-shot** (`parseReservationDraft` + validasi horizon),
   state dipulihkan, dan wizard langsung mendarat **di langkah Pembelian** untuk
   **memeriksa ulang** (bukan mengasumsikan) → kini "Pembelian ditemukan".
   Draft kadaluarsa/corrupt/JSON rusak → diabaikan (wizard mulai normal).

Terbukti di browser: draft tersimpan (B7), kembali ke `/reservasi` → banner
"Melanjutkan reservasi Anda sebelumnya." + nomor guest terisi (B8, B9).

---

## 7. TESTS

Focused reservation tests (semua dijalankan dengan `--test-force-exit`):

| Suite | Hasil |
| --- | --- |
| `src/app/(customer)/reservasi/reservation-flow.test.ts` | **29 pass / 0 fail** (sebelumnya 18; +11) |
| `src/services/reservation/reservation.purchase.test.ts` | **21 pass / 0 fail** (sebelumnya 15; +6) |
| `src/services/reservation/reservation.service.test.ts` | 47 pass / 0 fail |
| `src/services/reservation/reservation.customer.test.ts` | 17 pass / 0 fail |
| `src/services/reservation/reservation.customer-api.test.ts` | 12 pass / 0 fail |

Cakupan requirement (1–9):

1. **Guest tanpa purchase melihat purchase step** → `nextWizardStep("table") === "purchase"` + browser B1/B3.
2. **Guest tanpa purchase tidak langsung masuk Review** → `nextWizardStep("table") !== "guest"`/`"review"`; tombol "Lanjutkan Reservasi" `disabled` (browser B5, A2).
3. **Guest dengan purchase lolos** → probe eligible true (test 16) + browser A3/A5; submit nyata 201.
4. **Logged-in customer dengan purchase lolos** → test 17; tanpa purchase → false.
5. **CTA "Pesan Menu Dulu" mengarah ke menu flow existing** → `PURCHASE_CTA_HREF === "/menu"` (test) + browser B6 (`/menu`).
6. **Review bukan tempat pertama gate** → urutan `purchase < review` + `purchaseStepView("ineligible")` memegang CTA; browser A2/A7 (Review hanya "✓ Purchase requirement terpenuhi").
7. **Backend PURCHASE_REQUIRED tetap aktif** → test 1/3/5–8/10–12b + smoke HTTP `409 {"error":"PURCHASE_REQUIRED"}`.
8. **Client tidak bisa bypass backend gate** → test 20 (probe "eligible" pun POST tetap 409) + test 12/12b (spoof `customerId/orderId/paymentStatus/restaurantId`).
9. **R5.1 availability tidak berubah** → test 14 (regression, `status` tetap AVAILABLE/RESERVED biner) + 47 test service lama lolos tanpa perubahan.

Verifikasi antarmuka nyata:

- **Browser (Puppeteer, 16/16 PASS)**: 2 skenario guest — dengan purchase (A1–A7) dan
  tanpa purchase (B1–B9), termasuk kembali ke `/reservasi`.
- **HTTP**: `GET .../purchase-eligibility` → `false` (tanpa nomor / nomor tanpa purchase /
  nomor invalid), `true` (nomor hasil seed PAID). `POST /api/public/reservations` →
  **201** (punya purchase) dan **409 PURCHASE_REQUIRED** (tanpa purchase).

---

## 8. TSC

```
npx tsc --noEmit   → exit 0
```

(`prisma` base client diteruskan ke parameter bertipe `Prisma.TransactionClient` pada
helper rule bersama — typecheck lolos tanpa `any`/suppression.)

## 9. BUILD

```
npm run build      → exit 0
git diff --check   → exit 0 (tanpa whitespace error)
npx eslint <6 file diubah> → exit 0 (0 error, 0 warning)
```

Route baru terdaftar di artefak build:
`.next/server/app/api/public/reservations/purchase-eligibility/`.

---

## 10. REGRESSION CHECK

- **Business rule pembelian**: tidak diubah (kondisi query identik; diekstrak, bukan
  dimodifikasi). Gate admin/staff tetap tidak digate.
- **R5.1 (availability)**: tidak disentuh. `available = !hasOverlappingReservation`,
  HOLDING = PENDING/CONFIRMED/SEATED/COMPLETED, `Table.status` & order tetap tidak
  pernah dikonsultasikan; status biner AVAILABLE/RESERVED. Test 14 lolos + 47 test
  service tanpa perubahan.
- **Order/Payment/Cashier/QRIS/WhatsApp/TableLayout**: tidak ada file yang disentuh.
- **Guest tanpa login**: tetap boleh reservasi; tidak ada redirect login, tidak ada OTP,
  tidak ada "Login untuk melanjutkan".
- **Reservasi QR (R6)** dan **Audit Log Viewer**: tidak berubah.
- **Data dev dibersihkan**: 0 leftover QA order/product/category/customer/reservation;
  scratch files dihapus; dev server dihentikan; `next-env.d.ts` direvert.
- **Tidak ada commit/push** (sesuai instruksi).

### Known limitations (dilaporkan, bukan disembunyikan)

1. Nomor telepon guest belum OTP-verified → ownership guest tetap sekuat sinyal
   existing (sama seperti gate tulis R6).
2. Endpoint probe mengembalikan boolean untuk sebuah nomor telepon; ada minor
   information-disclosure ("nomor X punya order PAID di restoran Y"). Dibatasi rate
   limit 60/menit, tenant di-resolve server-side, tanpa PII — dan **bukan authorization**
   (POST tetap memvalidasi ulang).
3. Return-to-reservation memakai `sessionStorage` (per-tab). Bila storage diblokir
   (mode private ketat), flow tetap berjalan — hanya tidak bisa auto-resume.
