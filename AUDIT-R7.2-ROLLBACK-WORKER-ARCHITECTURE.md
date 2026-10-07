# AUDIT R7.2 — ROLLBACK WORKER ARCHITECTURE (DEMO: WEB = SOLE BAILEYS OWNER)

**Status:** AUDIT ONLY — belum ada rollback, belum ada perubahan source code.
**Tanggal audit:** 2026-10-07
**Repo:** `/home/reksa/restorant-cafe` · branch `main` · HEAD `70226bc` (`update reservation with integration whastapp`)
**Metode:** pembacaan langsung `git diff HEAD`, `git show HEAD:<file>`, pembacaan source, dan probe read-only ke Redis (`bull:whatsapp`).
**Tidak dilakukan:** `git reset --hard`, `git checkout .`, `git clean`, hapus untracked, reset DB/migration, drop table, hapus session credentials, commit, push, deploy.

---

## 0. RINGKASAN EKSEKUTIF

Keputusan final demo: **TIDAK ADA WhatsApp Worker**. Web/Next.js adalah **satu-satunya owner** Baileys.

Hasil audit: perubahan R7.2 yang ada di working tree **hanya menyentuh 7 file tracked** (118 insertions / 17 deletions) dan semuanya **terisolasi** di jalur Worker:

| Klasifikasi | File | Aksi |
|---|---|---|
| **B — Worker-only, harus rollback** | `src/app/api/whatsapp/connect/route.ts`, `disconnect/route.ts`, `reconnect/route.ts` | kembalikan ke panggilan langsung `whatsappSessionManager.*` |
| **B — Worker-only, harus rollback** | `src/services/whatsapp/whatsapp.queue.ts` (hanya `options?: {force}` pada `queueWhatsAppConnect`) | kembalikan signature asli |
| **B — Worker-only, komentar + opsi** | `.env` (baris komentar 27–29, gitignored) | kembalikan narasi komentar |
| **B — Worker-only, rollback opsional** | `package.json` (`worker:dev --env-file`, `worker:start`) | hapus/revert (harmless untuk web) |
| **A — Dokumentasi, aman** | `.env.example` (+5 baris komentar) | boleh tetap |
| **A — Netral, aman** | `.env` `WHATSAPP_SESSION_DIR="./whatsapp-session"` | **pertahankan** (dipakai web juga) |
| **B — Worker-only, boleh dibiarkan** | `src/workers/whatsapp.worker.ts` (file ini sudah ada SEBELUM R7.2; R7.2 menambah `force` branch + boot `restoreSessions()`) | tidak wajib diubah — cukup **jangan dijalankan** |

**TIDAK ADA perubahan R7.2** pada: `session-manager.ts`, `providers/baileys/*`, `api/whatsapp/status/route.ts`, `api/whatsapp/qr/route.ts`, `docker-compose.yml`, `Dockerfile.worker`, `prisma/schema.prisma`. **Tidak ada DDL, tidak ada migration, tidak ada perubahan data.**

**1 temuan kritis non-R7.2 yang harus diputuskan sebelum rollback** (lihat §10/§11): producer notifikasi **Order READY** dan **Reservation** mengirim lewat BullMQ `whatsapp` queue, dan **satu-satunya konsumen queue itu adalah Worker**. Kalau Worker tidak dijalankan, dua notifikasi itu akan masuk queue tanpa pernah diproses.

---

## 1. EXISTING ARCHITECTURE SEBELUM R7.2 (HEAD `70226bc`)

**Runtime sebelum R7.2 = DUA proses, dua pemilik socket:**

```
[WEB / Next.js :3100]                                  [WORKER process]
/api/whatsapp/connect    -> sessionManager.connect()     BullMQ Worker("whatsapp")
/api/whatsapp/disconnect -> sessionManager.disconnect()   ├─ send_message -> sessionManager.sendMessage()
/api/whatsapp/reconnect  -> sessionManager.forceReconnect()├─ connect     -> sessionManager.connect()
/api/whatsapp/status     -> sessionManager.getStatus()    └─ disconnect  -> sessionManager.disconnect()
/api/whatsapp/qr         -> sessionManager.getQrCode()
        │                                                        │
        └──► WhatsAppSessionManager (singleton, Map in-memory) ◄──┘
                        └──► Baileys provider ──► WhatsApp
```

Fakta berbasis kode (bukti di R7.1 + verifikasi ulang sekarang):

1. `whatsappSessionManager` adalah **singleton per-proses** dengan `Map<string, ProviderInstance>` in-memory (`session-manager.ts:82`). Setiap proses punya Map sendiri.
2. Pre-R7.2, tombol admin **Connect** memanggil route → `sessionManager.connect(restaurantId)` (`git show HEAD:src/app/api/whatsapp/connect/route.ts:26`). Artinya **socket hidup di proses WEB**.
3. Worker menjalankan proses terpisah; Map-nya kosong; jadi `sendMessage()` dari Worker melempar `WhatsApp not connected for restaurant <id>` (`session-manager.ts:305-310`). → **inilah akar G2** dari R7.1: order READY & notifikasi reservasi tidak pernah terkirim walau socket web sehat.
4. `restoreSessions()` (`session-manager.ts:339`) **0 caller** sebelum R7.2.
5. QR hanya hidup di memory proses yang membuat socket (expiry `QR_EXPIRATION_MS`), `provider.onQrCode` tidak pernah diregister; route `/api/whatsapp/qr` membaca `sessionManager.getQrCode(restaurantId)` (`qr/route.ts:26`) → hanya valid di proses yang punya provider.
6. `updateDbStatus` pakai `update()` (bukan upsert) — tidak ada row yang aman diasumsikan.
7. Producer notifikasi (PRE-EXISTING, wajib dipertahankan):
   - `queueWhatsAppNotification` → order READY (`order.service.ts:1829-1837`), enqueue job `send_message`, `jobId=notification-<orderNumber>`.
   - `queueWhatsAppReservation` → `reservation-whatsapp.ts:55` (`reservationWhatsAppGateway.enqueue`), `jobId=reservation-<id>-<status>`.
   - Keduanya masuk ke BullMQ queue `whatsapp`, dan **hanya Worker** yang meng-konsumsi `send_message` (`whatsapp.worker.ts:73-88`, termasuk menulis baris `WhatsAppMessage` OUTGOING).
8. `/api/whatsapp/status` juga menyertakan `getWhatsAppQueueStats()` (pre-existing, `status/route.ts:6,13`).
9. Tidak ada route `/api/whatsapp/send` (tidak ada endpoint kirim manual admin).
10. `src/services/whatsapp/whatsapp.service.ts` (server-side) = **dead code**, 0 importer. Client wrapper yang hidup: `src/services/whatsapp.service.ts` → axios ke `/whatsapp/{connect,disconnect,reconnect,status,qr}`.
11. Admin UI: `src/app/admin/whatsapp/page.tsx` memakai `whatsappService.connect/disconnect/reconnect/getStatus/getQrCode`.

**Kesimpulan §1:** arsitektur demo yang diminta user (web owner tunggal) sebenarnya adalah **arsitektur asli sebelum R7.2**, dan R7.2 justru memindahkan ownership ke Worker. Maka rollback = kembali ke perilaku lama, bukan membuat mekanisme baru.

---

## 2. PERUBAHAN PHASE 0 (R7.2)

`git diff HEAD` untuk scope yang diminta hanya melaporkan 7 file tracked; Phase 0 = 2 file tracked + 1 file gitignored.

### 2.1 `package.json` (+3 / −1) — **KLASIFIKASI B** (worker-only)

```diff
-    "worker:dev": "tsx src/workers/whatsapp.worker.ts"
+    "worker:dev": "tsx --env-file=.env src/workers/whatsapp.worker.ts",
+    "worker:start": "tsx --env-file-if-exists=.env src/workers/whatsapp.worker.ts"
```

- `tsx` **tidak** auto-load `.env`; tanpa `--env-file` Worker crash `DATABASE_URL environment variable is not set`. Jadi tambahan ini **hanya relevan untuk Worker**.
- Script web/Next (`dev`, `build`, `start`) **tidak disentuh** → web tetap dapat `.env` otomatis dari Next.js. **Tidak ada risiko ke web.**
- `worker:start` = script baru murni untuk Worker.

### 2.2 `.env.example` (+5) — **KLASIFIKASI A** (dokumentasi)

Menambah komentar precedence `WHATSAPP_SESSION_DIR || WHATSAPP_SESSION_PATH || "/app/whatsapp-session"` dan meng-comment alias `WHATSAPP_SESSION_PATH`. Tidak mengubah nilai aktif `WHATSAPP_SESSION_DIR="./whatsapp-session"`. Netral untuk demo.

### 2.3 `.env` (gitignored — `.gitignore:3`) — **campuran A + B**

```
22:# WhatsApp (Baileys)
24:#   WHATSAPP_SESSION_DIR || WHATSAPP_SESSION_PATH || "/app/whatsapp-session"
27:# R7.2 Phase 1: the WORKER (src/workers/whatsapp.worker.ts) is the ONLY
28:# ... 
29:# The web process never opens a socket (commands go through the whatsapp queue).
30:WHATSAPP_SESSION_DIR="./whatsapp-session"
32:# WHATSAPP_SESSION_PATH="./whatsapp-session"
35:REDIS_URL="redis://localhost:6379"
```

- **A (pertahankan):** `WHATSAPP_SESSION_DIR="./whatsapp-session"` dan `WHATSAPP_SESSION_PATH` tetap komentar. Web butuh variabel ini juga: provider me-resolve `<dir>/restaurant-<restaurantId>` (`baileys.provider.impl.ts`). Jika tidak di-set, fallback `/app/whatsapp-session` (path container) → **QR/creds web akan salah tempat**.
- **B (cosmetic, rollback opsional):** baris komentar 27–29 yang menyatakan "WORKER adalah satu-satunya owner, web tidak pernah membuka socket" — narasi ini bertentangan dengan keputusan final. Boleh diganti narasi web-owner. **Tidak mengubah perilaku runtime.**

---

## 3. PERUBAHAN PHASE 1 (R7.2)

### 3.1 `src/app/api/whatsapp/connect/route.ts` (+23) — **KLASIFIKASI B (WAJIB ROLLBACK)**

Pre-R7.2 (`git show HEAD`):
```ts
const currentStatus = await whatsappSessionManager.getStatus(restaurantId);
// ... guard 409 ...
const sessionInfo = await whatsappSessionManager.connect(restaurantId);
```
Sekarang:
```ts
import { queueWhatsAppConnect } from "@/services/whatsapp/whatsapp.queue";
...
await queueWhatsAppConnect(restaurantId);
const sessionInfo = await whatsappSessionManager.getStatus(restaurantId);
```
→ web **tidak lagi** membuat socket; hanya enqueue. **Bertentangan langsung** dengan target demo.

### 3.2 `src/app/api/whatsapp/disconnect/route.ts` (+18) — **KLASIFIKASI B (WAJIB ROLLBACK)**

Pre-R7.2: `await whatsappSessionManager.disconnect(restaurantId)`.
Sekarang: `await queueWhatsAppDisconnect(restaurantId)` + `getStatus(restaurantId)`.

### 3.3 `src/app/api/whatsapp/reconnect/route.ts` (+16) — **KLASIFIKASI B (WAJIB ROLLBACK)**

Pre-R7.2: `await whatsappSessionManager.forceReconnect(restaurantId)`.
Sekarang: `await queueWhatsAppConnect(restaurantId, { force: true })` + `getStatus(restaurantId)`.

Perhatikan side-effect penting: setelah Phase 1, ketiga route mengembalikan `getStatus()` (status DB), bukan status socket nyata. Setelah rollback, ketiga route mengembalikan status provider in-process → **lebih akurat untuk demo**.

### 3.4 `src/services/whatsapp/whatsapp.queue.ts` (+23 / −?) — **KLASIFIKASI B hanya pada `force`**

```diff
-export async function queueWhatsAppConnect(restaurantId: string) {
+export async function queueWhatsAppConnect(
+  restaurantId: string,
+  options?: { force?: boolean }
+) {
   ...
+      ...(options?.force ? { force: true } : {}),
```
Plus perubahan **komentar** pada `queueWhatsAppConnect`/`queueWhatsAppDisconnect` yang menyebut "the WORKER owns the Baileys socket".

- **B (rollback):** parameter `options?: {force}` + spread `force` pada payload job. Setelah rollback, tidak ada konsumen `force`, jadi param ini jadi dead surface.
- **A (aman/pertahankan):** `queueWhatsAppNotification`, `queueWhatsAppReservation`, `queueWhatsAppMessage`, `getWhatsAppQueueStats`, `defaultJobOptions` (attempts 3 / backoff exponential / removeOnComplete 100 / removeOnFail 50) — **semuanya PRE-EXISTING, tidak disentuh R7.2**.

### 3.5 `src/workers/whatsapp.worker.ts` (+47) — **KLASIFIKASI B**

File worker **sudah ada sebelum R7.2** (bukan artefak R7.2). R7.2 menambah:
1. `force?: boolean` pada `WhatsAppConnectJobData` + branch `force ? forceReconnect() : connect()` pada case `"connect"`.
2. IIFE boot yang memanggil `whatsappSessionManager.restoreSessions()` (`console.log` "Restoring persisted WhatsApp sessions..." → "Session restore finished").

Tidak ada perubahan pada `send_message` handler (kode pre-existing).

### 3.6 Perubahan yang disebut di brief TAPI TIDAK ADA

| Yang dicari | Hasil |
|---|---|
| Route `connect` → queue | ADA (§3.1) |
| Route `disconnect` → queue | ADA (§3.2) |
| Route `reconnect` → queue | ADA (§3.3) |
| `queue` force option | ADA (§3.4) |
| `restoreSessions()` pada worker | ADA (§3.5) |
| "worker ownership changes" lain | tidak ada |
| `WHATSAPP_SESSION_DIR` (Phase 0) | ADA di `.env`/`.env.example` — nilai aktif dipakai web juga |
| `WHATSAPP_SESSION_PATH` | hanya di-comment (`.env`, `.env.example`) |
| IPC / websocket / supervisor / service baru | **TIDAK ADA** (tidak pernah dibuat) |
| Perubahan `docker-compose.yml` / `Dockerfile.worker` | **TIDAK ADA** (service `worker` pre-existing) |
| Perubahan `prisma/schema.prisma` | **TIDAK ADA** |
| Perubahan `session-manager.ts` / provider Baileys / `/status` / `/qr` | **TIDAK ADA** |

---

## 4. MANA YANG HARUS DI-ROLLBACK

Urutan eksekusi (belum dijalankan — menunggu review):

| # | File | Edit | Alasan |
|---|---|---|---|
| 1 | `src/app/api/whatsapp/connect/route.ts` | hapus import `queueWhatsAppConnect`; `queueWhatsAppConnect(restaurantId)` → `await whatsappSessionManager.connect(restaurantId)` | web harus jadi owner socket |
| 2 | `src/app/api/whatsapp/disconnect/route.ts` | hapus import `queueWhatsAppDisconnect`; → `await whatsappSessionManager.disconnect(restaurantId)` | idem |
| 3 | `src/app/api/whatsapp/reconnect/route.ts` | hapus import `queueWhatsAppConnect`; → `await whatsappSessionManager.forceReconnect(restaurantId)` | idem |
| 4 | `src/services/whatsapp/whatsapp.queue.ts` | `queueWhatsAppConnect(restaurantId)` (buang `options?: {force}` + spread `force`) | dead surface produk Worker |
| 5 | `package.json` | hapus `worker:start`; `worker:dev` → `tsx src/workers/whatsapp.worker.ts` | script Worker-only |
| 6 | `.env` baris 27–29 (gitignored) | ganti narasi "worker is the ONLY owner" → "web is the only owner" | konsistensi dokumen demo |
| 7 | (opsional) `src/workers/whatsapp.worker.ts` | dibiarkan apa adanya | file pre-existing; cukup **tidak dijalankan** |

Catatan: komentar R7.2 di dalam route/queue (yang menjelaskan "the WORKER owns the socket") harus ikut dibersihkan saat rollback (mereka bagian dari hunk yang sama) — tidak ada file lain yang menyebut arsitektur Worker.

Tidak perlu rollback: `src/app/api/whatsapp/status/route.ts`, `qr/route.ts`, `session-manager.ts`, `provider/*`, `docker-compose.yml`, `Dockerfile.worker`, `prisma/schema.prisma`.

---

## 5. MANA YANG HARUS DIPERTAHANKAN

**Never-remove list (semua TIDAK tersentuh R7.2 — tinggal dipastikan tetap utuh):**
- `src/services/whatsapp/session-manager.ts` 634 baris utuh (`connect` 148, `disconnect` 189, `refreshQr` 213, `forceReconnect` 256, `getQrCode` 296, `sendMessage` 303, `restoreSessions` 339, `getStatus` 274, `updateDbStatus` 535).
- `src/services/whatsapp/providers/baileys/baileys.provider.impl.ts` (512) + `baileys.provider.ts` — satu-satunya `makeWASocket`/`useMultiFileAuthState`.
- `/api/whatsapp/status` dan `/api/whatsapp/qr` (socket-free + DB fallback + in-memory QR).
- DB status update, pengiriman WhatsApp, template pesan.
- Producer Order READY (`order.service.ts:1829`) dan Reservation (`reservation-whatsapp.ts:55`).
- `whatsapp.queue.ts` selain param `force`.
- `docker-compose.yml`, `Dockerfile.worker`, `prisma/schema.prisma`, DB, migration.

**Perubahan working-tree yang TIDAK boleh disentuh (PENTING — bukan bagian R7.2):**
- Phase 1 Reservation/Order/Payment: `src/app/(customer)/reservasi/page.tsx`, `reservation-flow.ts`, `reservation-flow.test.ts`, `api/public/reservations/_public-dto.ts`, `purchase-eligibility/route.ts` (**deleted**), `services/order/order.service.ts`, `reservation.{api,customer,customer-api,purchase,purchase.fixtures,service,types}*`.
- Untracked (report/artefak): `AUDIT-PHASE1-RESERVATION-ORDER-PAYMENT-INTEGRATION.md`, `AUDIT-R7.1-WHATSAPP-SESSION-OWNERSHIP.md`, `REPORT-R7.2-PHASE0-ENV-SINGLE-CONSUMER.md`, `REPORT-R7.2-PHASE1-DEMO-WORKER-OWNERSHIP.md`, `src/components/customer/reservation/reservation-product-picker.tsx`.

⚠️ **`order.service.ts` sudah dimodifikasi oleh Phase 1 reservation.** Rollback TIDAK boleh memakai `git checkout -- src/services/order/order.service.ts`; dan perubahan notifikasi tidak menyentuh file itu (kita tidak mengubah producer).

---

## 6. FINAL DEMO ARCHITECTURE

```
ADMIN UI (/admin/whatsapp)
        │ axios (src/services/whatsapp.service.ts)
        ▼
NEXT.JS WEB  ──►  /api/whatsapp/connect    → whatsappSessionManager.connect(restaurantId)
                  /api/whatsapp/disconnect → whatsappSessionManager.disconnect(restaurantId)
                  /api/whatsapp/reconnect  → whatsappSessionManager.forceReconnect(restaurantId)
                  /api/whatsapp/status     → whatsappSessionManager.getStatus(restaurantId)
                  /api/whatsapp/qr         → whatsappSessionManager.getQrCode(restaurantId)
                        │
                        ▼
              WhatsAppSessionManager (singleton, Map in-memory — WEB adalah satu-satunya owner)
                        │
                        ▼
              Baileys Provider (useMultiFileAuthState, <WHATSAPP_SESSION_DIR>/restaurant-<id>)
                        │
                        ▼
                    WhatsApp
```

- Web = **satu-satunya** proses yang membuka socket & menulis credentials.
- Tidak ada Worker proses, tidak ada QR via Redis, tidak ada IPC, tidak ada websocket, tidak ada supervisor, tidak ada service baru, tidak ada infrastructure baru.
- Order READY & Reservation → **flow notifikasi yang sama** (template & producer tidak diubah) — lihat §10 untuk transport-nya.

---

## 7. FILES YANG AKAN DIUBAH

Total **6 file** (1 di antaranya gitignored), 0 file baru, 0 migration:

1. `src/app/api/whatsapp/connect/route.ts`
2. `src/app/api/whatsapp/disconnect/route.ts`
3. `src/app/api/whatsapp/reconnect/route.ts`
4. `src/services/whatsapp/whatsapp.queue.ts` (hanya `queueWhatsAppConnect`)
5. `package.json` (hanya `worker:dev` / `worker:start`)
6. `.env` (gitignored — hanya baris komentar; opsional)

Plus 1 aksi operasional (bukan file): **hentikan proses Worker** yang saat ini berjalan (`tsx --env-file=.env src/workers/whatsapp.worker.ts`, PID 72301/72312, log `/tmp/r72-phase1-worker.log`).

---

## 8. APAKAH DATABASE BERUBAH?

**Tidak.** Tidak ada DDL, tidak ada `db push`, tidak ada perubahan data.
- Row `WhatsAppSession` (1 baris, `restaurantId=cmtois12y0000bzu8o894azsd`, status `ERROR`) dibiarkan apa adanya; `session-manager` akan men-sync status lewat `syncDbSession`/`updateDbStatus` saat connect (perilaku pre-existing).
- `WhatsAppMessage` tidak berubah kecuali ada pengiriman nyata.
- Redis (bukan DB, tapi terkait): queue `whatsapp` saat ini `{active:0, completed:0, failed:50, waiting:0}` dan `getWorkers()=1` (Worker yang masih hidup). Setelah Worker dihentikan → `getWorkers()=0`. 50 failed job = sisa QA, tidak perlu dibersihkan untuk demo.

---

## 9. APAKAH MIGRATION DIPERLUKAN?

**Tidak.** `prisma/schema.prisma` tidak tersentuh R7.2 (`git diff HEAD` bersih). Tidak ada perubahan schema, tidak ada `prisma migrate`, tidak ada `prisma db push`.

---

## 10. APAKAH REDIS / BULLMQ MASIH DIPERLUKAN UNTUK WHATSAPP?

Jawaban berlapis — ini titik paling penting dari audit:

**10.1 Jalur admin (connect/disconnect/reconnect/QR/status): TIDAK perlu Redis lagi.**
Setelah rollback, ketiga route memanggil `sessionManager` langsung di proses web. Redis tidak lagi menjadi transport WhatsApp.

**10.2 Jalur notifikasi (Order READY & Reservation): MASIH lewat Redis/BullMQ dan MASIH butuh konsumen.**
- `queueWhatsAppNotification` (`order.service.ts:1829`) dan `queueWhatsAppReservation` (`reservation-whatsapp.ts:55`) **enqueue job ke queue `whatsapp`** (pre-existing; tidak boleh dihapus — keduanya ada di never-remove list).
- Satu-satunya konsumen `send_message` adalah `whatsapp.worker.ts:73-88`, yang juga menulis baris `WhatsAppMessage` OUTGOING.
- **Jika Worker tidak dijalankan, dua notifikasi ini masuk queue dan tidak pernah diproses**: pesan tidak terkirim, row `WhatsAppMessage` tidak dibuat — padahal `order.service.ts:1841` men-set `notifiedAt` dan `whatsappTriggered = true`, sehingga UI bisa melaporkan "notifikasi dikirim" padahal tidak.
- **Catatan penting:** celah ini **bukan disebabkan R7.2** — desain pre-R7.2 pun sudah queue→worker (dan justru gagal dengan `WhatsApp not connected` karena Map worker kosong, akar G2). Yang berubah hanya: dulu ada Worker (gagal kirim), sekarang tidak ada Worker sama sekali (tidak ada konsumen).

**10.3 Redis dipakai untuk hal lain?**
R7.1 menyatakan Redis hanya berisi key BullMQ (tidak ada key aplikasi). Jadi secara teknis Redis **bisa dimatikan** kalau queue WhatsApp tidak dipakai lagi — TETAPI karena producer masih enqueue dan tidak ada perubahan engine yang diizinkan di fase ini, rekomendasi: **biarkan Redis menyala, jangan hapus queue** (menghapus = membuang producer pre-existing order READY & reservasi).

**10.4 Tiga opsi (butuh keputusan user — jangan diasumsikan):**
- **Opsi A — "Web mengirim langsung":** pindahkan isi handler `send_message` (send via `sessionManager.sendMessage` + tulis `WhatsAppMessage`) ke jalur web, dan arahkan producer memanggilnya. Notifikasi benar-benar terkirim, Redis tidak lagi dipakai WhatsApp. Menyentuh `order.service.ts` (call site notifikasi saja) + `reservation-whatsapp.ts` (seam `enqueue`). Template & engine Order/Reservation/Payment **tidak** berubah.
- **Opsi B — "Demo tanpa notifikasi keluar":** tidak mengubah apa pun, dan secara eksplisit menerima bahwa Order READY & Reservation **tidak** mengirim WhatsApp di demo. Cukup rollback §4, tidak menyentuh producer.
- **Opsi C — "Worker tetap ada hanya untuk notifikasi":** ditolak oleh keputusan final (tidak ada WhatsApp Worker).

Rekomendasi audit: **Opsi A** jika demo ingin memperlihatkan notifikasi WA nyata dari web; **Opsi B** jika target demo hanya pairing/QR/status/kirim manual dan notifikasi di luar scope. Keduanya harus dipilih user sebelum rollback dieksekusi.

---

## 11. RISIKO SETELAH ROLLBACK

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | **Worker masih berjalan saat web connect** → kembali menjadi dua pemilik socket (bug G2) | status/QR tidak konsisten, `sendMessage` gagal | **hentikan proses Worker** (PID 72301/72312) sebelum/bersamaan rollback; jangan `docker start restaurant-worker` |
| R2 | `whatsappSessionManager` singleton = **Map in-memory per proses**; HMR Next.js dev bisa me-reevaluasi modul → Map kosong → "WhatsApp not connected" | pairing hilang setelah edit file | jangan edit source saat demo; restart dev server setelah `npm run build`; (perbaikan permanen = singleton via `globalThis`, di luar scope audit ini) |
| R3 | **Notifikasi Order READY & Reservation** tidak punya konsumen queue | pesan tidak terkirim; `notifiedAt`/`whatsappTriggered` menyesatkan | putuskan Opsi A/B (§10.4) |
| R4 | QR in-memory punya expiry (25s) & `provider.onQrCode` belum diregister | QR harus di-refresh berkala | perilaku pre-existing; admin UI sudah polling `/qr`; tombol "Refresh QR" memanggil `connect` (409 saat `QR_REQUIRED`) — cacat lama, di luar scope |
| R5 | Multi-instance Next (production/scale) akan melanggar aturan single-owner | tidak relevan untuk demo single-instance | dokumentasikan batas demo |
| R6 | `/status` masih mengembalikan `queue` stats | kosmetik (`queue.failed=50`) di UI | opsional: sembunyikan di UI (di luar scope) |
| R7 | Rollback menyentuh `package.json`/route yang juga dipakai script lain | build/dev web bisa terganggu | tidak ada script web yang diubah; verifikasi `npm run build` + dev server setelah rollback |
| R8 | Phase 1 reservation work (working tree) bisa ikut ter-reset | kehilangan pekerjaan besar | **dilarang** `git reset --hard` / `git checkout .` / `git clean`; edit per-file |
| R9 | `.env` gitignored → tidak terlihat di `git status` | lupa/revert berlebihan | sentuh hanya baris komentar 27–29 |

Hal yang **MEMBAIK** setelah rollback: QR & status kembali membaca provider nyata di proses web (akar masalah QR di R7.1 hilang), dan `restoreSessions()` tidak lagi dipanggil Worker.

---

## 12. VERIFICATION PLAN (setelah rollback dieksekusi — belum dijalankan)

**A. Static / unit**
1. `npx tsc --noEmit` → harapan EXIT 0.
2. `git diff --check` → harapan EXIT 0 (tanpa whitespace error).
3. `npx tsx --test --test-force-exit src/services/whatsapp/*.test.ts` + suite unit/reservation yang relevan (unit+whatsapp 53 test, reservation suite) → semua pass.
4. `rm -rf .next/dev/types .next/types` lalu `npm run build` → EXIT 0 (wajib karena ada route yang pernah diubah).

**B. Arsitektur / ownership**
5. `ps -ef | grep whatsapp.worker` → **tidak ada** proses Worker.
6. Probe Redis read-only: `getWorkers()` pada queue `whatsapp` → **0**; `getJobCounts()` tetap `failed:50`, `active:0` (tidak berubah karena rollback).
7. `grep -rn "queueWhatsAppConnect\|queueWhatsAppDisconnect" src/app/api/whatsapp` → **0 hasil** (route kembali memanggil `sessionManager`).
8. `grep -rn "options?: { force" src/services/whatsapp/whatsapp.queue.ts` → **0 hasil**.

**C. Runtime demo (dev server `npx next dev -p 3100`, buka `http://localhost:3100`)**
9. Login admin → `/admin/whatsapp` → klik **Connect**.
   - Harapan: status jadi `QR_REQUIRED` (atau `CONNECTING`), `GET /api/whatsapp/qr` mengembalikan `qrCode` non-null (bukti provider hidup di proses WEB).
10. Scan QR dengan WhatsApp → status `CONNECTED` + nomor terbaca; cek folder `./whatsapp-session/restaurant-<id>/creds.json` dibuat oleh proses **web**.
11. Klik **Disconnect** → status `DISCONNECTED`; klik **Reconnect** → socket baru dibuat (status `CONNECTING`/`QR_REQUIRED`).
12. Verifikasi single-owner: hanya 1 proses Node yang menulis/mengubah creds; `getWorkers()=0`.

**D. Data / kebersihan**
13. DB: `whatsappsession` tetap 1 row (status mengikuti aksi demo); `whatsappmessage` hanya bertambah bila ada pengiriman nyata.
14. `git status --porcelain` → hanya file rollback yang berubah + perubahan Phase 1 yang sudah ada; **tidak ada** staging, **HEAD tetap `70226bc`**, tidak ada commit/push/deploy.

**E. Guardrail (tidak boleh dilakukan)**
Tidak ada `git reset --hard`, `git checkout .`, `git clean`, hapus untracked massal, reset DB/migration, drop table, hapus `whatsapp-session` credentials, commit, push, atau deploy.

---

## LAMPIRAN — Bukti mentah yang dipakai audit

```
$ git rev-parse HEAD
70226bca064b717c5c5bee7ef9ca343ed7d3ed1a

$ git diff --stat HEAD -- <scope R7.2>
 .env.example                             |  5 ++++
 package.json                             |  3 +-
 src/app/api/whatsapp/connect/route.ts    | 23 ++++++++++++++--
 src/app/api/whatsapp/disconnect/route.ts | 18 +++++++++---
 src/app/api/whatsapp/reconnect/route.ts  | 16 ++++++++---
 src/services/whatsapp/whatsapp.queue.ts  | 23 +++++++++++++---
 src/workers/whatsapp.worker.ts           | 47 +++++++++++++++++++++++++++++++-
 7 files changed, 118 insertions(+), 17 deletions(-)
```
(status/route.ts, qr/route.ts, session-manager.ts, providers/*, docker-compose.yml, Dockerfile.worker, prisma/schema.prisma → **tidak muncul = 0 diff**)

```
$ git show HEAD:src/app/api/whatsapp/connect/route.ts | grep whatsappSessionManager.
 12:    const currentStatus = await whatsappSessionManager.getStatus(
 26:    const sessionInfo = await whatsappSessionManager.connect(restaurantId);
$ git show HEAD:src/app/api/whatsapp/disconnect/route.ts | grep whatsappSessionManager.
 19:    const sessionInfo = await whatsappSessionManager.disconnect(
$ git show HEAD:src/app/api/whatsapp/reconnect/route.ts | grep whatsappSessionManager.
 11:    const sessionInfo = await whatsappSessionManager.forceReconnect(
```

```
$ ps -ef | grep whatsapp.worker
reksa 72301 node .../tsx --env-file=.env src/workers/whatsapp.worker.ts
reksa 72312 node ... --env-file=.env src/workers/whatsapp.worker.ts

$ tail -5 /tmp/r72-phase1-worker.log
[WhatsApp Worker] Starting worker...
[WhatsApp Worker] Restoring persisted WhatsApp sessions...
[WhatsApp Worker] Session restore finished
[WhatsApp Worker] Worker is ready and listening for jobs

$ whatsapp queue counts: {"active":0,"completed":0,"delayed":0,"failed":50,"prioritized":0,"waiting":0,"waiting-children":0}
$ active workers: 1
```

```
$ git check-ignore -v .env
.gitignore:3:.env	.env
```

**STOP — menunggu review user sebelum rollback.**
