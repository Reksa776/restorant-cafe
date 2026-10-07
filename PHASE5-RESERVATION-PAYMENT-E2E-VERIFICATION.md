# PHASE 5 — RESERVATION PAYMENT E2E VERIFICATION

**Repository:** `~/restorant-cafe`
**Mode:** VERIFICATION ONLY — no source/schema/migration changes, no commit/push/deploy, no production transaction.
**Base HEAD:** `5d82cf4` (unchanged).

**Overall:** The gateway E2E (real iPaymu QRIS creation + real callback) is **BLOCKED** — no safe sandbox is configured; the local `.env` is **production**. All non-gateway verification was executed and **PASSED** (plus one environment-only issue, explained in §2/§20).

---

## 1. SCOPE

Verify the end-to-end reservation-QRIS flow as far as is safe and possible in this environment:

`Customer reservation → Reservation.orderId → Order → Payment(UNPAID) → /reservasi/[code]/payment → POST /api/public/reservations/[code]/payment → existing Payment engine → iPaymu QRIS → PENDING → GET polling → webhook → Order.paymentStatus=PAID → Reservation resolved via orderId → PENDING→CONFIRMED → WhatsApp confirmation seam → admin detail (Lunas)`.

Cases A–H as specified by the request, plus regression. Verification only; a defect would be reported and **not** fixed.

## 2. GIT / REPOSITORY STATE

- HEAD: `5d82cf4` (`fix wa`), branch `main`, **0 staged**.
- Working tree (excluding `whatsapp-session/` churn): 6 modified source files (Phase 2–4 work) + untracked reports/new files. No source change was made in Phase 5.
- Temporary Phase-5 probe `p5-probe.mts` was created, run, and **removed** (`ls` → not found).
- `next-env.d.ts` was rewritten by a test-spawned dev server; it is a generated file and was **restored** from HEAD (`git status -- next-env.d.ts` → clean).
- `git diff --check` → **EXIT 0**.

Note: an early `reservation.api.test.ts` run failed (31/31) purely because a previously-started `next dev -p 3100` was still running and Next 16 refuses a second dev server for the same directory. After stopping that server the suite passed 31/31. **Environment artifact, not a code defect.**

## 3. ENVIRONMENT AUDIT

| Check | Result |
|---|---|
| `.env` present | ✅ (gitignored, `-rwxrwxrwx`) |
| `.env.example` present | ✅ documents sandbox + production selection |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` (unreachable for a real gateway callback) |
| DB | local MariaDB `restaurant_app` (reachable; all DB-backed suites ran) |
| Redis | `redis://localhost:6379` (no `redis-cli` on host) |
| WhatsApp session dir | `./whatsapp-session/restaurant-cmtois12y0000bzu8o894azsd` exists |
| WhatsApp DB row | `WhatsAppSession.status = CONNECTED` for the local tenant |
| In-process WhatsApp socket | **NOT connected** (no worker running) — notifier logs "WhatsApp not connected" |
| Browser E2E | headless `google-chrome` available (used in Phase 3/4); no Playwright/Puppeteer |
| Test runner infra | `node:test` via `npx tsx --test --test-force-exit` (existing) |

## 4. PAYMENT ENVIRONMENT

- `.env`: **`IPAYMU_ENV=production`**, `IPAYMU_BASE_URL=https://my.ipaymu.com/api/v2`, production `IPAYMU_VA` + `IPAYMU_API_KEY` set. A sandbox block exists in `.env` but is **commented out** (`#IPAYMU_ENV=sandbox`, no usable sandbox VA/key).
- Provider resolution (`ipaymu.provider.ts` `resolveBaseUrl`): `production` is selected **explicitly** → base URL is the live endpoint. Confirmed at runtime by the probe: `ENV IPAYMU_ENV=production VA_set=true`.
- Therefore any real `createPayment` would hit the **production** gateway and could create a billable QRIS. **Not performed.**

## 5. SANDBOX AVAILABILITY

- **No sandbox credentials are configured** and none were added (adding/altering `.env` was forbidden).
- A call to `provider.createPayment` would be a production request → the gateway leg of the E2E is **BLOCKED** by design.
- Per instruction, no attempt was made to bypass the production restriction. Instead, all non-gateway verification was performed, plus a **local webhook simulation** (see §10) that never contacts the gateway.

## 6. RESERVATION TEST DATA

- Identifier used: the local dev tenant `cmtois12y0000bzu8o894azsd`, branch `cmts9dbpe0000ravmnrjfknin` (local dev DB, not production customer data).
- Test data created by the throwaway probe (order/reservation/customer/payment with `P5<ts>` codes and fake phones `081234500001`) was **deleted** in the same run: `Z1 no test payments`, `Z2 no test reservations`.
- Pre-existing Phase-2/3 test suites create their own isolated tenants and clean up in `after()`.
- No real customer data and no production transaction was used.

## 7. RESERVATION CREATION VERIFICATION

**PASS** — `src/services/reservation/reservation.purchase.test.ts` (21/21):

- `reservation.orderId` is set after `createPublicReservation`.
- The linked Order exists and `order.id === reservation.orderId`.
- `Order.paymentStatus === "UNPAID"` right after creation.
- The reservation remains `PENDING`.

(Also asserted across create/cancel/refund scenarios at multiple points in the same suite.)

## 8. PAYMENT CREATION VERIFICATION

- Only **QRIS** accepted — POST `method:"KASIR"` → **400**. **PASS** (`reservation.payment.test.ts`).
- **Server calculates amount from the Order** — PASS: probe POST included forged `amount:1`, `grandTotal:1`, `orderId:"HACK-ORDER"`, `paymentId:"HACK-PAYMENT"`; the returned/reused intent amount was **55000 = Order.grandTotal** (client override ignored).
- **Existing Payment engine reused** — PASS: the route calls `paymentService.createPayment(order.id, restaurantId, {method:"QRIS"}, …)` (no parallel engine).
- **Provider reference correlation** — PASS: Phase 0.1 proved `Data.Reference === webhook reference_id` identik (18/18); probe reused `providerRef` and the webhook resolved the correct Payment by `providerRef`.
- **Payment intent stored correctly** — PASS: live `PENDING` QRIS row reused (`reference` = seeded ref, status PENDING, exactly 1 row).
- **Real QRIS intent creation via iPaymu** — **BLOCKED** (production gateway).

## 9. IDEMPOTENCY VERIFICATION

- **Repeated POST while PENDING reuses the existing intent** — **PASS** (probe C2/C3): two POSTs returned the same live intent (reference + PENDING status match) and the DB still held **exactly one** payment row.
- **No duplicate active payment intent** — **PASS** (row count = 1; engine's in-transaction live-QRIS reuse path, before any gateway call).
- **PAID cannot create another payment** — **PASS** (`reservation.payment.test.ts`: already-paid order → 409).
- **Expired/failed intent can create a new payment** — **NOT RUN**: this path deliberately proceeds to `provider.createPayment` (gateway) → would be a production request. Not attempted.

## 10. WEBHOOK VERIFICATION

**Local service simulation** (`paymentService.handleWebhook` called in-process with a locally computed HMAC-SHA256 signature; **no network request, no gateway call**). Probe: 25/25 PASS.

- **Signature validation unchanged & enforced** — PASS: valid signature accepted (D1); `X-Signature: deadbeef` → rejected (D9). No code changed.
- **Provider reference resolves the correct Payment** — PASS (findFirst by `providerRef`).
- **Payment mirrors correctly** — PASS: `Payment.status = PAID` (D2).
- **Order.paymentStatus becomes PAID** — PASS (D3).
- **Reservation resolved through `Reservation.orderId`** — PASS: `confirmFromPaidOrderInTransaction(tx, orderId, restaurantId)` → CONFIRMED (D4).
- **PENDING → CONFIRMED exactly once + `confirmedAt`** — PASS (D4/D5; existing tests add the CAS/no-resurrect proof).
- **Duplicate webhook is idempotent** — PASS: second identical callback returned early, **no new PaymentTransaction** (D6), state unchanged (D7/D8).
- **CANCELLED reservation is never resurrected** — PASS (D14; `reservation.payment.test.ts` "H").
- **Failed/expired payment does not confirm** — PASS: `status:"expired"` → Payment `EXPIRED` (D10), Order mirrors `EXPIRED` (D11), Reservation stays `PENDING` with `confirmedAt = null` (D12/D13).
- **REAL gateway callback (signature produced by iPaymu)** — **BLOCKED** (needs the production gateway). The simulation exercises the identical service path with a locally signed payload.

## 11. RESERVATION AUTO-CONFIRMATION

**PASS.** The webhook seam `reservationService.confirmFromPaidOrderInTransaction` is CAS-guarded (`PENDING → CONFIRMED` + `confirmedAt`) and:
- resolves only via `orderId AND restaurantId` (cross-restaurant → resolves nothing);
- leaves SEATED/other states untouched; ordinary orders (no reservation) resolve nothing;
- never resurrects `CANCELLED`;
- is idempotent (second call returns `null`).

All covered by `reservation.payment.test.ts` (24/24) plus the probe D4–D8.

## 12. WHATSAPP CONFIRMATION

- **Seam reused, not duplicated** — PASS: `notifyReservationConfirmedFromPayment` re-reads the reservation (only if `CONFIRMED`) and calls the existing private `notifyReservationWhatsApp` → `dispatchReservationWhatsApp` → `sendWhatsAppNotification` (existing engine, in-process, **no worker introduced**).
- **Fires after successful webhook confirmation** — PASS: the probe's PAID webhook triggered the dispatch (observed log `[WhatsApp] Notification not sent … WhatsApp not connected`).
- **No duplicate confirmation on duplicate webhook** — PASS: the duplicate webhook returns early (payment already PAID) → dispatch not reached; `WhatsAppMessage` rows in the last 2 min = **0**.
- **Actual delivery** — **NOT RUN**: the in-process Baileys session is not connected (no socket/worker running), so no real message was sent. This is the intended safe state.

## 13. ADMIN UI VERIFICATION

**PASS** (probe F1–F4 + Phase 4 browser verification):

- Admin DTO payment after webhook: `status = "PAID"` (Lunas), `method = "QRIS"`, `reference` present, `amount` present.
- Reservation status (`CONFIRMED`) remains **separate** from payment status (`PAID`).
- Phase 4 headless render confirmed the modal shows: `Pembayaran · Status Lunas · Metode QRIS · Jumlah Rp125.000 · Provider ipaymu · Reference … · Dibayar Pada · Kadaluarsa Pada`, with the empty state `Belum ada pembayaran` when no order.

## 14. SECURITY VERIFICATION

| Case | Result |
|---|---|
| Wrong customer/phone cannot access payment | PASS — GET/POST wrong phone → 404 |
| Cross-restaurant reservation cannot access payment | PASS — 404 |
| Forged client `restaurantId` cannot bypass tenant scope | PASS — 404 |
| Client amount override rejected | PASS — server amount = `Order.grandTotal` |
| Client `orderId`/`paymentId` not accepted as authority | PASS — ignored by the endpoint (only `method`/`phone`/`restaurantId` hint) |
| Payment internal IDs not exposed | PASS — public DTO omits `payment.id`; admin DTO omits internal ids |
| Payment secrets never exposed | PASS — no VA/API key/raw gateway secret in any DTO |
| Webhook remains signature-protected | PASS — invalid signature rejected |

## 15. CANCELLATION VERIFICATION

**PASS** (`reservation.payment.test.ts`):

- Cancel with a live `PENDING` payment → Payment becomes `CANCELLED` (guarded `updateMany`); Order left safe; Reservation `CANCELLED`.
- Cancel with a `PAID` payment → Payment stays `PAID`, Order stays `CONFIRMED` (handed to the refund workflow).
- Unpaid reservation cancellation cancels the linked UNPAID order (`cancelUnpaidLinkedOrderInTransaction`) without touching PAID orders.

## 16. REFUND COMPATIBILITY

- The refund path is unchanged and reuses the existing engine (`approval.service.ts` + `/api/refunds/*`); it is keyed by `orderId`, which the reservation still owns. **No modification.**
- Automated refund E2E was **NOT RUN** (no dedicated reservation-refund suite in this repo); compatibility is asserted by code inspection and by the existing payment/refund tests staying green.

## 17. EXISTING ORDER QRIS REGRESSION

- Existing Order QRIS flow (customer `/payment/[orderNumber]`, cashier screens) — **NOT RUN / no automated test**: exercising it would require the gateway (production) for a real intent. The files and the payment engine were **not modified** in Phase 2–5, and the same engine drives both flows.
- The order-row lock, PAID-terminal guard (409), KASIR path, and supersede logic are unchanged (code inspection).

## 18. SALES/PAYMENT REPORT REGRESSION

- **NOT RUN** — no report test suite exists in this repo. The reservation purchase still creates a real Order (`Order.paymentStatus = PAID` after webhook), so the existing sales report scope (`Order.status != CANCELLED AND paymentStatus = 'PAID'`) and payment report (`join Order.orderNumber`, `groupBy orderId`) remain satisfied. Code unchanged.

## 19. PASS / BLOCKED / NOT RUN MATRIX

**PASS (executed)**
- A. Reservation creation + order linkage (orderId set, Order UNPAID, reservation PENDING) — 21/21.
- B. Payment endpoint: QRIS-only (400 for KASIR), server-side amount, intent stored, provider correlation, engine reused.
- C. Idempotency: repeated POST reuses live intent (1 row); PAID → 409.
- D. Webhook (simulated): signature valid/invalid, correct Payment resolution, Payment/Order mirror, reservation confirm once + confirmedAt, duplicate idempotent, expired no-confirm, CANCELLED not resurrected.
- E. WhatsApp: seam reused, fired after confirmation, no duplicate, no worker.
- F. Admin: payment DTO PAID/QRIS/amount/reference; status separation.
- G. Security: ownership, cross-tenant, forged restaurantId, amount override, id opacity, signature.
- H (partial): all existing suites green — **264 pass / 0 fail** across 13 suites:
  `reservation.unit` 43, `reservation.purchase` 21, `reservation.service` 47, `reservation.payment` 24,
  `reservation.customer` 17, `reservation.customer-api` 12, `reservation.api` 31,
  `reservation-whatsapp.unit` 10, `whatsapp-notifier.unit` 3,
  `reservation-flow` 29, `reservation-payment-state` 12, `reservation-format` 8, `reservation-payment-format` 7.
- Probe (throwaway): **25 pass / 0 fail**.

**BLOCKED (no safe sandbox)**
- Real iPaymu QRIS creation (`provider.createPayment`) — production gateway.
- Real gateway callback with a gateway-produced signature.
- Expired/failed intent → new intent (requires gateway).
- End-to-end customer-page QRIS scanning/payment.

**NOT RUN**
- Actual WhatsApp message delivery (in-process socket not connected; no worker started).
- Existing Order QRIS flow E2E, cashier payment E2E (gateway / no automated suite).
- Sales/payment report regression (no suite).
- Full browser automation of the reservation payment page against a real paid reservation (covered by Phase 3 static + Phase 4 modal checks).

## 20. RISKS / KNOWN LIMITATIONS

- The webhook step was verified by **service-level simulation** with a locally computed signature using the configured VA — no gateway request was made and no credential was changed. Real gateway signature/time-of-flight behaviour is unverified.
- `.env` is **production**; any accidental real POST from the app would hit the live gateway. No real POST was issued.
- The in-process WhatsApp socket was not connected, so delivery is unverified; the DB session row says CONNECTED but no Baileys connection exists (no worker).
- The early `reservation.api.test.ts` failure was caused by a stale dev server on port 3100 (Next refuses a second dev server per directory); this is environmental and was resolved by stopping it. No code impact.
- No dedicated automated coverage exists for the ordinary Order QRIS flow, cashier payment, refunds, or reports.

## 21. PHASE 5 CONCLUSION

- **Customer → Reservation → Order → Payment ownership (`Reservation.orderId → Order → Payment`) is verified** across creation, derivation, pre-gateway validation, idempotency, webhook-driven auto-confirmation, cancellation, security, and the admin DTO.
- **The only unverified leg is the real iPaymu gateway round-trip**, which is **BLOCKED** because this environment has production credentials only and a safe sandbox is not configured.
- **No defect was discovered.** The single failing check during the run (`reservation.api.test.ts` 0/31) was an environment conflict (stale dev server) and passed 31/31 once that server was stopped.
- No source/schema/migration change, no commit/push/deploy, no production payment was executed.

## 22. NEXT RECOMMENDED PHASE

- **Phase 6 (optional): Sandbox gateway E2E** — provision iPaymu **sandbox** VA/key in a non-production env (`IPAYMU_ENV=sandbox`) with a reachable `NEXT_PUBLIC_APP_URL` (tunnel/ngrok) and run the full create → scan → callback → PAID → CONFIRMED path, including the expired-intent retry and real signature verification.
- Add automated coverage for the ordinary Order QRIS flow, cashier payment, refunds, and the sales/payment reports (currently no tests) to harden the regression surface.
- Keep the WhatsApp delivery check in the sandbox run (with a controlled test number).

---

### Final safety confirmations

- `git status` — 6 modified source files (Phase 2–4) + untracked Phase reports/new files; **0 staged**; `next-env.d.ts` restored; probe removed.
- `git diff --check` — **EXIT 0**.
- **No commit** made.
- **No push** made.
- **No deploy** made.
- **No production payment/QRIS was executed** (gateway leg BLOCKED; webhook verified by in-process simulation only).

_STOP — Phase 5 verification report only._
