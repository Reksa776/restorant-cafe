# AUDIT + FIX — KASIR SINGLE-SCAN PAYMENT

> Kasir harus scan order **dua kali** untuk membayar: sekali di list Orders,
> lalu sekali lagi di step pembayaran. Fix: order yang sudah ditemukan langsung
> dipakai — scan hanya 1x. Semua engine CASH/QRIS tetap reuse, authorization
> server-side tetap utuh.
> Tanggal: 2026-09-09 · Verifikasi: `npx tsc --noEmit` + `npm run build` + code-trace.

---

## 1. Problem

Flow saat ini:

```text
Menu Orders
→ Scan Order
→ Order ditemukan (detail page)
→ Print Bill / Proses Pembayaran
→ malah masuk Scan lagi          ← DOUBLE SCAN
→ baru CASH / QRIS
```

Padahal `orderNumber` sudah diketahui setelah scan pertama. Kasir harus scan
ulang di step pembayaran — buang waktu, dan membingungkan.

Flow yang diinginkan:

```text
Orders
→ Scan Order
→ Order Detail
   ├── Print Bill
   └── Proses Pembayaran Kasir
        ├── CASH
        └── QRIS
```

Scan hanya 1 kali; Print Bill dan Proses Pembayaran langsung memakai order yang
sudah ditemukan.

## 2. Root Cause

- `/admin/orders/[orderNumber]` (halaman yang dibuka oleh scan dari list
  Orders) menampilkan tombol **"Scan & Bayar"** yang membuka
  `BarcodePaymentFlow`.
- `BarcodePaymentFlow` hanya menerima `open` / `onOpenChange` — **tidak ada
  cara menerima order yang sudah diketahui**. Setiap kali dialog dibuka,
  state internal-nya `scanStatus: "idle"` → menampilkan tombol "Scan QR
  Pesanan" → kasir harus scan ulang.
- Selain itu, tombol aksi hanya muncul ketika ada row `KASIR UNPAID`
  (`cashierUnpaid`); order tanpa row kasir (mis. order customer dengan QRIS
  PENDING) tidak punya aksi pembayaran sama sekali di halaman detail.

## 3. Flow Before / After

| Step | Before | After |
|---|---|---|
| 1 | Orders list → Scan QR → detail page | sama (tidak berubah) |
| 2 | Detail page | sama |
| 3 | "Scan & Bayar" → **buka scanner lagi** → scan → CASH/QRIS | "Proses Pembayaran" → langsung CASH/QRIS (order sudah dimuat) |
| 4 | Print Bill | sama — `PrintBillDialog` memakai prop `order`, tidak pernah scan |
| 5 | CASH | cash form (uang diterima/kembalian) — sama |
| 6 | QRIS | `createKasirQrisPayment()` + QR/countdown/polling — sama |
| 7 | Scan order lain | "Pindai Pesanan Lain" di header — tetap ada |

## 4. Files Changed

| File | Perubahan |
|---|---|
| `src/components/admin/barcode-payment-flow.tsx` | Prop baru **`initialOrderNumber?: string \| null`**. Saat dialog terbuka dan nilai ada, order dimuat langsung via `loadOrder()` (endpoint admin scoped yang sama dengan jalur scanner) dan scanner **dilewati** — tidak ada flash tombol scan (state "Memuat pesanan..." ditampilkan saat idle+initialOrderNumber). Mode scan internal tetap ada sebagai default (kompatibel mundur). |
| `src/app/admin/orders/[orderNumber]/page.tsx` | Tombol ganda ("Scan & Bayar" + "Proses Pembayaran Kasir" via `CashierPayDialog`) diganti satu tombol **"Proses Pembayaran"** yang membuka `BarcodePaymentFlow` dengan **`initialOrderNumber={order.orderNumber}`** → langsung CASH/QRIS tanpa scan kedua. Aksi kini tersedia untuk **semua** order `!isPaid && !CANCELLED` (sebelumnya hanya jika ada row kasir UNPAID). `CashierPayDialog`/`dialogOpen` dihapus dari halaman ini (komponen tetap dipakai oleh sheet list orders di `order-detail.tsx` — tidak dihapus). Print Bill tidak berubah (sudah memakai `order` langsung). |

## 5. Security

| Kontrol | Status |
|---|---|
| `initialOrderNumber` tidak pernah dipercaya mentah | ✅ Order dimuat ulang lewat `getOrderByNumberScoped` → `GET /api/orders/by-number/[orderNumber]` (`requireRoles ADMIN/CASHIER` + `authorizedBranches`) — restaurantId dari session, branch dari UserBranch. |
| Foreign branch / foreign restaurant order | ✅ 404 (order tidak ditemukan dalam scope); 403 untuk branch non-assigned. Tidak ada jalur baru yang melewati authorization. |
| Order dari scanner vs order dari prop — hak akses sama | ✅ Jalur lookup identik (endpoint scoped yang sama); `initialOrderNumber` hanya menghilangkan langkah scan, bukan otorisasinya. |
| Payment engine | ✅ Tidak ada engine baru — CASH (createPayment KASIR + markCashierPaymentPaid) dan QRIS (`createKasirQrisPayment` + polling) persis seperti sebelumnya. |
| No credential di client | ✅ Tidak ada secret baru. |

## 6. Test Matrix

| # | Skenario | Status |
|---|---|---|
| 1 | Scan order sekali → detail muncul | ✅ tidak berubah (list → `/admin/orders/[orderNumber]`) |
| 2 | Print Bill → tidak scan lagi | ✅ `PrintBillDialog` memakai prop `order` (pre-existing, diverifikasi) |
| 3 | Proses Pembayaran → tidak scan lagi | ✅ dialog dibuka dengan `initialOrderNumber` → langsung CASH/QRIS |
| 4 | CASH → berhasil | ✅ cash form existing (uang diterima, "Uang Pas", kembalian, `markCashierPaymentPaid`) |
| 5 | QRIS → QR muncul tanpa scanner kedua | ✅ `handleQrisSelect` → `createKasirQrisPayment` → QR render |
| 6 | QRIS PAID → status benar | ✅ polling 4s `getPayment` + single-fire PAID (unchanged) |
| 7 | Scan order lain → tetap bisa | ✅ "Pindai Pesanan Lain" (`OrderScanner`) di header detail + "Scan QR Pesanan" di list/dashboard tetap ada |
| 8 | Foreign branch order → tetap ditolak | ✅ lookup scoped server-side (404/403) |
| 9 | `/admin/orders/new` tidak rusak | ✅ tidak disentuh |
| 10 | Customer QRIS tidak rusak | ✅ tidak disentuh (public route/pages) |

### Build
- `npx tsc --noEmit` → ✅ **PASS** (0 error)
- `npm run build` → ✅ **PASS** (exit 0)
- ESLint 2 file yang diubah → ✅ 0 error (1 warning pre-existing `<img>` di barcode-payment-flow, sudah didokumentasikan audit sebelumnya)

## 7. Regression

- **Kasir CASH / QRIS** — engine & form tidak diubah; hanya jalur pembukaan dialog.
- **Barcode scanner** (`OrderScanner`) — tidak diubah; masih dipakai di list, dashboard, header detail.
- **`CashierPayDialog`** — masih dipakai oleh sheet `order-detail.tsx` (list orders); hanya tidak lagi dirender di halaman detail scan.
- **Manual order `/admin/orders/new`** — tidak diubah.
- **Customer QRIS / checkout / cart** — tidak diubah.
- **Stock deduction COMPLETED, webhook, polling** — tidak diubah.
- Produksi tetap `next start -p 3001`; port 3000 tidak disentuh.

## 8. Remaining Risks

1. **Runtime/gateway belum diverifikasi** (sama seperti audit sebelumnya): verifikasi di sesi ini = typecheck + build + code-trace; iPaymu live/sandbox butuh server + DB + kunci.
2. Mode scan internal `BarcodePaymentFlow` kini praktis tidak terpakai dari UI (semua pemanggil detail page memakai `initialOrderNumber`) — dipertahankan sebagai default kompatibel; tidak dihapus.
3. Aksi "Proses Pembayaran" kini muncul untuk semua order belum lunas (bukan hanya yang punya row kasir) — jika order sudah punya QRIS PENDING, tombol membuka flow yang akan **reuse** QRIS tersebut (perilaku `createKasirQrisPayment`), bukan membuat payment baru.

---

## Verdict

**🟢 FIXED — single scan** — root cause (dialog pembayaran tidak menerima order yang sudah diketahui) diperbaiki dengan prop `initialOrderNumber`; `tsc` + `build` PASS; authorization server-side tidak berubah; tidak ada engine baru.