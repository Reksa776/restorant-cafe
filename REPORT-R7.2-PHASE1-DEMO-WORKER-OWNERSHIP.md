# REPORT R7.2 — PHASE 1 (DEMO): BAILEYS WORKER OWNERSHIP HANDOFF

> Mode: **Phase 1 DEMO** — ownership handoff only. Tanpa pairing, tanpa QR scan, tanpa login, tanpa kirim pesan,
> tanpa trigger Order READY / reservation notification, tanpa infrastructure baru.
> Tanggal: 2026-10-07 · Repo: `/home/reksa/restorant-cafe` · HEAD: `70226bc` (tidak berubah)
> Referensi: `AUDIT-R7.1-WHATSAPP-SESSION-OWNERSHIP.md`, `REPORT-R7.2-PHASE0-ENV-SINGLE-CONSUMER.md`

## JAWABAN SINGKAT (pertanyaan wajib)

| Pertanyaan | Jawaban |
| --- | --- |
| Migration diperlukan? | **TIDAK** (0 migration dijalankan) |
| Schema berubah? | **TIDAK** (`prisma/schema.prisma` tidak disentuh) |
| Redis key baru dibuat? | **TIDAK** (tidak ada key QR/status/lock/session; hanya pemakaian queue `whatsapp` yang sudah ada) |
| Infrastructure baru ditambahkan? | **TIDAK** (tanpa queue baru, tanpa service/proses baru, tanpa pub/sub, tanpa websocket, tanpa supervisor) |
| Pairing dilakukan? | **TIDAK** (tidak ada QR, tidak ada scan, tidak ada login) |
| Credentials ada? | **TIDAK ADA** file kredensial sama sekali (`./whatsapp-session/` tidak dibuat); DB hanya punya 1 baris `WhatsAppSession` berstatus `ERROR` |
| Jumlah worker aktif | **1** worker native = **1** BullMQ consumer pada queue `whatsapp` |
| Domain lain diubah? | **TIDAK** (Order/Reservation/Payment/template/`session-manager`/provider/schema tidak disentuh) |

**Exact files changed (5, semuanya tracked):**

```
src/app/api/whatsapp/connect/route.ts    | 23 ++++++++++++++--
src/app/api/whatsapp/disconnect/route.ts | 18 +++++++++---
src/app/api/whatsapp/reconnect/route.ts  | 16 ++++++++---
src/services/whatsapp/whatsapp.queue.ts  | 23 +++++++++++++---
src/workers/whatsapp.worker.ts           | 47 +++++++++++++++++++++++++++++++-
```

Ditambah 1 file **gitignored** (lokal saja, tidak muncul di `git diff`): `.env` — komentar session-dir diperbarui
(worker = satu-satunya owner). **Tidak** ada perubahan pada `src/services/whatsapp/session-manager.ts`,
`providers/baileys/*`, `/api/whatsapp/status`, `/api/whatsapp/qr`, `prisma/schema.prisma`.

---

## 1. AUDIT FINDINGS

Audit ulang (read-only) atas jalur web → Baileys menemukan:

| # | Temuan | Bukti |
| --- | --- | --- |
| A1 | **Semua 5 route web memanggil `whatsappSessionManager` langsung**, termasuk 3 yang membuat socket | `connect/route.ts:26`, `disconnect/route.ts:19`, `reconnect/route.ts:11` (sebelum) |
| A2 | **Producer command sudah ada tetapi 0 pemanggil** → desain worker-owned belum pernah disambungkan | `queueWhatsAppConnect` (`whatsapp.queue.ts:142`), `queueWhatsAppDisconnect` (`:164`) — 0 caller sebelum Phase 1 |
| A3 | **Worker sudah punya `case "connect"/"disconnect"`** tetapi tak pernah menerima job | `whatsapp.worker.ts:86–93` (sebelum) |
| A4 | **`restoreSessions()` 0 pemanggil** (session tidak pernah dipulihkan) | `session-manager.ts:339`; grep seluruh repo = hanya definisi |
| A5 | Worker **tidak** memanggil restore saat boot | `whatsapp.worker.ts:139` (sebelum) hanya `console.log` |
| A6 | Route `connect`/`reconnect`/`disconnect` **tidak pernah enqueue** → socket hidup di proses web | grep `queueWhatsApp*` di `src/app/**` = 0 hasil |
| A7 | `/api/whatsapp/status` & `/qr` **sudah** bisa membaca tanpa socket (fallback DB + map in-memory) | `session-manager.ts:271–300` (`getStatus` DB fallback, `getQrCode` map) |
| A8 | Provider di-import **lazy** (dynamic import) → mengimpor `session-manager` tidak memuat Baileys | `session-manager.ts:66–80` `loadProviderClass()`; dibuktikan §18 masuk 2 |
| A9 | `senMessage` gagal karena map worker kosong (G2) | `session-manager.ts:304–311` |
| A10 | Session dir native web `./whatsapp-session`, worker (sebelum Phase 0) `/app/whatsapp-session` | `provider.impl.ts:58–63` + `REPORT-R7.2-PHASE0` |

**Kesimpulan audit:** yang dibutuhkan **bukan implementasi baru**, melainkan **WIRING**: panggil producer yang sudah
ada dari 3 route, dan panggil `restoreSessions()` saat boot worker. Tidak ada duplicate implementation dibuat.

---

## 2. EXISTING FUNCTIONALITY REUSED

| Existing | Dipakai sebagai | Perubahan |
| --- | --- | --- |
| BullMQ queue `whatsapp` (`whatsapp.queue.ts:14`) | Satu-satunya jalur command/message | **Tidak berubah** (nama/opsi queue sama) |
| `queueWhatsAppConnect` (`:149`) | Command connect + reconnect (`force`) | Diperluas opsional `{force}`; job type & queue sama |
| `queueWhatsAppDisconnect` (`:179`) | Command disconnect | **Tidak berubah** |
| `queueWhatsAppNotification` / `queueWhatsAppReservation` | Order READY + Reservation | **Tidak berubah** |
| `whatsappSessionManager.connect/disconnect/forceReconnect/restoreSessions/sendMessage` | Lifecycle di worker | **Tidak berubah** (0 baris diubah) |
| Baileys provider (`makeWASocket`, `useMultiFileAuthState`, backoff, logout cleanup) | Socket + auth state + reconnect | **Tidak berubah** |
| `WhatsAppSession` (DB) | Status kanonik yang dibaca web | **Tidak berubah** (tanpa kolom/enum baru) |
| `/api/whatsapp/status` & `/qr` | UI membaca status/QR | **Tidak berubah** (sudah socket-free) |
| Worker `case send_message` | Eksekusi pengiriman | **Tidak berubah** |
| `restoreSessions()` | Restore saat boot | Boolean/log wiring di worker saja |

Tidak ada queue baru, engine WhatsApp baru, auth baru, tabel baru, atau Redis feature baru.

---

## 3. ARCHITECTURE BEFORE

```
WEB (Next.js)                                    WORKER (tsx)
├─ POST /api/whatsapp/connect ──► sessionManager.connect()   ← SOCKET DI WEB
├─ POST /api/whatsapp/reconnect ─► sessionManager.forceReconnect()  ← SOCKET DI WEB
├─ POST /api/whatsapp/disconnect ► sessionManager.disconnect()      ← SOCKET DI WEB
├─ GET  /api/whatsapp/status  ──► in-memory provider (fallback DB)
└─ GET  /api/whatsapp/qr      ──► in-memory QR (web)               ← QR DI WEB

Order READY / Reservation ─► queue "whatsapp" ─► WORKER ─► sessionManager.sendMessage()
                                                        └─ map KOSONG ─► THROW "not connected"
Worker boot: (tanpa restoreSessions)
```

**Masalah:** dua "dunia" session (web & worker) dengan filesystem berbeda; `send_message` selalu gagal (G2).

## 4. ARCHITECTURE AFTER (target tercapai)

```
WEB (Next.js) — command/UI layer, TIDAK memegang socket
├─ POST /api/whatsapp/connect    ─► queueWhatsAppConnect(rid)          ─┐
├─ POST /api/whatsapp/reconnect  ─► queueWhatsAppConnect(rid,{force})  ─┤
├─ POST /api/whatsapp/disconnect ─► queueWhatsAppDisconnect(rid)       ─┤
├─ GET  /api/whatsapp/status     ─► WhatsAppSession (DB)  ◄────────────┼── status ditulis worker
└─ GET  /api/whatsapp/qr         ─► memory map (null) [DEMO LIMITATION]│
                                                                       │
                        EXISTING BullMQ queue "whatsapp" (Redis)  ◄─────┘
                                       │
                                       ▼
WORKER (1 proses) — SATU-SATUNYA Baileys owner
├─ boot: restoreSessions()            ─► (0 restored bila tanpa kredensial)
├─ job connect (force=false)          ─► sessionManager.connect()
├─ job connect (force=true)           ─► sessionManager.forceReconnect()
├─ job disconnect                     ─► sessionManager.disconnect()
├─ job send_message                   ─► sessionManager.sendMessage()  [Order READY + Reservation]
└─ provider callbacks ─► WhatsAppSession (DB status) + WhatsAppMessage
                                       │
                                       ▼
                    Baileys socket ──► ./whatsapp-session/restaurant-<id>
```

## 5. OWNERSHIP BEFORE

| Capability | Web | Worker |
| --- | --- | --- |
| create socket / open auth state | **YA** | tidak |
| connect / reconnect / disconnect | **YA** | tidak (case ada, tanpa producer) |
| restore session | tidak (0 caller) | tidak (tidak dipanggil) |
| send message | tidak | ya, tetapi selalu gagal (map kosong) |
| QR | **YA** (in-memory web) | tidak |
| status | dibaca dari provider web / DB | ditulis provider worker |

## 6. OWNERSHIP AFTER

| Capability | Web | Worker |
| --- | --- | --- |
| create socket / open auth state | **TIDAK** (terbukti §18) | **YA — satu-satunya** |
| connect / reconnect / disconnect | tidak (hanya enqueue) | **YA** |
| restore session | tidak | **YA** (boot) |
| send message | tidak | **YA** |
| QR | tidak (tidak ada socket → `null`) | di memori worker — **belum bisa dikonsumsi web (demo limitation)** |
| status baca | DB `WhatsAppSession` | — |
| status tulis | — | DB `WhatsAppSession` |

Bukti: `grep "whatsappSessionManager.(connect|disconnect|forceReconnect|refreshQr|sendMessage)" src/app/**`
→ **0 hasil** (hanya komentar dokumentasi); semua pemanggil socket-creating berada di `src/workers/whatsapp.worker.ts`.

---

## 7. FILES CHANGED

| File | Perubahan (minimal) |
| --- | --- |
| `src/app/api/whatsapp/connect/route.ts` | `sessionManager.connect()` → `await queueWhatsAppConnect(restaurantId)` (L39); respons dari `getStatus()` (DB) L43; `requireAdmin()` tetap L21; 409-check tetap L25 |
| `src/app/api/whatsapp/disconnect/route.ts` | `sessionManager.disconnect()` → `await queueWhatsAppDisconnect(restaurantId)` (L29); respons DB L31; 404-check tetap |
| `src/app/api/whatsapp/reconnect/route.ts` | `sessionManager.forceReconnect()` → `await queueWhatsAppConnect(restaurantId, { force: true })` (L19); respons DB L21 |
| `src/services/whatsapp/whatsapp.queue.ts` | `queueWhatsAppConnect(restaurantId, options?: {force?})` — job type/queue SAMA, `force` opsional (L149–168); komentar pada `queueWhatsAppDisconnect` |
| `src/workers/whatsapp.worker.ts` | (a) `force?: boolean` pada `WhatsAppConnectJobData` (L31–32); (b) `case "connect"` memilih `forceReconnect()`/`connect()` (L91–100); (c) IIFE boot memanggil `restoreSessions()` (L160–195, log L179/L183) |
| `.env` (**gitignored**) | komentar session-dir: worker = satu-satunya owner |

**Tidak diubah:** `session-manager.ts`, `providers/baileys/*`, `/api/whatsapp/status`, `/api/whatsapp/qr`,
`src/services/whatsapp/whatsapp.service.ts` (dead code), `prisma/*`, Order/Reservation/Payment engine, template pesan.

---

## 8. WORKER LIFECYCLE

```
npm run worker:dev
  └─ tsx --env-file=.env src/workers/whatsapp.worker.ts
       ├─ new IORedis(REDIS_URL) + new Worker("whatsapp", …, {concurrency:5})
       ├─ console.log("[WhatsApp Worker] Starting worker...")
       ├─ IIFE: import(session-manager) → restoreSessions()   ← BARU (Phase 1)
       │    └─ 0 session eligible → 0 restored (tanpa kredensial dummy, tanpa socket, tanpa QR)
       ├─ Worker ready → konsumsi queue "whatsapp"
       └─ SIGINT/SIGTERM → gracefulShutdown() (worker.close + redis.quit)
```

Log nyata:

```
[WhatsApp Worker] Starting worker...
[WhatsApp Worker] Restoring persisted WhatsApp sessions...
[WhatsApp Worker] Session restore finished
[WhatsApp Worker] Worker is ready and listening for jobs
```

Urutan aman: restore berjalan **setelah** `Starting worker...` dan **tidak** memblokir konsumer (IIFE, tanpa top-level await
sehingga tetap kompatibel dengan transform CJS `tsx`). Kegagalan restore tidak pernah mematikan worker (try/catch; `restoreSessions()` juga sudah menelan error per-session).

## 9. CONNECT FLOW

```
Admin UI → POST /api/whatsapp/connect
  → requireAdmin()                       (restaurantId dari sesi admin, bukan klien)
  → getStatus(rid) : cek DB → 409 bila CONNECTED/CONNECTING/QR_REQUIRED
  → queueWhatsAppConnect(rid)            (queue "whatsapp" existing, priority 0)
  → getStatus(rid) : respons SessionInfo (bentuk sama seperti sebelumnya)
Worker → job "connect" → sessionManager.connect(rid) → provider.connect() → Baileys
```

## 10. DISCONNECT FLOW

```
Admin UI → POST /api/whatsapp/disconnect
  → requireAdmin() → getStatus(rid) : 404 bila DISCONNECTED
  → queueWhatsAppDisconnect(rid)
  → getStatus(rid) : respons SessionInfo
Worker → job "disconnect" → sessionManager.disconnect(rid) → provider.disconnect()
        → updateDbStatus(DISCONNECTED)   (semantik logout/penghapusan kredensial tidak diubah)
```

## 11. SEND MESSAGE FLOW

```
Order READY      → order.service queueWhatsAppNotification → queue "whatsapp"
Reservation      → reservation-whatsapp queueWhatsAppReservation → queue "whatsapp"
                              │
                              ▼
Worker → job "send_message" → sessionManager.sendMessage(rid,to,msg)
         → (bila CONNECTED) provider.sendMessage() dengan socket MILIK WORKER
         → lalu simpan WhatsAppMessage OUTGOING status "sent"
```

Order engine, Reservation engine, dan template pesan **tidak diubah**. Setelah handoff ini, jalur yang sama kini
berjalan di proses yang benar-benar memiliki socket (sebelumnya mustahil).

## 12. QR HANDLING

**DEMO LIMITATION / FOLLOW-UP.** Tidak ada Redis QR, tidak ada tabel QR, tidak ada websocket (sesuai instruksi).

| Aspek | Status Phase 1 |
| --- | --- |
| `provider.onQrCode` | masih **tidak diregistrasi** di session-manager (tidak diubah pada Phase 1) |
| `getQrCode()` / `refreshQr()` | tetap seperti semula (`refreshQr` tetap 0 caller) |
| `/api/whatsapp/qr` | tetap ada, **tidak** membuat socket; memanggil `getStatus()` (DB) lalu `getQrCode()` → `null` |
| Konsekuensi | QR hanya hidup di **memori worker**; web tidak bisa menampilkannya |

Yang **dijamin** Phase 1: QR ownership **tidak** menyebabkan web membuat Baileys socket (dibuktikan: modul Baileys
tidak termuat di proses web, §18 masuk 2). Integrasi QR yang proper (mis. publikasi QR ber-TTL) ditunda ke fase
setelah ownership dasar stabil — dan **tidak** dibuat pada Phase 1.

## 13. STATUS HANDLING

```
Worker: Baileys → callback onStatusChange → sessionManager.updateSessionStatus → DB WhatsAppSession
Web   : GET /api/whatsapp/status → requireAdmin → sessionManager.getStatus()
        → (web tidak punya provider) → fallback DB WhatsAppSession  → { status, phone, qrCode:null, lastActiveAt, lastError } + queue stats
```

- **Tidak** ada Redis status system, **tidak** ada model/tabel/enum baru.
- Route `/status` **tidak diubah** — setelah handoff, fallback DB otomatis menjadi satu-satunya jalur di web
  (tidak perlu memodifikasi apa pun; sesuai STEP 7).
- Terverifikasi tanpa socket (§18 masuk 2): `getStatus` mengembalikan data DB (`ERROR`, `phone=null`, `qrCode=null`, `lastError=...`).

## 14. SESSION DIRECTORY

| Proses | Peran terhadap `./whatsapp-session` |
| --- | --- |
| **Worker** | **Owner tunggal** — satu-satunya yang boleh menginisialisasi Baileys (connect/restore) terhadap direktori ini |
| **Web** | **Tidak pernah** membuka/membuat direktori ini (tidak ada jalur socket dari web) |

- Tidak ada direktori session kedua, tidak ada duplicate credentials, tidak ada dua socket.
- Phase 1 **tidak membuat** direktori/kredensial sama sekali: `ls whatsapp-session` → `No such file or directory`
  (konsisten: 0 session eligible → `restoreSessions()` tidak meng-instansiasi provider → tidak ada FS access).
- Path tetap deterministik dari Phase 0: `/home/reksa/restorant-cafe/whatsapp-session`.

## 15. DATABASE IMPACT

| Item | Hasil |
| --- | --- |
| Migration | **TIDAK ADA** (tidak dijalankan, tidak dibuat) |
| Schema change | **TIDAK ADA** (`prisma/schema.prisma` tidak disentuh) |
| Tabel/kolom/enum baru | **TIDAK ADA** |
| Model yang dipakai | `WhatsAppSession` (existing) untuk status; `WhatsAppMessage` (existing) untuk log pesan |
| Tulis DB selama Phase 1 | **NOL.** `whatsappsession` = 1 baris (tidak berubah), `whatsappmessage` = 0 baris |
| Tenant scope | `restaurantId @unique` tetap satu-satunya kunci session |

## 16. REDIS / BULLMQ IMPACT

| Item | Hasil |
| --- | --- |
| Redis system baru | **TIDAK** |
| Key baru untuk QR/status/lock/session | **TIDAK ADA** |
| Queue baru | **TIDAK** (hanya queue `whatsapp` yang sudah ada) |
| Job semantics baru | **TIDAK** — hanya field opsional `force` pada job `connect` yang sudah ada (backward compatible: tanpa `force` perilaku identik) |
| Clear queue manual | **TIDAK** |
| Replay stale QA job | **TIDAK** |
| Manufacture test job | **TIDAK** |
| Kondisi queue setelah Phase 1 | `wait=0, active=0, prioritized=0, delayed=0, completed=0, failed=50 (cap)` — tidak ada aktivitas job selama Phase 1 |

## 17. SECURITY / TENANT ISOLATION

| Aspek | Status |
| --- | --- |
| Authorization | `requireAdmin()` tetap di **semua** route (tidak ada auth baru) |
| `restaurantId` | **Selalu** dari `requireAdmin()` (sesi admin terverifikasi) — tidak pernah dari body/query; job queue hanya menerima id hasil otorisasi |
| Worker tenant guard | `prisma.restaurant.findUnique` tetap menolak restaurant tidak dikenal (§ tidak berubah) |
| Web tidak dapat membuka socket | Terverifikasi: 0 pemanggilan socket-creating dari `src/app/**`; modul Baileys tidak termuat di proses web |
| Cross-restaurant QR/status | QR/status per `restaurantId`; `/qr` & `/status` memakai `restaurantId` dari sesi; QR di web selalu `null` (tidak ada kebocoran lintas restoran) |
| Credentials ke API | Tidak ada — `SessionInfo` hanya `{restaurantId,status,phone,qrCode,lastActiveAt,lastError}`; DB `lastError` sudah disanitasi |
| Baileys provider ke klien | Tidak — provider hanya di worker; bundle klien memakai wrapper axios |

## 18. VERIFICATION

Verifikasi minimal (STEP 14). **Tidak** dijalankan: `npx tsc --noEmit`, `npm run build`, full test suite
(tidak diperlukan — tidak ada error dari perubahan). Tidak ada test suite WhatsApp baru yang dibuat.

| # | Target | Hasil |
| --- | --- | --- |
| 1 | **worker startup** | `[WhatsApp Worker] Starting worker...` + `Worker is ready and listening for jobs` (log §8) |
| 2 | **`restoreSessions()` dipanggil worker** | `[WhatsApp Worker] Restoring persisted WhatsApp sessions...` (1×) + `Session restore finished` (1×), 0× `Session restore failed`. DB: 1 baris `ERROR` → **0 session eligible** → **0 restored** (diterima) |
| 3 | **web tidak membuat Baileys socket** | grep `src/app/**` untuk connect/disconnect/forceReconnect/refreshQr/sendMessage = **0**; probe proses web (`getStatus`) → `baileys provider module loaded: false`, `getQrCode → null` |
| 4 | **connect route → queue → worker** | `connect/route.ts:39` `await queueWhatsAppConnect(restaurantId)`; worker `case "connect"` L91–100 → `sessionManager.connect()` |
| 5 | **disconnect route → queue → worker** | `disconnect/route.ts:29` `await queueWhatsAppDisconnect(restaurantId)`; worker L104 → `sessionManager.disconnect()` |
| 6 | **send_message → worker** | worker `case "send_message"` tetap di worker (tidak diubah); producer Order/Reservation tidak diubah |
| 7 | **status tetap dapat dibaca web** | `getStatus()` → DB `{status:"ERROR", phone:null, qrCode:null, lastError:"Connection failed after maximum retry attempts"}` tanpa socket |
| 8 | **session directory hanya worker** | `ls whatsapp-session` → tidak ada (dibuat 0 kali) |
| 9 | **exactly one worker** | BullMQ `getWorkers()` = **1** (`name: "whatsapp"`); native = 1 worker logis |
| 10 | **git diff --check** | **EXIT 0** |
| — | Docker worker | `restaurant-worker  Exited (0)` (tetap stopped) |
| — | Redis / MariaDB | `restaurant-redis  Up (healthy)` / `restaurant-mariadb  Up (healthy)` |
| — | Clone `restorant-cafe2` | tidak ada worker/consumer dari sana |
| — | DB/Redis reset | tidak ada |
| — | commit/push/deploy | tidak ada; HEAD tetap `70226bc`; nothing staged |

Catatan metode: verifikasi connect/disconnect **tidak** dijalankan sebagai job nyata karena itu akan membuat
socket + QR (dilarang di Phase 1 — STEP 15). Bukti bersifat **statis + wiring** (kode final + producer/consumer yang
sudah terverifikasi ada di Phase 0).

### PHASE 1 PASS CRITERIA

- [x] Worker is sole Baileys owner
- [x] Web cannot create Baileys socket
- [x] `restoreSessions()` runs from worker
- [x] Existing session manager reused (0 baris diubah)
- [x] Existing queue reused
- [x] Connect goes WEB → EXISTING QUEUE → WORKER
- [x] Disconnect goes WEB → EXISTING QUEUE → WORKER
- [x] `send_message` executes in worker
- [x] Web status does not require Baileys socket
- [x] Session directory owned only by worker
- [x] Tenant isolation preserved
- [x] Credentials never exposed
- [x] No new Redis architecture
- [x] No new infrastructure
- [x] No schema migration
- [x] Exactly one whatsapp worker
- [x] Docker worker remains stopped
- [x] Redis remains running
- [x] MariaDB remains running
- [x] No pairing
- [x] No QR scan
- [x] No message sent
- [x] No unrelated domain changes
- [x] `git diff --check` PASS
- [x] no commit · [x] no push · [x] no deploy

## 19. DEMO LIMITATIONS

Disengaja (bukan bug Phase 1):

1. **QR tidak bisa ditampilkan di admin UI** — QR hidup di memori worker; tidak ada Redis/DB/websocket untuk
   meneruskannya. `/api/whatsapp/qr` mengembalikan `null` dengan pesan "QR code is being generated, please wait...".
   ⇒ **FOLLOW-UP** setelah ownership stabil (mis. publikasi QR ber-TTL; belum dikerjakan).
2. **Connect/disconnect bersifat asinkron** — respons route memuat status DB saat itu; UI sudah polling
   (`/status` 10s; `/qr` 2s saat `QR_REQUIRED`) sehingga perubahan akan muncul tanpa mengubah kontrak API.
3. **Tombol "Refresh QR"** di admin masih memanggil `POST /api/whatsapp/connect` yang akan 409 saat
   `QR_REQUIRED` (temuan R7.1 §5). Tidak diperbaiki pada Phase 1 (bukan bagian ownership handoff).
4. **`refreshQr()` masih 0 caller** dan `provider.onQrCode` belum diregistrasi — sengaja tidak diubah.
5. **Worker belum punya supervisor** (tidak ada systemd/pm2) — restart VPS = jalankan `npm run worker:dev` manual.
6. **`failed` job cap 50** — riwayat kegagalan lama terdorong keluar; belum ada visibilitas kegagalan di UI.
7. **`src/services/whatsapp/whatsapp.service.ts` (server) masih dead code** — tidak dihapus pada Phase 1.

## 20. REMAINING RISKS

| Risiko | Tingkat | Catatan |
| --- | --- | --- |
| Jalur connect/disconnect **belum diuji end-to-end** | Sedang | Diuji statis; uji runtime butuh pairing (dilarang Phase 1). Uji wajib pada fase pairing |
| Job `connect` berkonkurensi (`concurrency: 5`) | Rendah | `connect()` idempoten (guard `connectionAttemptInProgress`/`this.sock`); double-click aman |
| `force` reconnect bertumpuk dengan connect biasa | Rendah | Keduanya bersifat serialisasi internal provider; job diproses FIFO |
| Status DB bisa basi setelah worker mati | Sedang | `getStatus` tidak memeriksa freshness `lastActiveAt`; UI bisa menampilkan status lama sampai worker menulis ulang |
| Web masih mengimpor `session-manager` (read-only) | Rendah | Terverifikasi tidak memuat Baileys (dynamic import); tidak membuat socket |
| Satu worker = single point | **Diterima (demo)** | Sesuai keputusan "tidak ada HA/multiple worker di demo" |
| Redis tanpa auth | Sedang (terpisah) | Temuan R7.1 §15; tidak diubah |

## 21. PHASE 2 READINESS

Sudah siap:

- [x] Worker = satu-satunya Baileys owner; web = command/UI layer.
- [x] Command connect/disconnect/reconnect melewati queue existing.
- [x] `restoreSessions()` aktif saat boot (0 restored tanpa kredensial — normal).
- [x] Status web tanpa socket; session dir eksklusif worker.
- [x] Tepat satu consumer; docker worker stopped; Redis/MariaDB running.
- [x] Tanpa migration/schema/Redis-key/infrastruktur baru.

Pekerjaan yang menanti (belum dikerjakan, butuh review/persetujuan):

1. **Pairing end-to-end** (scan QR oleh admin) — memerlukan keputusan tentang penerusan QR ke UI (demo limitation §19.1).
2. Uji runtime connect → CONNECTED → `send_message` nyata (Order READY + Reservation).
3. Perapian UX tombol "Refresh QR" (409) dan/atau registrasi `provider.onQrCode`.
4. Opsional: supervisor native (systemd/pm2) + visibilitas kegagalan job.

**STOP** — Phase 1 selesai. Tidak ada pairing, tidak ada QR scan, tidak ada pesan terkirim, dan Phase 2 belum dimulai.
