# AUDIT-FIX-KASIR-QRIS-CASH-FLOW

## 1. Bug

Di Kasir:

```
Orders → Scan Order → Proses Pembayaran → pilih QRIS
```

muncul:

```
Pembayaran kasir sudah tercatat.
Silakan masukkan uang diterima.
```

Pesan + form uang diterima/kembalian hanya boleh muncul untuk **CASH**, bukan QRIS.

## 2. Root Cause

`barcode-payment-flow.tsx` → `handleQrisSelect()` memanggil
`paymentService.createKasirQrisPayment(orderNumber)`.

Server (`createKasirQrisPayment` di `src/services/payment/payment.service.ts`)
menemukan row **KASIR UNPAID** yang masih ada di order (contoh: customer
DINE_IN checkout memilih "Bayar di Kasir" → intent kasir dibuat atomik dengan
order) dan langsung mengembalikan:

```ts
{ payment: existingCashier, kind: "kasir_existing" }
```

Client **menafsirkan `kasir_existing` sebagai "lanjutkan ke form cash"**:

```ts
if (result.kind === "kasir_existing") {
  setPayStatus("cash-form");                    // ← BUG
  toast.info("Pembayaran kasir sudah tercatat. Silakan masukkan uang diterima.");
  return;
}
```

Jadi: user memilih QRIS, tetapi UI pindah ke form CASH — persis bug yang
dilaporkan. Akar masalahnya adalah **branching client yang menyamakan
"ada intent kasir" dengan "pilih CASH"**, ditambah **server yang
mengembalikan row KASIR sebagai jawaban atas permintaan QRIS eksplisit**.

## 3. Before Flow

```
Pilih QRIS
  → createKasirQrisPayment
  → UNPAID KASIR row ada → kind: "kasir_existing"
  → setPayStatus("cash-form")  ← SALAH
  → "Pembayaran kasir sudah tercatat. Silakan masukkan uang diterima."
  → form uang diterima / kembalian / markCashierPaymentPaid
```

## 4. After Flow

```
Pilih QRIS
  → createKasirQrisPayment
  → UNPAID KASIR row superseded (guarded cancel → CANCELLED)
  → reuse PENDING valid QRIS, atau retry FAILED/EXPIRED, atau intent QRIS baru
  → kind: "pending_existing" | "qris_created"
  → QRIS screen: nominal, QR, countdown, polling → PAID
  → (defensif) kasir_existing tidak pernah lagi membuka cash form — ditampilkan error
```

```
                PROSES PEMBAYARAN
                        │
              ┌─────────┴─────────┐
             CASH                QRIS
              │                   │
              ▼                   ▼
       CASH PAYMENT       KASIR QRIS PAYMENT
              │                   │
       uang diterima       create/reuse QRIS
              │                   │
          kembalian          tampil QR
              │                   │
        mark PAID             polling
                                  │
                              gateway PAID
                                  │
                               PAID
```

## 5. Files Changed

| File | Perubahan |
| --- | --- |
| `src/services/payment/payment.service.ts` | `createKasirQrisPayment`: UNPAID KASIR row tidak lagi dikembalikan sebagai `kasir_existing`; di-supersede (guarded cancel `UNPAID → CANCELLED`) lalu alur QRIS lanjut (reuse/retry/create). `markCashierPaymentPaid`: guard order-level `paymentStatus === "PAID"` → `alreadyPaid` (stale KASIR row tidak bisa ditarik dua kali). `createPayment` (KASIR): reuse hanya row `UNPAID` yang masih live; row `CANCELLED/FAILED/EXPIRED` dilewati dan dibuat row baru. |
| `src/components/admin/barcode-payment-flow.tsx` | `handleQrisSelect`: cabang `kasir_existing` (kini unreachable dari server) tidak pernah membuka `cash-form` — ditampilkan error defensif. |

## 6. CASH Flow (tidak berubah)

- `handleCashSubmit` → cari row `KASIR`/`null` UNPAID di order → bila tidak ada
  `createPayment(order.id, { method: "KASIR" })` (idempotent, reuse UNPAID
  saja) → `markCashierPaymentPaid(paymentId, received)`.
- Validasi `amountReceived >= amountDue` tetap server-side.
- `markCashierPaymentPaid` hanya dipanggil dari alur CASH.

## 7. QRIS Flow

- `handleQrisSelect` / `KasirQrisScreen` → `createKasirQrisPayment(orderNumber)`.
- Server: PAID → `ConflictError "Order already paid"` (tanpa duplicate);
  PENDING valid → reuse `pending_existing`; FAILED/EXPIRED/stale-PENDING →
  expire lalu intent baru `qris_created`; UNPAID KASIR row → superseded.
- UI: QR (`qrImage` → fallback `qrString` via lib `qrcode`), nominal, order
  number, countdown expired, polling 4s `getPayment`, PAID single-fire,
  FAILED/EXPIRED → "Buat QRIS Baru".
- `markCashierPaymentPaid` **tidak pernah** dipanggil dari alur QRIS sebelum
  gateway benar-benar PAID.

## 8. Payment Engine

Tidak ada engine baru. Semua jalur tetap menggunakan:

- `PaymentService.createPayment()` (KASIR + gateway)
- `PaymentService.createKasirQrisPayment()`
- `PaymentService.markCashierPaymentPaid()`
- Polling status + webhook iPaymu existing.

## 9. Duplicate Payment Protection

- `createPayment` masih memakai per-order `FOR UPDATE` row lock + cek
  PENDING/PAID existing → Conflict.
- Supersede KASIR row memakai **guarded update** (`where status: "UNPAID"`),
  jadi flip bersamaan (webhook/mark-paid) tidak bisa ditimpa.
- `markCashierPaymentPaid`: guarded `updateMany` + guard order-level
  `paymentStatus === "PAID"` → double-collect tidak mungkin.
- Client: `qrisBusyRef` mencegah double-click membuat dua intent QRIS;
  `paidNotifiedRef` membuat transisi PAID single-fire.

## 10. Branch/Tenant Security

Tidak ada perubahan. Tetap:

- `restaurantId` dari session (`requireRoles(["ADMIN","CASHIER"])`).
- `branchId` dari client hanya hint — divalidasi via `authorizedBranches(ctx)`.
- `createKasirQrisPayment(orderNumber, restaurantId, branchFilters)` — lookup
  order double-scoped (restaurant + branch filter); foreign branch/order →
  NotFound (404).
- `markCashierPaymentPaid(paymentId, restaurantId, ..., branchFilters)` —
  payment double-scoped; foreign branch → NotFound.

## 11. Test Matrix

| Test | Expected | Status |
| --- | --- | --- |
| Scan → CASH | Form cash (uang diterima/kembalian) | ✅ traced (flow tak berubah) |
| Scan → QRIS (order punya UNPAID KASIR row) | QRIS screen, bukan cash form | ✅ FIXED — server supersede + client tak pernah `cash-form` |
| QRIS → PENDING valid | QR tampil (reuse `pending_existing`) | ✅ unchanged |
| QRIS → PAID | PAID, tanpa duplicate | ✅ unchanged (Conflict + single-fire) |
| QRIS → FAILED | Retry `qris_created` | ✅ unchanged |
| QRIS → EXPIRED | Retry `qris_created` | ✅ unchanged |
| CASH → amount kurang | Ditolak (`ValidationError`) | ✅ unchanged |
| CASH → amount cukup | PAID | ✅ unchanged |
| CASH → QRIS switch | Tidak membawa state CASH (reset `resetToChoose` + server supersede) | ✅ |
| QRIS → CASH switch | Tidak membawa state QRIS; `createPayment(KASIR)` reuse UNPAID / buat baru | ✅ (reuse hanya UNPAID) |
| DINE_IN QRIS | PASS | ✅ no OrderType guard |
| TAKEAWAY QRIS | PASS | ✅ no OrderType guard |
| DELIVERY QRIS | PASS | ✅ no OrderType guard |
| Foreign branch QRIS | 403/404 | ✅ double-scoped lookup |
| Duplicate QRIS click | Tidak duplicate payment | ✅ `qrisBusyRef` + row lock + Conflict |
| CASH setelah QRIS (row KASIR di-cancel) | Row KASIR baru dibuat (tidak reuse CANCELLED) | ✅ FIXED (`createPayment` KASIR reuse hanya UNPAID) |
| Stale UNPAID KASIR row di order yang sudah PAID via QRIS | Tidak bisa ditarik (alreadyPaid) | ✅ FIXED (guard order-level) |

### Regression

- Customer QRIS / checkout — tidak diubah.
- Kasir CASH — tidak diubah.
- Payment Dashboard — tidak diubah.
- Repayment QRIS (`/admin/payments/[orderNumber]/qris`) — memakai
  `KasirQrisScreen` yang sama; `kasir_existing` branch jadi unreachable,
  tidak ada regresi.
- Print Bill, Order scanner, Manual Order (`/admin/orders/new`) — tidak diubah.
- Stock deduction, webhook, polling — tidak diubah.
- Branch authorization — tidak diubah.

## 12. Build Result

- `npx tsc --noEmit` — **PASS** (exit 0)
- `npm run build` — **PASS** (exit 0)
- ESLint 2 file diubah — 0 error baru (2 warning pre-existing: `toast` unused,
  `<img>` LCP).

## 13. Remaining Risks

1. Runtime e2e (iPaymu gateway) belum dijalankan — DB lokal & server 3001 tidak
   aktif; verifikasi berbasis code-trace + tsc/build (konsisten dengan audit
   sebelumnya).
2. Supersede KASIR row saat QRIS dipilih membatalkan intent cash yang dibuat
   customer di checkout — ini perilaku yang diminta (pilihan QRIS eksplisit
   kasir menang), namun order yang lalu ingin balik ke cash tetap bisa: CASH
   membuat row KASIR baru (fix `createPayment` reuse-UNPAID-only).
3. `kasir_existing` branch defensif di client kini unreachable — dibiarkan
   sebagai pengaman, tidak dihapus (mengurangi risiko jika engine berubah lagi).

## 14. Final Verdict

**FIXED.** Akar masalah = branching client yang mengarahkan `kasir_existing`
ke form cash + server yang menjawab permintaan QRIS eksplisit dengan row KASIR.
Server kini meng-supersede intent kasir stale dan selalu mengembalikan intent
QRIS; client tidak pernah membuka cash form dari alur QRIS. CASH dan QRIS
memiliki state/engine terpisah, duplicate protection diperkuat (guard
order-level di `markCashierPaymentPaid`, reuse-UNPAID-only di `createPayment`),
security branch/tenant tidak disentuh.