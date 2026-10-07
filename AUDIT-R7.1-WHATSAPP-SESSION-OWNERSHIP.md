# AUDIT R7.1 — WHATSAPP SESSION OWNERSHIP / BAILEYS WORKER (G2)

> Mode: **AUDIT ONLY (read-only)**. Tidak ada source/schema/migration/Docker/PM2/Redis/DB/env yang diubah.
> Tidak ada test/build, tidak ada commit/push, tidak menyentuh VPS/production.
> Tanggal: 2026-10-07 · Repo audit: `/home/reksa/restorant-cafe` @ `70226bc` (+ working tree Phase 1 reservation/order/payment yang belum di-commit)
> Baseline: `AUDIT-R7.0-APP-WORKER-DATABASE-ENVIRONMENT.md` (G1 PASS) dan `AUDIT-WHATSAPP-RESERVATION-NOTIFICATION-R7.md`.

---

## 1. EXECUTIVE SUMMARY

**Root cause G2 (session ownership terpecah):** ada **DUA proses** yang masing-masing menjalankan
`WhatsAppSessionManager` sendiri dengan `Map<string, ProviderInstance>` **di memori proses**
(`session-manager.ts:82`):

- Proses **WEB** (Next.js) yang membuat & memegang socket Baileys — dipanggil **langsung**
  (bukan lewat queue) oleh `src/app/api/whatsapp/{connect,disconnect,status,qr,reconnect}/route.ts`.
  Jadi socket hasil pairing admin hidup di **memori proses web**.
- Proses **WORKER** (BullMQ, `src/workers/whatsapp.worker.ts`) yang **mengeksekusi pengiriman pesan**,
  tetapi `sessions` map-nya **kosong** karena socket-nya ada di proses web.

`session-manager.sendMessage()` (`session-manager.ts:304`) hanya melihat map in-process:

```ts
const provider = this.sessions.get(restaurantId);
if (!provider || provider.getConnectionStatus() !== "CONNECTED") {
  throw new Error(`WhatsApp not connected for restaurant ${restaurantId}`);   // L308–311
}
```

→ dari worker selalu throw. **Bukti runtime:** tepat **1 job** di `bull:whatsapp:failed` dengan
`failedReason = "WhatsApp not connected for restaurant cmtois12y0000bzu8o894azsd"`
(`finishedOn 2026-10-06T09:08:57.603Z`) dan itu adalah job **terbaru** yang gagal.

**Owner saat ini:** WEB (untuk connect/QR/status) — **bukan** worker.
**Owner yang seharusnya:** **WORKER** (satu-satunya proses yang butuh socket untuk mengirim, dan
satu-satunya proses yang dapat hidup lama tanpa bergantung pada trafik HTTP).
**Perubahan minimal & aman:** **OPTION A — worker owns Baileys**; API berhenti membuat socket dan
hanya **enqueue command** ke queue `whatsapp` (producer `queueWhatsAppConnect/Disconnect` **sudah ada**),
sementara **status** dibaca dari DB `WhatsAppSession` (sudah disinkronkan oleh session-manager) dan
**QR** dipublikasikan worker ke Redis ber-TTL pendek untuk dibaca `/api/whatsapp/qr`.
**Tidak perlu migration, tidak perlu schema baru, tidak perlu queue baru.**

Temuan fatal tambahan (blocker yang harus ikut ditutup):
1. **`restoreSessions()` 0 pemanggil** → session tidak pernah dipulihkan setelah restart (`session-manager.ts:339`).
2. **Tidak ada `instrumentation.ts`** → tidak ada hook boot di proses web (dan memang tidak diperlukan bila worker jadi owner).
3. **Worker tidak memuat `.env`** (`package.json:16` → `tsx src/workers/whatsapp.worker.ts`; **tidak ada** `import "dotenv/config"`,
   dan probe membuktikan `tsx` tidak auto-load `.env`): `DATABASE_URL` **unset** → `@/lib/prisma` throw
   `"DATABASE_URL environment variable is not set"`. Efek sampingnya **lebih berbahaya**: `WHATSAPP_SESSION_DIR`/
   `WHATSAPP_SESSION_PATH` juga unset sehingga provider worker jatuh ke fallback absolut `/app/whatsapp-session`
   (bukan `./whatsapp-session` milik web) → **filesystem session pun terpisah**.
4. **Tidak ada file kredensial Baileys sama sekali** di mesin aktif (`whatsapp-session/` tidak ada, tidak ada
   direktori `restaurant-*`), dan satu-satunya baris `WhatsAppSession` berstatus **ERROR**, `isActive=false`,
   `phone=null` (update terakhir 2026-09-09) → **pairing harus diulang** sebelum G2 bisa diuji end-to-end.
5. **Dead code** di jalur ini: `restoreSessions`, `refreshQr`, `isConnected`, `isHealthy`,
   `queueWhatsAppConnect`, `queueWhatsAppDisconnect`, `queueWhatsAppMessage`, `message.parser.ts`,
   `src/services/whatsapp/whatsapp.service.ts` (server) — 0 pemanggil produksi.

---

## 2. CURRENT ARCHITECTURE

```
                         PROSES WEB (Next.js: next dev / next start)                       PROSES WORKER (tsx src/workers/whatsapp.worker.ts)
                         ─────────────────────────────────────────                         ──────────────────────────────────────────────
Admin UI /admin/whatsapp
   │ (axios, cookie admin)
   ▼
/api/whatsapp/connect      ──LANGSUNG──►  whatsappSessionManager(WEB)  ──► Buffer Baileys
/api/whatsapp/qr           ──LANGSUNG──►  (Map in-memory)  ─────────────►  socket SOCKET-A
/api/whatsapp/status       ──LANGSUNG──►        │
/api/whatsapp/disconnect   ──LANGSUNG──►        │ syncDbSession()/updateSessionStatus()
/api/whatsapp/reconnect    ──LANGSUNG──►        ▼
                                            DB whatsappsession  ◄──── juga ditulis worker saat connect/disconnect

Order READY ─┐
Reservation ─┴► queueWhatsAppNotification/Reservation
                        │  BullMQ "whatsapp" (redis://localhost:6379)
                        ▼
                 Worker("whatsapp", concurrency 5)  ──►  whatsappSessionManager(WORKER)
                        │                                   Map in-memory: **KOSONG**
                        │                                   └─► sendMessage() → THROW
                        │                                        "WhatsApp not connected for restaurant ..."
                        └─► (job gagal, attempts/backoff, masuk bull:whatsapp:failed)
```

**Fakta kunci:** tidak ada satu pun jalur yang menghubungkan socket di proses WEB dengan `sendMessage`
di proses WORKER. Tidak ada Redis/DB/lock yang membawa *socket handle* (dan memang tidak bisa —
socket hanya hidup di memori proses).

---

## 3. SESSION MANAGER AUDIT — `src/services/whatsapp/session-manager.ts` (634 baris)

| Elemen | Lokasi | Current behavior | Problem | Rekomendasi |
| --- | --- | --- | --- | --- |
| Singleton | L619–634 (`globalForSessionManager`) | Satu manager **per proses**; di dev dipasang ke `globalThis` (HMR-safe) | Dua proses = dua singleton = dua "dunia" terpisah | Pertahankan singleton, tetapi **hanya worker** yang boleh meng-instansiasi provider |
| Session map | L82 `private sessions: Map<string, ProviderInstance>` | `restaurantId → provider` in-memory | Sumber kebenaran socket hanya di memori proses; worker tidak punya entri apa pun | Worker jadi satu-satunya pemilik map; web tidak pernah menyentuh provider |
| Callback guard | L83 `callbackRegistered: Set<string>` | Cegah registrasi callback ganda per restoran per proses | Guard-nya per proses → tidak mencegah dua proses memegang socket yang sama | Tidak perlu diubah bila single owner |
| `getOrCreateProvider` | L89–102 | Buat provider lewat **lazy import** `baileys.provider.impl` | Lazy import tetap memuat Baileys di proses pemanggil | Hanya dipanggil dari worker |
| `registerCallbacks` | L105–146 | `onStatusChange`→DB, `onLoggedOut`→cleanup+DB, `onMaxRetriesExceeded`→ERROR, `onMessage`→`WhatsAppMessage` INCOMING | `onQrCode` **tidak** diregistrasi di sini (lihat §11) | Tambahkan `provider.onQrCode(qr => publishQr(restaurantId, qr))` saat worker menjadi owner |
| `connect` | L148–187 | Idempoten untuk status CONNECTED/CONNECTING/QR_REQUIRED/RECONNECTING; `registerCallbacks`; `provider.connect()`; `syncDbSession` | Dipanggil dari proses WEB saat ini → socket di web | Web hanya enqueue; worker yang memanggil |
| `disconnect` | L189–211 | `provider.disconnect()`, hapus dari map & callbackGuard, `updateDbStatus(DISCONNECTED)` | Idem (web-owned) | Web hanya enqueue; worker yang memanggil |
| `refreshQr` | L213–254 | Reconnect bila status QR_REQUIRED/CONNECTING | **0 pemanggil** (tidak ada route yang memakainya) | Hapus atau pakai lewat job `reconnect` |
| `forceReconnect` | L256–269 | Disconnect lalu `connect()` | Dipakai `/api/whatsapp/reconnect` (web) | Pindahkan ke job worker |
| `getStatus` | L271–294 | Provider in-memory bila ada, **fallback** ke baris DB | Fallback DB bisa **basi** (mis. `CONNECTED` padahal proses baru saja restart) | Status publik harus dari DB + heartbeat freshness |
| `getQrCode` | L296–300 | `provider?.getQrCode() ?? null` | QR hanya di memori proses pembuat socket → web tidak bisa melihat QR milik worker | Publikasikan QR ke Redis (TTL pendek), baca dari sana |
| `sendMessage` | L304–319 | Cek provider + status CONNECTED, else **throw** | **Sumber error G2** | Setelah worker jadi owner, jalur ini berfungsi tanpa perubahan kontrak |
| `isConnected` / `isHealthy` | L321–337 | Cek provider in-memory | **0 pemanggil** | Dead code (boleh dipertahankan untuk health endpoint di R7.2+) |
| `restoreSessions` | L339–394 | Baca DB status CONNECTED/RECONNECTING/QR_REQUIRED → `hasExistingSession()` → `connect()`; else tandai DISCONNECTED | **0 pemanggil** (blocker) | Panggil saat **boot worker** |
| `getSessionInfo` | L396–411 | Susun `SessionInfo` dari provider | Hanya bisa jalan di proses pemilik socket | Web tidak boleh memakainya |
| `syncDbSession` | L413–473 | Upsert status/phone/lastActiveAt/isActive; buat `sessionId` `session-<rid>-<ts>` | `sessionId` **tidak pernah dibaca** di mana pun | Biarkan (kolom existing, tanpa migration) |
| `updateSessionStatus` | L475–533 | Dipanggil dari callback status; menyimpan `lastError` | — | Pertahankan |
| `updateDbStatus` | L535–560 | `prisma.whatsAppSession.update()` **(bukan upsert)** | Bila baris belum ada → P2025, ditelan `catch` (status tidak tersimpan) | Ganti ke upsert pada R7.2 |
| `sanitizeError` | L562–582 | Buang path/password/secret, potong 200 char | Baik | Pertahankan |
| incoming message | L584–617 | Simpan `WhatsAppMessage` INCOMING | Hanya berjalan di proses pemilik socket | Otomatis benar setelah worker jadi owner |

### 3.1 MATRIKS KEPEMILIKAN (kondisi SEKARANG, berbasis bukti source)

| Capability | Web/API | Worker | Redis | DB | Filesystem |
| --- | --- | --- | --- | --- | --- |
| connect | **YA** (`api/whatsapp/connect/route.ts:26` → `sessionManager.connect`) | TIDAK (ada `case "connect"` di worker, tapi **tidak ada producer**) | hanya BullMQ internal (job) | write `whatsappsession` (`syncDbSession`) | YA — tulis `creds.json` (`useMultiFileAuthState`) |
| disconnect | **YA** (`disconnect/route.ts:19`) | TIDAK (case ada, producer tidak ada) | — | write `whatsappsession` (`updateDbStatus`) | YA — `cleanupSessionFiles()` pada logout |
| QR | **YA** (`qr/route.ts:24` → `getQrCode`, in-memory) | TIDAK | TIDAK | TIDAK (QR tidak pernah disimpan) | TIDAK |
| status | **YA** (`status/route.ts:12` → provider atau DB) | TIDAK | hanya statistik queue (`getWhatsAppQueueStats`) | **YA** (fallback baca `whatsappsession`) | TIDAK |
| sendMessage | TIDAK (tidak ada route kirim) | **YA** (`whatsapp.worker.ts:73`) tetapi **selalu throw** (map kosong) | hanya job `send_message` | tulis `whatsappmessage` OUTGOING (**hanya setelah** send sukses → saat ini tidak pernah tercapai) | TIDAK |
| restore | TIDAK | TIDAK | TIDAK | baca `whatsappsession` (fungsi ada, **0 pemanggil**) | dibaca `hasExistingSession()` (belum pernah jalan) |
| reconnect | **YA** (`reconnect/route.ts:11` → `forceReconnect`) | TIDAK | — | write `whatsappsession` | YA |

> Kesimpulan tabel: **semua capability koneksi dimiliki WEB**, sedangkan **satu-satunya capability yang
> butuh socket (sendMessage) dijalankan WORKER**. Inilah G2.

---

## 4. BAILEYS LIFECYCLE — `providers/baileys/baileys.provider.impl.ts` (512 baris)

Satu-satunya tempat `makeWASocket` hidup di seluruh repo (grep `@whiskeysockets/baileys` → 1 file).

| Elemen | Lokasi | Current behavior | Problem |
| --- | --- | --- | --- |
| `QR_EXPIRATION_MS` | L23 | 25.000 ms | QR dianggap kedaluwarsa 25s, **hanya** untuk getter (Baileys sendiri rotasi ~20s) |
| `MAX_RECONNECT_ATTEMPTS` | L24 | 5 | Setelah 5× → status `ERROR` + callback `onMaxRetriesExceeded` (inilah `lastError` di DB) |
| `constructor` | L55–66 | `sessionDir = WHATSAPP_SESSION_DIR \|\| WHATSAPP_SESSION_PATH \|\| "/app/whatsapp-session"` | Fallback absolut → **worker tanpa env menulis ke `/app/whatsapp-session`**, web ke `./whatsapp-session` |
| `getSessionPath` | L70–72 | `<sessionDir>/restaurant-<restaurantId>` | Sudah **restaurant-scoped** (bagus) |
| `hasExistingSession` | L77–85 | Cek `creds.json` | Dipakai hanya oleh `restoreSessions` (0 pemanggil) |
| `cleanupSessionFiles` | L91–110 | `fs.rmSync(path, {recursive, force})` | Dipanggil pada loggedOut/badSession/connectionReplaced — **menghapus kredensial**; bila dua owner berbagi direktori, salah satu bisa menghapus kredensial owner lain |
| `getQrCode` | L160–171 | Null-kan QR bila > 25s | QR tidak pernah dipublikasikan keluar proses |
| `connect` | L195–390 | Guard `connectionAttemptInProgress`/`this.sock`; `mkdir`; `useMultiFileAuthState` (L225); `makeWASocket` (L228); `credForUpdate` (`creds.update` → `saveCreds`); `connection.update` (L244) | — |
| `connection.update` | L244–338 | `qr` → status `QR_REQUIRED` + `onQrCode`; `close` → klasifikasi `loggedOut` / `badSession(500)` / `connectionReplaced` (no-reconnect + cleanup) vs recoverable (backoff `min(1000·2^n,16000)`); `open` → `CONNECTED` + ambil nomor dari JID | **`connectionReplaced` adalah risiko nyata** bila 2 proses memakai creds yang sama |
| `messages.upsert` | L340–380 | `notify` non-`fromMe` → `onMessage` | Store INCOMING via session-manager |
| `disconnect` | L392–408 | `sock.end(undefined)` → `DISCONNECTED` | — |
| `refreshQr` | L410–431 | End socket + `connect()` | **0 pemanggil** |
| `forceReconnect` | L433–455 | End socket + reset state + `connect()` | Dipakai route reconnect (web) |
| `sendMessage` | L457–470 | Guard `sock && CONNECTED`; `to` → `<digits>@s.whatsapp.net`; `sock.sendMessage(jid,{text})` | Amankan; hanya bisa jalan di proses pemilik socket |

**Yang membuat socket:** `getOrCreateProvider` (`session-manager.ts:89`) → `connect()` → `makeWASocket`.
Karena `session-manager` di-import oleh **route web** dan **worker**, kedua proses **berpotensi** membuat socket.

---

## 5. WEB/API AUDIT

| Route | File | Perilaku | Bukti |
| --- | --- | --- | --- |
| `POST /api/whatsapp/connect` | `src/app/api/whatsapp/connect/route.ts` | `requireAdmin()` → `getStatus()` → tolak 409 bila CONNECTED/CONNECTING/QR_REQUIRED → **`sessionManager.connect()` langsung** | L18–26 |
| `POST /api/whatsapp/disconnect` | `.../disconnect/route.ts` | `requireAdmin()` → 404 bila DISCONNECTED → **`disconnect()` langsung** | L12–19 |
| `GET /api/whatsapp/status` | `.../status/route.ts` | `requireAdmin()` → `getStatus()` + `getWhatsAppQueueStats()` | L12–13 |
| `GET /api/whatsapp/qr` | `.../qr/route.ts` | `requireAdmin()` → `getStatus()`; hanya bila `QR_REQUIRED` → **`getQrCode()` in-memory** | L11–24 |
| `POST /api/whatsapp/reconnect` | `.../reconnect/route.ts` | `requireAdmin()` → **`forceReconnect()` langsung** | L11 |

Jawaban tegas atas pertanyaan audit:
- **Langsung membuat Baileys socket?** Ya (via session-manager → provider → `makeWASocket`).
- **Memanggil session manager?** Ya, kelima route.
- **Enqueue BullMQ?** **Tidak** (0 `queueWhatsApp*` di folder route).
- **Membaca Redis?** Hanya `getWhatsAppQueueStats()` (statistik waiting/active/completed/failed).
- **Membaca DB?** Ya, via fallback `getStatus()` (`whatsappsession`) dan `syncDbSession`/`updateDbStatus`.
- **Membaca filesystem?** Tidak langsung; lewat provider (`useMultiFileAuthState`, `hasExistingSession`).

**UI admin:** `src/app/admin/whatsapp/page.tsx` (client component) memakai wrapper **browser**
`src/services/whatsapp.service.ts` (axios → `/api/whatsapp/*`, L1–20: "CLIENT-SIDE API wrapper").
Polling status tiap 10s; saat `QR_REQUIRED` polling QR tiap 2s (`page.tsx:145–154`, `264–277`).
Tidak ada Baileys/Baileys-credential yang masuk bundle klien (wrapper hanya axios).

**Cacat UI yang ditemukan (relevant untuk R7.2):** tombol "Refresh QR" (`handleRefreshQr`, `page.tsx:225–243`)
memanggil `whatsappService.connect()` → `POST /api/whatsapp/connect`, padahal route itu **409** saat status
`QR_REQUIRED`. Jadi refresh QR dari UI **tidak berfungsi**; jalur yang bekerja adalah tombol Reconnect
(`/api/whatsapp/reconnect`). Route `/api/whatsapp/qr` **hanya bisa membaca** QR, tidak pernah meregenerasi.

---

## 6. WORKER AUDIT — `src/workers/whatsapp.worker.ts` (150 baris)

| Bagian | Lokasi | Current behavior | Status |
| --- | --- | --- | --- |
| Redis | L8–16 | `new IORedis(REDIS_URL \|\| redis://localhost:6379, {maxRetriesPerRequest:null, enableReadyCheck:false})` standalone (tidak memakai `@/lib/redis`) | OK |
| Worker | L48–103 | `new Worker("whatsapp", handler, {connection, concurrency: 5})` | OK |
| Guard restaurant | L58–64 | `prisma.restaurant.findUnique` → throw `Restaurant <id> not found` | **G1 sudah PASS** (bukti Redis: 49 job gagal lama) |
| Dynamic import | L66–68 | `await import("@/services/whatsapp/session-manager")` | OK (lazy) |
| `send_message` | L71–84 | `sessionManager.sendMessage(rid,to,msg)` lalu tulis `WhatsAppMessage` OUTGOING `status:"sent"` | **FAIL → throw G2**; penulisan OUTGOING tidak pernah tercapai |
| `connect` | L86–89 | `sessionManager.connect(rid)` | **Tidak ada producer** → dead path |
| `disconnect` | L90–93 | `sessionManager.disconnect(rid)` | **Tidak ada producer** → dead path |
| Job type lain | L94–98 | `default: console.warn("Unknown job type")` | Tidak ada `reconnect`/`restore`/`qr`/`status` |
| Event handler | L105–118 | `completed`/`failed`/`ready` → `console.log`/`console.error` | **Tidak ada persistensi kegagalan** (hanya log) |
| Boot | L139 | `console.log("[WhatsApp Worker] Starting worker...")` | **Tidak memanggil `restoreSessions()`** |
| Shutdown | L124–137 | SIGINT/SIGTERM → `worker.close()` + `connection.quit()` | OK |
| Import env | seluruh file | **Tidak ada** `dotenv/config`; `npm run worker:dev` = `tsx src/workers/whatsapp.worker.ts` (`package.json:16`) | **Blocker:** probe `npx tsx` tanpa env-file → `DATABASE_URL unset` → Prisma throw; `WHATSAPP_SESSION_DIR` unset → fallback `/app/whatsapp-session` |

Ringkas: worker **sudah** menjadi consumer yang benar untuk `send_message`, tetapi (a) tidak pernah
menjadi **owner** socket, (b) tidak memulihkan session, (c) tidak menerima job connect/disconnect karena
producer-nya tidak pernah dipakai, (d) tidak memuat env.

---

## 7. QUEUE AUDIT — `src/services/whatsapp/whatsapp.queue.ts` (203 baris)

Konfigurasi queue (L9–25, nama `"whatsapp"`, Redis dari `@/lib/redis` via lazy `require`):

| Opsi | Nilai | Catatan |
| --- | --- | --- |
| `attempts` | 3 | retry otomatis |
| `backoff` | exponential, delay 1000 ms | 1s, 4s, … |
| `removeOnComplete` | `{ count: 100 }` | hash job completed disimpan sampai 100 |
| `removeOnFail` | `{ count: 50 }` | **sesuai bukti: `bull:whatsapp:failed` card = 50 (cap tercapai)** |

Producer (5 fungsi):

| Fungsi | Lokasi | Job type | `jobId` | Priority | Prod callers |
| --- | --- | --- | --- | --- | --- |
| `queueWhatsAppMessage` | L37–61 | `send_message` | — | 1 | **0** (dead) |
| `queueWhatsAppNotification` | L66–96 | `send_message` | `notification-<orderNumber>` | 1 | 1 — Order READY (`order.service.ts:1829`) |
| `queueWhatsAppReservation` | L108–137 | `send_message` | `reservation-<reservationId>-<status>` | 1 | 1 — `reservation-whatsapp.ts:55` |
| `queueWhatsAppConnect` | L142–161 | `connect` | — | 0 | **0** (dead, padahal ini kunci desain worker-owned) |
| `queueWhatsAppDisconnect` | L164–183 | `disconnect` | — | 0 | **0** (dead) |
| `getWhatsAppQueueStats` | L186–200 | — | — | — | `/api/whatsapp/status` |

Consumer: **hanya** `src/workers/whatsapp.worker.ts` (satu-satunya `new Worker(` di repo).
→ **Tidak ada double-consume dari kode repo**; risiko double-consume hanya bila worker docker (cafe2) dan worker lokal jalan bersamaan (lihat R7.0 §6).

Reliability:
- Kegagalan **dapat diketahui secara persisten**: `bull:whatsapp:failed` (zset) + hash job berisi `failedReason`.
  Namun **tidak ada** surfacing ke UI/dashboard/DB — hanya `console.error` di worker (L111–116).
- **Idempotency:** `jobId` di-set untuk order (`notification-<orderNumber>`) dan reservasi
  (`reservation-<id>-<status>`) → enqueue ulang pada status/kejadian yang sama **collapse** menjadi satu job.
  `send_message` untuk order juga dijaga ganda oleh `Order.notifiedAt` (`order.service.ts:1802,1842`).
- **Bahaya urutan:** karena `jobId` unik, kegagalan job **tidak** bisa di-enqueue ulang dengan `jobId` yang sama
  selama hash jobId masih ada (perlu `removeOnFail` habis / hapus job / pakai `jobId` baru).
- Retry: 3 attempts + backoff; setelah habis → `failed` (permanen sampai dibersihkan).

---

## 8. REDIS AUDIT

**Tidak ada satu pun Redis key milik aplikasi.** Grep `redis.(set|get|del|hset|publish|subscribe|lock)` pada
`src/**` → **0 hasil**. Satu-satunya isi Redis adalah key internal BullMQ.

Bukti inventaris (read-only, `redis://localhost:6379`, tanpa auth — `REDIS_URL` di `.env:26` tanpa password):

| Key | Tipe | Isi | TTL |
| --- | --- | --- | --- |
| `bull:whatsapp:wait` | list | 0 | — |
| `bull:whatsapp:active` | zset | 0 | — |
| `bull:whatsapp:prioritized` | zset | 133 | — |
| `bull:whatsapp:failed` | zset | **50** (cap `removeOnFail:50` tercapai) | — |
| `bull:whatsapp:completed` | zset | 0 | — |
| `bull:whatsapp:events` | stream | event job | — |
| `bull:whatsapp:meta` | hash | `{"version":"bullmq:6.3.2"}`, `paused=null` | — |
| `bull:whatsapp:<jobId>` | hash | job (5–12 field) untuk ±190 job, mayoritas `reservation-<id>-PENDING` | tidak ada |
| `bull:*` total | — | **195 key** | — |

Isi `failedReason` (dinormalisasi) dari 50 job gagal:
- **49 × `Restaurant <restaurantId> not found`** → error lama G1 (sudah hilang sejak R7.0).
- **1 × `WhatsApp not connected for restaurant cmtois12y0000bzu8o894azsd`** → **G2**, `finishedOn 2026-10-06T09:08:57.603Z`,
  dan merupakan **job terbaru** yang gagal.

Konsekuensi audit:
- **TIDAK ADA** Redis key untuk: session state, QR state, status state, atau distributed lock.
- Karena itu **tidak mungkin** web dan worker berbagi QR/socket lewat Redis hari ini.
- Penambahan key (*mis.* `whatsapp:qr:<restaurantId>` dengan TTL) **baru boleh** di R7.2 (dilarang pada fase audit ini).
- Redis **tanpa auth** dan listen `0.0.0.0:6379` → temuan keamanan (§15); TIDAK diubah di fase ini.

---

## 9. FILESYSTEM / AUTH STATE AUDIT

Resolusi direktori (**satu-satunya tempat ditentukan**): `baileys.provider.impl.ts:58–63`
`WHATSAPP_SESSION_DIR || WHATSAPP_SESSION_PATH || "/app/whatsapp-session"`, lalu path per restoran
`<dir>/restaurant-<restaurantId>` (`L70–72`), file kredensial `creds.json` (`L77–85`), plus file
signal/key lain yang dibuat `useMultiFileAuthState`.

| Konteks | `WHATSAPP_SESSION_DIR` | `WHATSAPP_SESSION_PATH` | Dir efektif |
| --- | --- | --- | --- |
| Web (Next.js) — **Next otomatis memuat `.env`** | unset | `./whatsapp-session` (`.env:23`) | `<repo>/whatsapp-session` |
| Worker native `npm run worker:dev` (tsx, tanpa env-file) | unset | unset | **`/app/whatsapp-session`** (fallback absolut) |
| `.env.example` (acuan kanonik) | `./whatsapp-session` (L35) | — | `<repo>/whatsapp-session` |
| docker-compose `app` | `/app/whatsapp-session` (L59) | — | volume `whatsapp_data` |
| docker-compose `worker` | `/app/whatsapp-session` (L88) | — | **volume `whatsapp_data` yang SAMA** |
| Dockerfile (app, runner) | — | — | `mkdir /app/whatsapp-session` + `chown nextjs:nodejs`; proses `USER nextjs` (uid 1001) |
| Dockerfile.worker | — | — | `mkdir /app/whatsapp-session`; proses **root** (tidak ada `USER`) |

Temuan:
1. **Native (kondisi aktif R7.0/R7.1): direktori session TERPISAH** (`<repo>/whatsapp-session` vs
   `/app/whatsapp-session`). Bahkan bila `sessions` map-nya "diperbaiki", worker tidak akan menemukan
   `creds.json` milik web.
2. **Belum ada kredensial sama sekali:** `whatsapp-session/` **tidak ada** di repo; `find / -name "whatsapp-session"` → kosong;
   tidak ada direktori `restaurant-*`. ⇒ Pairing harus diulang.
3. **Bila keduanya diarahkan ke direktori yang sama tanpa mematikan salah satu owner** → risiko nyata:
   dua `makeWASocket` memakai `creds.json` yang sama → Baileys melaporkan `connectionReplaced`, atau
   `cleanupSessionFiles()` salah satu proses **menghapus kredensial** yang dipakai proses lain (L284, L91–110).
4. **Docker: volume dibagi dua service dengan UID berbeda** (app `nextjs:1001`, worker `root`) → file
   `creds.json`/signal key bisa tidak terbaca/tidak bisa ditulis oleh salah satu pihak.
5. `.env` masih memakai alias lama `WHATSAPP_SESSION_PATH`, sedangkan `.env.example` sudah kanonik
   `WHATSAPP_SESSION_DIR` → **sumber kebingungan** yang harus diseragamkan di R7.2.

---

## 10. `restoreSessions()` AUDIT

- Definisi: `session-manager.ts:339–394`.
- **Caller di seluruh repo: 0.** Bukti: `grep -rn "restoreSessions" src/ *.ts *.json` → hanya definisi.
- Tidak ada `instrumentation.ts` / `instrumentation.js` di repo, dan tidak ada `process.on("ready")`/boot hook di web.
- Worker **tidak** memanggilnya saat boot (`whatsapp.worker.ts:139` hanya `console.log`).

⇒ **Blocker dikonfirmasi.** Setelah restart proses apa pun, tidak ada mekanisme memulihkan session;
satu-satunya cara adalah admin menekan Connect/Reconnect lagi.
Catatan: meski dipanggil pun, saat ini ia akan menandai semua baris `DISCONNECTED` (karena `hasExistingSession()`
false, dan baris DB berstatus ERROR tidak termasuk filter status restore).

---

## 11. QR LIFECYCLE

| Tahap | Lokasi | Current behavior |
| --- | --- | --- |
| Dibuat | Baileys `connection.update`→`qr`; `baileys.provider.impl.ts:249–256` | `qrCode = qr`, `qrGeneratedAt = Date.now()`, status `QR_REQUIRED`, callback `onQrCode` |
| Callback | `session-manager.ts:105–146` | **`onQrCode` TIDAK diregistrasi** → callback tidak pernah dipasang (QR tetap tersimpan di provider, tapi tidak ada jalur publish) |
| Disimpan | memori provider (`private qrCode`) | **Tidak** di Redis, **tidak** di DB |
| Dibaca | `/api/whatsapp/qr` (`qr/route.ts:24`) dan juga `/api/whatsapp/status` (karena `SessionInfo.qrCode`, `session-manager.ts:404`) | Keduanya **hanya di proses WEB** |
| TTL | `QR_EXPIRATION_MS = 25_000` (`L23`), dicek di getter `L160–171` | Setelah 25s getter mengembalikan `null` (QR lama tetap valid di sisi WA sampai rotasi berikutnya) |
| Expired | getter null → UI menampilkan "QR code is being generated" | UI polling 2s (`page.tsx:145–154`) |
| Regenerate | Hanya bila Baileys memancarkan event `qr` baru (≈20s) atau `forceReconnect` | `refreshQr()` **0 pemanggil**; tombol Refresh QR UI justru kena **409** (§5) |
| Multiple request | Idempoten (getter murni) | Aman |
| Isolasi restoran | QR disimpan per provider; provider per `restaurantId` | Isolasi benar **per proses**; tidak ada key lintas-restoran |
| Kebocoran | QR hanya lewat API ber-otorisasi `requireAdmin()` | OK; tapi `status` route juga mengembalikan `qrCode` (perlu diperhatikan saat membaca dari Redis) |

⇒ Setelah worker menjadi owner, QR **tidak lagi** bisa dibaca web. Diperlukan **publish QR ke Redis**
(`whatsapp:qr:<restaurantId>`, TTL pendek ~60s, di-set saat event `qr`, dihapus saat `open`/`close`),
dan `/api/whatsapp/qr` membaca dari Redis (bukan dari memori).

---

## 12. STATUS LIFECYCLE

Sumber status:
1. **Provider (memori)** → `onStatusChange` (`session-manager.ts:105–108`) → `updateSessionStatus` (`L475–533`)
   → **DB `whatsappsession`** (`status`, `phone`, `lastError`, `lastActiveAt`, `isActive = status==="CONNECTED"`).
2. **API `/api/whatsapp/status`** (`status/route.ts:12`) → `sessionManager.getStatus()`:
   - bila provider ada di memori proses → status provider;
   - bila **tidak** → **fallback DB** (`session-manager.ts:271–294`, `qrCode: null`);
   - ditambah `queue: {waiting, active, completed, failed}`.
3. **UI**: polling 10s (`page.tsx:264–277`).

Masalah:
- **Status bisa basi & menyesatkan.** Setelah proses web restart, provider map kosong → status dibaca dari DB;
  baris DB bisa masih `CONNECTED`/`QR_REQUIRED` padahal tidak ada socket. Tidak ada heartbeat/`updatedAt` freshness check
  (meski `lastActiveAt`/`updatedAt` tersedia).
- **Dua penulis DB** (web & worker) tanpa lock → `updateSessionStatus` web dan worker bisa saling menimpa `lastError`/`phone`.
- Kondisi saat ini (bukti): baris tunggal `status=ERROR`, `isActive=false`, `phone=null`,
  `lastError="Connection failed after maximum retry attempts"`, `lastActiveAt=2026-09-09T08:17:27Z`.
- `updateDbStatus` memakai `update()` bukan `upsert()` (`L535–560`) → bila baris belum ada, status gagal tersimpan
  (hanya di-log).

Setelah worker jadi owner: DB menjadi **satu-satunya** sumber status untuk web (ditambah Redis untuk QR), dan
`sessionId`/`lastActiveAt` dapat dipakai sebagai freshness marker.

---

## 13. MULTI-RESTAURANT ISOLATION

Struktur yang sudah restaurant-scoped (baik, tidak perlu diubah):
- Map key `restaurantId` (`session-manager.ts:82`), provider 1-per-restoran (`L89–102`).
- Direktori `restaurant-<restaurantId>` (`baileys.provider.impl.ts:70–72`).
- DB `whatsappsession.restaurantId @unique` (`schema.prisma:1233`).
- Job data membawa `restaurantId` (`whatsapp.queue.ts:44,84,126`); worker memvalidasi restoran (`whatsapp.worker.ts:58–64`).
- `WhatsAppMessage` menyimpan `restaurantId` (`schema.prisma:1201–1214`).
- API: `requireAdmin()` → `restaurantId` dari sesi (`auth-helpers.ts:171–175`), bukan dari body.

Risiko collision yang ditemukan:
1. **Bukan collision antar restoran**, tetapi **collision antar PROSES untuk restoran yang sama** —
   dua owner pada `restaurant-<id>` yang sama (lihat §9 butir 3). Ini risiko tertinggi.
2. `sessionId` = `session-<rid>-<Date.now()>` (`L424,489`) **tidak pernah dibaca**; tidak dipakai sebagai kunci apa pun.
3. Bila dua instance worker dijalankan (mis. docker + native) → **dua konsumer** queue `whatsapp` (concurrency 5 masing-masing)
   dan **dua** pemilik socket → `connectionReplaced` + kemungkinan pesan ganda/kredensial rusak.
4. QR bila dipublikasikan ke Redis **wajib** di-key per `restaurantId` dan dibaca dengan `restaurantId` dari sesi
   (jangan pernah menerima `restaurantId` dari klien).

---

## 14. RESTART / RECONNECT BEHAVIOR

| Skenario | Perilaku saat ini | Bisa restore otomatis? | Setelah worker-owned (rekomendasi) |
| --- | --- | --- | --- |
| **Web restart** | Socket (bila ada di web) hilang; QR hilang; DB tetap berisi status terakhir | Tidak | Web tidak lagi memegang socket → tidak ada yang hilang; status dari DB |
| **Worker restart** | Socket worker (kosong) hilang; job baru akan gagal lagi; **`restoreSessions` tidak dipanggil** | **Tidak** | Worker boot → `restoreSessions()` → baca DB + `creds.json` → reconnect |
| **Redis restart** | Queue BullMQ reconnect (`@/lib/redis` retryStrategy ≤10×; worker `maxRetriesPerRequest:null`) | Ya (job tetap ada bila AOF/RDB aktif) | Sama; QR cache hilang (admin bisa refresh) |
| **VPS restart** | Tidak ada auto-start worker; tidak ada auto-restore session; kredensial harus ada di disk | **Tidak** | Worker (systemd/pm2/compose `restart`) + `restoreSessions()` → reconnect otomatis |
| **Connection drop (recoverable)** | Provider reconnect internal, backoff `1s→16s`, maks 5× (`L300–323`) | Ya (selama proses hidup) | Sama (dan kini benar-benar berjalan, karena provider hidup di worker) |
| **WhatsApp logout / `badSession(500)` / `connectionReplaced`** | Tidak reconnect; `cleanupSessionFiles()` menghapus kredensial; status `DISCONNECTED` (+`onLoggedOut`) | Tidak (harus pairing ulang) | Sama — perilaku aman dipertahankan |
| **`creds.json` korup** | `useMultiFileAuthState` gagal/`badSession` → cleanup + DISCONNECTED | Tidak | Sama; tambahkan logging terstruktur alasan agar terlihat di UI |
| **App/worker berhenti lama (off-peak)** | Pesan-pesan dalam queue tertahan di `wait`/`prioritized` dan diproses saat konsumer hidup (kecuali sudah `failed`) | Ya | Sama |

Catatan: satu-satunya job yang saat ini gagal permanen adalah yang jatuh ke `failed` (cap 50). Job `send_message`
**tidak** punya retry manual/dashboard.

---

## 15. SECURITY AUDIT

| Area | Temuan | Bukti | Rekomendasi |
| --- | --- | --- | --- |
| Authz API | Semua route WhatsApp memakai `requireAdmin()` (role ADMIN + `restaurantId` dari sesi) | 5 route, L1–12 masing-masing | Pertahankan |
| Tenant isolation | `restaurantId` tidak pernah dari body/query | `auth-helpers.ts:171`; route memakai `{restaurantId}` dari `requireAdmin()` | Pertahankan |
| Credential Baileys tidak bocor | `SessionInfo` hanya `{restaurantId,status,phone,qrCode,lastActiveAt,lastError}` | `session-manager.ts:10–17`, `read_files` route | Pertahankan; pastikan QR Redis **tidak** memuat nama file/creds |
| QR exposure | QR adalah artefak pairing; disajikan ke admin via API ber-otorisasi. QR juga muncul di `/status` | `session-manager.ts:404`; `qr/route.ts` | Bila QR dipindah ke Redis: TTL ≤ 60s, key per restoran, **hanya** endpoint `requireAdmin()` yang membaca; pertimbangkan berhenti mengirim QR di `/status` |
| Logging | Provider **tidak** mencatat isi QR (komentar eksplisit `// SECURITY: Do NOT log QR code content`, L253); `sanitizeError` menyaring path/password/secret (L562–582) | provider L253; session-manager L562 | Pertahankan; tambahkan redaksi `to` (nomor telepon) pada log worker bila dianggap sensitif |
| Data di Redis | Job `send_message` memuat **isi pesan lengkap + nomor tujuan** (`bull:whatsapp:<jobId>` hash, terlihat pada probe) | probe Redis (sample job) | Bukan kebocoran baru (memang data operasional), tetapi: Redis tanpa auth (`0.0.0.0:6379`) → siapa pun di jaringan bisa membaca isi pesan. **Temuan keamanan terpisah** (di luar G2) |
| DB details | `WhatsAppMessage.content` menyimpan isi pesan (by design); `WhatsAppSession.lastError` sudah disanitasi | schema L1201; L475–533 | Pertahankan |
| Client bundle | `src/services/whatsapp.service.ts` (wrapper klien) **tidak** meng-import Baileys/Prisma | file hanya `import api from "@/lib/axios"` | Pertahankan (jangan sampai refactor R7.2 menarik modul server ke klien) |
| Error response | Route mengembalikan pesan generik `AppError`/`INTERNAL_ERROR` | 5 route catch block | Pertahankan |
| Filesystem permission | Docker: app `nextjs:1001` vs worker **root** pada volume yang sama | `Dockerfile` (RUN mkdir+chown, `USER nextjs`), `Dockerfile.worker` (tanpa `USER`) | Setelah worker jadi owner: samakan UID/GID atau beri worker akses eksplisit; web tidak perlu mount volume session lagi |
| Redis access | Tanpa password, bind `0.0.0.0` | `.env:26`; `ss -ltnp` → `0.0.0.0:6379` | Rekomendasi terpisah (requirepass/firewall); **tidak** diubah di R7.1 |

**Tidak ditemukan** kebocoran credential Baileys ke: API response, audit log, log normal, client bundle, DB details, error response.

---

## 16. NOTIFICATION CALLER MAP (semua jalur WhatsApp, bukan hanya reservasi)

| Notifikasi | Sumber | Producer | Job type | Target phone (server-side) | Status sekarang |
| --- | --- | --- | --- | --- | --- |
| **Order READY** | `order.service.ts` `updateOrderStatus` (L1802–1855) | `queueWhatsAppNotification` (L1829–1839) | `send_message`, `jobId=notification-<orderNumber>` | `order.customer.phone` (bukan `guest-*`, len > 5) | Enqueue OK; **gagal kirim** (G2). Idempotensi ganda: `Order.notifiedAt` (L1802, L1842) |
| **Reservation PENDING/CONFIRMED/SEATED/COMPLETED/CANCELLED/NO_SHOW** | `reservation.service.ts` → `dispatchReservationWhatsApp` (`reservation-whatsapp.ts:185–220`) | `queueWhatsAppReservation` (`L55`) | `send_message`, `jobId=reservation-<id>-<status>` | `guestPhone` (fallback `customer.phone`), `normalizePhone`, skip `guest-*` (`resolveReservationWhatsAppTarget`) | Enqueue OK; **gagal kirim** (G2) |
| Payment (request/success) | `src/services/whatsapp/whatsapp.service.ts` (`sendPaymentRequest`, `sendPaymentSuccess`) | **tidak dipanggil siapa pun** | — | — | **Dead code** |
| Order received/confirmed/processing/completed/cancelled (helper) | idem | **tidak dipanggil siapa pun** | — | — | **Dead code** |
| Incoming message → DB | Provider `messages.upsert` → `session-manager.handleIncomingMessage` | — | — | — | Hanya jalan di proses pemilik socket (saat ini WEB) |
| `queueWhatsAppMessage` (kirim manual) | — | **tidak dipanggil siapa pun** | `send_message` | — | **Dead code** |

⇒ **Order READY dan Reservation memakai pipeline yang SAMA** (queue `whatsapp` → worker → session-manager).
Perubahan ownership otomatis memperbaiki keduanya, tetapi juga berarti **keduanya berisiko** bila perubahan
ownership salah (lihat §24).

---

## 17. CURRENT FAILURE TRACE (baseline R7.0)

Job: `reservation-<reservationId>-PENDING` (dan varian status lain) · Queue: `whatsapp`.

Trace lengkap sebelum error:

```
1. reservation.service.createReservation()/transitionReservation()  [server, setelah commit]
2.   → notifyReservationWhatsApp(view)                    reservation.service.ts
3.       → dispatchReservationWhatsApp(view, status)      reservation-whatsapp.ts:185
4.           resolveReservationWhatsAppTarget(view)       → guestPhone/customer.phone (normalizePhone)
5.           buildReservationWhatsAppMessage(...)         (teks pesan, tanpa ID internal)
6.           reservationWhatsAppGateway.enqueue(...)      = queueWhatsAppReservation (L55)
7.               queue.add("send_message", {restaurantId,to,message},
                          {jobId:`reservation-${id}-${status}`, priority:1})   whatsapp.queue.ts:117–133
8.                     BullMQ → Redis  bull:whatsapp:prioritized / wait   (bukti: prioritized card=133)
9.   WORKER whatsapp.worker.ts:48 mengambil job (concurrency 5)
10.      prisma.restaurant.findUnique(restaurantId)       → OK sejak R7.0 (G1 PASS)
11.      await import("@/services/whatsapp/session-manager")  → singleton BARU milik proses worker
12.      case "send_message": sessionManager.sendMessage(rid,to,msg)   whatsapp.worker.ts:73
13.          session-manager.ts:305  const provider = this.sessions.get(restaurantId)   → undefined
14.          session-manager.ts:308–311  THROW `WhatsApp not connected for restaurant <id>`
15.      BullMQ menandai job failed → bull:whatsapp:failed (+ failedReason pada hash job)
16.      worker event "failed" → console.error   (tidak ada persistensi tambahan / tidak ada retry manual)
```

**Bukti Redis (read-only) yang mengonfirmasi trace ini:**
- `bull:whatsapp:failed` = **50** job (cap `removeOnFail: 50`).
- 49 job: `failedReason = "Restaurant <restaurantId> not found"` (G1, lama).
- **1 job (paling baru): `failedReason = "WhatsApp not connected for restaurant cmtois12y0000bzu8o894azsd"`,
  finishedOn `2026-10-06T09:08:57.603Z`** — bertepatan dengan sesi R7.0 (audit R7.0 dibuat 2026-10-06 16:05 lokal = 09:05Z).
- `restaurantId` tersebut **sama** dengan satu-satunya baris `WhatsAppSession` (status `ERROR`, `phone=null`) → restoran yang
  sudah pernah pairing **gagal restore** dan sekarang tidak punya socket di proses mana pun.
- `wait=0`, `active=0` → tidak ada job yang sedang diproses (worker tidak berjalan saat audit).

Di titik ini **tidak ada** perubahan yang dilakukan untuk memperbaikinya (sesuai instruksi).

---

## 18. OPTION A vs OPTION B

### OPTION A — WORKER OWNER (API → BullMQ → Worker → Baileys)

| Aspek | Penilaian |
| --- | --- |
| Complexity | **Rendah–sedang.** Producer `queueWhatsAppConnect/Disconnect` **sudah ada**; worker sudah punya `case "connect"/"disconnect"`; yang kurang: panggil `restoreSessions()` saat boot, param `force` untuk reconnect, publish QR ke Redis, dan ubah 5 route |
| Reliability | **Tinggi.** Satu proses memegang socket; pengiriman & koneksi hidup di proses yang sama; queue memberi retry/backoff yang sudah ada |
| Restart | **Baik.** Worker restart → `restoreSessions()` memulihkan dari `creds.json`; web restart tidak berdampak |
| Scaling | **Baik (single worker per queue).** Bisa di-scale horizontal untuk BANYAK restoran, tetapi **satu** restoran tetap harus dipegang satu worker (BullMQ `concurrency` lokal aman karena map per-process; multi-worker untuk restoran sama = bahaya) |
| Multi-restaurant | Baik: map/dir/DB/job semua ber-key `restaurantId` |
| QR | Butuh jembatan: worker → Redis (TTL pendek) → API admin. UI tetap harus polling (sudah polling 2s) |
| Session persistence | `creds.json` di disk (sudah) + status di DB (sudah). Tinggal dipulihkan saat boot |
| Race condition | Rendah setelah web berhenti membuat socket (hilangnya sumber `connectionReplaced`) |
| Security | Baik: web tidak lagi memegang kredensial; QR di Redis ber-TTL & key restoran |
| Current code compatibility | **Tinggi.** 70% kerangka sudah ada (producer connect/disconnect, case worker, restoreSessions, syncDbSession) — ini jelas desain yang **diinginkan** namun belum diselesaikan (lihat komentar dead producer) |
| Migration impact | **Nol** skema. Mungkin 1 key Redis baru (bukan migration) |
| Regression risk | Sedang: halaman admin pairing harus diuji ulang; respon API harus dipertahankan bentuknya |

### OPTION B — WEB OWNER (worker memanggil web/session service)

| Aspek | Penilaian |
| --- | --- |
| Complexity | **Tinggi.** Butuh jalur IPC baru dari worker ke proses web (HTTP internal + auth internal, atau pub/sub), plus server HTTP tambahan di web untuk "send" & "status". Menambah permukaan serangan & titik gagal |
| Reliability | **Rendah.** Pengiriman pesan bergantung pada proses web hidup; bila web restart (deploy/HMR), worker kehilangan jalur kirim. Tidak ada retry lintas-proses selain BullMQ di worker |
| Restart | Buruk: session hidup di web, dan web adalah proses yang paling sering restart |
| Scaling | Buruk: session "menempel" pada instance web yang kebetulan di-pair; tidak bisa scale-out |
| Multi-restaurant | Bisa, tetapi setiap instance web memegang subset session → kompleks (sticky routing) |
| QR | Lebih mudah secara UI (semuanya di web) — satu-satunya keunggulan nyata |
| Session persistence | Sama (filesystem+DB) tetapi dipulihkan oleh proses yang salah |
| Race condition | Lebih tinggi: worker → web → socket berarti dua proses berbagi state lewat jaringan |
| Security | Perlu endpoint internal (auth tambahan) untuk mengirim pesan → permukaan serangan baru |
| Current code compatibility | **Rendah.** Tidak ada IPC semacam ini; harus dibangun baru; berlawanan dengan `queueWhatsAppConnect/Disconnect` yang sudah ada |
| Migration impact | Nol–kecil (tetap butuh kolom Redis/DB untuk state bersama) |
| Regression risk | Tinggi (mengubah arah ketergantungan proses) |

### Rekomendasi

**OPTION A — worker-owned Baileys.** Bukan karena "biasanya begitu", tetapi karena evidence:
`queueWhatsAppConnect`/`queueWhatsAppDisconnect` (0 pemanggil) + `case "connect"/"disconnect"` di worker (0 producer)
+ `restoreSessions()` (0 pemanggil) adalah **tiga bagian desain worker-owned yang sudah ditulis tetapi belum
disambungkan**. Opsi A menyelesaikan G2 dengan **menyambungkan yang sudah ada**, bukan membangun arsitektur baru.

---

## 19. RECOMMENDED ARCHITECTURE

```
Admin UI (/admin/whatsapp)
   │ POST /api/whatsapp/connect|disconnect|reconnect      (requireAdmin → restaurantId dari sesi)
   │ GET  /api/whatsapp/status|qr
   ▼
API (proses WEB) — TIDAK menyentuh Baileys lagi
   ├─ enqueue: queueWhatsAppConnect / queueWhatsAppDisconnect / (baru) reconnect   → BullMQ "whatsapp"
   ├─ read status: DB WhatsAppSession (status, phone, lastError, lastActiveAt, isActive)
   └─ read QR: Redis  whatsapp:qr:<restaurantId>  (TTL ≤ 60s)

BullMQ "whatsapp" (Redis)  ── satu konsumer ──►  WORKER  (SINGLE OWNER)
                                                  ├─ boot: restoreSessions()
                                                  ├─ job connect / disconnect / reconnect → sessionManager
                                                  ├─ job send_message → sessionManager.sendMessage()   [Order READY + Reservation]
                                                  ├─ provider callbacks → DB WhatsAppSession (status) + Redis (QR)
                                                  ├─ incoming messages → WhatsAppMessage
                                                  └─ Baileys socket ←── creds.json  (<WHATSAPP_SESSION_DIR>/restaurant-<id>)
```

Prinsip:
1. **Satu socket per restoran, dimiliki worker.** Web tidak pernah meng-import provider/`makeWASocket`.
2. **Web hanya perintah + baca state.** Perintah lewat BullMQ (retry/backoff gratis); state lewat DB + Redis.
3. **State bersama:** status kanonik = DB (sudah disinkronkan hari ini); QR = Redis ber-TTL.
4. **Restore saat boot** worker → tahan restart/redeploy.
5. **Satu konsumer** queue `whatsapp` (jangan jalankan dua worker untuk queue yang sama).
6. **Tanpa engine/queue/Baileys client baru**, tanpa migration.

### 19.A JAWABAN PERTANYAAN ARSITEKTUR (A–O)

| # | Pertanyaan | Jawaban (berbasis evidence) |
| --- | --- | --- |
| A | Siapa SINGLE OWNER Baileys? | **Worker** (`whatsapp.worker.ts`). Hari ini WEB yang secara de-facto memegang socket (`api/whatsapp/connect/route.ts:26`). |
| B | Haruskah web berhenti membuat socket? | **Ya.** Route connect/reconnect/disconnect harus hanya **enqueue**; route status/qr harus baca DB/Redis. Bukti masalah: `connectionReplaced` + `sessions` map terpisah (`session-manager.ts:82,304`). |
| C | Haruskah worker menjadi owner session? | **Ya.** Worker adalah satu-satunya tempat `send_message` dieksekusi dan satu-satunya proses yang hidup lama tanpa trafik HTTP. |
| D | Bagaimana API connect/disconnect mengirim command? | **Lewat queue `whatsapp`**: `queueWhatsAppConnect()` (`whatsapp.queue.ts:142`, sudah ada, 0 pemanggil) & `queueWhatsAppDisconnect()` (`L164`). Worker sudah punya `case "connect"/"disconnect"` (`whatsapp.worker.ts:86–93`). Untuk reconnect: tambah param `force` pada job `connect` atau job tipe `reconnect` baru (perubahan kecil). |
| E | Bagaimana QR dari worker sampai Admin UI? | Worker (provider callback `onQrCode`, `provider.impl.ts:255`) → publish ke Redis `whatsapp:qr:<restaurantId>` (TTL ≤ 60s; **key baru, dibuat di R7.2**) → `/api/whatsapp/qr` membacanya (`requireAdmin`, restaurantId dari sesi). Catatan: `onQrCode` **belum pernah diregistrasi** (`session-manager.ts:105–146`) → harus ditambahkan. |
| F | Bagaimana status dari worker sampai Admin UI? | Worker → callback `onStatusChange` (`session-manager.ts:105–108`) → `updateSessionStatus` → DB `whatsappsession` (`L475–533`) → `/api/whatsapp/status` membaca DB (bukan memori provider). |
| G | Bagaimana worker restore session setelah restart? | Panggil `restoreSessions()` (`session-manager.ts:339`, sudah lengkap) **saat boot worker** (`whatsapp.worker.ts:139`). Ia membaca DB (CONNECTED/RECONNECTING/QR_REQUIRED), cek `hasExistingSession()`, lalu `connect()`. |
| H | Bagaimana auth state dipersist? | `useMultiFileAuthState(<WHATSAPP_SESSION_DIR>/restaurant-<restaurantId>)` + `creds.update → saveCreds` (`provider.impl.ts:225,241`). Tetap seperti sekarang. |
| I | Apakah filesystem shared diperlukan? | **Tidak** — dan sebaiknya **tidak** shared setelah worker jadi owner. Hanya worker yang butuh direktori session. Web tidak lagi menulis/membaca `creds.json`. |
| J | Apakah Redis lebih cocok untuk state/QR/status sementara? | **QR: ya** (rahasia berumur pendek, tidak butuh skema). **Status: tidak** — sudah ada kolom kanonik di `WhatsAppSession` (hindari dua sumber kebenaran). Redis **tidak** boleh memuat socket/creds. |
| K | Multi-restaurant isolation? | Map/dir/DB/job semuanya ber-key `restaurantId` (§13). Pertahankan; tambahkan key Redis per restoran dan **jangan** pernah ambil `restaurantId` dari klien. |
| L | Reconnect otomatis? | Sudah ada di provider (backoff 1s→16s, maks 5) + `setStatus("RECONNECTING")` (`provider.impl.ts:300–323`). Setelah worker-owned, jalur ini benar-benar hidup. Tambahan: `restoreSessions()` saat boot menutup kasus proses mati. |
| M | Bagaimana logout? | Baileys `loggedOut` → `cleanupSessionFiles()` + `setStatus("DISCONNECTED")` + callback `onLoggedOut` → DB DISCONNECTED (`provider.impl.ts:274–290`; `session-manager.ts:110–119`). Perilaku aman, pertahankan. |
| N | Bagaimana Order READY tetap berjalan? | Jalur tidak berubah: `order.service.ts:1829` `queueWhatsAppNotification` → queue `whatsapp` → worker `send_message` → socket worker. Setelah G2 diperbaiki, jalur ini **baru benar-benar terkirim**. |
| O | Bagaimana Reservation notification tetap berjalan? | Idem: `reservation-whatsapp.ts:55` → queue `whatsapp` → worker. Target `guestPhone` (fallback `customer.phone`) tidak berubah; `jobId=reservation-<id>-<status>` tetap idempoten. |

---

## 20. REQUIRED FILES TO CHANGE (rencana R7.2 — belum dikerjakan)

| # | File | Perubahan minimal |
| --- | --- | --- |
| 1 | `src/app/api/whatsapp/connect/route.ts` | Ganti `sessionManager.connect()` → `queueWhatsAppConnect(restaurantId)`; respons dari DB (`SessionInfo` bentuk sama) |
| 2 | `src/app/api/whatsapp/disconnect/route.ts` | Ganti → `queueWhatsAppDisconnect(restaurantId)`; respons dari DB |
| 3 | `src/app/api/whatsapp/reconnect/route.ts` | Enqueue job reconnect (param `force:true` pada `connect`, atau job `reconnect`); worker memanggil `forceReconnect()` |
| 4 | `src/app/api/whatsapp/status/route.ts` | Baca status dari DB (`WhatsAppSession`) + `getWhatsAppQueueStats()`; **hentikan** pembacaan provider in-memory |
| 5 | `src/app/api/whatsapp/qr/route.ts` | Baca QR dari Redis `whatsapp:qr:<restaurantId>` (fallback `null`) |
| 6 | `src/services/whatsapp/session-manager.ts` | (a) registrasi `provider.onQrCode` → publish QR ke Redis; (b) hapus QR saat `open`/`close`; (c) `updateDbStatus` → upsert; (d) **tidak ada** perubahan kontrak `sendMessage` |
| 7 | `src/workers/whatsapp.worker.ts` | (a) `restoreSessions()` saat boot; (b) `case "reconnect"` / dukungan `force`; (c) publish QR bila perlu; (d) load env (dotenv/`--env-file`) |
| 8 | `src/services/whatsapp/whatsapp.queue.ts` | (opsional) `queueWhatsAppReconnect()` kecil, atau perluas `queueWhatsAppConnect(restaurantId, {force})` |
| 9 | `package.json` | `worker:dev` → `tsx --env-file=.env src/workers/whatsapp.worker.ts` (atau `import "dotenv/config"` di worker) |
| 10 | `.env` / `.env.example` | Seragamkan ke `WHATSAPP_SESSION_DIR="./whatsapp-session"` (kanonik); hapus/alias-kan `WHATSAPP_SESSION_PATH` |
| 11 | (opsional, cleanup) | Hapus `src/services/whatsapp/message.parser.ts`, `src/services/whatsapp/whatsapp.service.ts`, atau tandai jelas sebagai dead code |

**Tidak berubah:** `providers/baileys/*` (kecuali bila memilih memindahkan publish QR ke provider),
`reservation-whatsapp.ts`, `order.service.ts` (READY), `payment.service.ts`, schema, migration, cashier,
webhook iPaymu, R5.1 availability, Reservation QR.

---

## 21. DATABASE IMPACT

- **Tidak ada tabel/kolom baru.** `WhatsAppSession` (schema L1231–1247) sudah punya semua yang dibutuhkan:
  `restaurantId @unique`, `sessionId`, `status`, `phone`, `lastError`, `isActive`, `lastActiveAt`, `updatedAt`.
- `WhatsAppMessage` (L1201–1220) sudah dipakai untuk INCOMING/OUTGOING.
- Satu-satunya penulisan DB baru: **pola penulisan berubah pemilik** (worker, bukan web) untuk baris yang
  sudah ada. Tidak ada backfill yang diperlukan.
- Baris yang ada sekarang: **1 baris** (`restaurantId=cmtois12y0000bzu8o894azsd`, `status=ERROR`, `isActive=false`,
  `phone=null`, `lastActiveAt=2026-09-09T08:17:27Z`, `lastError="Connection failed after maximum retry attempts"`).
  **Tidak** diubah selama audit.
- Kolom `sessionId` tetap tidak terpakai (tidak dihapus — menghapus butuh migration).

## 22. MIGRATION IMPACT

**TIDAK ADA migration.** Tidak ada perubahan `schema.prisma`, tidak ada tabel/kolom/enum/FK baru, tidak ada
`prisma migrate`, tidak ada `db push`, tidak ada reset/seed. Bila QR disimpan di **Redis** (rekomendasi),
tidak ada kebutuhan skema sama sekali.

## 23. ENV / DEPLOYMENT IMPACT

| Area | Dampak | Catatan |
| --- | --- | --- |
| `WHATSAPP_SESSION_DIR` | **Wajib konsisten** di web & worker (hanya worker yang memakainya setelah R7.2) | `.env` sekarang memakai alias lama `WHATSAPP_SESSION_PATH`; `.env.example` memakai `WHATSAPP_SESSION_DIR` |
| Pemuatan `.env` di worker | **Wajib diperbaiki** | `npm run worker:dev` = `tsx ...` tanpa env-file → `DATABASE_URL` unset (probe: Prisma throw). Ini juga penyebab `sessionDir` jatuh ke `/app/whatsapp-session` |
| Redis URL | Sudah sama (`redis://localhost:6379`) untuk web & worker | Redis tanpa auth (temuan terpisah) |
| Key Redis baru | 1 key (`whatsapp:qr:<restaurantId>`, TTL ≤ 60s) | Dibuat pada R7.2, bukan pada audit ini |
| Docker | Bila memakai compose: worker tetap mount `whatsapp_data`; **app tidak perlu lagi** mount volume session | Perhatikan UID: app `nextjs:1001` vs worker root |
| Proses | **Hanya satu** konsumer queue `whatsapp` | Jangan jalankan worker docker (cafe2) + worker lokal bersamaan (dokumen R7.0 §6) |
| Pairing | Setelah R7.2, sekali pairing harus ulang (kredensial saat ini tidak ada) | Diperlukan 1 nomor WA uji + scan QR oleh admin |
| Downtime | Tidak ada; perubahan bersifat kode + 1 key Redis | Tidak menyentuh VPS/production |

## 24. REGRESSION RISKS

| Risiko | Tingkat | Mitigasi |
| --- | --- | --- |
| Halaman admin QR/pairing rusak saat ownership pindah | **Tinggi** | Pertahankan bentuk respons `/api/whatsapp/{status,qr,connect,disconnect,reconnect}`; QR dari Redis; uji pairing end-to-end dengan 1 nomor uji |
| OrdER READY berhenti bekerja | Sedang | Pipeline sama; uji ulang setelah R7.2 (job `notification-<orderNumber>` + `Order.notifiedAt` idempoten) |
| Reservation notification (semua status) berhenti bekerja | Sedang | Uji ulang 1 siklus PENDING→CONFIRMED→CANCELLED; pastikan `guestPhone` tetap jadi target |
| Dua owner sesaat selama migrasi kode (web masih membuat socket + worker mulai membuat socket) | **Tinggi** | Pastikan **satu** owner aktif: matikan jalur web pada rilis yang sama; jangan biarkan web & worker berbagi `creds.json` (bahaya `connectionReplaced`/cleanup kredensial) |
| Status UI membeku di `CONNECTING`/`QR_REQUIRED` | Sedang | Worker wajib sinkronkan DB pada setiap transisi (sudah ada); tambahkan freshness (`lastActiveAt`) |
| Tombol "Refresh QR" tetap 409 | Rendah | Perbaiki sekaligus di R7.2 (arahkan ke reconnect / atau izinkan connect saat QR_REQUIRED dengan `force`) |
| Job gagal lama (`bull:whatsapp:failed` 50, termasuk 49 G1 + 1 G2) menutupi kegagalan baru | Sedang | Bersihkan/arsipkan job gagal **secara eksplisit** (R7.2) atau naikkan visibilitas (log terstruktur + hitung di `/status`) |
| Job `send_message` gagal permanen tanpa retry manual (jobId unik) | Sedang | Sediakan jalur re-enqueue (jobId baru) atau biarkan `removeOnFail` mengosongkan lalu trigger ulang event |
| Dead code (`message.parser.ts`, `whatsapp.service.ts` server, `refreshQr`, `isConnected`, `isHealthy`, `queueWhatsAppMessage`) | Rendah | Hapus pada fase cleanup terpisah agar tidak membingungkan |

## 25. R7.2 IMPLEMENTATION PLAN (usulan, belum dikerjakan)

**Fase 0 — Persiapan (tanpa risiko).**
1. Seragamkan env: `WHATSAPP_SESSION_DIR="./whatsapp-session"` di `.env` (+ pertahankan alias PATH bila perlu).
2. Pastikan hanya satu konsumer: hentikan worker docker bila berjalan.
3. Tambahkan pemuatan env di worker (`tsx --env-file=.env` atau `import "dotenv/config"`) — buktikan `DATABASE_URL` terisi.

**Fase 1 — Worker menjadi owner koneksi.**
4. Worker: panggil `restoreSessions()` saat boot; tambahkan `case "reconnect"` (atau `connect` dengan `force`).
5. Session-manager: registrasi `provider.onQrCode` → publish QR ke Redis (`whatsapp:qr:<restaurantId>`, TTL ≤ 60s);
   hapus key saat `open`/`close`; ubah `updateDbStatus` → upsert.

**Fase 2 — Web berhenti memegang socket.**
6. `connect`/`disconnect`/`reconnect` route → `queueWhatsAppConnect/Disconnect` (+ reconnect).
7. `status` route → DB `WhatsAppSession` + queue stats (bentuk respons sama).
8. `qr` route → Redis (fallback `{qrCode:null, status, message}`).
9. Hapus import `whatsappSessionManager` dari seluruh `src/app/api/whatsapp/**` (verifikasi: grep harus 0).

**Fase 3 — Verifikasi end-to-end (dengan 1 nomor WA uji).**
10. Connect dari UI → QR muncul (dipublikasikan worker) → scan → status CONNECTED (DB) & `phone` terisi.
11. Trigger **Order READY** → pesan terkirim + `WhatsAppMessage` OUTGOING `status:"sent"` + `notifiedAt` terisi.
12. Trigger **Reservation PENDING/CONFIRMED/CANCELLED** → 3 pesan terkirim, `guestPhone` benar.
13. Restart worker → `restoreSessions()` → reconnect otomatis tanpa scan ulang.
14. Restart web → status tetap benar (dibaca dari DB), QR tetap bisa dibaca bila sedang pairing.
15. Disconnect dari UI → status DISCONNECTED, `isActive=false`.
16. Logout dari HP → session dibersihkan, status DISCONNECTED (perilaku aman dipertahankan).
17. Cek `bull:whatsapp:failed` tidak bertambah untuk jalur yang diuji.
18. Verifikasi tidak ada regresi: `tsc`, test suite reservasi/order, build.

**Fase 4 — Pembersihan (opsional, terpisah).**
19. Hapus dead code (`message.parser.ts`, `src/services/whatsapp/whatsapp.service.ts`, `queueWhatsAppMessage`,
    `refreshQr`/`isConnected`/`isHealthy` bila tetap tidak dipakai).
20. Perbaiki UX tombol "Refresh QR".

Rollback: kembalikan 5 route + worker ke pemanggilan in-process (git revert), dan hapus key Redis
`whatsapp:qr:*`. Tidak ada state DB/migration yang perlu dibalik.

## 26. ACCEPTANCE CRITERIA (R7.1 → gerbang ke R7.2)

- [x] Root cause G2 teridentifikasi dengan file+fungsi+line dan bukti runtime (Redis failed job + DB row).
- [x] Terjawab: owner Baileys sekarang = **WEB**; seharusnya = **WORKER**.
- [x] Matriks kepemilikan (connect/disconnect/QR/status/sendMessage/restore/reconnect) terisi berbasis bukti.
- [x] `restoreSessions()` terbukti **0 pemanggil** (blocker dicatat).
- [x] Producer `connect`/`disconnect` + `case` worker terbukti **dead path** (desain worker-owned belum disambungkan).
- [x] Inventaris Redis: tidak ada key aplikasi; hanya BullMQ; 1 key QR **akan** ditambahkan di R7.2.
- [x] Inventaris filesystem: web `./whatsapp-session` vs worker `/app/whatsapp-session`; tidak ada kredensial saat ini.
- [x] Security: tidak ada kebocoran kredensial; temuan terpisah (Redis tanpa auth) dicatat tanpa diubah.
- [x] Option A vs B dibandingkan; **Opsi A direkomendasikan** dengan alasan kompatibilitas kode.
- [x] Tidak ada migration & tidak ada perubahan DB yang diperlukan.
- [x] Rencana R7.2 + risiko regresi + kriteria sukses terdokumentasi.
- [x] **Tidak ada** perubahan source/schema/Docker/Redis/DB/env pada fase ini (audit-only).

**STOP** — menunggu persetujuan sebelum implementasi R7.2.
