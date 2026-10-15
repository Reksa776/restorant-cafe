# ACCOUNTING M2 — SNAPSHOT ENGINE DEPLOY-TIME AUDIT & SOLUTION PROPOSAL

Versi: **v3 — revisi STATUS SEMANTICS, MARKER SCOPE & ACCEPTANCE SPLIT (2026-10-10)**, lihat §16. §14–§15 tetap dipertahankan sebagai riwayat v2; bila ada pertentangan, **§16 yang berlaku**. Status: **PROPOSAL REVISION ONLY — belum ada implementasi, belum ada perubahan code/schema/migration/database, belum ada commit/push/deploy, tanpa akses VPS/production.**
Tanggal audit: 2026-10-10 (± 09:40 WIB / 02:40 UTC)
Repo: `/home/reksa/restorant-cafe`
Semua pemeriksaan DB bersifat **read-only** (`SELECT`). Tidak ada INSERT/UPDATE/DELETE, tidak ada migration, tidak ada akses VPS/production.

---

## 0. Koreksi baseline (WAJIB dibaca lebih dulu)

Brief M2 menyebutkan baseline berikut. Hasil verifikasi read-only menunjukkan **baseline tersebut sudah tidak berlaku**:

| Klaim brief | Fakta terverifikasi (read-only) |
|---|---|
| HEAD = `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` | HEAD = **`e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0`** ("fix selesai orderan", 2026-10-10 09:25:44 +0700). `d7f29ac` adalah **ancestor** (3 commit di belakang). |
| "Banyak pekerjaan accounting dan fitur lain masih uncommitted" | `git status` = **working tree clean** (0 modified / 0 untracked). Pekerjaan M1 (Menu Engineering), Integrity Monitoring F1–F4, dan decoupling Order Completion **sudah ter-commit**. |
| "Prisma schema memiliki perubahan existing yang belum di-commit" | `prisma/schema.prisma` **clean** (tidak ada perubahan uncommitted). |
| "Migration Expense `20261009_add_expense_management` … belum selesai deployment planning-nya" | Migration Expense **sudah terpasang** di DB yang dipakai audit ini: `_prisma_migrations.finished_at = 2026-10-09 03:40:31.705` (UTC) = 10:40:31 WIB. |

Konsekuensi audit: konteks M2 harus dibaca ulang atas **kode yang sudah commit**, dan dua commit terakhir (`bd9219a`, `e8d4aa3`) **mengubah sifat C2 secara mendasar** (§4.4). Baseline `d7f29ac` hanya dipakai sebagai titik referensi historis.

---

## 1. Executive summary

1. **C2 hari ini tidak dapat mengklasifikasi kondisi nyata di DB audit ini**: `ORDER COMPLETED tanpa snapshot` = **0 item / 0 order** (`status: OK`), karena seluruh DB hanya punya **1 baris `orderitem`** (dan baris itu milik order berstatus `READY`). Semua order COMPLETED ber-revenue **tidak punya item** — itu domain **C1**, bukan C2.
2. **Cutoff C2 (`_prisma_migrations.finished_at` untuk `20260911143644_f5_order_item_cost_snapshot` = 2026-09-11T16:06:57.831Z) sudah benar secara teknis** (round-trip UTC-nya konsisten, dan checksum membuktikan migration yang diterapkan adalah versi **pasca**-perbaikan collation). Yang belum terbukti adalah **hubungannya dengan aktivasi engine di production** — persis seperti kekhawatiran brief.
3. **Bukti deployment yang sebelumnya dianggap tidak ada ternyata TERSEDIA**: metadata run GitHub Actions (`Deploy to VPS`, dipicu `push` ke `main`) dapat dibaca read-only lewat GitHub API (repository metadata, bukan VPS/production). Ini memberi **batas bawah-nyata** waktu deploy per commit. Namun bukti itu membuktikan *pipeline dijalankan*, **bukan** bahwa proses aplikasi sudah memuat kode baru pada saat tertentu.
4. **Penemuan baru yang paling penting**: sejak commit `bd9219a`/`e8d4aa3`, penulisan snapshot **dipindahkan dari dalam transaksi `READY → COMPLETED` ke BEST-EFFORT post-commit** (try/catch, hanya `console.error`). Akibatnya muncul **kelas root-cause baru yang permanen**: order **benar-benar COMPLETED tanpa snapshot karena kegagalan tulis**, tanpa error apa pun ke user, dan **C2 adalah satu-satunya detektor**. Ini **menggugurkan Opsi C** (menurunkan severity) sebagai pilihan yang aman.
5. **Rekomendasi (direvisi di v2 — lihat §14)**: **Opsi D + penanda berbasis data Opsi B** ("evidence terpisah dari severity"), yaitu:
   - **tidak mengubah** cutoff dan tidak mengarang timestamp;
   - tambahkan **penanda observasi yang terbukti dari data sendiri**: `firstObservedSnapshotAt = MIN(orderitemcostsnapshot.completedAt)` dalam scope tenant/branch. Nama ini **sengaja tidak** memakai kata "engine/live/activation": ia hanya membuktikan **snapshot pertama yang teramati di dataset**. `snapshot ada` ⇒ engine **pernah** menulis; `snapshot tidak ada` ⇒ **tidak** membuktikan apa pun tentang engine. Ia **bukan** waktu deploy dan **bukan** waktu aktivasi;
   - bila penanda ada → item `[cutoff, firstObservedSnapshotAt)` = **UNKNOWN (bucket `beforeFirstSnapshot`)** — **bukan** HEALTHY/OK — dan item `≥ firstObservedSnapshotAt` = **anomali nyata → CRITICAL**;
   - bila penanda **tidak ada** (0 snapshot, kondisi DB ini) → **perilaku CRITICAL dipertahankan tanpa penurunan severity** dan payload diberi label eksplisit `evidenceLevel: "MIGRATION_ONLY"` + `activationUnproven: true` sehingga API/UI tidak mengklaim bukti yang tidak dimiliki.
6. Tidak diperlukan schema/migration untuk rekomendasi utama (kolom & `@@index([completedAt])` sudah ada). Tidak ada perubahan rumus revenue/refund/COGS/profit. Tenant & branch isolation tidak berubah.

---

## 2. Bukti yang ditemukan dan sumbernya

| # | Bukti | Sumber (read-only) | Sifat |
|---|---|---|---|
| E1 | Pemanggil snapshot **tunggal**: `createOrderItemCostSnapshots()` dipanggil hanya dari `OrderService.updateOrderStatus` | `src/services/costing/historical-snapshot.ts` L271; `src/services/order/order.service.ts` L29 (import), L1843 (call) | **[Source]** |
| E2 | Snapshot kini ditulis **post-commit, best-effort** | `src/services/order/order.service.ts` L1828–L1848 (blok di luar `prisma.$transaction`; `try/catch` di L1841–L1848) | **[Source]** |
| E3 | C2 memakai cutoff = `_prisma_migrations.finished_at` migration F5, dibaca runtime | `src/services/accounting/integrity.service.ts` L77–L116 (`resolveLegacyCutoff`), dipanggil di L173 (`checkCompletedItemsWithoutSnapshot`) | **[Source]** |
| E4 | `codeDeployUnproven` sudah ada dan **selalu true** | `src/services/accounting/integrity.rules.ts` L174–L184 (`buildCutoffEvidence`; `codeDeployUnproven: true` di L183); `integrity.types.ts` L70–L86 | **[Source]** |
| E5 | Migration F5 terpasang di DB audit ini | `_prisma_migrations`: `20260911143644_f5_order_item_cost_snapshot` → `started_at 2026-09-11 16:06:57.572`, `finished_at 2026-09-11 16:06:57.831` | **[Test]** |
| E6 | Migration yang diterapkan = versi **pasca**-fix collation (f835e13) | `sha256(migration.sql@HEAD)` = `f4234f86…` **sama** dengan `_prisma_migrations.checksum`; versi pra-fix (`4b5895c`) = `7b9067d4…` (beda) | **[Test]** |
| E7 | Kode F1–F6 pertama masuk source | commit `4b5895c` "feat: add cost intelligence foundation F1-F6", author date 2026-09-11 **16:31:58 +0700** (= 09:31:58 UTC) | **[Source/git]** |
| E8 | Merge PR #1 `f1-f6-cost-intelligence` | commit `789529d`, 2026-09-11 22:01:16 +0700 | **[Source/git]** |
| E9 | Deploy = GitHub Actions pada **push ke main** | `.github/workflows/deploy.yml` (ssh ke VPS → `cd ~/restorant-cafe && ./deploy.sh`) | **[Source]** |
| E10 | `deploy.sh` (versi historis terakhir di git) menjalankan: `git fetch/reset --hard origin/main` → `npm ci` → `npx prisma generate` → **`npx prisma migrate deploy`** → `npm run build` → **`pm2 reload toko`** | `git show cf72b02:deploy.sh` (baris 250–302) | **[Source/git]** |
| E11 | **`deploy.sh` TIDAK ada di working tree/HEAD repo** (hanya versi historis) → skrip yang dieksekusi VPS tidak dapat diverifikasi dari repo | `git ls-files`; `git log --all -- deploy.sh` berakhir di `bdab770` (2026-09-03) | **[Test → LIKELY]** |
| E12 | Metadata run deploy (UTC), read-only via GitHub API | `gh run list / gh run view` (repo metadata, bukan VPS) | **[Test]** |
| E13 | DB audit ini = **DB dev host**, bukan production | `AUDIT-R7.0-APP-WORKER-DATABASE-ENVIRONMENT.md` §"HOST native MariaDB `localhost:3306/restaurant_app`" + `docker ps` (`restaurant-mariadb` di **3307**); DB 3307 kosong (0 order, 0 tabel migrations) | **[Test]** |
| E14 | DB dev pernah di-**restore/import** pada 2026-09-12 13:41 WIB (06:41 UTC); `_prisma_migrations` mempertahankan timestamp lama | `ACCOUNTING-PHASE-D2-MISSING-ORDERITEM-AUDIT.md` §21/§103/§108 (CREATE_TIME seragam) | **[Test]** |
| E15 | Baris `_prisma_migrations` Expense (2026-10-09 03:40:31) bersesuaian dengan apply **lokal** pekerjaan Expense yang saat itu uncommitted ⇒ ledger lokal **memuat apply lokal** | E5 + M3 di `FINAL-ACCOUNTING-READINESS-AUDIT.md` (Expense uncommitted pada 09-10) | **[LIKELY]** |
| E16 | Aktivitas COMPLETED +7,3 dan +10,8 menit setelah cutoff **nyata di DB ini**: `ORD-20260911-JK2E2C` (16:14:15.791) & `ORD-20260911-N11PN1` (16:17:47.362) | `orderstatushistory` (MIN(createdAt) status COMPLETED) | **[Test]** |
| E17 | Kedua order di E16 **tidak punya `orderitem`** sehingga **tidak masuk C2 sama sekali** | `SELECT … FROM orderitem` → hanya 1 baris, milik `ORD-20261007-ZW6RV0` (status READY) | **[Test]** |
| E18 | **0 baris `orderitemcostsnapshot`** di DB audit → tidak ada bukti engine pernah menulis | `SELECT COUNT(*) FROM orderitemcostsnapshot` = 0; status distribution = kosong | **[Test]** |
| E19 | Kondisi C1/C2/C3 aktual | `getIntegrityReport()` dijalankan read-only: C1 CRITICAL 16 order/Rp517.000; **C2 `OK` items 0/orders 0, semua bucket 0**; C3 `reconciled: true`, counts 35/1/0 | **[Test]** |
| E20 | Timezone: session DB `SYSTEM`/`WIB (+07)`; `order.createdAt` vs `orderstatushistory.createdAt` (status PENDING) hanya berbeda **18–24 ms** dengan kolom `@updatedAt` (client-side) pada detik yang sama ⇒ **satu konvensi UTC**, tidak ada pencampuran | `SELECT NOW(3), UTC_TIMESTAMP(3)`, perbandingan lintas tabel | **[Test]** |
| E21 | `git status --short` sebelum audit = **kosong** | terminal | **[Test]** |
| E22 | Migration Expense **sudah** terpasang (lihat §0) | E5-style query pada `_prisma_migrations` | **[Test]** |
| E23 | **DB audit = DB dev host-native**: `DATABASE_URL` di `.env` = `mysql://root:***@localhost:3306/restaurant_app`; server `11.8.8-MariaDB`, `@@port=3306`, `@@hostname=webdev` | parse `.env` (hanya host/port/db yang dicetak, kredensial tidak) + `SELECT VERSION(), @@port, @@hostname` | **[Test]** |
| E24 | DB Docker `restaurant-mariadb` (port **3307**) punya 43 tabel tetapi **0 baris `order`** ⇒ bukan dataset audit, dan tetap bukan production | `mysql -h 127.0.0.1 -P 3307 … information_schema.tables` + `COUNT(*) FROM order` | **[Test]** |
| E25 | **Tidak ada kredensial production di lingkungan ini**: deploy VPS memakai GitHub **secret** `VPSBIZNET`/`VPS_NAME`/`VPS_SSH_KEY` (write-only, tidak ada di repo); token `gh` hanya berscope `gist, read:org, repo, workflow` ⇒ tidak dapat membaca nilai secret | `.github/workflows/deploy.yml` L16–L18; `gh auth status` | **[Test]** |
| E26 | Deploy **2026-10-10**: run `38013458467` (`bd9219a`) **FAILURE** 01:30:47→01:40:59Z; run `38016937824` (`e8d4aa3`) **SUCCESS** 02:25:58→02:34:51Z (step "Deploy to VPS" 02:26:01→02:34:48Z) | `gh run list`/`gh run view --json jobs` (metadata repo, **tanpa** `--log`) | **[Test]** |
| E27 | `~/.ssh/known_hosts` memuat 3 host non-GitHub (`100.88.79.104`, `103.93.132.214`, `139.190.97.242`); `next.config.ts` L5 `allowedDevOrigins` memuat `100.88.79.104` | `awk` pada `known_hosts`; `next.config.ts` | **[Test]** — entri known_hosts membuktikan **pernah** ada koneksi SSH dari mesin ini, **bukan** bahwa production DB dapat/boleh diakses |
| E28 | Hitungan DB **identik** dengan audit v1 (order 35, orderitem 1, orderstatushistory 108, snapshot 0, auditlog 44, `_prisma_migrations` 28) ⇒ seluruh verifikasi v2 juga `SELECT`-only | pengulangan query read-only | **[Test]** |

---

## 3. Timeline: migration, source availability, deployment evidence

Semua waktu ditampilkan **UTC** (konvensi penyimpanan terverifikasi di E20; WIB = UTC+7 hanya sebagai anotasi).

| Waktu (UTC) | Waktu (WIB) | Peristiwa | Sumber | Tingkat bukti |
|---|---|---|---|---|
| 2026-09-11 09:31:58 | 16:31:58 | Commit `4b5895c` — kode F1–F6 (termasuk `historical-snapshot.ts`) masuk repo | git | **[Source]** |
| 2026-09-11 15:01:19 → 15:06:14 | 22:01 → 22:06 | **Deploy run** `34613619303` (`789529d`, merge PR #1) sukses | E12 | **[Test]** |
| 2026-09-11 15:45:46 → (rolled back 15:54:10) | 22:45 → 22:54 | Percobaan `prisma migrate deploy` **gagal** (`20260911_add_ingredient_f1`, `applied_steps_count = 0`) | DB | **[Test]** |
| 2026-09-11 15:47:10 → 15:50:48 | 22:47 → 22:50 | **Deploy run** `34618184412` (`7a463d3` "navbar") sukses | E12 | **[Test]** |
| 2026-09-11 15:55:41 → (rolled back 16:05:08) | 22:55 → 23:05 | Percobaan migrate F1 **gagal** lagi | DB | **[Test]** |
| 2026-09-11 16:02:01 | 23:02:01 | Commit `f835e13` "fix: align F1-F5 migration collations" | git | **[Source]** |
| 2026-09-11 16:02:28 → 16:05:36 | 23:02 → 23:05 | **Deploy run** `34619665733` (`f835e13`) sukses; step "Deploy to VPS" 16:02:32 → 16:05:34 | E12 | **[Test]** |
| 2026-09-11 16:06:55 → **16:06:57** | 23:06:55 → 23:06:57 | **Migration F1–F5 terpasang sukses** (checksum = versi pasca-fix) | E5, E6 | **[Test]** |
| 2026-09-11 16:14:15 | 23:14:15 | `ORD-20260911-JK2E2C` → COMPLETED (**+437 s**) — **0 item** | E16, E17 | **[Test]** |
| 2026-09-11 16:16:57 → 16:17:47 | 23:16 → 23:17 | `ORD-20260911-N11PN1` dibuat → COMPLETED (**+649 s**) — **0 item** | E16, E17 | **[Test]** |
| 2026-09-11 16:25:22 | 23:25:22 | Aktivitas aplikasi terakhir yang tercatat di DB ini (`auditlog PAYMENT_RECEIVED`) | DB | **[Test]** |
| 2026-09-12 06:41 | 13:41 | **Restore/import DB** (CREATE_TIME seragam semua tabel dasar) | E14 | **[Test → LIKELY]** |
| 2026-10-09 03:40:31 | 10:40:31 | Migration Expense terpasang (di DB ini) | E22 | **[Test]** |

### 3.1 Jawaban langsung atas pertanyaan §3.A

| # | Pertanyaan | Jawaban | Bukti |
|---|---|---|---|
| 1 | Migration selesai | **BUKTI ADA.** `finished_at = 2026-09-11T16:06:57.831Z` (dan checksum membuktikan versi file yang benar). | E5, E6 |
| 2 | Snapshot engine pertama tersedia di source | **BUKTI ADA.** Commit `4b5895c` (2026-09-11 09:31:58Z) → merged `789529d` (15:01:19Z). | E7, E8 |
| 3 | Snapshot engine pertama dipanggil oleh production application | **TIDAK TERBUKTI.** Production DB tidak boleh diakses pada tugas ini; DB audit ini punya 0 baris snapshot dan tidak ada application log. Tidak ada bukti pemanggilan pertama. | E13, E18 |
| 4 | Snapshot engine aktif di production | **TIDAK TERBUKTI (hanya dapat dibatasi).** Batas bawah yang tersedia: deploy run `789529d` selesai 15:06:14Z (kode ada di VPS) dan run `f835e13` selesai 16:05:36Z (restart `pm2 reload` ada di akhir script historis, E10). Batas itu **bukan** bukti proses memuat kode baru, dan bukan bukti tabel sudah ada saat itu. | E10, E11, E12 |
| 5 | Waktu deployment dapat dibuktikan atau hanya diperkirakan | **Campuran.** (a) **Dapat dibuktikan**: *invocation* deploy (run id, start/end UTC) lewat GitHub Actions API — bukti pihak ketiga di luar repo. (b) **Hanya diperkirakan**: waktu *efektif* engine dapat menulis, karena (i) `deploy.sh` yang benar-benar dieksekusi tidak ada di repo (E11), (ii) urutan `migrate deploy` → `build` → `reload` hanya diketahui dari versi historis, (iii) migrasi ledger di DB audit ini **tidak terbukti berasal dari production** (E13–E15). | E10–E15 |

### 3.2 Temuan provenance cutoff (penting)

DB yang dipakai audit ini adalah **DB dev host** (E13) yang pernah di-restore pada 2026-09-12 (E14). Ledger lokal **terbukti memuat apply lokal** (baris Expense, E15 — pekerjaan yang saat itu belum di-commit dan tidak pernah dideploy). Karena itu:

* Nilai cutoff `2026-09-11T16:06:57.831Z` adalah **nilai yang benar untuk DB ini**, dan kode C2 memang membaca ledger dari DB yang sama (self-consistent by construction) — **tidak ada bug membaca ledger**.
* Namun **tidak terbukti** nilai itu sama dengan ledger **production**. Jika di production migration terpasang pada waktu lain, batas bucket C2 juga berbeda.
* **Action item untuk reviewer (read-only, di production):** jalankan satu query `SELECT migration_name, started_at, finished_at, checksum FROM _prisma_migrations WHERE migration_name = '20260911143644_f5_order_item_cost_snapshot'` pada DB production, lalu bandingkan `finished_at` dengan `16:06:57.831Z` **dan** bandingkan **signature data**: apakah `orderitem` pada order COMPLETED di production juga hilang (E17/E19) atau tidak. Semua angka "16 order / Rp517.000 / 1 item / 0 snapshot" pada laporan-laporan M1/M2 adalah **angka dev**, bukan production.

### 3.3 Status verifikasi production pada revisi v2: **BLOCKED** (tidak ada otorisasi & tidak ada kredensial)

Brief M2 meminta verifikasi read-only atas **production**: cutoff migration C2, snapshot yang benar-benar tersimpan, kondisi C2 di production, waktu snapshot pertama yang dapat dibuktikan dari data, dan perbedaan fakta production vs dev. Pada lingkungan ini **tidak satu pun** dapat dijalankan, dan **tidak ada angka dev yang dipakai sebagai pengganti**.

| # | Yang diminta | Status | Alasan / bukti |
|---|---|---|---|
| P1 | Cutoff C2 di production (`_prisma_migrations` F5) | **BLOCKED** | Tidak ada kredensial DB production di lingkungan ini. `DATABASE_URL` menunjuk **`localhost:3306/restaurant_app`** (host-native dev), server `11.8.8-MariaDB`, `@@port = 3306`, `@@hostname = webdev` (E23). DB Docker di **3307** punya 43 tabel tetapi **0 order** (E24) — bukan dataset audit, dan tetap bukan production. |
| P2 | Snapshot yang benar-benar tersimpan di production (jumlah + `MIN(completedAt)`) | **BLOCKED** | Sama seperti P1. Di DB lokal: `orderitemcostsnapshot` = **0 baris** dan `MIN(completedAt) = NULL` (E18) ⇒ **tidak ada** `firstObservedSnapshotAt` yang dapat dihitung di sini, dan nilai lokal tidak boleh diklaim sebagai production. |
| P3 | Kondisi C2 di production (COMPLETED tanpa snapshot pasca-cutoff) | **BLOCKED** | Sama seperti P1. Di DB lokal C2 = 0 item / 0 order (E19) — dan angka itu **tetap bercap dev**. |
| P4 | Waktu snapshot pertama yang dapat dibuktikan dari data | **BLOCKED untuk production.** Di DB lokal: **tidak tersedia** (0 snapshot ⇒ `NULL`) | `firstObservedSnapshotAt = MIN(orderitemcostsnapshot.completedAt)`. Tanpa baris snapshot tidak ada nilai yang dapat dibuktikan; **tidak** diisi dengan asumsi (mis. cutoff) atau dengan angka dev. |
| P5 | Perbedaan fakta production vs dev | **HANYA DAPAT DINYATAKAN "TIDAK DIKETAHUI"** | Yang **bisa** dibuktikan: DB yang diaudit **bukan** production (E23–E24) dan ledger lokal memuat apply lokal (E15). Yang **tidak** bisa: apakah production juga kehilangan `orderitem`, apakah C2 production 0, apakah cutoff production = `16:06:57.831Z`. |

**Akses production memang tidak tersedia, bukan sekadar tidak dijalankan:**

* Deploy production dijalankan lewat GitHub Actions memakai **secret** `VPSBIZNET` / `VPS_NAME` / `VPS_SSH_KEY` (`.github/workflows/deploy.yml` L16–L18). Nilai secret **write-only** dan tidak ada di repo; token `gh` lokal hanya berscope `gist, read:org, repo, workflow` ⇒ **tidak dapat membaca nilai secret** (E25).
* `~/.ssh/known_hosts` memuat tiga host non-GitHub (E27). Entri known_hosts hanya membuktikan **pernah** ada koneksi SSH dari mesin ini — **bukan** bukti bahwa DB production dapat (atau kini boleh) diakses dari sesi ini, dan tidak ada kredensial DB production di `.env`. Sesuai guardrail, **tidak ada** percobaan koneksi ke VPS/production.
* Bahkan seandainya `.env` VPS yang identik terbaca, `DATABASE_URL`-nya akan menunjuk `localhost` **milik VPS itu**, sehingga tetap tidak dapat diverifikasi dari mesin ini.

**Bukti yang masih dibutuhkan (read-only, dijalankan di production oleh pemilik akses):**

1. `SELECT migration_name, applied_steps_count, started_at, finished_at, checksum FROM _prisma_migrations WHERE migration_name = '20260911143644_f5_order_item_cost_snapshot';` → cutoff production + verifikasi checksum.
2. `SELECT COUNT(*) FROM orderitem;` dan `SELECT COUNT(*), MIN(completedAt), MAX(completedAt) FROM orderitemcostsnapshot;` → apakah production punya snapshot sama sekali, dan berapa `firstObservedSnapshotAt` production.
3. `SELECT COUNT(DISTINCT i.orderId), COUNT(*) FROM orderitem i JOIN \`order\` o ON o.id = i.orderId LEFT JOIN orderitemcostsnapshot s ON s.orderItemId = i.id WHERE o.status = 'COMPLETED' AND s.id IS NULL;` → signature C2 production.
4. `SELECT COUNT(*) FROM \`order\` o WHERE o.grandTotal > 0 AND NOT EXISTS (SELECT 1 FROM orderitem i WHERE i.orderId = o.id);` → apakah production juga punya order headless (C1). Jika **tidak**, seluruh analisis struktur C2/C1 di laporan ini tidak berlaku untuk production.
5. Konfirmasi isi `deploy.sh` yang benar-benar ada di VPS (urutan `migrate deploy` → `build` → `pm2 reload`).

**Aturan pelaporan:** sampai kelima bukti itu ada, **semua** angka pada laporan ini (`16 order`, `Rp517.000`, `1 orderitem`, `0 snapshot`, cutoff `16:06:57.831Z`) wajib dibaca sebagai **angka DEV**, dan **tidak boleh** menjadi dasar keputusan production.

### 3.4 Bukti deploy tambahan (read-only, repository metadata) — relevan untuk M2

| Waktu (UTC) | Waktu (WIB) | Run | Commit | Hasil |
|---|---|---|---|---|
| 2026-10-10 01:30:47 → 01:40:59 | 08:30 → 08:40 | `38013458467` ("fix selesai ordera") | `bd9219a` | **FAILURE** (step "Deploy to VPS" 01:30:51 → 01:40:56) |
| 2026-10-10 02:25:58 → 02:34:51 | 09:25 → 09:34 | `38016937824` ("fix selesai orderan") | `e8d4aa3` | **SUCCESS** (step "Deploy to VPS" 02:26:01 → 02:34:48) |

Implikasi (dibatasi pada yang benar-benar dibuktikan): kode **best-effort post-commit** (`e8d4aa3`, E2) baru **mungkin** aktif di production paling cepat **2026-10-10 02:34:48Z**. Yang **tidak** dibuktikan: apakah build/reload berhasil pada detik itu (log langkah tidak dibaca — isinya output VPS dan berada di luar otorisasi tugas ini), dan berapa banyak kegagalan tulis snapshot sejak itu. Ada pula satu run **FAILURE** tepat sebelumnya (01:40:59Z) yang menambah ketidakpastian status deploy pada jendela itu. Tanpa akses production, awal jendela RC-2 di production **tidak dapat** ditentukan dari sini.

---

## 4. Root cause: terbukti vs hipotesis

### 4.1 Terbukti (**[Test]**)

1. **Cutoff terpasang ≠ engine aktif.** `_prisma_migrations.finished_at` mencatat kapan DDL selesai; ia tidak mencatat kapan proses aplikasi mulai mengeksekusi jalur snapshot. Tidak ada kolom/artefak apa pun di DB yang merekam waktu aktivasi engine. (E5, E3)
2. **Komparasi waktu C2 secara teknis benar.** `orderstatushistory.createdAt` dan cutoff yang dibaca Prisma berada pada konvensi **UTC** yang sama (E20); presisi keduanya `datetime(3)`; klasifikasi batas `≥ cutoff ⇒ anomaly` konsisten. **Bukan** sumber false-positive.
3. **Root cause "COMPLETED tanpa snapshot" bersifat majemuk**, minimal:
   - **RC-1 jendela aktivasi** (deployment/restart lag): kode lama + tabel sudah ada ⇒ jalur completion lama tidak menulis snapshot. Terbukti **mungkin** karena migration dan restart berada pada rentang waktu yang berbeda (E10/E12), dan ada aktivitas completion di jendela itu (E16).
   - **RC-2 kegagalan tulis snapshot pasca-commit** (lihat §4.4) — **baru & permanen**.
   - **RC-3 kehilangan data oleh restore/import**: 0 baris snapshot + 1 baris orderitem, dengan bukti restore 2026-09-12 (E14, E18). Snapshot bisa hilang melalui cascade FK `orderitem.id → orderitemcostsnapshot.orderItemId`.
   - **RC-4 data historis tidak lengkap sejak awal** (mis. order pra-F5 yang juga headless).
4. **Saat ini C2 = 0 item / 0 order.** Klaim "ada anomali CRITICAL" **tidak berlaku** pada dataset ini.

### 4.2 Hipotesis (**[LIKELY]** / **[NOT VERIFIED]**)

| Hipotesis | Status | Alasan |
|---|---|---|
| Cutoff ledger local = cutoff ledger production | **[NOT VERIFIED]** | Ledger lokal memuat apply lokal (E15); 24 jam sebelum ledger ada restore (E14). |
| Produksi juga punya order COMPLETED tanpa item | **[NOT VERIFIED]** | Tidak ada akses production; bentuk data dev (1 item dari 35 order) tidak lazim untuk data operasional nyata. |
| Order `JK2E2C`/`N11PN1` di production **punya item** dan karenanya benar-benar masuk C2 | **[NOT VERIFIED]** | Di DB ini keduanya headless (E17). |
| Urutan `migrate deploy` → `build` → `pm2 reload` masih berlaku di `deploy.sh` VPS saat ini | **[LIKELY]** | Dari versi historis (E10), tetapi file current tidak ada di repo (E11). |
| Deploy `789529d` (15:06:14Z) sudah membuat proses memuat kode F5 | **[LIKELY]** | Run sukses + job step selesai 15:06:14Z; tidak dapat dipastikan dari repo. |

### 4.3 Yang **tidak boleh** disimpulkan

* ❌ "Order COMPLETED tanpa snapshot pasca-cutoff pasti integritas rusak." (bisa RC-1/RC-3)
* ❌ "Snapshot hilang pasti bug aplikasi." (bisa restore/import, RC-3)
* ❌ "Migration 23:06:57 = engine aktif 23:06:57." (tidak terbukti)
* ❌ Sebaliknya: "semua order pasca-cutoff tanpa snapshot wajar, tidak perlu diperiksa." (RC-2 nyata)

### 4.4 Dampak perubahan Order Completion terbaru (`bd9219a`, `e8d4aa3`) — analisis khusus

**Sebelum** (`d7f29ac` dan sebelumnya): pemanggilan `consumeOrderIngredients` + snapshot HPP berada **di dalam transaksi** `READY → COMPLETED`. Kegagalan apa pun ⇒ transaksi rollback ⇒ order **tetap READY** dan tidak ada snapshot. Artinya dulu "COMPLETED tanpa snapshot" **tidak dapat** berasal dari kegagalan tulis pada jalur service normal; ia hanya dapat berasal dari legacy/deploy-window (RC-1) atau restore/penulisan DB di luar service (RC-3/RC-4).

**Sesudah** (`e8d4aa3`, `order.service.ts` L1828–L1848): input snapshot dikumpulkan di dalam transaksi, lalu **eksekusi tulis dijalankan setelah commit, dibungkus `try/catch`**, hanya `console.error`. Order sudah final `COMPLETED`. Konsekuensi:

1. **RC-2 menjadi kelas nyata dan permanen**: DB gagal sesaat / lock timeout / koneksi putus ⇒ order COMPLETED **tanpa snapshot**, **tanpa error ke user**, tanpa retry, dan tanpa jejak selain satu baris log server.
2. **Snapshot tidak pernah ditulis belakangan** (dan memang **tidak boleh** di-backfill: resep/WAC saat backfill ≠ WAC saat completion ⇒ itu akan memalsukan HPP historis). Jadi RC-2 bersifat **permanen** untuk order tersebut.
3. **C2 kini adalah satu-satunya detektor** untuk RC-2 (Integrity Monitoring). Karena itu:
   - **menurunkan severity pasca-cutoff (Opsi C) menjadi berbahaya** — ia akan menyembunyikan kelas kegagalan yang justru baru diperkenalkan;
   - C2 wajib **membedakan** "belum bisa dibuktikan" dari "tidak ada masalah"; bucket `unknown` tidak boleh diperlakukan sehat (dan saat ini memang tidak — lihat §5).
4. Efek samping kecil: `snapshot.completedAt` sekarang **lebih besar** daripada `orderstatushistory.createdAt` COMPLETED untuk order yang sama (ditulis setelah commit). Ini tidak mengganggu C2 (yang memakai `orderstatushistory`), tetapi relevan untuk penanda aktivasi di §7.

---

## 5. False positive & false negative C2 (kondisi saat ini)

**Mekanisme klasifikasi (kondisi sekarang):**

```
done = MIN(orderstatushistory.createdAt WHERE status='COMPLETED') per order
buckets:  done <  cutoff                → legacyExpected   → OK
          done >= cutoff                → anomaly          → CRITICAL (jika > 0)
          done IS NULL / cutoff NULL    → unknownCompletion→ WARN (cutoff resolved) / UNKNOWN (cutoff unresolved)
overallStatus: CRITICAL dominates; UNKNOWN folds to WARN; else OK
```

| Kelas | Definisi | Risiko saat ini |
|---|---|---|
| **False positive** | Item yang ter-COMPLETED dalam **jendela sebelum snapshot pertama teramati** (`cutoff ≤ done < firstObservedSnapshotAt`, yaitu periode yang belum dapat dibuktikan) dinyatakan `anomaly → CRITICAL`. Waktu **aktivasi engine** sendiri tidak pernah diketahui, sehingga jendela itu sebelumnya tidak dapat dipisahkan. | **Nyata tetapi laten.** Di DB ini tidak terealisasi (C2 = 0 karena tidak ada item). Secara mekanisme pasti terjadi pada setiap deploy yang diikuti order ber-item sebelum engine benar-benar menulis snapshot. |
| **False positive (RC-3)** | Snapshot hilang karena restore/import data, bukan karena jalur completion | Nyata pada dataset ini secara struktur (0 snapshot) — namun tertutup oleh C2 = 0. |
| **False negative (RC-2)** | Kegagalan tulis pasca-commit → COMPLETED tanpa snapshot | **TIDAK ADA false negative pada level deteksi**: C2 tetap akan menandainya. Yang belum ada adalah **diskriminator** kegagalan (tidak ada marker eksplisit) sehingga sulit dibedakan dari deploy lag. |
| **False negative (struktural)** | Order **headless** (tanpa `orderitem`) yang COMPLETED tanpa snapshot **tidak pernah muncul di C2** (query C2 ber-`JOIN orderitem`). | Nyata pada dataset ini: 15 dari 16 order COMPLETED headless (E17). Itu **domain C1/D2**, bukan C2 — jangan dicampur. |
| **False negative (cutoff tak teresolusi)** | Ledger tidak tersedia ⇒ semua `unknownCompletion`, status `UNKNOWN` (bukan OK). | Aman: `UNKNOWN` tidak dianggap sehat. |
| **False negative (completion timestamp hilang)** | `orderstatushistory` COMPLETED hilang ⇒ `unknownCompletion` → WARN. | Aman (tidak diam-diam sehat). |

Catatan penting: C2 memakai **`MIN(createdAt)` status COMPLETED**, bukan `order.updatedAt`, sehingga penulisan COMPLETED **di luar jalur service** (mis. SQL langsung, migrasi data) tetap terdeteksi sebagai anomaly sesudah cutoff — perilaku yang benar dan harus dipertahankan.

---

## 6. Perbandingan Opsi A / B / C / D

Kriteria penilaian: akurasi accounting, risiko false positive, risiko false negative, kompatibilitas API/UI, dampak DB/migration, kemudahan operasional, kemampuan audit masa depan.

### Opsi A — Pertahankan cutoff migration (status quo + dokumentasi)
Tetap `cutoff = migration.finished_at`; `anomaly → CRITICAL`; dokumentasikan bahwa CRITICAL = indikasi berbasis cutoff, bukan bukti engine aktif.

* **Akurasi:** sedang. Batasnya benar secara DB, salah secara operasional.
* **False positive:** tetap (jendela aktivasi).
* **False negative:** rendah (konservatif).
* **API/UI:** nol perubahan.
* **DB/migration:** nol.
* **Operasional:** paling mudah; operator menerima CRITICAL yang tidak dapat dibedakan penyebabnya ⇒ **alarm fatigue**.
* **Audit masa depan:** lemah — tidak ada jejak mengapa CRITICAL dianggap wajar pada suatu jendela.

### Opsi B — Cutoff berdasarkan deployment evidence
Pakai bukti **hanya bila ada bukti terpercaya**; mis. `effectiveCutoff = max(migration.finished_at, firstObservedSnapshotAt)` (dengan catatan: penanda berbasis snapshot adalah **observasi**, bukan bukti deploy — lihat bullet "jangka menengah").

* **Akurasi:** tertinggi jika buktinya kuat.
* **False positive:** turun tajam (jendela aktivasi tidak lagi dihitung sebagai anomali).
* **False negative:** naik **hanya** untuk jendela antara cutoff dan penanda — dapat dikelola dengan tetap melaporkan sebagai bucket tersendiri (bukan OK).
* **API/UI:** aditif (field baru).
* **DB/migration:** nol untuk penanda berbasis data (`MIN(completedAt)` sudah ter-indeks `@@index([completedAt])`).
* **Operasional:** perlu tata kelola bukti deploy. **Cara memperoleh & memelihara (rekomendasi):**
  - **Jangka pendek (tersedia hari ini, tanpa perubahan kode):** metadata GitHub Actions — `gh run list --created <YYYY-MM-DD> --json databaseId,displayTitle,conclusion,createdAt,updatedAt,headSha` dan `gh run view <run-id> --json jobs` (memberi start/end per step `Deploy to VPS`). Ini **bukti pihak ketiga**, read-only, di luar production (yang diakses adalah metadata repo, bukan VPS). Simpan salinan JSON run untuk commit penting ke dokumentasi audit.
  - **Jangka menengah (lebih tahan lama, di dalam sistem):** tulis **penanda observasi yang berasal dari data engine sendiri** — `firstObservedSnapshotAt = MIN(orderitemcostsnapshot.completedAt)` (**tenant-wide — K1, §16.2**; tidak branch-scoped). Nilai ini **berasal dari baris yang benar-benar ditulis engine** (bukan asumsi operator) dan otomatis tersedia **tanpa** perubahan schema. **Batas klaimnya wajib dinyatakan:** ia adalah snapshot **pertama yang teramati di dataset**; sifatnya **lower bound aktivitas engine yang terobservasi** — **bukan** waktu deploy, **bukan** waktu aktivasi, dan **bukan** batas atas kapan engine mulai hidup (snapshot yang lebih tua dapat hilang karena restore/delete). Catatan jujur: ia dapat bergeser karena operasi DB di luar aplikasi (restore/delete) — karena itu §12.1 R1 mewajibkannya **tidak** dipakai untuk menurunkan severity di bawah UNKNOWN.
  - **Jangka panjang (opsional, additive):** catat build/versi + waktu saat startup aplikasi ke `AuditLog` sehingga "kode versi X hidup sejak T" dapat dibaca dari sistem. Ini **lebih persisten** daripada penanda berbasis observasi dan ditulis saat startup (biasanya DB sehat), tetapi tetap **best-effort**: bila penulisan saat startup gagal, tidak ada jaminan jejaknya tersimpan.
* **Audit masa depan:** kuat (bisa menjelaskan kapan & mengapa severity berubah).

### Opsi C — UNKNOWN sampai deployment evidence tersedia
Bucket pasca-cutoff diturunkan menjadi WARN/UNKNOWN sampai bukti ada.

* **Akurasi:** turun.
* **False positive:** hilang.
* **False negative:** **tinggi dan berbahaya setelah `e8d4aa3`** — RC-2 (kegagalan tulis pasca-commit) akan tersembunyi persis di periode di mana kita paling tidak punya bukti.
* **API/UI:** perubahan severity (konsumen bisa menganggap "aman").
* **DB/migration:** nol.
* **Operasional:** mudah, tetapi menyesatkan.
* **Audit masa depan:** lemah (kehilangan jejak kegagalan).
* **Verdict: DITOLAK.** Menurunkan severity tidak boleh menjadi cara mengatasi ketidakpastian.

### Opsi D — Model evidence terpisah dari severity ✅ (+ penanda observasi Opsi B)
Pisahkan **status bukti** dari **severity anomali**:

* Pertahankan `status`/`anomaly` seperti sekarang (CRITICAL tidak pernah diturunkan untuk item yang **terbukti** pasca-snapshot-teramati).
* Tambahkan dimensi bukti eksplisit pada payload:
  - `evidenceLevel: "MIGRATION_ONLY" | "SNAPSHOT_OBSERVED"`
  - `activationUnproven: boolean`
  - `firstObservedSnapshotAt: string | null`
  - `buckets.beforeFirstSnapshot: { items, orders }` (baru; `[cutoff, firstObservedSnapshotAt)`, **UNKNOWN — bukan HEALTHY**)
* Aturan severity yang diusulkan (tidak ada downgrade buta):
  - `firstObservedSnapshotAt` **ada**: `[cutoff, firstObservedSnapshotAt)` → `beforeFirstSnapshot` → **UNKNOWN** (overall WARN, **tidak pernah** OK/HEALTHY); `≥ firstObservedSnapshotAt` → `anomaly` → **CRITICAL**.
  - `firstObservedSnapshotAt` **NULL** (0 snapshot, kondisi DB ini): `≥ cutoff` tetap `anomaly` → **CRITICAL**, **plus** label `evidenceLevel: "MIGRATION_ONLY"` + `activationUnproven: true` sehingga UI/API **tidak** mengklaim bukti. Penanda tidak tersedia ⇒ **tidak ada** penurunan severity dan **tidak ada** jalur dari "penanda NULL" ke OK/HEALTHY.
* **Akurasi:** tinggi — severity hanya "naik kelas" saat bukti tersedia, dan selalu melaporkan tingkat kepastian.
* **False positive:** hilang/berkurang saat penanda tersedia; tetap ada tetapi **berlabel** saat belum tersedia.
* **False negative:** rendah (UNKNOWN selalu tampil sebagai WARN, tidak pernah OK).
* **API/UI:** aditif; **ada satu perubahan semantik** yang harus disosialisasikan: sebagian item yang dulu CRITICAL dapat menjadi UNKNOWN/WARN setelah `firstObservedSnapshotAt` tersedia.
* **DB/migration:** nol.
* **Operasional:** jelas — operator melihat "CRITICAL (terbukti)" vs "UNKNOWN — jendela aktivasi belum terbukti (migration-only)".
* **Audit masa depan:** terkuat (severity + bukti terpisah, dapat direproduksi dari data).

**Risiko khusus Opsi D yang wajib ditangani:** bila terjadi restore/import yang menghapus baris snapshot (E14 — pernah terjadi!), `firstObservedSnapshotAt` **bergerak maju** (jendela UNKNOWN melebar, sehingga item CRITICAL dapat turun menjadi WARN) atau menjadi **NULL** bila semua snapshot hilang. Karena itu aturannya harus: **penanda tidak boleh memberi hasil OK/HEALTHY**, dan **tidak ada penurunan severity ketika penanda hilang (NULL)**. Penanda hanya dipakai untuk **mempersempit jendela tak-terbukti**, bukan untuk menyatakan aman. Tambahkan juga sinyal pembantu (read-only, sudah ada datanya): bila `snapshots = 0` **dan** ada order ber-item pasca-cutoff, itu sendiri indikasi kehilangan data/anomali — laporkan sebagai bagian dari bucket anomaly (jangan dianggap "penanda tidak tersedia, aman").

### Tabel ringkas

| Kriteria | A | B | C | **D (+B marker)** |
|---|---|---|---|---|
| Akurasi accounting | Sedang | Tinggi | **Rendah** | **Tinggi** |
| Risiko false positive | Tetap | Rendah | Nol | Rendah (berlabel saat migration-only) |
| Risiko false negative | Rendah | Sedang (jendela) | **Tinggi (RC-2 tersembunyi)** | Rendah |
| Kompatibilitas API/UI | Nol perubahan | Aditif | Mengubah severity | Aditif + 1 perubahan semantik terdokumentasi |
| Dampak DB/migration | Nol | Nol | Nol | **Nol** |
| Kemudahan operasional | Mudah tapi ambigu | Sedang | Mudah tapi menyesatkan | Sedang & jelas |
| Kemampuan audit masa depan | Lemah | Kuat | Lemah | **Paling kuat** |

---

## 7. Rekomendasi (satu opsi utama)

> **Opsi D + penanda observasi berbasis data (`firstObservedSnapshotAt`, bagian dari Opsi B), tanpa mengubah cutoff dan tanpa mengarang timestamp.**

Alasan utama:

1. Memenuhi seluruh acceptance criteria §6 brief: migration timestamp **tidak** disamakan dengan deploy timestamp; `UNKNOWN` tidak pernah jadi "sehat"; `CRITICAL` tidak diklaim sebagai bukti deploy; snapshot hilang tetap terdeteksi; data historis tidak dimanipulasi.
2. **Tidak ada penurunan severity buta**, sehingga kelas RC-2 (kegagalan tulis pasca-commit yang baru diperkenalkan `e8d4aa3`) tetap tertangkap.
3. Memberi operator **tingkat kepastian** yang dapat dipertanggungjawabkan, bukan sekadar angka.
4. **Nol migration**, nol perubahan rumus accounting, nol perubahan kontrol tenant/branch — risiko implementasi rendah.

Urutan implementasi yang disarankan (di luar tugas ini, menunggu persetujuan):

1. **(Langkah 0 — wajib, read-only, saat ini BLOCKED)** Konfirmasi di **production**: nilai `_prisma_migrations.finished_at` F5 + jumlah `orderitem`/`orderitemcostsnapshot` + `MIN(completedAt)` snapshot (§3.3). Tanpa ini, semua angka audit tetap bercap "dev".
2. **(Langkah 1)** Tambah `firstObservedSnapshotAt` + `evidenceLevel` + `buckets.beforeFirstSnapshot` + aturan severity §6-Opsi D di service/rules/types (aditif).
3. **(Langkah 2, opsional tapi disarankan)** Marker **best-effort** untuk RC-2: saat penulisan snapshot pasca-commit gagal, tulis `AuditLog` (action mis. `ORDER_COST_SNAPSHOT_FAILED`, details: orderId/orderNumber/branchId), tetap di dalam `catch` agar tidak pernah menggagalkan completion. **Batas jaminannya:** `AuditLog` ditulis ke **database yang sama**; bila kegagalan yang menghambat snapshot bersifat DB-wide (DB down/lock/koneksi putus), penulisan `AuditLog` **ikut gagal** — jadi ini **tidak** menjamin pencatatan durable. Ia hanya menambah peluang diagnostik pada kegagalan parsial (mis. error per-order).
4. **(Langkah 3)** Surface di UI integrity (belum ada halaman UI — lihat §10) dengan label eksplisit: "CRITICAL (terbukti)" vs "UNKNOWN — jendela aktivasi belum terbukti (migration-only)".

---

## 8. Perubahan file yang diperlukan (jika proposal disetujui)

Tidak ada perubahan yang dilakukan pada tugas ini; berikut rencana bila disetujui.

| File | Perubahan | Jenis |
|---|---|---|
| `src/services/accounting/integrity.types.ts` | `IntegrityCutoffEvidence` += `firstObservedSnapshotAt: string \| null`, `evidenceLevel: "MIGRATION_ONLY" \| "SNAPSHOT_OBSERVED"`, `activationUnproven`; `CompletedItemsWithoutSnapshotCheck` += `statusCutoffOnly`, `buckets.beforeFirstSnapshot`, `snapshotPopulation`, `disclosure` | Aditif |
| `src/services/accounting/integrity.rules.ts` | Fungsi murni baru: `classifyCompletionBucketV2(done, cutoff, firstObservedSnapshotAt)` (bucket `beforeFirstSnapshot`), `completedWithoutSnapshotStatusV3({anomalyItems, beforeFirstSnapshotItems, unknownItems, cutoffResolved})` (→ **UNKNOWN**, bukan OK/CRITICAL), dan `statusCutoffOnly` dari classifier cutoff-only yang sama. **Evidence BUKAN input severity** (K5). Komentar "engine was live" diperbaiki (K8). `classifyCompletionBucket` lama **dipertahankan** untuk kompatibilitas | Aditif + aturan baru |
| `src/services/accounting/integrity.service.ts` | 1 query read-only tambahan, **tenant-wide & sekali per report** (K1/K2/K3): `SELECT MIN(s.completedAt) FROM orderitemcostsnapshot s JOIN order o ON o.id = s.orderId WHERE o.restaurantId = ? AND s.restaurantId = o.restaurantId` (**tanpa** filter branch); cutoff & marker dihitung sekali lalu dipakai bersama oleh klasifikasi marker-aware dan `statusCutoffOnly`; `beforeFirstSnapshot` disertakan pada sample (setelah anomaly) | Aditif |
| `src/services/accounting/integrity.unit.test.ts` | Test baru: cutoff-only vs `SNAPSHOT_OBSERVED`, batas `>= firstObservedSnapshotAt`, penanda NULL (severity **tidak** turun), penanda bergeser maju karena restore, jendela `beforeFirstSnapshot` selalu UNKNOWN (tidak pernah OK) | Aditif |
| `src/services/order/order.service.ts` | (Opsional, Langkah 2) di blok `catch` post-commit L1844–L1848: tulis `AuditLog` `ORDER_COST_SNAPSHOT_FAILED` sebelum/selain `console.error`; **tidak** melempar, **tidak** mengubah transaksi; **bukan** jaminan durable (DB yang sama bisa ikut gagal) | Aditif |
| `src/app/api/admin/accounting/integrity/route.ts` | **Tidak berubah** (payload otomatis membawa field baru) | — |
| UI integrity (belum ada file) | Bila dibuat: tampilkan `evidenceLevel`, `firstObservedSnapshotAt`, dan `beforeFirstSnapshot` sebagai baris tersendiri; label "snapshot pertama teramati", **bukan** "engine aktif sejak"; jangan render UNKNOWN sebagai hijau | Baru (opsional) |

**Dilarang** dalam implementasi M2 (sesuai guardrail): mengubah `LEGACY_CUTOFF_MIGRATION`, mengubah ambang `≥ cutoff`, menulis ulang/backfill snapshot, mengubah rumus revenue/COGS, atau membuat dependency baru pada HPP/bahan baku di jalur completion.

### 8.1 Dampak regresi & isolasi tenant/branch (audit §3.D brief)

| Area | Apakah rekomendasi M2 memengaruhinya? | Bukti / alasan |
|---|---|---|
| **Restaurant scoping** | **Tidak berubah.** `restaurantId` tetap dari sesi (`requireAdmin`), tidak pernah dari query; query `firstObservedSnapshotAt` baru wajib berpredikat `o.restaurantId = ?`. | `integrity.service.ts` L118–L126 (C1), **L196** (C2 `o.restaurantId`), L320–L326 (C3 counts); route L28–L44; §11.2 D3 |
| **Branch scoping** | **Tidak berubah untuk counts/sample** — namun lihat K1: `firstObservedSnapshotAt` kini **tenant-wide** (TIDAK difilter branch), karena aktivasi engine bersifat tenant-level dan filter branch bisa membuat marker NULL padahal snapshot ada. Marker tetap **tenant-scoped** (`o.restaurantId = ?` + `s.restaurantId = o.restaurantId`), sehingga tidak pernah lintas tenant (K9). Counts/`buckets`/sample C2 **tetap** memakai `o.branchId IN (…)` seperti semula; order `branchId NULL` tetap dikecualikan saat filter branch aktif. | `integrity.service.ts` L179–L183 (C2 `branchSql`); K1/K2/K9 §16.2; `scopeNote` L475–L483 |
| **Sample IDs** | **Tidak berubah** untuk anomali. Sample `beforeFirstSnapshot` ditambahkan **dengan aturan scope yang sama** (`selectSampleOrderIds`: branch-scoped dulu, tenant-wide hanya bila tidak ada filter branch). Tidak ada ID cabang lain yang bocor. | `integrity.rules.ts` L148–L172; `integrity.unit.test.ts` "sample id scoping" |
| **`branchReconciled` / `tenantReconciled` / `reconciled`** | **Tidak disentuh.** Itu verdict C3 (`VIOLATION_SCOPE`, `partitionViolations`, `deriveReconciliation`); M2 hanya menyentuh C2. | `integrity.rules.ts` L105–L185; §11.2 D5 |
| **C1 (revenue order tanpa item)** | **Tidak disentuh.** Tetap `revenueScopeWhere` + `items: { none: {} }`. Penting: M2 **tidak** memindahkan order headless dari C1 ke C2. | `integrity.service.ts` L118–L152 (`items: { none: {} }` di L126) |
| **C3 (rekonsiliasi relasional)** | **Tidak disentuh.** Enam invariant, count 35/1/0, `snapshotByStatus` tetap. | §11.2 D5; E19 |
| **Revenue / refund** | **Tidak berubah.** Tidak ada file revenue/refund yang direncanakan diubah (§8); Integrity tidak menulis apa pun. | §8 tabel |
| **COGS (termasuk HPP historis & snapshot)** | **Tidak berubah dan tidak di-backfill.** Penulisan snapshot tetap satu-satunya jalur (`createOrderItemCostSnapshots`); proposal **tidak** menambah tulisan snapshot, tidak mengubah rumus `computeHistoricalHpp`/`aggregateSelectionCost`. | `historical-snapshot.ts` L97–L200 (`computeHistoricalHpp` L97, `buildSnapshotRows` L173), `createOrderItemCostSnapshots` L271; §8/§9 |
| **Profitability / P&L / Menu Engineering** | **Tidak berubah.** Konsumen `UNCOVERED`/`grossProfit=null` tetap; M2 hanya menambah metadata pada payload Integrity. | §10 |
| **Order Completion (kini independen HPP & bahan baku)** | **Dipertahankan independen.** M2 **tidak** memperkenalkan ulang dependency/blocking; blocker `consumeOrderIngredients` tetap dilepas. Satu-satunya penambahan di jalur completion (opsional, Langkah 2) adalah `AuditLog` di dalam `catch` — **tidak** melempar, **tidak** menyentuh transaksi, sehingga completion tetap tidak bergantung pada HPP/bahan baku. Catatan: `AuditLog` itu **best-effort**, ditulis ke DB yang sama ⇒ **tidak** menjamin pencatatan ketika DB sedang gagal (§12.1 R4/R6). | `order.service.ts` L1828–L1848; §8, §12.1 R4, R6 |
| **Kontrol tenant/branch dikendurkan?** | **Tidak.** Tidak ada perubahan pada `assertBranchInScope`, `branchHintFrom`, `authorizedBranches`, maupun Zod schema `.optional()`. | route L24–L44 |

---

## 9. Apakah schema / migration diperlukan?

**Tidak**, untuk rekomendasi utama:

* `firstObservedSnapshotAt` dihitung dari kolom yang sudah ada (`orderitemcostsnapshot.completedAt`) dan sudah punya **`@@index([completedAt])`** (`prisma/schema.prisma` L1056) ⇒ query `MIN()` murah.
* `evidenceLevel` / `beforeFirstSnapshot` adalah field **response API**, bukan kolom DB.
* Penanda kegagalan RC-2 (Langkah 2) memakai tabel **`AuditLog` yang sudah ada** (kolom generik `action`/`entityType`/`entityId`/`details`) ⇒ **tanpa migration**. Jaminannya tetap **best-effort**: tulisan itu memakai **datasource yang sama**, sehingga kegagalan DB yang menghambat penulisan snapshot **juga** menghambat penulisan `AuditLog`.
* Tidak ada kebutuhan menyimpan "deployment timestamp" di DB pada scope ini. Bila di masa depan diinginkan, itu **wajib** berasal dari penulisan nyata saat startup (bukan nilai yang ditebak) dan bersifat **additive** (mis. tabel/marker baru) — bukan dengan memodifikasi `_prisma_migrations`.
* Enum `OrderItemCostStatus` sudah memiliki nilai **`LEGACY`** yang saat ini **tidak dipakai** oleh engine; jika kelak ingin menandai baris legacy secara eksplisit, nilainya sudah tersedia (tetap tanpa migration).

---

## 10. Dampak API / UI & backward compatibility

* **Endpoint:** `GET /api/admin/accounting/integrity?branchId=&sampleLimit=` (`src/app/api/admin/accounting/integrity/route.ts`). `restaurantId` tetap dari sesi (`requireAdmin`), `branchId` divalidasi `assertBranchInScope`, semua parameter divalidasi Zod sebelum query. **Tidak berubah.**
* **Field existing dipertahankan apa adanya:** `checks.completedItemsWithoutSnapshot.status|items|orders|buckets.legacyExpected|buckets.anomaly|buckets.unknownCompletion|cutoff|sampleOrderIds`, `overallStatus`, `scope`. Tidak ada rename/penghapusan ⇒ konsumen lama tidak pecah.
* **Perubahan yang perlu disosialisasikan (breaking secara *makna*, bukan *shape*):** setelah `firstObservedSnapshotAt` tersedia, sebagian item yang sebelumnya `anomaly → CRITICAL` akan berpindah ke `beforeFirstSnapshot → UNKNOWN` (overall WARN). Ini **disengaja** dan harus disebut di release note + UI, karena operator yang hanya melihat `overallStatus` akan melihat perubahan dari CRITICAL ke WARN. Agar tidak menyesatkan: UNKNOWN **wajib** ditampilkan sebagai "belum terbukti" (kuning/abu), **bukan** hijau, dan disertai teks penyebab. **UNKNOWN bukan keadaan sehat** — periode sebelum snapshot pertama teramati memang **tidak dapat dibuktikan**.
* **`codeDeployUnproven`** tetap `true` untuk cutoff berbasis migration; tambahan `evidenceLevel` memberi sinyal yang lebih tajam tanpa mengubah arti field lama.
* **UI:** saat ini **tidak ada halaman UI** untuk integrity (hanya route API; halaman admin accounting yang ada: `cashbook`, `expenses`, `pnl`). Jadi tidak ada komponen UI yang perlu diubah untuk menjaga kompatibilitas. Bila halaman integrity dibuat, ia harus menampilkan dimensi bukti **terpisah** dari severity (judul kolom: "Severity" vs "Bukti aktivasi"), bukan menggabungkannya dalam satu angka.

---

## 11. Test plan & acceptance criteria

### 11.1 Unit test (DB-free, `integrity.rules.ts`)

| # | Kasus | Ekspektasi |
|---|---|---|
| U1 | `done < cutoff`, tanpa `firstObservedSnapshotAt` | `legacyExpected` |
| U2 | `done >= cutoff`, tanpa `firstObservedSnapshotAt` | `anomaly` (CRITICAL) + `evidenceLevel = MIGRATION_ONLY` + `activationUnproven = true` |
| U3 | `done == cutoff` | batas **tetap** `>=` ⇒ `anomaly`/`beforeFirstSnapshot` menurut ketersediaan penanda |
| U4 | `cutoff <= done < firstObservedSnapshotAt` | `beforeFirstSnapshot` → status `UNKNOWN` (**bukan** OK, **bukan** CRITICAL) |
| U5 | `done >= firstObservedSnapshotAt` | `anomaly` → `CRITICAL` |
| U6 | `firstObservedSnapshotAt == null` (0 snapshot) | **severity tidak diturunkan**; `activationUnproven = true`; `evidenceLevel = MIGRATION_ONLY` |
| U7 | cutoff NULL | semua `unknownCompletion`, status `UNKNOWN` |
| U8 | `done` NULL / invalid | `unknownCompletion`; **tidak pernah** dihitung legacy |
| U9 | `beforeFirstSnapshotItems > 0`, `anomalyItems = 0` | status `UNKNOWN`; `overallStatus = WARN` (**bukan OK**) |
| U10 | penanda bergeser **maju** (restore menghapus snapshot tertua) sementara ada item di jendela baru | item berpindah ke `beforeFirstSnapshot` (maksimum UNKNOWN/WARN), **tidak pernah OK**; tidak ada item hilang dari total |
| U11 | Regresi F1–F4 (scope branch/tenant, sample scoping, verdict rekonsiliasi) | tetap lulus tanpa perubahan |
| U12 | Skema query (`sampleLimit` 1..50, branchId opsional) | tetap lulus |
| U13 | Label/nama field | **tidak ada** field bernama `engineLiveSince`/`activationWindow`/`ENGINE_LIVE` yang tersisa (nama hanya menyatakan observasi) |
| U14 | Invariant bucket | `legacy + beforeFirstSnapshot + anomaly + unknown == totalItems` untuk semua kombinasi penanda ada/NULL |

### 11.2 Verifikasi read-only pada DB (tanpa menulis)

| # | Pemeriksaan | Ekspektasi |
|---|---|---|
| D1 | `SELECT MIN(completedAt) … (tenant+branch scope)` sebagai `firstObservedSnapshotAt` | konsisten dengan scope `counts` C3 (JOIN `order`); NULL bila 0 snapshot |
| D2 | Bandingkan `buckets` lama vs baru pada dataset yang sama | `legacy + beforeFirstSnapshot + anomaly + unknown = total items` (**tidak ada item hilang**) |
| D3 | Tenant B | semua bucket 0 (isolasi tenant) |
| D4 | Branch-scoped (`branchId` di-scope user) | `sampleOrderIds` tetap tidak memuat order cabang lain |
| D5 | C3 (`branchReconciled`/`tenantReconciled`/`reconciled`) & C1 | **tidak berubah** (verifikasi regresi) |
| D6 | **Production** (saat ini **BLOCKED**, §3.3): `_prisma_migrations` F5 + jumlah `orderitem`/`orderitemcostsnapshot` + `MIN(completedAt)` + signature C2 | mengonfirmasi/mengoreksi angka dev (§3.2); **tidak** boleh diisi dengan angka dev |

### 11.3 Acceptance criteria (dipetakan dari §6 brief)

- [ ] Migration timestamp **tidak** pernah disamakan dengan deploy timestamp (tidak ada cutoff baru yang dikarang).
- [ ] Periode `[cutoff, firstObservedSnapshotAt)` **selalu UNKNOWN**, tidak pernah HEALTHY/OK; `overallStatus = WARN` bila hanya jendela itu yang berisi item.
- [ ] Jika `firstObservedSnapshotAt` **tidak tersedia (NULL)**, severity **tidak** diturunkan (tetap CRITICAL untuk item `≥ cutoff`) + `evidenceLevel = MIGRATION_ONLY` + `activationUnproven = true`.
- [ ] Tidak ada nama/field/label yang mengklaim waktu **aktivasi** atau **deployment** (`firstObservedSnapshotAt`, `SNAPSHOT_OBSERVED`, `beforeFirstSnapshot` saja).
- [ ] `CRITICAL` hanya diklaim sebagai anomali sesudah ada snapshot teramati (`firstObservedSnapshotAt`) **atau** diberi label `evidenceLevel = MIGRATION_ONLY` + `activationUnproven = true`.
- [ ] Snapshot yang hilang tetap terdeteksi (termasuk order ber-item tepat sesudah cutoff).
- [ ] Ketiadaan snapshot tidak pernah menjadi klaim "engine mati" maupun "sehat" — hanya "belum teramati".
- [ ] Kegagalan snapshot pada completion baru **tidak** tersembunyi (marker best-effort + tetap terdeteksi C2), dan **tidak** ada klaim bahwa `AuditLog` menjamin pencatatan ketika DB yang sama gagal.
- [ ] Tidak ada manipulasi data historis (tanpa backfill/rewrite snapshot).
- [ ] Tenant/branch isolation tidak berubah (semua query tetap berpredikat tenant + JOIN `order`).
- [ ] Revenue, refund, COGS, dan rumus profit **tidak berubah** (tidak ada file rumus yang disentuh).

---

## 12. Risiko, rollback plan, dan yang belum diketahui

### 12.1 Risiko implementasi

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | `firstObservedSnapshotAt` berdampak bila restore/delete menghapus snapshot tertua (pernah terjadi, E14) | Penanda **bergerak maju** ⇒ jendela UNKNOWN melebar dan item CRITICAL dapat turun ke WARN; bila semua snapshot hilang ⇒ penanda NULL | Aturan: hasil maksimum dari jendela itu adalah **UNKNOWN/WARN (tidak pernah OK)**; penanda NULL ⇒ **fallback CRITICAL tanpa penurunan**; tambahkan sinyal `snapshots == 0 & ada order ber-item ≥ cutoff` sebagai anomali, bukan alasan "penanda tidak ada" |
| R2 | Perubahan CRITICAL → UNKNOWN setelah penanda tersedia | Operator mengira membaik padahal tidak | Sosialisasi + label UI eksplisit + `evidenceLevel` di API |
| R3 | Tambahan 1 query `MIN(completedAt)` | Beban DB | Sudah ter-indeks `@@index([completedAt])`; query dijalankan dalam `Promise.all` yang ada |
| R4 | Marker `AuditLog` RC-2 menambah write di jalur completion | Kegagalan marker dapat memengaruhi completion | Selalu di dalam `catch`, `try/catch` bersarang, **tidak** melempar; kalaupun marker gagal, hanya `console.error` |
| R5 | Menganggap angka dev sebagai production (§3.2) | Kesimpulan salah, prioritas salah | Langkah 0 wajib (D6) sebelum implementasi; verifikasi production saat ini **BLOCKED** (§3.3) |
| R6 | `AuditLog` RC-2 **tidak durable** ketika DB yang sama gagal | Kegagalan RC-2 bisa tanpa jejak sama sekali (hanya C2 yang menangkapnya nanti) | Nyatakan eksplisit sebagai **best-effort** di dokumentasi/UI; jangan mengandalkannya sebagai bukti kegagalan; andalkan C2 + invariant bucket |
| R7 | Penanda hanya **lower bound observasi** | Snapshot tertua yang pernah terhapus tidak dapat dipulihkan ⇒ jendela UNKNOWN bisa lebih lebar dari aktivasi sebenarnya | Terima sebagai keterbatasan yang dinyatakan (§14.5, §16.13), jangan diisi dengan asumsi/angka; opsi jangka panjang: catat versi build + waktu startup ke `AuditLog` (additive, di luar scope M2) |
| R8 (K8) | Komentar kode mengklaim **waktu aktivasi engine** ("snapshot engine was live") | Klaim yang tidak dapat dibuktikan tampak sebagai kebenaran di kode | Reword komentar di `integrity.rules.ts` & `integrity.types.ts` menjadi "activation unproven" (tanpa klaim live) — §16.12/K8 |
| R9 (K1/K2) | Marker branch-scoped & tanpa guard tenant | Marker NULL/bergeser salah, risiko lintas tenant | Marker **tenant-wide** + predikat `o.restaurantId = ?` dan `s.restaurantId = o.restaurantId` — §16.2/K1,K2 |
| R10 | Ambiguitas **semantik status** (bucket vs overall, UNKNOWN vs WARN) | Mengklaim UNKNOWN sebagai overall padahal `deriveOverallStatus()` merendernya WARN | Model status tiga tingkat + tabel transisi final API/UI — §16.3/§16.4 |

### 12.2 Rollback plan

* Semua perubahan adalah **aditif** pada payload + aturan severity; rollback = `git revert` commit M2 (tidak ada migration untuk dibatalkan, tidak ada data yang ditulis/diubah).
* Karena tidak ada migration dan tidak ada penulisan data, rollback **tidak** memerlukan langkah DB apa pun.
* Bila ingin mematikan hanya perubahan perilaku tanpa revert kode: kembalikan `completedWithoutSnapshotStatus` ke aturan lama (anomaly > 0 ⇒ CRITICAL) — flag sederhana/PR kecil, tetap tanpa migration.

### 12.3 Yang belum diketahui (harus tetap dinyatakan sebagai tidak diketahui)

1. Waktu **aktivasi engine di production** (dan apakah `deploy.sh` VPS saat ini masih berurutan `migrate → build → reload`).
2. Apakah ledger DB audit ini berasal dari production atau dari mesin dev (E15).
3. Perintah/artefak restore 2026-09-12 dan mengapa dump tidak memuat `orderitem`/`orderitemcostsnapshot` (dari D2: **NOT VERIFIED**).
4. Apakah di production juga ada order COMPLETED ber-item tanpa snapshot (angka C2 production).
5. Apakah pernah ada kegagalan tulis snapshot pasca-commit sejak `e8d4aa3` (tidak ada marker/log yang tersimpan; `console.error` tidak persisten).
6. Apakah `pm2 reload toko` benar-benar menghasilkan proses tanpa downtime/gagal sebagian pada deploy 2026-09-11, **dan** apakah deploy `e8d4aa3` 2026-10-10 02:34:48Z benar-benar membuat proses memuat kode baru (hanya metadata run yang terbaca; log langkah tidak dibaca).
7. Seluruh fakta **production** (§3.3 P1–P5): cutoff production, jumlah snapshot production, `firstObservedSnapshotAt` production, kondisi C2 production, dan apakah production juga headless — **semuanya BLOCKED**, bukan angka dev.
8. Apakah sudah pernah terjadi kegagalan tulis snapshot pasca-commit (RC-2) sejak `e8d4aa3`; tidak ada `AuditLog`/`console.error` yang tersimpan sehingga tidak dapat diperiksa dari sini.

---

## 13. Ringkasan perubahan pada tugas ini

* **File dibuat:** `ACCOUNTING-M2-SOLUTION-PROPOSAL.md` (laporan ini, satu-satunya artefak — v1, lalu **direvisi menjadi v2** pada tugas ini, §14).
* **Pemeriksaan read-only tambahan pada revisi v2:** lingkungan/kredensial (`.env` `DATABASE_URL` host/port/db, `docker ps`, `gh auth status` scope token, `~/.ssh/known_hosts`), metadata run GitHub Actions `38013458467` & `38016937824` (metadata saja, `--log` tidak diambil), serta pengulangan hitungan DB (order 35, orderitem 1, orderstatushistory 108, snapshot 0, auditlog 44, `_prisma_migrations` 28 — **identik** dengan v1 ⇒ tidak ada mutasi data).
* **Tidak diubah:** seluruh source code, test, `prisma/schema.prisma`, migration, konfigurasi, `.env`, database. Tidak ada `INSERT/UPDATE/DELETE/backfill/reset`, tidak ada migration dijalankan, tidak ada deploy/push/commit, tidak ada akses VPS/production.
* **Pemeriksaan DB read-only yang dijalankan:** `_prisma_migrations` (ledger + checksum), `order`/`orderitem`/`orderstatushistory`/`orderitemcostsnapshot`/`auditlog`/`user` (agregat & sampling), `NOW()/UTC_TIMESTAMP()/time_zone`, serta pemanggilan `getIntegrityReport()` (service read-only) untuk tenant A (tenant-wide & branch-scoped).
* **`git status --short` sebelum audit:** kosong (clean, HEAD `e8d4aa3`).
* **`git status --short` sesudah audit:** hanya berisi file laporan ini sebagai untracked (`?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md`); tidak ada perubahan tracked.

## 14. Revisi v2 — pre-implementation verification, perubahan proposal & alasan

### 14.1 Hasil verifikasi production

**BLOCKED** — lihat §3.3. Tidak ada kredensial/otorisasi DB production di lingkungan ini; **tidak ada** angka dev yang dipakai menggantikan; daftar bukti yang masih dibutuhkan ada di §3.3. Konsekuensinya: **tidak ada** snapshot production yang dapat dibuktikan ⇒ **tidak ada** `firstObservedSnapshotAt` yang dapat dihitung pada tugas ini.

### 14.2 Perubahan proposal (v1 → v2)

| # | Sebelum (v1) | Sesudah (v2) | Alasan |
|---|---|---|---|
| 1 | `engineLiveSince` | **`firstObservedSnapshotAt`** | Nama lama mengklaim **waktu aktivasi engine**. Nilai itu hanya membuktikan snapshot **pertama yang teramati di dataset**; "engine live since" adalah klaim yang tidak dapat dibuktikan dari data. |
| 2 | Bucket `activationWindow` | **Bucket `beforeFirstSnapshot`**, dan isinya **UNKNOWN — bukan HEALTHY** | "activation" juga mengklaim aktivasi. Selain itu periode sebelum snapshot pertama yang teramati memang **tidak dapat dibuktikan**; ketiadaan snapshot **bukan** bukti engine hidup, dan ketiadaan snapshot pertama juga **bukan** bukti engine mati, sehingga **tidak boleh** dirender sehat. |
| 3 | `evidenceLevel: "ENGINE_LIVE"` | **`evidenceLevel: "SNAPSHOT_OBSERVED"`** | Menyatakan fakta observasi (ada snapshot teramati), bukan status engine. |
| 4 | Penanda NULL → label `MIGRATION_ONLY` + CRITICAL dipertahankan (sudah ada di v1) | **Dipertahankan dan dipertegas**: penanda **tidak tersedia** ⇒ severity **tidak** diturunkan, dan **tidak ada** jalur dari "penanda NULL" ke OK/HEALTHY | Brief eksplisit: "jika marker tidak tersedia, severity tidak boleh otomatis diturunkan". |
| 5 | Penanda bergeser karena restore disebut "mundur/hilang" | **Dikoreksi**: menghapus snapshot tertua membuat `MIN(completedAt)` **bergerak maju** (jendela UNKNOWN melebar) atau menjadi `NULL`; efeknya CRITICAL dapat turun menjadi **WARN**, dan itu **tetap bukan OK** | Arah pergerakan penanda harus benar agar risiko dievaluasi jujur (§12.1 R1). |
| 6 | Marker `AuditLog` RC-2 disebut "durable" | **Dikoreksi**: `AuditLog` **best-effort juga** — ditulis ke **database yang sama**; ketika kegagalan yang menghambat snapshot bersifat DB-wide (DB down / lock / koneksi putus), penulisan `AuditLog` **ikut gagal**, sehingga **tidak** ada jaminan pencatatan durable | Brief eksplisit: jelaskan bahwa AuditLog best-effort tidak menjamin pencatatan durable ketika database yang sama sedang gagal. |
| 7 | Tidak ada bagian verifikasi production | **§3.3 (BLOCKED + bukti yang dibutuhkan) & §3.4 (bukti deploy terbaru)** | Brief meminta hasil verifikasi production atau alasan BLOCKED, disertai bukti. |
| 8 | Cutoff, rumus accounting, data historis | **TIDAK berubah** (tidak ada perubahan `LEGACY_CUTOFF_MIGRATION`, ambang `≥ cutoff`, rumus revenue/COGS/profit, dan tidak ada backfill/rewrite snapshot) | Guardrail brief. |

### 14.3 Final logic M2 (riwayat v2 — DIGANTIKAN oleh §16.5)

> ⚠️ Blok di bawah adalah rumusan v2. Ia **digantikan** oleh §16.5: `firstObservedSnapshotAt` kini **tenant-wide** (K1), ditambah `statusCutoffOnly` (K4), dan invariant carve-from-anomaly (K7).

```
cutoff                  = _prisma_migrations.finished_at(F5)            // TIDAK diubah
firstObservedSnapshotAt = MIN(orderitemcostsnapshot.completedAt)        // scope tenant (+branch bila difilter)
                                                                        // null bila TIDAK ADA snapshot teramati

untuk tiap item COMPLETED tanpa snapshot (JOIN order, s.id IS NULL):
  done = MIN(orderstatushistory.createdAt WHERE status='COMPLETED')

  done IS NULL                              -> unknownCompletion        -> WARN (cutoff resolved) / UNKNOWN
  done <  cutoff                            -> legacyExpected           -> OK
  cutoff <= done <  firstObservedSnapshotAt -> beforeFirstSnapshot      -> UNKNOWN   (jendela belum terbukti; BUKAN HEALTHY)
  done >= firstObservedSnapshotAt           -> anomaly                 -> CRITICAL

  firstObservedSnapshotAt IS NULL  (penanda tidak tersedia):
      done >= cutoff                        -> anomaly                 -> CRITICAL   (severity TIDAK diturunkan)
                                                + evidenceLevel="MIGRATION_ONLY", activationUnproven=true
      done <  cutoff                        -> legacyExpected           -> OK

invariant  : legacy + beforeFirstSnapshot + anomaly + unknown == totalItems   (tidak ada item hilang)
overall    : CRITICAL menang; UNKNOWN melipat ke WARN; tidak ada apa pun -> OK
```

Catatan semantik yang mengikat implementasi:

* `firstObservedSnapshotAt` adalah **lower bound aktivitas engine yang teramati**, bukan waktu aktivasi; implementasi **tidak boleh** memakai nama/label yang mengklaim lebih (UI: "snapshot pertama teramati", **bukan** "engine aktif sejak").
* `beforeFirstSnapshot > 0` ⇒ **UNKNOWN/WARN**, **tidak pernah** OK/HEALTHY.
* Penanda `NULL` ⇒ **tidak ada penurunan severity** (fallback ke aturan cutoff).
* `snapshots == 0` **dan** ada order ber-item `≥ cutoff` ⇒ tetap anomali (bukan alasan "penanda tidak ada, aman").
* Konsistensi defensif (observasi saja, tanpa menormalkan apa pun): `firstObservedSnapshotAt < cutoff` adalah anomali metadata (snapshot ada sebelum DDL) — laporkan apa adanya, **jangan** menyetel ulang cutoff.

### 14.4 Acceptance criteria M2 (final, v2) — DIGANTIKAN oleh §16.11

> ⚠️ Daftar v2 di bawah digantikan oleh pemecahan empat kategori di §16.11 (unit DB-free / read-only dev / E2E dengan fixture / production BLOCKED).

1. Migration apply time **tidak** pernah disamakan dengan waktu deploy/aktivasi engine; tidak ada timestamp baru yang dikarang.
2. Periode `[cutoff, firstObservedSnapshotAt)` **selalu UNKNOWN**, tidak pernah HEALTHY/OK; `overallStatus = WARN` ketika hanya jendela itu yang berisi item.
3. Jika `firstObservedSnapshotAt` **tidak tersedia (NULL)**, severity **tidak** diturunkan (item `≥ cutoff` tetap CRITICAL) + `evidenceLevel = MIGRATION_ONLY` + `activationUnproven = true`.
4. `firstObservedSnapshotAt` dihitung dengan scope yang sama dengan `counts` (JOIN `order` + tenant/branch); tidak ada kebocoran lintas tenant/cabang.
5. Snapshot yang hilang tetap terdeteksi; invariant bucket `legacy + beforeFirstSnapshot + anomaly + unknown == totalItems` terjaga.
6. Ketiadaan snapshot tidak pernah menjadi klaim "engine mati" maupun "sehat" — hanya "belum teramati".
7. Kegagalan tulis snapshot pasca-commit (RC-2) tetap terdeteksi C2, dan marker `AuditLog` dinyatakan **best-effort, tidak durable** (tanpa klaim jaminan pencatatan ketika DB yang sama gagal).
8. Tidak ada perubahan cutoff, rumus accounting, atau data historis; tidak ada backfill/rewrite snapshot; tidak ada perubahan kontrol tenant/branch.
9. Rollback = revert kode saja (tanpa langkah DB).

### 14.5 Risiko yang masih tersisa

1. **Production tetap BLOCKED** (§3.3): cutoff, jumlah snapshot, `firstObservedSnapshotAt`, dan kondisi C2 production **belum terbukti**; semua angka laporan ini masih angka dev.
2. **Jendela UNKNOWN dapat melebar** bila restore menghapus snapshot tertua ⇒ CRITICAL→WARN (bukan OK, tetapi tetap penurunan severity untuk item nyata).
3. **Penanda hanya lower bound observasi**: snapshot yang lebih tua dan sudah terhapus tidak dapat dipulihkan ⇒ `firstObservedSnapshotAt` selamanya ≥ aktivasi sebenarnya.
4. **RC-2 tidak punya jejak durable**: `console.error` tidak persisten dan `AuditLog` best-effort ikut gagal bila DB yang sama gagal.
5. **Deploy production terakhir (`e8d4aa3`) hanya membuktikan pipeline sukses** (02:34:48Z), bukan bahwa proses memuat kode baru; ada satu run FAILURE tepat sebelumnya (01:40:59Z). Awal jendela RC-2 di production tidak dapat ditentukan.
6. **`deploy.sh` VPS tidak ada di repo** ⇒ urutan `migrate deploy` → `build` → `pm2 reload` di production tidak dapat diverifikasi dari sini.

---

## 15. Catatan transisi v2 → v3

Seluruh isi §0–§13 (bukti, timeline, opsi, rekomendasi) tetap berlaku. §14.3/§14.4 digantikan oleh §16.5/§16.11. Bagian yang bertentangan dengan §16 dinyatakan **superseded**.

---

## 16. REVISI v3 — K1–K9, semantik status, marker movement, invariant & acceptance

> **Status:** PROPOSAL REVISION ONLY. v3 **tidak** mengimplementasikan apa pun, **tidak** mengubah source/schema/migration/data, **tidak** commit/push/deploy, **tidak** mengakses VPS/production. Bila ada pertentangan antara §1–§15 (v2) dan §16 (v3), **§16 yang berlaku**.

### 16.1 Perubahan v2 → v3 (change report)

| # | Temuan review | Sebelum (v2) | Sesudah (v3) | Alasan |
|---|---|---|---|---|
| 1 | **R1 / K1** — scope marker | `firstObservedSnapshotAt` di-scope **tenant (+branch bila difilter)** | **Tenant-wide saja** (tanpa filter branch) | Aktivasi engine bersifat **tenant-level** (deploy/restart), bukan per-branch. Marker branch-scoped bisa NULL/tergeser salah padahal snapshot ada di cabang lain; window `beforeFirstSnapshot` jadi keliru. |
| 2 | **R2 / K2** — predikat tenant marker | Hanya `o.restaurantId = ?` | **`o.restaurantId = ?` AND `s.restaurantId = o.restaurantId`** | Baris snapshot dengan `restaurantId` tidak konsisten dengan order-nya tidak boleh memengaruhi marker (guard data lintas-tenant). |
| 3 | **R3 / K3** — single source | Cutoff dibaca di C2; marker dideskripsikan ad hoc (query terpisah bisa divergen) | **Cutoff dihitung sekali** (`resolveLegacyCutoff`) dan **marker dihitung sekali**; satu instance dipakai bersama klasifikasi marker-aware, `statusCutoffOnly`, counts, sample, dan evidence | Tidak ada dua definisi cutoff/marker yang bisa berbeda. |
| 4 | **R4 / K4** — pembanding independen | Tidak ada | Tambah field **`statusCutoffOnly`** (klasifikasi cutoff-only, **tidak** memakai marker) | Baseline pembanding: operator dapat melihat efek marker tanpa kehilangan sinyal lama. |
| 5 | **R5 / K5** — evidence vs severity | Evidence dipakai implisit di narasi | **Field evidence dikunci sebagai NON-INPUT severity** (type + test) | Severity hanya fungsi dari counts + `cutoffResolved`; evidence tidak boleh menaikkan/menurunkan severity. |
| 6 | **R6 / K6** — disclosure populasi snapshot 0 | Hanya `evidenceLevel` | Tambah **`snapshotPopulation`** + **`disclosure`** eksplisit saat populasi snapshot = 0 | Menyatakan fakta populasi **tanpa** mengklaim production sehat / engine mati. |
| 7 | **R7 / K7** — bucket baru | Invariant disebut, tanpa aturan carve | **`beforeFirstSnapshot` hanya memecah populasi `anomaly` yang sama** (carve-from-anomaly) | Tidak ada item yang berpindah kategori diam-diam; total populasi tetap. |
| 8 | **R8 / K8** — komentar kode | Komentar "the snapshot engine was live"/"engine live since" | Diperbaiki menjadi **"activation unproven"** (observasi, bukan klaim aktivasi) | Tidak ada klaim aktivasi engine di kode/UI. |
| 9 | **R9 / K9** — isolasi tenant/branch & sample | Dinyatakan | Ditegaskan: marker tenant-wide **tetap tenant-scoped** (bukan lintas tenant); counts/sample tetap branch-scoped sesuai aturan lama | Marker dan isolasi tidak saling melanggar. |
| 10 | **R10** — semantik status | UNKNOWN dilipat secara konseptual; berisiko diklaim sebagai overall | **Model status tiga tingkat** (bucket / check / overall) + tabel transisi final API & UI (§16.3–§16.4) | `deriveOverallStatus()` merender UNKNOWN → **WARN**; overall **tidak pernah** UNKNOWN. |
| 11 | Marker movement (item 3) | Disebut sebagian | **§16.7**: perilaku maju / NULL / restore, plus apa yang **tidak** dapat dijamin | Risiko restore harus dinyatakan jujur. |
| 12 | Invariant single-source (item 4) | Invariant bucket disebut | **§16.8**: cutoff & marker sekali per report + invariant `legacy + beforeFirstSnapshot + anomaly + unknown == totalItems` | Tidak ada item hilang / cutoff berbeda. |
| 13 | Acceptance split (item 5) | Unit + read-only + production | **§16.11**: 4 kategori (unit DB-free / read-only dev / E2E fixture / production BLOCKED) | Klarifikasi prasyarat tiap verifikasi. |
| 14 | Guardrails (item 6) | Ada, tersebar | **§16.12**: dikumpulkan dan dipertahankan utuh | Tidak ada implementasi tanpa persetujuan terpisah. |

### 16.2 Keputusan yang dikunci (K1–K9)

| # | Keputusan | Isi yang mengikat implementasi |
|---|---|---|
| **K1** | `firstObservedSnapshotAt` **tenant-wide** | `MIN(s.completedAt)` dihitung pada scope tenant (`o.restaurantId = ?`), **tanpa** filter branch. Alasan: aktivasi engine tenant-level; branch-scoped marker bisa NULL walau snapshot ada di cabang lain. |
| **K2** | Filter marker wajib | Query marker **wajib** memuat `o.restaurantId = ?` **dan** `s.restaurantId = o.restaurantId`. |
| **K3** | Sekali hitung per report | Cutoff (`resolveLegacyCutoff`) dan marker dihitung **satu kali** per `getIntegrityReport`; satu instance dipakai bersama klasifikasi, `statusCutoffOnly`, counts, sample, evidence. Tidak ada query marker/cutoff kedua. |
| **K4** | `statusCutoffOnly` | Field pembanding independen: status C2 memakai **klasifikasi cutoff-only** (tidak memakai marker). Selalu dihitung berdampingan dengan status marker-aware. |
| **K5** | Evidence = non-input | `evidenceLevel`, `activationUnproven`, `firstObservedSnapshotAt`, `codeDeployUnproven` adalah **output-only metadata**; fungsi severity **tidak menerimanya** sebagai argumen dan tidak membacanya. |
| **K6** | Disclosure populasi snapshot = 0 | Bila `snapshotPopulation == 0` (dalam scope tenant), sertakan `snapshotPopulation: 0` + `disclosure { code: "SNAPSHOT_POPULATION_EMPTY", ... }` yang menyatakan **fakta observasi**, **bukan** "production sehat" / "engine mati". |
| **K7** | Bucket memecah populasi sama | `beforeFirstSnapshot` **hanya** memecah populasi yang sebelumnya masuk `anomaly` (item `cutoff <= done`). Bila marker NULL, `beforeFirstSnapshot = 0` dan `anomaly` kembali ke definisi cutoff-only. Tidak ada item yang ditambah/dikurangi. |
| **K8** | Komentar tidak mengklaim aktivasi | Komentar "the snapshot engine was live"/"engine live since" diperbaiki menjadi "activation unproven" (observasi, bukan klaim). Tidak ada field/label bernama `engineLiveSince`/`ENGINE_LIVE`/`activationWindow`. |
| **K9** | Isolasi tenant/branch & sample | Marker **tenant-wide tetapi tetap tenant-scoped** (tidak pernah lintas tenant). Counts/buckets/sample C2 tetap memakai `o.branchId IN (…)` dan `selectSampleOrderIds` seperti semula (`branchFilterActive` → tenant-wide sample tidak dikirim). Tidak ada kontrol `assertBranchInScope`/Zod yang dilonggarkan. |

### 16.3 Model status tiga tingkat (R10)

v3 memisahkan **tiga tingkat** yang sebelumnya bercampur:

| Tingkat | Tipe | Nilai | Siapa yang menetapkan |
|---|---|---|---|
| **1. Bucket (per item)** | `IntegrityLegacyBucket` | `legacyExpected \| beforeFirstSnapshot \| anomaly \| unknownCompletion` | `classifyCompletionBucketV2(done, cutoff, marker)` |
| **2. Check status (C2)** | `IntegrityCheckStatus` | `OK \| WARN \| CRITICAL \| UNKNOWN` | `completedWithoutSnapshotStatusV3({anomalyItems, beforeFirstSnapshotItems, unknownItems, cutoffResolved})` |
| **3. Overall report** | `IntegrityOverallStatus` | `OK \| WARN \| CRITICAL` (**tanpa UNKNOWN**) | `deriveOverallStatus([C1.status, C2.status, C3.status])` |

**Aturan eksplisit `beforeFirstSnapshot` (item 2 brief):**

* Setiap item `cutoff <= done < firstObservedSnapshotAt` → bucket `beforeFirstSnapshot`.
* Check status C2 untuk item tsb adalah **`UNKNOWN`** — "belum terbukti", **bukan** OK/HEALTHY.
* `deriveOverallStatus()` **melipat UNKNOWN → WARN**. Karena itu v3 **TIDAK PERNAH** mengklaim `overallStatus = UNKNOWN`: overall hanya `OK|WARN|CRITICAL`. Bila satu-satunya pemicu adalah jendela `beforeFirstSnapshot`, `overallStatus = WARN`.

**Penggabungan dengan `unknownCompletion` (item 2 brief):** kedua bucket berarti "tidak dapat dibuktikan", tetapi **sebabnya berbeda** dan karena itu **tidak digabung** di level bucket:

* `beforeFirstSnapshot` = waktu selesai diketahui, tetapi aktivasi engine pada jendela itu belum terbukti.
* `unknownCompletion` = waktu selesai hilang (`done IS NULL`) atau cutoff tidak teresolusi.
* Di level **check status**, keduanya memetakan ke `UNKNOWN`; bila keduanya kosong dan hanya legacy → `OK`.

**Precedence check status C2 (v3):**

```
anomalyItems > 0                      -> CRITICAL
!cutoffResolved                       -> UNKNOWN        (semua unknownCompletion)
beforeFirstSnapshotItems > 0          -> UNKNOWN        (jendela belum terbukti)
unknownItems > 0                      -> WARN           (completion time hilang)
else                                  -> OK
```

### 16.4 Tabel transisi final (API & UI)

**Tabel A — klasifikasi item → check status → overall report**

| Kondisi (item C2) | Bucket | Check status C2 | Overall report |
|---|---|---|---|
| `anomalyItems > 0` | `anomaly` | **CRITICAL** | **CRITICAL** |
| `anomalyItems = 0`; `beforeFirstSnapshotItems > 0` | `beforeFirstSnapshot` | **UNKNOWN** | **WARN** (UNKNOWN dilipat) |
| `anomalyItems = 0`; `before = 0`; `unknownItems > 0`; cutoff resolved | `unknownCompletion` | WARN | WARN |
| cutoff tidak teresolusi | `unknownCompletion` | UNKNOWN | WARN |
| hanya `legacyExpected` / tidak ada item C2 | `legacyExpected` | OK | ditentukan C1/C3 |
| marker NULL (K7) | `beforeFirstSnapshot = 0`; `anomaly = done >= cutoff` | CRITICAL bila ada, else … | CRITICAL bila ada |

**Tabel B — transisi field API**

| Field | v2 | v3 | Jenis |
|---|---|---|---|
| `status` | `OK/WARN/CRITICAL/UNKNOWN` | sama | tidak berubah |
| `statusCutoffOnly` | — | **baru** | aditif (K4) |
| `buckets.legacyExpected` | ada | ada | tidak berubah |
| `buckets.anomaly` | cutoff-only | **marker-aware** (`done >= marker`; bila marker NULL → `done >= cutoff`) | **semantik** (disosialisasikan) |
| `buckets.unknownCompletion` | ada | ada | tidak berubah |
| `buckets.beforeFirstSnapshot` | — | **baru** (`cutoff <= done < marker`) | aditif (K7) |
| `cutoff` (`migration/appliedAt/resolved/codeDeployUnproven`) | ada | ada | tidak berubah |
| `evidence.firstObservedSnapshotAt` | — | **baru** (`string \| null`) | aditif (K1) |
| `evidence.evidenceLevel` | — | **baru** (`MIGRATION_ONLY \| SNAPSHOT_OBSERVED`) | aditif |
| `evidence.activationUnproven` | — | **baru** (`boolean`) | aditif |
| `snapshotPopulation` | — | **baru** (`number`) | aditif (K6) |
| `disclosure` | — | **baru** (saat populasi 0) | aditif (K6) |

**Tabel C — transisi UI (bila halaman integrity dibuat)**

| Kondisi | Label severity | Warna | Aturan |
|---|---|---|---|
| `anomaly > 0` | "CRITICAL (terbukti)" | merah | — |
| hanya `beforeFirstSnapshot > 0` | "UNKNOWN — jendela belum terbukti" | **kuning/abu, BUKAN hijau** | UNKNOWN **bukan** sehat |
| `unknownCompletion` (cutoff resolved) | "WARN — waktu selesai hilang" | kuning | — |
| cutoff unresolved | "UNKNOWN — cutoff tak teresolusi" | kuning/abu | — |
| populasi snapshot 0 | tampilkan `disclosure` terpisah | — | **tidak** menyatakan sehat/mati |
| semua OK | "OK" | hijau | — |

UI **wajib** menampilkan "Severity" dan "Bukti aktivasi" sebagai **kolom terpisah**, serta `statusCutoffOnly` sebagai pembanding — bukan satu angka gabungan. Tidak ada halaman UI integrity saat ini (hanya route API), sehingga Tabel C berlaku saat halaman dibuat.

### 16.5 Final logic v3 (authoritative — menggantikan §14.3)

```
cutoff                  = _prisma_migrations.finished_at(F5)        // sekali per report (K3)
firstObservedSnapshotAt = MIN(s.completedAt)
                          FROM orderitemcostsnapshot s
                          JOIN `order` o ON o.id = s.orderId
                          WHERE o.restaurantId = ?                  // K1 tenant-wide
                            AND s.restaurantId = o.restaurantId      // K2
                          // null bila tidak ada snapshot teramati

untuk tiap item COMPLETED tanpa snapshot (JOIN order, s.id IS NULL):
  done = MIN(orderstatushistory.createdAt WHERE status='COMPLETED')

  done IS NULL                              -> unknownCompletion      -> UNKNOWN/WARN
  done <  cutoff                            -> legacyExpected         -> OK

  marker PRESENT (firstObservedSnapshotAt NOT NULL):
     cutoff <= done <  firstObservedSnapshotAt -> beforeFirstSnapshot -> UNKNOWN   (K7: carve dari anomaly)
     done >= firstObservedSnapshotAt           -> anomaly            -> CRITICAL

  marker NULL (K7/K6):
     beforeFirstSnapshot = 0
     done >= cutoff                        -> anomaly                -> CRITICAL   (severity TIDAK diturunkan)
                                              + evidenceLevel=MIGRATION_ONLY, activationUnproven=true

statusCutoffOnly = completedWithoutSnapshotStatus(cutoff-only buckets, cutoffInstance)   // K4, tanpa marker
status           = completedWithoutSnapshotStatusV3({anomaly, beforeFirstSnapshot, unknown, cutoffResolved})
overallStatus    = deriveOverallStatus([C1.status, status, C3.status])   // UNKNOWN -> WARN

invariant : legacy + beforeFirstSnapshot + anomaly + unknown == totalItems
carve     : beforeFirstSnapshot ⊆ populasi anomaly cutoff-only (K7)
```

Catatan semantik yang mengikat implementasi:

* `firstObservedSnapshotAt` = **lower bound aktivitas engine yang teramati**, bukan waktu aktivasi/deploy; label UI "snapshot pertama teramati".
* `beforeFirstSnapshot > 0` ⇒ check **UNKNOWN** ⇒ overall **WARN**, **tidak pernah** OK.
* Marker NULL ⇒ **tidak ada penurunan severity** (fallback cutoff).
* `snapshotPopulation == 0` + ada order ber-item `>= cutoff` ⇒ tetap anomali + disclosure (bukan "aman").
* `firstObservedSnapshotAt < cutoff` (anomali metadata) ⇒ laporkan apa adanya, **jangan** menyetel ulang cutoff.

### 16.6 `statusCutoffOnly` (K4)

* Dihitung dari **klasifikasi cutoff-only yang sama dengan perilaku saat ini** (`legacyExpected` vs `anomaly`), memakai **instance cutoff yang sama** dengan status utama (K3).
* **Tidak** memakai `firstObservedSnapshotAt` dalam bentuk apa pun.
* Tujuan: pembanding independen — operator dapat melihat berapa item yang berpindah dari `anomaly` (cutoff-only) ke `beforeFirstSnapshot` (marker-aware) dan memastikan tidak ada item yang hilang.
* `statusCutoffOnly` adalah **check status** (`OK/WARN/CRITICAL/UNKNOWN`), bukan overall. Overall tetap dari `deriveOverallStatus`.

### 16.7 Perilaku marker bergerak maju / NULL / snapshot tertua hilang (item 3)

`firstObservedSnapshotAt = MIN(s.completedAt)` adalah **observasi**, sehingga ia dapat berubah karena operasi DB di luar aplikasi (restore/delete). Perilaku yang ditetapkan:

| Peristiwa | Efek pada marker | Dapat dideteksi dalam satu report? | Efek pada bucket/status |
|---|---|---|---|
| Engine mulai menulis snapshot (pertama kali) | marker **muncul** / bergerak **mundur** (MIN turun) | Ya (marker berubah dari NULL → nilai) | Jendela menyempit; sebagian `beforeFirstSnapshot` → `anomaly` (severity **naik**). |
| Snapshot tertua dihapus / hilang saat restore (E14) | marker **bergerak maju** (MIN naik) | **TIDAK** — tanpa marker tersimpan sebelumnya tidak ada pembanding | Jendela melebar; sebagian `anomaly` → `beforeFirstSnapshot` (**CRITICAL → UNKNOWN/WARN**). |
| **Semua** snapshot hilang | marker → **NULL** | Ya (`MIN` NULL) | `beforeFirstSnapshot = 0`; `anomaly = done >= cutoff`; **severity tidak diturunkan**; `evidenceLevel=MIGRATION_ONLY`; `activationUnproven=true`; + disclosure bila `snapshotPopulation == 0`. |
| Snapshot lebih tua disisipkan (`marker < cutoff`) | marker < cutoff | Terlihat (`marker < cutoff`) | Anomali metadata — **dilaporkan apa adanya**; cutoff **tidak** diubah; tidak ada item yang di-reclassify ke legacy. |

**Yang dapat dijamin:**

1. Hasil maksimum dari jendela `beforeFirstSnapshot` adalah `UNKNOWN`/`WARN` — **tidak pernah** `OK`.
2. Marker NULL ⇒ **tidak ada** penurunan severity (fallback CRITICAL cutoff-only).
3. Invariant bucket tetap (`legacy + beforeFirstSnapshot + anomaly + unknown == totalItems`) pada kedua keadaan marker.
4. `beforeFirstSnapshot` selalu ⊆ populasi `anomaly` cutoff-only (K7).

**Yang TIDAK dapat dijamin (harus dinyatakan, bukan diasumsikan):**

1. Deteksi bahwa marker bergerak maju akibat restore — tidak ada marker historis yang tersimpan (§9: tanpa schema/migration), sehingga **tidak** dapat dibandingkan antar-report.
2. Stabilitas marker: marker adalah **lower bound** yang dapat berubah.
3. Akurasi jendela aktivasi sebenarnya: snapshot yang lebih tua & sudah terhapus tidak dapat dipulihkan ⇒ `firstObservedSnapshotAt` selamanya ≥ aktivasi sebenarnya.
4. Diagnosa penyebab (deploy lag vs kegagalan tulis vs restore) dari marker saja.

### 16.8 Invariant single-source (item 4)

1. **Cutoff single-source:** `resolveLegacyCutoff()` dipanggil **sekali** per `getIntegrityReport`; `cutoffInstance` yang sama dipakai oleh klasifikasi marker-aware, `statusCutoffOnly`, `counts`, dan `evidence`. Tidak ada pembacaan `_prisma_migrations` kedua.
2. **Marker single-source:** query marker dijalankan **sekali**; satu nilai `firstObservedSnapshotAt` dipakai oleh klasifikasi bucket, sample `beforeFirstSnapshot`, dan `evidence`. Tidak ada query marker kedua.
3. **Definisi tunggal:** tidak ada re-definisi revenue (`revenueScopeWhere`) maupun cutoff di M2.
4. **Invariant bucket (wajib, kedua keadaan marker):**

```
legacyExpected + beforeFirstSnapshot + anomaly + unknownCompletion == totalItems
```

5. **Invariant carve (K7):** dengan marker present, `anomaly_new = anomaly_cutoffOnly - beforeFirstSnapshot`; dengan marker NULL, `beforeFirstSnapshot = 0` dan `anomaly_new = anomaly_cutoffOnly`.

### 16.9 Evidence sebagai NON-INPUT severity (K5)

* Fungsi severity (`completedWithoutSnapshotStatusV3`, `revenueWithoutItemsStatus`, `reconciliationStatus`) **hanya** menerima counts + `cutoffResolved`. **Tidak** menerima `evidenceLevel`, `activationUnproven`, `firstObservedSnapshotAt`, atau `codeDeployUnproven`.
* `evidenceLevel`/`activationUnproven`/`snapshotPopulation`/`disclosure` adalah **output-only** metadata.
* Test wajib membuktikan: mengubah nilai field evidence **tidak pernah** mengubah `status`/`overallStatus`.

### 16.10 Disclosure populasi snapshot = 0 (K6)

Bila `snapshotPopulation == 0` (dalam scope tenant), payload menyertakan:

```json
{
  "snapshotPopulation": 0,
  "evidence": { "level": "MIGRATION_ONLY", "activationUnproven": true, "firstObservedSnapshotAt": null },
  "disclosure": {
    "code": "SNAPSHOT_POPULATION_EMPTY",
    "text": "Tidak ada snapshot teramati di scope tenant ini. Ini fakta populasi data; tidak dapat membedakan engine yang belum menulis dari snapshot yang hilang/ter-restore."
  }
}
```

Aturan teks disclosure **dilarang** menyatakan "production sehat", "engine tidak aktif", atau "aman". Ia hanya menyatakan fakta observasi + keterbatasan.

### 16.11 Acceptance criteria (item 5) — dipisah 4 kategori

#### A. Unit test DB-free (`integrity.rules.ts` / `integrity.types.ts`)

| # | Kasus | Ekspektasi |
|---|---|---|
| A1 | `done < cutoff` (marker ada/NULL) | `legacyExpected` |
| A2 | `done == cutoff` | batas tetap `>=`; marker NULL → `anomaly` |
| A3 | marker ada, `cutoff <= done < marker` | `beforeFirstSnapshot` |
| A4 | marker ada, `done >= marker` | `anomaly` |
| A5 | hanya `beforeFirstSnapshot > 0` | check `UNKNOWN`; `deriveOverallStatus` = **WARN** (**bukan** OK, **bukan** UNKNOWN) |
| A6 | marker NULL, `done >= cutoff` | `anomaly` → **CRITICAL**; `evidenceLevel=MIGRATION_ONLY`; `activationUnproven=true`; **tanpa** penurunan severity |
| A7 | cutoff NULL | `unknownCompletion`; check `UNKNOWN` |
| A8 | `done` NULL/invalid | `unknownCompletion`; tidak pernah legacy |
| A9 | marker bergeser maju | item pindah ke `beforeFirstSnapshot` (maks UNKNOWN/WARN), tidak pernah OK |
| A10 | marker NULL vs present | invariant bucket tetap; `beforeFirstSnapshot == 0` saat NULL |
| A11 | `statusCutoffOnly` | independen dari marker; sama dengan klasifikasi cutoff-only |
| A12 | Evidence non-input | mengubah semua field evidence tidak mengubah `status` |
| A13 | carve (K7) | `anomaly + beforeFirstSnapshot == anomaly_cutoffOnly` |
| A14 | Label/nama | tidak ada `engineLiveSince`/`ENGINE_LIVE`/`activationWindow` |
| A15 | Regresi F1–F4 + skema query (`sampleLimit` 1..50, branchId opsional) | tetap lulus tanpa perubahan |

#### B. Verifikasi read-only di dev

| # | Pemeriksaan | Ekspektasi |
|---|---|---|
| B1 | Query marker tenant-wide (K1/K2) | konsisten; NULL bila 0 snapshot |
| B2 | Bandingkan bucket lama vs baru | `legacy + beforeFirstSnapshot + anomaly + unknown == totalItems` (tidak ada item hilang) |
| B3 | Tenant B | semua bucket 0 (isolasi tenant) |
| B4 | Branch-scoped | `sampleOrderIds` tidak memuat order cabang lain; `beforeFirstSnapshot` sample mengikuti aturan sample lama |
| B5 | C1/C3 | **tidak berubah** (regresi) |
| B6 | `statusCutoffOnly` | konsisten dengan status marker-aware + carve (K4/K7) |
| B7 | Populasi snapshot 0 | disclosure muncul; **tidak** menyatakan sehat |

#### C. Pengujian end-to-end (memerlukan fixture)

Fixture **terisolasi** (DB/tenant uji, **bukan** production), **tanpa backfill data historis**. Skenario:

| # | Fixture | Ekspektasi |
|---|---|---|
| C1 | Tenant dengan order COMPLETED ber-item + snapshot (marker present) | `anomaly` & `beforeFirstSnapshot` terpisah sesuai marker |
| C2 | Tenant tanpa snapshot + order ber-item `>= cutoff` | marker NULL; `anomaly` CRITICAL; `evidenceLevel=MIGRATION_ONLY` |
| C3 | Populasi snapshot 0 | `snapshotPopulation=0` + `disclosure`; tidak ada klaim sehat |
| C4 | Bentuk payload API | field aditif Tabel B ada; field lama tidak pecah |
| C5 | UI (bila halaman ada) | Tabel C: UNKNOWN kuning/abu, bukan hijau; Severity & Bukti terpisah |

#### D. Verifikasi production — **BLOCKED**

Tetap **BLOCKED** (§3.3). Yang dibutuhkan (read-only, dijalankan pemilik akses production):

1. `_prisma_migrations` F5 (`finished_at` + checksum).
2. Jumlah `orderitem` & `orderitemcostsnapshot` + `MIN(completedAt)`, `MAX(completedAt)`.
3. Signature C2 production (order COMPLETED ber-item tanpa snapshot).
4. Order headless C1 production (`grandTotal > 0`, tanpa `orderitem`).
5. Isi `deploy.sh` VPS yang benar-benar dieksekusi.

**Tidak ada angka dev yang boleh dipakai menggantikan** hasil production. Semua angka §0–§13 tetap bercap **DEV** sampai D tuntas.

### 16.12 Mitigasi R1–R10

> R1–R9 = keputusan K1–K9; R10 = semantik status. Semuanya **sudah diterapkan pada v3** sebagai keputusan desain (tabel di §16.1–§16.11); implementasi kode tetap menunggu persetujuan terpisah.

| # | Temuan | Mitigasi di v3 | Verifikasi |
|---|---|---|---|
| R1 | Marker branch-scoped (salah) | K1 → marker **tenant-wide** (§16.2) | A10, B1 |
| R2 | Marker tanpa guard tenant | K2 → `o.restaurantId = ?` **AND** `s.restaurantId = o.restaurantId` (§16.2) | B1, A15 |
| R3 | Cutoff/marker bisa divergen | K3 → **sekali per report**, single instance (§16.8) | A11, B2 |
| R4 | Tidak ada pembanding independen | K4 → **`statusCutoffOnly`** (§16.6) | A11, B6 |
| R5 | Evidence bisa memengaruhi severity | K5 → evidence **non-input**, type+test lock (§16.9) | A12 |
| R6 | Populasi snapshot 0 bisa dibaca sehat | K6 → **`snapshotPopulation` + `disclosure`** (§16.10) | B7, C3 |
| R7 | Bucket baru bisa mengubah populasi | K7 → **carve-from-anomaly** + invariant (§16.5/§16.8) | A13, B2 |
| R8 | Komentar mengklaim aktivasi engine | K8 → komentar "activation unproven" (§16.1, §16.2) | A14 |
| R9 | Isolasi tenant/branch & sample | K9 → marker tenant-scoped, counts/sample tetap branch-scoped (§16.2) | B3, B4, A15 |
| R10 | Ambiguitas UNKNOWN vs WARN | **Model tiga tingkat** + tabel transisi API/UI (§16.3–§16.4) | A5, A6, A7, C4 |

**Mitigasi risiko v2 yang masih berlaku:** R1–R7 §12.1 (marker bergeser, perubahan CRITICAL→UNKNOWN, beban query, marker AuditLog, angka dev, AuditLog non-durable, lower-bound) tetap berlaku dan diperkuat oleh §16.7/§16.8.

### 16.13 Guardrails (item 6 — dipertahankan utuh)

1. **Migration cutoff tidak berubah** — `LEGACY_CUTOFF_MIGRATION` dan nilai `finished_at` tetap; tidak ada cutoff baru yang dikarang.
2. **Formula accounting tidak berubah** — revenue/refund/COGS/profit tidak disentuh.
3. **Data historis tidak diubah atau di-backfill** — tidak ada tulis/rewrite/backfill snapshot.
4. **Tidak ada schema/migration baru tanpa persetujuan terpisah** — solusi utama nol migration.
5. **Tidak ada klaim production sehat sebelum ada bukti production** — §3.3 tetap BLOCKED; disclosure §16.10 melarang klaim sehat.
6. **Tidak ada akses VPS/production, commit/push/deploy, atau mutasi data** pada tugas revisi ini.

### 16.14 Risiko yang masih tersisa (v3)

1. **Production tetap BLOCKED** (§3.3/§16.11-D): cutoff, jumlah snapshot, `firstObservedSnapshotAt`, kondisi C2 production **belum terbukti**; semua angka masih **DEV**.
2. **Marker bergerak maju tidak terdeteksi** (§16.7): CRITICAL dapat turun ke UNKNOWN/WARN setelah restore (bukan OK, tetapi tetap penurunan severity untuk item nyata).
3. **Marker hanya lower bound observasi**: window UNKNOWN bisa lebih lebar dari aktivasi sebenarnya.
4. **RC-2 tanpa jejak durable**: `console.error` tidak persisten; `AuditLog` best-effort ikut gagal bila DB yang sama gagal.
5. **`snapshotPopulation == 0` ambigu secara sebab** (belum pernah menulis vs ter-restore) — hanya dapat dinyatakan sebagai fakta, bukan diagnosis.
6. **`deploy.sh` VPS tidak ada di repo** ⇒ urutan `migrate → build → reload` production tidak dapat diverifikasi dari sini.
7. **Halaman UI integrity belum ada** ⇒ Tabel C belum dapat diverifikasi end-to-end sampai halaman dibuat.

### 16.15 Files yang berubah pada revisi ini

| File | Perubahan | Status |
|---|---|---|
| `ACCOUNTING-M2-SOLUTION-PROPOSAL.md` | Header → v3; §14.3/§14.4 ditandai superseded; §15 dijadikan catatan transisi; **§16 baru** (K1–K9, model status, tabel transisi API/UI, marker movement, invariant, `statusCutoffOnly`, evidence non-input, disclosure, R1–R10, acceptance 4 kategori, guardrails, risiko, files) | **satu-satunya file yang berubah** |

**Tidak diubah:** seluruh source code, test, `prisma/schema.prisma`, migration, konfigurasi, `.env`, database. Tidak ada `INSERT/UPDATE/DELETE/backfill/reset`, tidak ada commit/push/deploy, tidak ada akses VPS/production.

---

## 17. STOP

Proposal **v3** selesai (PROPOSAL REVISION ONLY). **Tidak ada implementasi M2 yang dijalankan**, tidak ada coding, migration, mutasi data, commit, push, atau deploy. Menunggu **review reviewer** sebelum langkah apa pun pada §7/§8/§16.5 dikerjakan.
