# ACCOUNTING — PHASE C: CASHBOOK READ-MODEL — IMPLEMENTATION REPORT

**Repository:** `/home/reksa/restorant-cafe`
**Branch:** `main` — **HEAD:** `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (`d7f29ac`) ✅ tidak berubah sebelum/sesudah
**Mode:** Implementasi terbatas (PHASE C only). Tanpa migration, tanpa perubahan `prisma/schema.prisma`, tanpa commit/push/deploy, tanpa perubahan data historis.
**Tanggal:** 2026-10-09
**Referensi:** `ACCOUNTING-PHASE-C-AUDIT.md`.

> **[Source]** = dari kode/schema. **[Test]** = runtime read-only (SELECT) yang dijalankan. **[Belum diverifikasi]** = tidak dapat dipastikan.

---

## 1. Files changed

### Baru (6)
| File | Isi |
|---|---|
| `src/services/accounting/cashbook.types.ts` | Schema Zod v4 (`CashbookQuerySchema`) + konstanta `CASHBOOK_METHODS`/`CASHBOOK_TYPES`/`CASHBOOK_SOURCES`. |
| `src/services/accounting/cashbook.service.ts` | Read-model: loader 3 sumber, klasifikasi, dedup, summary, sort, paginasi, export. |
| `src/services/cashbook.service.ts` | Client wrapper (axios) — pola `expense.service.ts`. |
| `src/app/api/admin/accounting/cashbook/route.ts` | `GET` list + summary (ADMIN). |
| `src/app/api/admin/accounting/cashbook/export/route.ts` | `GET` CSV export (ADMIN). |
| `src/app/admin/accounting/cashbook/page.tsx` | Halaman UI `/admin/accounting/cashbook`. |

### Diubah (1, tracked)
| File | Perubahan |
|---|---|
| `src/app/admin/layout.tsx` | +2 baris: komentar + entri **"Buku Kas"** (`/admin/accounting/cashbook`, ikon `BookOpen`, `roles: ["ADMIN"]`) di grup **Finance**; +1 import `BookOpen`. Tidak merombak sidebar. |

**Tidak diubah:** `prisma/schema.prisma` (tetap `+78/-0` dari PHASE B), `payment.service.ts`, `approval.service.ts`, `shift.service.ts`, `cashier-sales.service.ts`, `report.service.ts`, `profitability.service.ts`, `expense.service.ts`, `lib/money.ts`. **[Source]**

---

## 2. Klasifikasi transaksi dan rumus summary

### Sumber (hanya dibaca, tidak pernah ditulis) **[Source]**
| Sumber | Filter | Tanggal | Type |
|---|---|---|---|
| `Payment` | `status ∈ {PAID, REFUNDED}` (`COLLECTED_PAYMENT_STATUSES`) | `paidAt` (fallback `createdAt`, ditandai `dateFallback`) | `IN` |
| `Refund` | `status = APPROVED` | `approvedAt` | `OUT` |
| `Expense` | semua baris | `spentAt` | `OUT` |

`PaymentTransaction` **tidak pernah dijumlahkan** dan **tidak diekspos** (dedup). `Order` omzet tidak pernah masuk; `Purchase` bukan expense. **[Source]**

### Bucket
- **Inflow:** `kasir` (Payment method `KASIR`), `qris` (method `QRIS`), `other` (metode lain/null). `inflow.total = totalIn`.
- **Outflow:** `refundKasir`/`refundQris`/`refundUnknown` (dari metode payment induk refund), `expenseCash`/`expenseTransfer`/`expenseQris`/`expenseCard`/`expenseOther`. `outflow.total = totalOut`.
- **attributableCash:** `{ in: inflow.kasir, out: outflow.refundKasir + outflow.expenseCash, net }` — hanya kas fisik.
- **nonCash:** `{ in: inflow.qris + inflow.other, out: refundQris + refundUnknown + expenseTransfer + expenseQris + expenseCard + expenseOther, net }`.
- **Indikator:** `unattributedShift {count, inAmount, outAmount}` (baris `shiftId = null`), `collectedOnCancelledOrders {count, amount}` (pembayaran pada order `CANCELLED`), `qrisSettlementVerified: false`, `openingBalance: null`.

### Rumus **[Source]**
```
totalIn     = Σ Payment(collected).amount
totalOut    = Σ Refund(APPROVED).amount + Σ Expense.amount
netMovement = round2(totalIn − totalOut)          // movement periode, BUKAN saldo absolut

inflow.total  = round2(inflow.kasir + inflow.qris + inflow.other)
outflow.total = round2(Σ semua bucket outflow)

attributableCash.net = round2(inflow.kasir − (outflow.refundKasir + outflow.expenseCash))
nonCash.net          = round2(nonCash.in − nonCash.out)
```
- **`netMovement` bukan saldo absolut**; `openingBalance = null` dan tidak ada running balance. **[Source]**
- Satu baris Payment dihitung **per payment** (bukan per order) → split tender tetap sah.
- `isCash` = instrumen tunai; `settlementVerified` = `method !== "QRIS"` (QRIS = belum settled).
- Per-source cap `FETCH_CAP = 20000`; `meta.truncated` true bila tercapai (UI/CSV memberi tanda). **[Source]**

---

## 3. Tenant / branch / security

- **Authorization:** kedua endpoint `requireAdmin(branchHintFrom(request))` → non-admin 403. **[Source]**
- **Tenant:** `restaurantId` **selalu dari sesi** (`ctx.restaurantId`); tidak pernah dari body/query. Zod menolak query invalid sebelum query DB. **[Source]**
- **Branch:** list/export difilter `authorizedBranches(ctx)` (predikat `branchId` di service); `branchId` eksplisit divalidasi `assertBranchInScope` (branch di luar assignment → 403). Baris `branchId = null` tidak muncul untuk admin branch-scoped (pola report existing). **[Source][Test]**
- **No sensitive data:** entri tidak mengekspos `rawData`/gateway payload. **[Test]**
- **No writes:** service dan kedua route **read-only** (tidak ada `create/update/delete`); tidak ada AuditLog karena tidak ada mutasi. **[Source]**
- **QRIS tidak diklaim settled**; `netMovement` tidak disebut saldo. **[Source]**

---

## 4. Migration impact

**TIDAK ADA migration / perubahan schema.** `git diff --numstat -- prisma/` tetap `78  0  prisma/schema.prisma` (dari PHASE B, tidak tersentuh). Cashbook murni read-model atas tabel existing. Tidak ada `prisma migrate`/`db push`/seed/reset dijalankan. **[Source]**

---

## 5. Hasil tes beserta bukti dan exit status

### 5.1 Harness terisolasi **[Test]**
`_accCverify.ts` (read-only SELECT; **tanpa** menulis DB; file dihapus setelah dipakai):

```
INFO collectedRows=17 expectedIn=607000 expectedOut=30000 ptSum=577000
INFO total=18 totalIn=607000 totalOut=30000 net=577000
PASS  T1  totalIn equals collected Payment sum (once, per row)        — totalIn=607000 expected=607000
PASS  T1b entry ids unique (no duplicate rows)
PASS  T2  PaymentTransaction sum is excluded from totalIn             — totalIn=607000 ptSum=577000
PASS  T3  refund APPROVED counted once, PENDING excluded              — refundOutRows=1 buckets=30000 pending=30000
PASS  T4  outflow = refunds + expenses (no Purchase)                  — totalOut=30000 expected=30000
PASS  T5  netMovement = totalIn - totalOut
PASS  T6  cancelled-order payment flagged without reclassifying       — count=1
PASS  T7  null-shift rows present and flagged (not hidden)            — unattributed=7
PASS  T8a branch filter limits to the authorized branch               — mainIn=240000 allIn=607000
PASS  T8b foreign tenant yields zero rows
PASS  T9a export matches list for the same filter                     — export=17 listTotal=17
PASS  T9b no rawData / gateway payload leaked
PASS  T10a type filter
PASS  T10b method filter
PASS  T10c pagination
PASS  T10d date range excludes everything
PASS  T11 canonical sales stable (517000/30000/487000)
SKIP  T12 non-admin runtime access — no session context

TOTAL 17, PASS 17, FAIL 0
HARNESS_EXIT=0
```

**Pemetaan ke 12 pengujian wajib:**

| # | Uji diminta | Hasil |
|---|---|---|
| 1 | `totalIn` menghitung Payment PAID/REFUNDED sekali | **PASS** (T1, T1b) |
| 2 | PaymentTransaction tidak mengubah total | **PASS** (T2 — `totalIn` 607000 ≠ PT 577000) |
| 3 | Refund APPROVED sekali; PENDING/REJECTED dikecualikan | **PASS** (T3) |
| 4 | Expense sekali; Purchase tidak masuk Expense | **PASS** (T4) |
| 5 | `netMovement = totalIn − totalOut` | **PASS** (T5) |
| 6 | Payment order CANCELLED diberi indikator, aturan kas tak berubah | **PASS** (T6) |
| 7 | Tanpa `shiftId` tidak hilang | **PASS** (T7) |
| 8 | Branch & tenant isolation | **PASS** (T8a, T8b) |
| 9 | CSV konsisten dengan list; tidak bocorkan `rawData` | **PASS** (T9a, T9b) |
| 10 | Filter tanggal/metode/tipe/paginasi | **PASS** (T10a–d) |
| 11 | Canonical Sales Report stabil | **PASS** (T11 → 517000/30000/487000) |
| 12 | Uji akses non-admin | **BELUM DIVERIFIKASI** (SKIP — tanpa sesi NextAuth runtime) |

### 5.2 Static checks **[Test]**
| Perintah | Exit | Hasil |
|---|---|---|
| `npx tsc --noEmit` | **0** | 0 error (dijalankan sebelum & sesudah cleanup). |
| `npm run build` | **0** | Sukses; tidak ada build lain berjalan. 3 rute baru terkompilasi: `/api/admin/accounting/cashbook/route`, `/api/admin/accounting/cashbook/export/route`, `/admin/accounting/cashbook/page`. |
| `git diff --check` | **0** | Bersih; `git diff --cached` kosong. |

---

## 6. Limitation yang belum terverifikasi

1. **Akses non-admin runtime** — mekanisme butuh sesi NextAuth; hanya terbukti **[Source]** (`requireAdmin` di kedua route). **Tidak diklaim lulus runtime.**
2. **Saldo awal/absolut & settlement QRIS ke bank** — tidak ada model; `openingBalance = null`, `qrisSettlementVerified = false`; sengaja **tidak** dihitung. **[Source]**
3. **UI interaktif di browser** — tidak dijalankan; halaman lolos typecheck & build. **[Belum diverifikasi]**
4. **Atribusi drawer** — snapshot: 7 baris tanpa `shiftId` (ditandai, tidak disembunyikan). **[Test]**
5. **Expense** — tabel masih kosong (0 baris) → jalur outflow Expense belum teruji dengan data nyata; diuji secara struktural/logika. **[Test]**
6. **Per-source cap 20000** — dataset besar dapat memicu `meta.truncated` (ditandai di UI/CSV), bukan error. **[Source]**

---

## 7. Git integrity sebelum / sesudah

| Item | Sebelum | Sesudah |
|---|---|---|
| HEAD | `d7f29ac` | `d7f29ac` (tidak berubah) |
| Modified | 23 | 23 |
| Untracked | 44 | 45 (+`src/services/cashbook.service.ts`; file PHASE C lain berada di direktori untracked yang sudah ada) |
| Deleted | 0 | 0 |
| Staged | 0 | 0 |
| `prisma/` diff | 78/0 | 78/0 (tidak berubah) |

Pekerjaan PHASE 4–9B, PHASE B, dan seluruh laporan `.md` **tetap utuh**. Temp harness dihapus (`ls _acc*.ts` → none). Tidak ada `git reset`/`git clean`/`checkout`/`stash`.

---

## 8. Konfirmasi

- **Tidak ada commit, push, deploy, atau perubahan VPS.**
- **Tidak ada perubahan `prisma/schema.prisma` dan tidak ada migration dijalankan.**
- **Tidak ada perubahan data historis** (semua operasi baca = SELECT; harness read-only).
- **Tidak ada engine** Payment/Refund/Expense/CashierShift/Sales/Profitability/cashier ledger yang diubah.
- Tidak menjalankan dua build bersamaan.

**STOP** — menunggu persetujuan. Tidak memulai PHASE D.
