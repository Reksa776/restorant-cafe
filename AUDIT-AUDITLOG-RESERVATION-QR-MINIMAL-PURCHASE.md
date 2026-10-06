# AUDIT — AUDIT LOG VIEWER · RESERVATION QR (KASIR SCAN) · RESERVATION MINIMAL 1 PEMBELIAN

Status: AUDIT ONLY — belum ada kode yang diubah. Menunggu approval.

---

## 1. EXISTING AUDIT LOG

**Model (`prisma/schema.prisma` L522)**
```
model AuditLog {
  id, restaurantId, branchId?, userId?, action, entityType?, entityId?,
  details Json?, ipAddress?, createdAt
  restaurant Restaurant? @relation(...)
  user       User?       @relation(...)
  @@index([restaurantId]) @@index([branchId]) @@index([userId])
  @@index([action]) @@index([createdAt])
  @@map("auditlog")
}
```

**Service (`src/services/audit/audit.service.ts`)**
- `auditService.log({restaurantId, branchId?, userId?, action, entityType?, entityId?, details?, ipAddress?})` — best-effort, **never throws** (catch → console.error).
- `auditService.list({restaurantId, userId?, action?, branchId?, page?, limit?})` — where restaurantId (+userId/action/branchId opsional), `include.user {id,name,email,role}`, `orderBy.createdAt desc`, skip/take, `{items,total,page,limit,totalPages}`. **Default limit 50, tanpa clamp.**
- `list()` **belum dipakai di mana pun** (dead capability).

**Writers (semua `auditService.log` — satu-satunya engine)**
| File | Actions |
|---|---|
| `payment/payment.service.ts` | `PAYMENT_RECEIVED` |
| `shift/shift.service.ts` | `SHIFT_OPENED`, `SHIFT_CLOSED`, `SHIFT_OVERRIDE_REQUESTED/APPROVED/REJECTED`, `SHIFT_REOPENED` |
| `branch/branch.service.ts` | `BRANCH_CREATED/UPDATED/ACTIVATED/DEACTIVATED`, `USER_BRANCH_UPDATED`, `BRANCH_PRODUCT_UPDATED` |
| `approval/approval.service.ts` | `REFUND_REQUESTED/APPROVED/DENIED`, `CANCELLATION_REQUESTED`, `ORDER_CANCELLED`, `CANCELLATION_REJECTED` |
| `user/user.service.ts` | `USER_CREATED`, `USER_ACTIVATED/DEACTIVATED`, `PASSWORD_CHANGED` |
| `menu/menu.service.ts` | `BRANCH_PRODUCT_CREATED` |

`details` saat ini berisi: email+role+name, orderNumber, amount/amountReceived/change, reason, stock/oldStock, shiftNumber/openingCash/cashSales/dsb, branchIds. **Tidak ada** password/token/secret.

**Existing API/UI viewer: TIDAK ADA.** Tidak ada route `/api/admin/audit*`, tidak ada halaman, tidak ada nav.

---

## 2. AUDIT LOG GAP

| Aspek | Kondisi | Gap |
|---|---|---|
| API | — | belum ada route list/detail |
| Auth | `requireAdmin`/`requireRoles`/`authorizedBranches`/`assertBranchInScope` tersedia | tinggal dipakai (ADMIN only) |
| Filters | userId, action, branchId | kurang: date range, entityType, entityId, search, actor-role; branch belum divalidasi scope |
| Pagination | page/limit ada | limit tanpa clamp max; default 50 |
| Detail | tidak ada endpoint | list sudah membawa `details` (bisa jadi drawer), tapi detail by-id lebih rapi |
| Security | restaurant-scoped di `list()` | perlu branch scope + redaksi defensif `details` |
| UI | — | belum ada halaman/tabel/filter/detail/nav |

---

## 3. EXISTING RESERVATION QR CAPABILITY

- **Reservation code**: `R-XXXXXXXX` (crypto base-36, non-sequential) dibuat di `reservation.service.ts`; `@@unique([restaurantId, code])` → lookup tenant-safe.
- **QR library**: `qrcode` (dependency existing).
- **QR component**: `src/components/qr-code-display.tsx` (`QrCodeDisplay({value,size,ariaLabel})`) — reusable apa adanya.
- **Scanner library**: `html5-qrcode` (dependency existing).
- **Scanner component**: `src/components/admin/order-scanner.tsx` (`OrderScanner`) — lifecycle kamera lengkap (permission/loading/scanning/error/cleanup), tapi **hardcoded** ke regex order `^ORD-\d{8}-[A-Z0-9]{6}$` + label "Scan QR Pesanan".
- **Reservation URL**: `GET /api/public/reservations/[code]?phone=` (guest, butuh phone), halaman customer `/account/reservasi/[code]`. **Tidak ada** URL publik code-only (disengaja).
- **Cashier architecture**: route `/api/admin/reservations/*` → `requireRoles(["ADMIN","CASHIER"], branchHintFrom(request))` + `authorizedBranches(ctx)`; nav "Reservasi" untuk ADMIN+CASHIER; branch lewat header `x-branch-id` (axios interceptor).
- **Endpoint scan sudah ada**: `GET /api/admin/reservations/code/[code]` — ADMIN/CASHIER, restaurant+branch scoped, read-only, mengembalikan `ReservationView` (code, guestName/guestPhone, partySize, date/time, status, table, branch, customer).

---

## 4. RESERVATION QR GAP

| Bagian | Kondisi | Gap |
|---|---|---|
| Customer QR UI | tidak ada | tambah section "QR Reservasi" di success step `reservasi/page.tsx` (+ opsional `/account/reservasi/[code]`) memakai `QrCodeDisplay` dengan payload = **reservation code** |
| Cashier scanner | tidak ada untuk reservasi | reuse pola `OrderScanner` (kamera) — generalisasi validator/label, atau varian reservasi berbasis `html5-qrcode` yang sama |
| Validation API | **SUDAH ADA** | REUSE `GET /api/admin/reservations/code/[code]`; tinggal tambah `getByCode()` di client wrapper `src/services/reservation.service.ts` |
| Manual fallback | tidak ada | tambah input "Masukkan Kode Reservasi" (validasi server-side lewat endpoint yang sama) |
| Security | — | QR hanya berisi code (opaque, tanpa nama/HP/email/secret); semua lookup server-side; 404 generik lintas tenant |

---

## 5. EXISTING PURCHASE/ORDER CAPABILITY

- **Order** (L829): `restaurantId`, `branchId?`, `orderNumber`, `customerId` (**required**), `status OrderStatus`, `paymentStatus PaymentStatus`, `items OrderItem[]`, index `customerId` + `paymentStatus` + `createdAt`.
- **OrderItem** (L995): `orderId`, `productId`, `quantity`, harga; relasi cascade.
- **Customer** (L803): `restaurantId`, `phone?`, `email?`, `password?` (login), `orders Order[]`; unique `(restaurantId, phone)` & `(restaurantId, email)`.
- **Payment** (L1075): `orderId`, `status PaymentStatus`, `amount`, `method`/`provider`; PAID di-set `payment.service`.
- **Checkout**: `POST /api/public/orders` — guest ATAU login; **selalu** membuat baris `Customer` (by phone, atau phone placeholder `guest-...`). Cart = client-side (`useCart`/localStorage) → bukan source of truth.
- **Relasi customer↔order**: `Order.customerId` required + `Customer.orders`.
- **Relasi reservation↔order**: `Reservation.orderId` **scalar saja** (tanpa Prisma relation, tanpa kode yang mengisinya — konversi check-in belum diimplementasikan). `Reservation.customerId` nullable.
- **Customer login**: sudah ada (`customer-auth.service`, cookie session httpOnly, `use-customer-auth`, `CustomerAuthDialog`). Guest customer row **di-upgrade in-place** saat register (riwayat order tetap ter-link).

**Definisi "pembelian" existing di codebase** = `Order.status != CANCELLED AND paymentStatus = PAID` (lihat `report.service.ts` L9, `profitability`, `cashier-sales`, `menu-engineering`). Refund penuh → `paymentStatus = UNPAID` (approval.service L490) → otomatis tidak terhitung.

---

## 6. MINIMUM PURCHASE GAP

- **Definisi pembelian yang direkomendasikan**: customer punya **≥1 Order** dengan `restaurantId` sama, `customerId = session.customerId`, `status != CANCELLED`, `paymentStatus = PAID`, dan **≥1 OrderItem**. Alasan: konsisten dengan definisi "terjual" existing; mencegah reservasi fiktif/tanpa bayar; refund penuh otomatis mendiskualifikasi.
  - Alternatif lebih longgar (butuh keputusan): order `!= CANCELLED` dengan ≥1 OrderItem meskipun belum PAID.
- **Payment requirement**: bila PAID dipilih → reuse payment engine existing (Cash/QRIS). Tidak ada engine baru.
- **Customer identity**: WAJIB login customer (session). `Reservation.customerId` sekarang nullable & guest diizinkan → business rule ini otomatis **mewajibkan login untuk reservasi** (reuse customer auth + `CustomerAuthDialog`).
- **Order ownership**: `where.customerId = session.customerId` + `restaurantId`.
- **Restaurant/branch scoping**: `Order.restaurantId = session.restaurantId` (wajib). Branch: **butuh keputusan** — (a) purchase di restoran yang sama (branch apa pun), atau (b) cabang yang sama dengan reservasi. Rekomendasi: (a) restoran sama, agar riwayat lintas cabang tetap valid.
- **Race condition**: validasi pembelian dijalankan **di dalam transaksi reservasi yang sudah ada** (branch+table `FOR UPDATE`) — cukup re-query Order di dalam tx. Tidak perlu arsitektur transaksi baru.
- **Cancel/refund implication** (perilaku existing): batal reservasi **tidak** menyentuh Order; refund penuh → `paymentStatus UNPAID` (reservasi berikutnya tidak bisa dibuat); order dibatalkan **tidak** otomatis membatalkan reservasi. Rekomendasi: **jangan** ubah perilaku otomatis (hindari regresi); cukup andalkan gate saat pembuatan reservasi.

---

## 7. FILES TO CHANGE

**Audit Log Viewer**
- NEW `src/services/audit/audit.types.ts` (schema query Zod) — opsional, atau perluas `audit.service.ts`.
- MOD `src/services/audit/audit.service.ts` — perluas `list()` (date range, entityType, entityId, search, clamp limit, branch scope `branchFilters`) + `getById()`.
- NEW `src/app/api/admin/audit-logs/route.ts` — `GET` (ADMIN only).
- NEW `src/app/api/admin/audit-logs/[id]/route.ts` — opsional detail.
- NEW `src/services/audit.service.ts` (client wrapper).
- NEW `src/app/admin/audit-logs/page.tsx` (+ komponen `src/components/admin/audit-logs/*`).
- MOD `src/app/admin/layout.tsx` — nav "Audit Log" (ADMIN).

**Reservation QR**
- MOD `src/app/(customer)/reservasi/page.tsx` — section QR di success step.
- MOD (opsional) `src/app/(customer)/account/reservasi/[code]/page.tsx` — QR di detail.
- MOD `src/services/reservation.service.ts` (client) — tambah `getByCode(code)`.
- MOD `src/components/admin/order-scanner.tsx` — generalisasi (props `validate`, `title`, `description`, `triggerLabel`) **atau** NEW `src/components/admin/reservation-scanner.tsx` yang reuse `html5-qrcode`.
- MOD `src/app/admin/reservations/page.tsx` — tombol "Scan QR Reservasi" + fallback input kode + tampil detail (reuse `ReservationDetail`).
- REUSE `src/app/api/admin/reservations/code/[code]/route.ts` (tanpa perubahan).

**Minimal Purchase**
- MOD `src/services/reservation/reservation.service.ts` — `PURCHASE_REQUIRED` gate di dalam transaksi + hasilkan DTO/err.
- MOD `src/services/reservation/reservation.types.ts` — kode error Zod/konstanta (opsional).
- MOD `src/app/api/public/reservations/route.ts` — wajibkan session; teruskan `customerId`.
- MOD `src/app/(customer)/reservasi/page.tsx` — gate login + pesan.
- MOD `src/lib/errors.ts` — bila perlu kode error baru (mis. `PURCHASE_REQUIRED`, `LOGIN_REQUIRED`).
- NEW komponen/UX untuk "belum ada pembelian" (CTA ke menu).

**Tests**
- NEW/MOD: audit service/api test, reservation purchase-gate test, scanner/QR helper test.

---

## 8. DATABASE IMPACT
- Audit Viewer: **tidak ada** perubahan schema.
- Reservation QR: **tidak ada** (code sudah ada & unik per restoran).
- Minimal Purchase: **tidak ada** — `Order.customerId` + index `customerId`/`paymentStatus` + `OrderItem` sudah cukup. `Reservation.orderId` sudah ada (dipakai hanya bila kelak mau link eksplisit).

## 13. MIGRATION REQUIRED?
**NO.** Semua kebutuhan terpenuhi oleh model existing. Tidak ada field/relasi/index baru yang esensial. (Jika kelak ingin mencatat `purchaseOrderId` di reservasi untuk audit, itu opsional & additive — tapi TIDAK diperlukan sekarang.)

---

## 9. API IMPACT
- **NEW** `GET /api/admin/audit-logs?page&limit&startDate&endDate&actor&action&entityType&entityId&branchId&search` → `paginatedResponse`. ADMIN only, restaurant+branch scoped.
- **NEW (opsional)** `GET /api/admin/audit-logs/[id]`.
- **REUSE** `GET /api/admin/reservations/code/[code]` untuk scan (tanpa perubahan).
- **MOD** `POST /api/public/reservations` — wajib session customer + gate pembelian; error baru (mis. 403 `LOGIN_REQUIRED`, 409 `PURCHASE_REQUIRED`).
- DTO scan: gunakan `ReservationView` existing yang sudah aman (tanpa secret). Tidak ada perubahan bentuk.

## 10. SECURITY IMPACT
- Audit viewer ADMIN-only, restaurant-scoped, branch-scoped (`authorizedBranches`/`assertBranchInScope`), redaksi defensif `details` (drop key `password|token|secret|authorization|providerRef|qrString|...`).
- QR hanya berisi reservation **code** (opaque) — tanpa PII/secret/credential; bukan authorization; semua validasi server-side.
- Cashier scan read-only; tenant check via `restaurantId` + branch scope; 404 generik (tidak membocorkan eksistensi tenant lain).
- Min-purchase: ownership order di-scope ke `customerId` + `restaurantId`; tidak percaya client.
- Tidak mengekspos payment credential/provider secret.

## 11. UI IMPACT
- Admin: halaman baru "Audit Log" (tabel + filter date-range/actor/action/entity/branch/search + pagination + detail drawer). Nav ADMIN-only.
- Customer: section "QR Reservasi" (code + QR + ringkasan) di success/detail; gate login + CTA pembelian.
- Cashier/admin reservasi: tombol scan QR + dialog kamera + input kode manual → detail reservasi.
- Reuse primitives `ui/table`, `ui/select`, `ui/input`, `ui/dialog`, `ui/sheet`, `ui/tabs`, `ui/badge`, `ui/skeleton`.

## 12. REGRESSION RISK
| Risiko | Level | Catatan |
|---|---|---|
| Reservasi kini wajib login + pembelian (guest tidak bisa reservasi) | **Tinggi (by requirement)** | Perlu keputusan & komunikasi UX |
| Definisi "pembelian" salah pilih → reservasi gagal/berlebihan | Sedang | Rekomendasi PAID + ≥1 OrderItem (konsisten dengan revenue existing) |
| Scanner diperluas → regresi scan pesanan kasir | Sedang | Generalisasi harus menjaga perilaku `OrderScanner` existing (test) |
| Audit viewer membocorkan data | Sedang | ADMIN-only + scope + redaksi; `details` sekarang tidak berisi secret |
| Perubahan availability/overlap reservasi | Nihil | Tidak disentuh |
| Order/Payment/Cashier/QRIS/WhatsApp/Table | Nihil | Tidak disentuh |

## 14. RECOMMENDED FINAL FLOW
```
Customer (login) → Menu → minimal 1 pembelian PAID
  → Cart → Checkout → Payment (jika perlu)
  → Reservasi (server validasi: session + purchase + input + availability)
  → Reservation PENDING + QR (code) ditampilkan
  → Customer datang → Kasir scan QR / input kode manual
  → Server validasi (exists, tenant, branch, status) → tampil detail (READ-ONLY)
```
Tidak ada engine baru: Order/Payment/Customer-auth/Reservation/QR/Scanner semua di-reuse.

## 15. IMPLEMENTATION PLAN (menunggu approval)
1. **Audit Log Viewer** — perluas `auditService.list` + `getById` + redaksi; route ADMIN-only `GET /api/admin/audit-logs` (+detail); client wrapper; halaman admin + filter/pagination/detail drawer; nav.
2. **Reservation QR (customer)** — section QR di success step & detail memakai `QrCodeDisplay` (payload = `code`).
3. **Reservation QR (kasir)** — tambah `getByCode()` di client wrapper; tombol "Scan QR Reservasi" + input kode manual di halaman reservasi admin; reuse endpoint existing; reuse/generalisasi `OrderScanner`.
4. **Minimal 1 pembelian** — gate di service (dalam transaksi existing) + wajib session di route publik + gate/pesan UI; keputusan definisi & scope branch.
5. **Tests & verifikasi** — unit/service/api untuk gate pembelian & audit viewer; tsc/build/diff-check/eslint; browser (QR tampil, scan → detail, tenant isolation); tanpa data sementara tertinggal.
6. **No migration.** No commit/push.

### Keputusan yang dibutuhkan sebelum implementasi
1. Definisi pembelian final: **(A) PAID + bukan CANCELLED + ≥1 item** (rekomendasi) atau (B) order dibuat + ≥1 item (lebih longgar)?
2. Scope pembelian: restoran sama (branch apa pun) **(rekomendasi)** atau harus cabang yang sama?
3. Reservasi wajib login (mengganti guest reservation)? (implikasi: ya, bila minimal pembelian diberlakukan).
