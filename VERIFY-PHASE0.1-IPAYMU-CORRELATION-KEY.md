# PHASE 0.1 — VERIFIKASI CORRELATION KEY iPAYMU (AUDIT/VERIFICATION ONLY)

> Mode: **AUDIT/VERIFICATION ONLY.** Tidak ada source/schema/migration yang diubah.
> Tidak ada commit/push/deploy/reset. Tidak ada worker/WhatsApp disentuh. Tidak ada
> payment production dibuat, tidak ada customer ditagih, tidak ada order existing diubah.
> Repo: `/home/reksa/restorant-cafe` · HEAD `5d82cf4`
>
> Metode: (1) audit kode exact (file + line + function), (2) **bukti data nyata read-only**
> dari `Payment` + `PaymentTransaction` hasil callback iPaymu yang sudah tersimpan.
> Probe read-only sementara dibuat di root repo, dijalankan, lalu **dihapus** (tidak
> ada perubahan source; `git status` non-session tetap hanya file audit).

---

## RINGKASAN EKSEKUTIF

**JAWABAN: `Data.Reference` (nilai yang disimpan sebagai `providerRef`) === webhook reference — IDENTIK.**
Dibuktikan dari **18/18 callback webhook nyata**: `Payment.providerRef` selalu sama dengan
`payload.reference_id`, dan `rawData.reference_id` selalu berisi `orderNumber` (= `referenceId` yang
kita kirim). Tidak ada satu pun mismatch.

Correlation key **AMAN** untuk redesign pembayaran Reservation; tidak ada blocker pada titik ini.

Satu nuansa penting (lihat §F): dari **kode saja** identitas tidak bisa dipastikan 100% karena ada
fallback `|| input.orderNumber`; tetapi **data callback nyata menutup ambiguitas itu** — lookup
`providerRef = reference_id` sukses dan payment berubah menjadi PAID/EXPIRED sesuai callback.

---

## A. CREATE REFERENCE (apa yang dikirim ke iPaymu)

| Item | Nilai | Bukti |
|---|---|---|
| Field body | `referenceId` | `ipaymu.provider.ts` `createPayment()`, baris **161** |
| Nilai | `input.orderNumber` (mis. `ORD-20260911-JK2E2C`) | idem |
| Konteks | bagian `body` yang di-JSON.stringify sekali, di-hash untuk signature, dan dikirim apa adanya | `ipaymu.provider.ts:164-166` |
| Body lain terkait | `notifyUrl: {APP_URL}/api/webhooks/ipaymu`, `returnUrl: /payment/callback`, `cancelUrl: /order/{orderNumber}`, `account: VA` | `ipaymu.provider.ts:158-162` |

Jadi **create reference = `orderNumber`** (deterministik, unik per order: `@@unique([restaurantId, orderNumber])`).

## B. PROVIDER RESPONSE REFERENCE (apa yang dikembalikan iPaymu)

| Item | Nilai | Bukti |
|---|---|---|
| Sumber | `body2.Data` dari response `/payment/direct` | `ipaymu.provider.ts:257` |
| Field dipakai | `data.Reference` (string) | `ipaymu.provider.ts` baris **276-278** |
| Fallback | bila `data.Reference` kosong/tipe salah → `input.orderNumber` | idem (`|| input.orderNumber`) |
| Dikembalikan sebagai | `PaymentResult.reference` | `payment.types.ts` `PaymentResult` |

```ts
// ipaymu.provider.ts:276
reference:
  (typeof data?.Reference === "string" && data.Reference) ||
  input.orderNumber,
```

## C. STORED `providerRef`

| Item | Nilai | Bukti |
|---|---|---|
| Penulisan | `providerRef: paymentResult.reference` | `payment.service.ts` `createPayment()`, baris **352** |
| Kapan | setelah gateway sukses (di luar lock), saat finalisasi intent | `payment.service.ts:347-354` |

**Bukti data nyata (read-only).** Seluruh `Payment` provider `ipaymu` yang disampel (12 terbaru) memiliki
`providerRef === order.orderNumber`, mis.:
- `cmtwbuk15000k…` · QRIS · PAID · `providerRef = "ORD-20260911-JK2E2C"` = `orderNumber` · cocok (`true`)
- `cmtvxb224001k…` · QRIS · PAID · `providerRef = "ORD-20260910-BVW5OZ"` = `orderNumber` · cocok
- … (semua 12 baris `providerRefEqualsOrderNumber: true`)
- juga terlihat pada status `CANCELLED`, `EXPIRED`, `PENDING` — konsisten.

## D. WEBHOOK REFERENCE (apa yang dikirim kembali iPaymu)

| Item | Nilai | Bukti |
|---|---|---|
| Parser | `parseWebhookPayload(payload)` | `ipaymu.provider.ts` baris **468-509** |
| Field dibaca | `payload.reference_id \|\| payload.Reference \|\| ""` | baris **471** |
| Dikembalikan sebagai | `WebhookData.reference` | baris **505** |
| Route | `POST /api/webhooks/ipaymu` → `paymentService.handleWebhook(body, x-signature)` | `src/app/api/webhooks/ipaymu/route.ts:37` |

```ts
// ipaymu.provider.ts:471
const referenceId = payload.reference_id || payload.Reference || "";
```

**Bukti data nyata.** Dari **18** `PaymentTransaction` provider `ipaymu` tipe `webhook`:
- `rawData.reference_id` **ada di 18/18** baris dan **selalu = `orderNumber`**.
- `rawData.Reference` (PascalCase) **tidak ada di 0/18** baris → parser selalu memakai jalur `reference_id`.
- `rawData.trx_id` = nomor transaksi iPaymu (mis. `37474852`) — **tidak** dipakai untuk lookup.

Contoh baris nyata:
| storedProviderRef | webhookRef (`reference_id`) | trx_id | status callback |
|---|---|---|---|
| ORD-20260911-JK2E2C | ORD-20260911-JK2E2C | 37474852 | PAID |
| ORD-20260911-6CSWQJ | ORD-20260911-6CSWQJ | 37474762 | PAID |
| ORD-20260910-XE2PR0 | ORD-20260910-XE2PR0 | 37470705 | PAID/E2E |
| ORD-20260910-49TXZJ | ORD-20260910-49TXZJ | 37470715 | EXPIRED |
| ORD-20260909-0FU9TS | ORD-20260909-0FU9TS | 37458082 | IGNORED_CANCELLED |

## E. LOOKUP KEY

| Item | Nilai | Bukti |
|---|---|---|
| Kode | `prisma.payment.findFirst({ where: { providerRef: webhookData.reference }, include: { order: true } })` | `payment.service.ts` `handleWebhook()`, baris **1003-1009** |
| Tidak ditemukan | `NotFoundError("Payment not found")` | idem |
| Lanjutan | idempotent PAID / PENDING no-op / amount match / CAS `updateMany(status: current)` + mirror `Order.paymentStatus` | `payment.service.ts:1012-1090` |

```ts
// payment.service.ts:1003
const payment = await prisma.payment.findFirst({
  where: { providerRef: webhookData.reference },
  include: { order: true },
});
```

## F. APAKAH IDENTIK?

**YA — `providerRef` (dari response create) === webhook reference. Terbukti dari data callback nyata.**

Chain nilai yang terverifikasi:

```
create:   referenceId              = orderNumber         (ipaymu.provider.ts:161)
create→ : PaymentResult.reference  = Data.Reference || orderNumber   (:276)
store:    Payment.providerRef      = orderNumber         (payment.service.ts:352)  [semua baris nyata]
webhook:  WebhookData.reference    = reference_id        (ipaymu.provider.ts:471)  [18/18 baris]
lookup:   providerRef === reference  → FOUND             (payment.service.ts:1005) [18/18 sukses]
```

**Hasil agregat dari 18 callback nyata:**

| Metrik | Nilai |
|---|---|
| Total webhook txn `ipaymu` | 18 |
| `providerRef === webhookRef` | **18** |
| Mismatch | **0** |
| Missing payment | 0 |
| Baris punya `reference_id` (snake) | 18 |
| Baris punya `Reference` (Pascal) | 0 |

**Nuansa kejujuran teknis (WAJIB dibaca):** dari **kode saja** tidak 100% dapat dipastikan apakah
`Data.Reference` *mengembalikan nilai yang kita kirim* atau field itu kosong lalu **fallback
`|| input.orderNumber`** yang menetapkan `providerRef`. Keduanya menghasilkan `providerRef = orderNumber`,
sehingga **secara fungsional identik**. Yang **tidak** ambigu dan sudah terbukti dari data:
`providerRef` selalu sama dengan `reference_id` pada callback nyata, dan lookup berhasil (payment
berubah PAID/EXPIRED sesuai callback) → correlation key **bekerja end-to-end**.

## G. BUKTI FILE + LINE/FUNCTION

| Langkah | File | Fungsi | Baris |
|---|---|---|---|
| Create reference | `src/services/payment/providers/ipaymu/ipaymu.provider.ts` | `createPayment()` | **161** (`referenceId: input.orderNumber`) |
| Body/signature | idem | `createPayment()` | 158-166 |
| Provider response ref | idem | `createPayment()` | **276-278** (`data.Reference \|\| orderNumber`) |
| Simpan providerRef | `src/services/payment/payment.service.ts` | `createPayment()` | **352** |
| Parser webhook | `src/services/payment/providers/ipaymu/ipaymu.provider.ts` | `parseWebhookPayload()` | **471** & **505** |
| Lookup | `src/services/payment/payment.service.ts` | `handleWebhook()` | **1005** |
| Route webhook | `src/app/api/webhooks/ipaymu/route.ts` | `POST` | 37 |

Bukti data: query read-only ke `payment` (provider `ipaymu`) dan `paymenttransaction`
(provider `ipaymu`, type `webhook`) pada DB aktif. Tidak ada tulisan.

## H. RISIKO JIKA TIDAK IDENTIK (kontrafaktual / jaga-jaga)

Seandainya `Data.Reference` ≠ `reference_id` (mis. gateway mengembalikan trx id internal sebagai
`Data.Reference` sementara callback mengirim nilai `referenceId` kita):
1. `handleWebhook` → `findFirst({ providerRef })` **tidak menemukan** → `404 Payment not found`
   (`payment.service.ts:1010`).
2. `Payment.status` **tidak pernah** naik ke `PAID`; `Order.paymentStatus` tetap `PENDING`.
3. Realtime `PAYMENT_STATUS_CHANGED` tidak terkirim → dashboard/QRIS page tidak update.
4. Pada redesign Reservation: pembayaran reservasi **tidak pernah settle** ⇒ Reservation tidak
   bisa otomatis PAID/CONFIRMED; customer sudah bayar tapi sistem menolak mengakui.
5. Uang sudah masuk (sisi gateway) tetapi sistem tetap menagih ⇒ risiko sengketa/refund manual.

Karena itu correlation key adalah **prasyarat** sebelum mengikat webhook ke Reservation.

## I. RECOMMENDATION

1. **Correlation key dinyatakan VERIFIED (IDENTIK).** Tidak ada blocker; redesign Reservation
   (Phase 1+) boleh mengandalkan `providerRef ← reference_id`.
2. **Tetap pakai mekanisme existing apa adanya** (`providerRef = Data.Reference || orderNumber`;
   lookup by `reference_id`). Tidak perlu mengubah kode untuk sekarang.
3. **Pertimbangkan hardening kecil (opsional, saat implementasi nanti — bukan sekarang):**
   simpan **juga** `trx_id` (dan `reference_id` mentah) di `PaymentTransaction.rawData` (sudah
   tersimpan) dan, bila kelak ada `Payment.reservationId`, lookup tetap memakai `providerRef`
   agar tidak mengubah kontrak webhook. **Tidak** menyentuh signature/parse.
4. **Live sandbox verification TIDAK dilakukan — dan memang tidak layak**, dengan alasan:
   - `.env` aktif menunjuk **PRODUCTION**: `IPAYMU_ENV=production`, residu base URL
     `https://my.ipaymu.com/api/v2` (kredensial ada: VA & API key ter-set).
     Aturan Anda melarang memakai production payment ⇒ tidak boleh membuat transaksi di sana.
   - `NEXT_PUBLIC_APP_URL = http://localhost:3000` ⇒ `notifyUrl` menunjuk localhost yang
     **tidak bisa dijangkau** gateway, sehingga callback nyata tidak akan pernah diterima.
   ⇒ Membuat payment sandbox kini tidak mungkin tanpa kredensial sandbox + URL publik.
   **Tidak diperlukan**, karena bukti callback nyata sudah menutup pertanyaan.
5. **Kesimpulan**: Phase 0.1 **SELESAI**; correlation key bukan lagi risiko terbuka.
   Boleh lanjut ke keputusan Phase 1 (OPTION A vs B) kapan pun Anda siap — tetapi **sesuai instruksi,
   audit ini berhenti di sini dan tidak masuk implementasi.**

---

**STOP — PHASE 0.1 SELESAI. Tidak ada source/schema/migration yang diubah, tidak ada commit/push,
tidak ada payment dibuat, tidak ada perintah destruktif. Probe read-only sudah dihapus.**
