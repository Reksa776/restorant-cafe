# ACCOUNTING INTEGRITY MONITORING — IMPLEMENTATION REPORT

**Repo:** `/home/reksa/restorant-cafe` — **Status:** SELESAI (menunggu review)
**Basis:** `ACCOUNTING-INTEGRITY-MONITORING-AUDIT.md` (scope disetujui)
**Aturan:** read-only, tanpa schema/migration/DDL/DML, tanpa menyentuh revenue/COGS/P&L, tanpa scheduler/alerting/UI/ekspor, tanpa commit/push/deploy, tidak memulai Phase E.

---

## 1. File Berubah

**Baru (5 file) — tidak ada file tracked yang diubah/dihapus:**

| File | Isi |
|---|---|
| `src/services/accounting/integrity.types.ts` | Skema query Zod v4 (`IntegrityQuerySchema`) + tipe hasil/kontrak API |
| `src/services/accounting/integrity.rules.ts` | Aturan murni tanpa DB: cutoff constant, `classifyCompletionBucket`, `deriveOverallStatus`, `revenueWithoutItemsStatus`, `completedWithoutSnapshotStatus`, `reconciliationStatus` |
| `src/services/accounting/integrity.service.ts` | Service read-only: 3 pemeriksaan + resolusi cutoff dari `_prisma_migrations` |
| `src/app/api/admin/accounting/integrity/route.ts` | `GET` endpoint ADMIN-only |
| `src/services/accounting/integrity.unit.test.ts` | Unit test murni (14 test) |

**Tidak diubah:** `prisma/schema.prisma`, `prisma/migrations/*`, `profitability.service.ts`, `pnl.service.ts`, `report.service.ts`, `historical-snapshot.ts`, `order.service.ts`, config, data. Tidak ada migration baru.

**Reuse (tanpa duplikasi):** `revenueScopeWhere` (report.service — predikat revenue kanonik), `requireAdmin`/`branchHintFrom`/`authorizedBranches`/`assertBranchInScope` (auth-helpers), `successResponse`/`errorResponse` (api-response), `ValidationError` (errors), `num` (money), pola `zod/v4` + `z.coerce` + split rules/service mengikuti `pnl.rules.ts`/`coverage.ts`.

---

## 2. API Contract

`GET /api/admin/accounting/integrity?sampleLimit=10&branchId=<id>`

* ADMIN-only (`requireAdmin`). `restaurantId` **selalu** dari sesi, tidak pernah dari query.
* `branchId` hanya hint; divalidasi `assertBranchInScope` lalu service juga menerapkan `authorizedBranches(ctx)`.
* `sampleLimit`: integer 1..50 (default 10) — Zod-validated; di luar rentang → `400 VALIDATION_ERROR`.

```jsonc
{
  "success": true,
  "message": "Pemeriksaan integritas",
  "data": {
    "generatedAt": "ISO-8601",
    "scope": { "restaurantId": "...", "branchIds": ["..."] | null, "sampleLimit": 10 },
    "overallStatus": "OK | WARN | CRITICAL",
    "checks": {
      "revenueOrdersWithoutItems": {
        "code": "REVENUE_ORDER_WITHOUT_ITEMS",
        "status": "OK | CRITICAL",
        "orders": 0, "headerValue": 0,
        "sampleOrderIds": ["..."]
      },
      "completedItemsWithoutSnapshot": {
        "code": "COMPLETED_ORDER_ITEM_WITHOUT_SNAPSHOT",
        "status": "OK | WARN | CRITICAL | UNKNOWN",
        "items": 0, "orders": 0,
        "buckets": {
          "legacyExpected":    { "items": 0, "orders": 0 },
          "anomaly":           { "items": 0, "orders": 0 },
          "unknownCompletion": { "items": 0, "orders": 0 }
        },
        "cutoff": {
          "migration": "20260911143644_f5_order_item_cost_snapshot",
          "appliedAt": "2026-09-11T16:06:57.831Z",
          "resolved": true
        },
        "sampleOrderIds": ["..."]
      },
      "reconciliation": {
        "code": "ORDER_ITEM_SNAPSHOT_RECONCILIATION",
        "status": "OK | CRITICAL",
        "reconciled": true,
        "counts": { "orders": 0, "orderItems": 0, "snapshots": 0 },
        "snapshotByStatus": { "SNAPSHOTTED": 0 },
        "violations": [ { "code": "ORPHAN_SNAPSHOT_ITEM", "count": 0 } ],
        "sampleOrderIds": ["..."]
      }
    }
  }
}
```

`overallStatus`: CRITICAL jika ada check CRITICAL; selain itu WARN bila ada WARN/UNKNOWN; selain itu OK.

---

## 3. Aturan Klasifikasi

**C1 — revenue order tanpa OrderItem.** Set = predikat revenue kanonik (`revenueScopeWhere`: `status <> CANCELLED` DAN (`paymentStatus = PAID` ATAU ada payment `REFUNDED`)) + `items: { none: {} }`. `orders > 0` ⇒ **CRITICAL**. Agregasi server-side (`order.aggregate` + `order.findMany` sample terbatas, tenant+branch scoped).

**C2 — COMPLETED item tanpa snapshot, dipisah legacy vs anomali.**
Dasar: `orderitem` yang order-nya `status = 'COMPLETED'` tanpa baris `orderitemcostsnapshot`. Waktu selesai = `MIN(orderstatushistory.createdAt)` dengan `status = 'COMPLETED'`.
Cutoff **dibuktikan dari migration** (bukan ditebak): migration yang membuat tabel snapshot, `20260911143644_f5_order_item_cost_snapshot`, dengan waktu terpasang dibaca runtime dari `_prisma_migrations.finished_at` = `2026-09-11T16:06:57.831Z`.

| Kondisi | Bucket | Severity |
|---|---|---|
| `done < cutoff` | `legacyExpected` | OK (wajar, pra-F.5) |
| `done >= cutoff` | `anomaly` | **CRITICAL** |
| `done` NULL / cutoff tak teresolusi | `unknownCompletion` | WARN (cutoff teresolusi) / **UNKNOWN** (tidak) |

Snapshot ditulis sekali pada transisi **non-COMPLETED → COMPLETED** untuk **setiap** item (`createOrderItemCostSnapshots`, `order.service.ts`), termasuk item berbiaya tak lengkap (tetap dapat baris, HPP NULL). Karena itu, item pada order COMPLETED **setelah** cutoff tanpa snapshot = anomali nyata. **Tidak pernah** menebak: cutoff tak teresolusi ⇒ semua `unknownCompletion`, status UNKNOWN.

**C3 — rekonsiliasi Order → OrderItem → OrderItemCostSnapshot.** Invarian relasional (bukan asumsi COUNT sama):
`ORPHAN_SNAPSHOT_ITEM`, `SNAPSHOT_ORDER_MISSING`, `SNAPSHOT_ORDER_MISMATCH`, `SNAPSHOT_TENANT_MISMATCH`, `DUPLICATE_SNAPSHOT_PER_ITEM`, dan `SNAPSHOTS_EXCEED_ORDER_ITEMS` (max(0, snapshots − items)). Total violation > 0 ⇒ **CRITICAL**. Counts (`orders/orderItems/snapshots`) & `snapshotByStatus` dilaporkan sebagai informasi.

---

## 4. Hasil Tes Aktual

| Tes | Perintah | Hasil |
|---|---|---|
| Unit (baru) | `npx tsx --test src/services/accounting/integrity.unit.test.ts` | **14 pass / 14** |
| Unit (regresi relevan) | `... integrity.unit.test.ts src/services/profitability/coverage.unit.test.ts` | **29 pass / 29** (14 + 15) |
| Typecheck | `npx tsc --noEmit` | **exit 0** |
| Build | `npm run build` | **exit 0**; route `ƒ /api/admin/accounting/integrity` ter-emit |
| Format diff | `git diff --check` | **exit 0** |
| Read-only | `grep` write-statement pada 3 file sumber | **NONE** |

**Verifikasi integrasi (read-only, DB saat ini):**

| Aspek | Hasil |
|---|---|
| Tenant A (`cmtois…`) — C1 | `orders: 16`, `headerValue: 517000`, `status: CRITICAL`, 5 sample order ID |
| Tenant A — cutoff | `resolved: true`, `appliedAt: 2026-09-11T16:06:57.831Z` |
| Tenant A — C2 | `items: 0` (data historis items sudah tak ada) → OK |
| Tenant A — C3 | `reconciled: true`; counts `orders 35 / items 1 / snapshots 0`; semua violation 0 |
| Isolasi tenant B (`cmu1…`) | C1 `0`, C2 `0`, C3 counts `0/0/0`, semua violation `0` → **tidak ada kebocoran** |
| Param invalid (`sampleLimit=999`) | `ValidationError` (400) — ditolak sebelum query |
| Semantik batas cutoff (SQL, baris inline read-only) | `done < cutoff` ⇒ legacy; `done >= cutoff` ⇒ anomaly; **tepat = cutoff ⇒ anomaly** |
| HTTP auth (server port 3010, tanpa sesi) | `401 {"error":"UNAUTHORIZED"}` — identik dengan route ADMIN `pnl` (kontrol) |

Catatan: angka 16 / Rp517.000 **dihitung** dari data, bukan di-hardcode. C2 bernilai 0 pada data saat ini (tidak ada order COMPLETED yang masih ber-item), jadi jalur anomali C2 diverifikasi lewat unit test + uji semantik SQL, bukan lewat data nyata.

---

## 5. Keamanan Tenant

* `restaurantId` **hanya** dari sesi (`requireAdmin`); tidak ada parameter tenant dari klien.
* Branch: `assertBranchInScope` (hint eksplisit) + `authorizedBranches(ctx)` selalu diterapkan di service.
* Setiap raw SQL membawa predikat tenant: `o.restaurantId = ?` atau `s.restaurantId = ?`. `orderitem` tidak punya `restaurantId` ⇒ selalu di-scope lewat `JOIN \`order\` o`.
* Snapshot di-scope `s.restaurantId = ?`/join order; branch via `o.branchId`/`s.branchId`.
* ADMIN-only; read-only; tidak menulis apa pun; tidak mengekspos PII (hanya order/item id).

---

## 6. Performa

* Agregasi server-side (`COUNT`/`SUM`/`CASE`) + index existing (`orderitem.orderId`, `orderitemcostsnapshot.orderItemId` UNIQUE, `order.restaurantId/createdAt/status`, `orderitemcostsnapshot.status`).
* Beberapa pemeriksaan dijalankan paralel (`Promise.all`); sample dibatasi `LIMIT sampleLimit` (≤50).
* Agregat all-time O(baris) via index — dapat diterima untuk monitor on-demand ADMIN.

---

## 7. Risiko / Regression

| Risiko | Status / Mitigasi |
|---|---|
| Duplikasi predikat revenue | **Tidak** — memakai `revenueScopeWhere` kanonik, tanpa definisi kedua. |
| Mengubah revenue/COGS/P&L | **Tidak** — modul terpisah, read-only, tanpa impor mesin tulis apa pun. |
| False alarm C2 (jendela deploy) | Cutoff = waktu **migration terpasang**; jika kode di-deploy sedikit setelah migration, order selesai di celah itu bisa tampak anomali. Didokumentasikan sebagai batasan; tidak diberi grace period arbitrer (tidak menebak). |
| False anomaly dari tulis DB langsung di luar service | Order yang di-COMPLETED di luar jalur service akan tampak anomali — memang pelanggaran integritas; ambang cutoff tetap terbukti. |
| Cutoff tak teresolusi | Ditandai `resolved:false` + status UNKNOWN; **tidak** mengklasifikasi. |
| Performa all-time | Aggregasi server-side + sample terbatas. |
| Kebocoran tenant | Predikat tenant di semua query; diverifikasi isolasi tenant B = 0. |
| Referensi nama migration | Bergantung pada nama migration F.5 sebagai artefak repo; jika migration di-rename di masa depan, cutoff jadi tak teresolusi (aman: UNKNOWN, bukan salah klasifikasi). |

---

## 8. Git Status Sebelum/Sesudah

**Sebelum:** `HEAD=d7f29ac`, modified tracked `29`, staged `0`, untracked `57`, `prisma/` numstat `78 0`.

**Sesudah:** `HEAD=d7f29ac`, modified tracked `29` (tidak berubah), staged `0`, untracked `57` (tak berubah sebagai *entry* karena file baru berada di dalam direktori `src/services/accounting/` dan `src/app/api/admin/accounting/` yang sudah untracked), `prisma/` numstat `78 0` (tidak berubah).

**Konfirmasi kepatuhan:**
- ✅ Tidak ada file tracked yang diubah/dihapus; hanya 5 file **baru**.
- ✅ Tidak mengubah schema/migration/config; tidak ada DDL/DML; tidak ada seed/reset/backfill.
- ✅ Tautan HTTP dijalankan pada port **3010** (server dihentikan), hanya GET tanpa sesi → 401; port 3000 tidak disentuh; tidak ada akses production/VPS.
- ✅ Tidak commit/push/deploy; tidak memulai Phase E.
- ✅ Temp file dihapus (tidak ada sisa); `.next` sudah gitignored.

---

## 9. Limitation / Catatan (dilaporkan apa adanya)

* Uji jalur HTTP **terautentikasi** sebagai ADMIN dan branch-scoped belum dijalankan end-to-end (butuh sesi login); guard memakai `requireAdmin` existing yang sudah teruji di route lain, dan kontrol tak-tersesi memberi 401 yang sama dengan route P&L.
* C2 anomali tidak dapat diuji pada data nyata karena saat ini tidak ada order COMPLETED ber-item; diverifikasi lewat unit test + uji semantik SQL dengan baris inline (read-only), tanpa DML.
* Cutoff legacy bersumber dari metadata migration (`_prisma_migrations`) — dapat dibuktikan dan konsisten dengan artefak migration + dokumen F.5; **tidak** membutuhkan keputusan blocker.

**STATUS: SELESAI — menunggu review. Tidak ada implementasi tambahan/commit/push/deploy.**
