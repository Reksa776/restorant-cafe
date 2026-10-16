# STEP 2C.7 — RESOLUTION (AP-2C7-RESOLUTION, owner-option **C**)

**Status: STEP 2C.7 COMPLETE WITH 49 DOCUMENTED LEGACY EXCEPTIONS — READY FOR STEP 2C.8**

Baseline HEAD: `4729a43ec09dc28d8425a5dfcbd713e1ebff24a8` (unchanged — no amend, no rebase, no push).
Authority: owner decision **C** — resolve **all 196** non-exception findings, keep the **49**
`react-hooks/set-state-in-effect` findings as a documented, owner-accepted legacy exception.
Scope was *resolution*, never suppression: **no** ESLint config change, **no** severity change,
**no** file exclusion, **no** dependency/engine addition, **no** schema/migration edit, **no**
business-rule, assertion or functionality removal, and no HELD/EXCLUDE artefact touched.

---

## 1. Lint inventory — before → after (measured)

| Rule | Before (baseline) | After (HEAD+worktree) | Δ |
|---|---|---|---|
| `@typescript-eslint/no-unused-vars` | 112 (0e/112w) | 0 | −112 |
| `@typescript-eslint/no-explicit-any` | 38 (38e/0w) | 0 | −38 |
| `react-hooks/exhaustive-deps` | 8 (0e/8w) | 0 | −8 |
| `@next/next/no-img-element` | 7 (0e/7w) | 0 | −7 |
| `react-hooks/refs` | 6 (6e/0w) | 0 | −6 |
| `react/no-unescaped-entities` | 4 (4e/0w) | 0 | −4 |
| `@typescript-eslint/no-unused-expressions` | 4 (0e/4w) | 0 | −4 |
| `prefer-const` | 4 (4e/0w) | 0 | −4 |
| unused `eslint-disable` directive | 4 (0e/4w) | 0 | −4 |
| `@next/next/no-location-assign-relative-destination` | 4 (0e/4w) | 0 | −4 |
| `@typescript-eslint/no-require-imports` | 3 (3e/0w) | 0 | −3 |
| `react-hooks/immutability` | 2 (2e/0w) | 0 | −2 |
| **`react-hooks/set-state-in-effect`** | **49 (49e/0w)** | **49 (49e/0w)** | **0 (unchanged exception)** |
| **Totals** | **245 (106e/139w)** — `eslint .` **exit 1** | **49 (49e/0w)** — `eslint .` **exit 1** | **−196** |

* **Non-exception findings resolved: 196 / 196. New findings introduced: 0.**
* Repo-wide ESLint exits **1** by design, because the 49 accepted legacy findings are still
  reported. **No “ESLint PASS 0/0” claim is made anywhere in this document.**

## 2. The 49 accepted exceptions (exact inventory)

All 49 are `react-hooks/set-state-in-effect` (error-level in the Next 16 preset), **42 files**.
The per-file counts and the file set are **byte-identical to the pre-execution baseline** — the
execution did not move, add or remove a single legacy location (see §5.4 for the two drifts that
were detected during verification and corrected before the commit).

| File | Findings | Lines |
|---|---|---|
| `src/app/(customer)/checkout/page.tsx` | 1 | 147 |
| `src/app/(customer)/menu/page.tsx` | 1 | 235 |
| `src/app/(customer)/payment/[orderNumber]/page.tsx` | 2 | 135, 163 |
| `src/app/admin/accounting/cashbook/page.tsx` | 2 | 134, 141 |
| `src/app/admin/accounting/expenses/page.tsx` | 2 | 193, 201 |
| `src/app/admin/accounting/pnl/page.tsx` | 1 | 109 |
| `src/app/admin/cashier/sales/page.tsx` | 1 | 171 |
| `src/app/admin/costing/page.tsx` | 5 | 106, 131, 520, 881, 885 |
| `src/app/admin/customers/page.tsx` | 1 | 50 |
| `src/app/admin/dashboard/page.tsx` | 1 | 92 |
| `src/app/admin/ingredients/page.tsx` | 1 | 101 |
| `src/app/admin/kitchen/page.tsx` | 1 | 61 |
| `src/app/admin/marketing/page.tsx` | 1 | 87 |
| `src/app/admin/menu-engineering/page.tsx` | 1 | 122 |
| `src/app/admin/menu/page.tsx` | 1 | 187 |
| `src/app/admin/orders/page.tsx` | 1 | 104 |
| `src/app/admin/profitability/page.tsx` | 1 | 103 |
| `src/app/admin/purchasing/purchases/[id]/page.tsx` | 1 | 86 |
| `src/app/admin/purchasing/purchases/new/page.tsx` | 1 | 125 |
| `src/app/admin/purchasing/purchases/page.tsx` | 1 | 103 |
| `src/app/admin/reports/customers/page.tsx` | 1 | 97 |
| `src/app/admin/reports/inventory/page.tsx` | 1 | 128 |
| `src/app/admin/reports/multi-outlet/page.tsx` | 1 | 72 |
| `src/app/admin/reports/page.tsx` | 1 | 150 |
| `src/app/admin/reports/payments/page.tsx` | 1 | 115 |
| `src/app/admin/reports/products/page.tsx` | 1 | 85 |
| `src/app/admin/reports/purchases/page.tsx` | 1 | 125 |
| `src/app/admin/reports/reservations/page.tsx` | 1 | 110 |
| `src/app/admin/reports/shift-sales/page.tsx` | 1 | 80 |
| `src/app/admin/settings/branches/page.tsx` | 1 | 52 |
| `src/app/admin/shifts/[shiftId]/page.tsx` | 1 | 88 |
| `src/app/admin/shifts/page.tsx` | 1 | 200 |
| `src/app/admin/tables/page.tsx` | 1 | 142 |
| `src/app/admin/users/page.tsx` | 1 | 84 |
| `src/app/page.tsx` | 1 | 43 |
| `src/components/admin/analytics/dashboard-analytics.tsx` | 1 | 214 |
| `src/components/admin/branch-availability-dialog.tsx` | 1 | 83 |
| `src/components/admin/product-image-field.tsx` | 1 | 113 |
| `src/components/customer/promo-section.tsx` | 1 | 74 |
| `src/components/qr-code-display.tsx` | 1 | 26 |
| `src/hooks/use-branch-stock.ts` | 1 | 33 |
| `src/hooks/use-mobile.ts` | 1 | 14 |

Nothing was refactored, suppressed or configured away for these 42 files beyond the minimal edits
listed in §3 (two of them were touched by *other* classes and still report their legacy finding).

## 3. Resolution by class (what actually changed, and why it is behaviour-neutral)

### 3.1 Autofix-safe cosmetics (8)
* `prefer-const` (4) — `let` → `const` where the binding is never reassigned:
  `scripts/phase-h4-4-harness.ts` (`skipped`), `src/app/api/admin/purchases/route.ts` (`branchId`),
  `src/services/cashier-sales/cashier-sales.service.ts` (`shiftWhere`),
  `src/services/menu-engineering/menu-engineering.service.ts` (`visibleRows`). (One further
  `prefer-const` cascade — `scripts/phase-h4-3-harness.ts` — appeared after the dead `skip()`
  helper was removed and was fixed the same way.)
* unused `eslint-disable` directives (4) — removed the stale directive only:
  `src/app/(customer)/menu/page.tsx`, `src/app/admin/reports/inventory/page.tsx`,
  `src/app/admin/reports/purchases/page.tsx`, `src/components/admin/product-image-field.tsx`
  (the last one because the dependency list is now complete, §3.5).

### 3.2 Module-format + expression cleanups (7)
* `no-require-imports` (3) — `require()` → ESM `import` in the dev harnesses
  `scripts/phase-b-harness.ts:121`, `scripts/phase-c-harness.ts:158`,
  `scripts/verify-bug2-checkout.mjs:118`.
* `no-unused-expressions` (4) — short-circuit click guards `x && x.click()` → `if (x) x.click()`
  in `scripts/phase-c-browser-test.mjs` (identical semantics: the click still happens exactly when
  the element exists).
* `react/no-unescaped-entities` (4) — literal `"` escaped to `&quot;` in user-visible copy
  (`src/app/admin/accounting/pnl/page.tsx`, `src/app/admin/costing/page.tsx`); rendered text is
  unchanged.

### 3.3 `no-unused-vars` (112)
Patterns used, in order of preference: drop a binding that only wrapped a side-effecting call
(`const x = await f()` → `await f()`); optional catch binding (`catch (e)` → `catch`) where the
error object is unused; delete genuinely unreachable locals/helpers; remove unused imports/type
aliases; mark a **signature-bound parameter that callers pass positionally** as intentionally
unread (`void param;` + one-line rationale — see below).

Notable removals (verified unreachable by ESLint *and* by grep against every call site):
* `src/services/report/report.service.ts` — two **private, unused** helpers `reportActivityWhere`
  and `orderFragment` (module-local, never exported, no reference anywhere).
* Dev harnesses — dead helpers with zero call sites: `getGroupContainer`, `groupContainerHandle`
  (`e2e-admin-fixup*.mjs`), `tryWait` (`e2e-admin-realtime.mjs`), `hasButtonText` + `clickButton`
  (`phase-d-browser-test.mjs`), `trace` (`repro-bug1-v2.mjs`), `completeOrder`
  (`phase-c-harness.ts`), `skip` (`phase-h4-3-harness.ts`), plus stale imports/constants.
* Cascades created by those removals (a helper whose only consumer disappeared) were fixed in the
  same pass — `hasButtonText`, `skipped`, `VA` (`dbg-shift.tmp.mjs`), the `phase-h4-3` `const`.
* `tests/fixtures/accounting.ts` — removed the unused `AnyDecimal` alias (and its
  `eslint-disable`), the unused `order`/`refund` bindings, and converted the runtime
  `SCOPED_COUNT_TABLES` array (which was *only* used in a type position) into the equivalent
  exported `ScopedCountTable` union, keeping `ScopedCounts` structurally identical.

**Explicitly documented idiom — `void <param>;` (5 sites).** Four wait helpers
(`scripts/e2e-dine-in-payment.mjs`, `scripts/e2e-order-realtime.mjs` ×2 `waitOn`/`waitDb`) and two
shipped service seams (`payment.service.ts` `_restaurantId`, `whatsapp/message.parser.ts`
`restaurantId`) keep a parameter that exists purely for call-site/signature parity. The lint rule
here has **no** `argsIgnorePattern` (verified with `eslint --print-config`: the rule is enabled
with **no** options), so an `_`-prefix cannot express intent, and removing the parameter would
re-map positional arguments at call sites these scripts cannot exercise in this STEP. Each site is
marked read with a one-line comment explaining the parity; **no** ESLint directive was added
(`void x;` is a real statement — `no-unused-expressions` is off, `eslint --print-config` → `[0]`).

### 3.4 `no-explicit-any` (38)
* `tests/fixtures/accounting.ts` (22) — removed every `as any`. Because four fixture helpers are
  **not wired into any suite** and deliberately omit Prisma-required columns
  (`customerId`, `unitPrice`, `restaurantId`, `productId`, `quantity`), the payload is now asserted
  against the **precise** Prisma input type (`Prisma.OrderUncheckedCreateInput`,
  `OrderItemUncheckedCreateInput`, `OrderItemCostSnapshotUncheckedCreateInput`,
  `PaymentUncheckedCreateInput`). Runtime payload is byte-identical (type assertions are erased) —
  the property of these helpers is unchanged, they were already unusable-but-exported before this
  STEP (see §7).
* `scripts/phase-b-harness.ts` (14) — `api<T = unknown>` with real response generics, typed catch
  narrowing (`e as { code?: string }`), generic `props<T>`, `unknown[]` for an HTTP items array, and
  removal of four *unnecessary* enum casts (`StockRefType.ORDER_COMPLETED`,
  `PURCHASE_RECEIVE`, `{ type: "IN" }`). The two deliberately out-of-domain test markers
  (`"TEST_ATOMIC"`, `"TEST_CONC"`) are plain strings — `refType` is a string column, so no cast is
  needed at all.
* `src/lib/auth.ts` (1) — the `prisma as any` cast was **stale**: `PrismaAdapter(prisma)`
  typechecks as-is (`tsc` exit 0).
* `src/app/admin/cashier/sales/page.tsx` (1) — `(item: any)` replaced with the real inferred
  `Order["items"][number]` element type from `order.service`.

### 3.5 React behaviour findings (16) — per-site review, trigger sets preserved
* `react-hooks/refs` (6) + unused directive (1) — `src/components/admin/product-image-field.tsx`:
  the preview object URL is no longer cached in/read from a ref **during render**. It is created by
  the preview memo and its lifetime is owned by an effect that revokes exactly the URL it created
  (`useEffect(() => () => revoke(owned), [previewUrl, value.kind])`); the now-redundant revoke in
  the file-select handler was removed. The file's single legacy `set-state-in-effect` finding is
  preserved unchanged.
* `react-hooks/immutability` (2) — declaration-order fixes: `loadOrder`
  (`src/app/(customer)/order/[orderNumber]/page.tsx`) and `loadTables`
  (`src/app/(customer)/checkout/page.tsx`) are now declared *before* the effects that use them, so
  no effect can close over a stale reference.
* `react-hooks/exhaustive-deps` (8), each resolved **without** changing when an effect re-runs:
  * `src/app/(customer)/checkout/page.tsx:175` — added the missing `tableContext?.branchCode`
    (the effect already re-runs on branch scope; it can now never use a stale branch code).
  * `src/app/(customer)/checkout/page.tsx:258` — `loadTables` memoized on
    `[restaurantId, checkoutBranchCode]` (both already in the array) and reached through a
    latest-value ref, so the trigger set is *identical*.
  * `src/app/(customer)/menu/page.tsx:1069` — added `applyBranding` and `setRestaurantId`; both are
    stable `useCallback`s from their providers (verified in `use-branding.tsx` and `use-cart.tsx`),
    so `loadMenu`'s identity and the depending effect's frequency do not change.
  * `src/app/(customer)/order/[orderNumber]/page.tsx:175` — the 10 s poller now calls the existing
    `loadOrderRef` instead of closing over the loader; deps stay `[]`.
  * `src/app/(customer)/payment/[orderNumber]/page.tsx:150` — the effect depends on the hoisted
    derived values (`effectiveStatus`, `paymentMethod`) instead of the whole re-fetched `data`
    object. The previously listed `data?.payment?.status` is subsumed by `effectiveStatus`, so the
    re-run frequency is unchanged (adding `data` itself would have restarted the 4 s poll on every
    fetch).
  * `src/app/admin/customers/page.tsx:44` — the loader is now a stable `useCallback` reading the
    search term through a ref, and the mount effect lists it. Search still only fires on
    Enter/“Cari” (no per-keystroke fetch); the legacy `set-state-in-effect` finding at this call
    site is preserved.
  * `src/app/admin/tables/page.tsx:143` — `loadTables` memoized on `[branchId]`, which the effect
    already depended on.
  * `src/components/admin/realtime-provider.tsx:254` — the effect captures
    `listenersRef.current` once at the top and the cleanup clears that capture (the fix the rule
    itself prescribes), so unmount clears exactly the Set it subscribed into.

### 3.6 `no-img-element` (7) — real `next/image` conversion
All seven sites were converted to `<Image>` **with `unoptimized`**, preserving `alt`, `className`,
`style` and `onError` verbatim: `src/components/qr-code-display.tsx`,
`src/app/(customer)/payment/[orderNumber]/page.tsx`,
`src/app/(customer)/reservasi/[code]/payment/page.tsx`, `src/app/admin/tables/page.tsx` (2),
`src/app/admin/whatsapp/page.tsx`, `src/components/admin/barcode-payment-flow.tsx`.

Why this is behaviour-neutral (evidence, not assumption):
* Every one of these sources is a **`data:` URL** (local `QRCode.toDataURL`, iPaymu
  `resolveQrImage`, Baileys QR, `table.service` QR) — Next 16 **forces** `unoptimized` for
  `data:`/`blob:` sources (`node_modules/next/dist/shared/lib/get-img-props.js:279-283`), i.e. the
  optimizer the rule exists for can never apply here.
* A render-level check (`renderToStaticMarkup` on the exact converted props) produced
  `<img … width="280" height="280" class="…" src="data:image/png;base64,…">` — **no
  `/_next/image` URL, no `srcset`**, identical classes and identical source.
* Explicit `unoptimized` keeps it true even if a gateway ever returns a remote URL (it would
  otherwise require `images.remotePatterns`). The temporary check script was deleted immediately
  and is not part of the change set.

### 3.7 `no-location-assign-relative-destination` (4)
The four session-recovery navigations now assign an **absolute** destination for the current
origin: `src/lib/axios.ts` via a documented `loginDestination()` helper
(`new URL(LOGIN_PATH, window.location.origin).href`, 3 call sites) and
`src/lib/notify-shift.ts` (`new URL("/admin/shifts", window.location.origin).href`).
`useRouter().push()` was deliberately **not** used: both sites require a **full page load**
(`axios.ts` is a module-level interceptor with no React context, and the 401 redirect-loop guard
exists precisely because the session must be gone *before* `/login` is entered — a soft
navigation would keep the purged React tree alive). Navigation target and history behaviour are
unchanged; only relative→absolute resolution changed.

## 4. Verification (all commands run fresh, after the final edit)

| Check | Command | Result |
|---|---|---|
| Full lint inventory | `npx eslint . -f json` | **49 findings / 0 warnings**, `exit 1` (by design) |
| Per-file exception parity | script diff vs pre-execution baseline | **identical**: 49 locations, 42 files, 0 non-exception |
| TypeScript | `npx tsc --noEmit` | **exit 0** |
| Migration preflight | `npm run db:preflight` | **exit 0** — `[preflight] PASS` 22/22 order+checksum |
| Whitespace / conflict markers | `git diff --check` (and `--cached --check` at commit) | **exit 0** |
| Production build | `npm run build` | **exit 0** (all routes built; static pages prerender the changed components) |
| F-2 unit | `npx tsx --test src/lib/database-url.unit.test.ts` | **24/24**, `exit 0` |
| M2 unit | `npx tsx --test src/services/accounting/integrity.unit.test.ts` | **78/78**, `exit 0` |
| Menu-engineering unit (touched) | `npx tsx --test src/services/menu-engineering/menu-engineering.classify.unit.test.ts` | **23/23**, `exit 0` |
| F-2 live | `npx tsx --test tests/database-connection.integration.test.ts` | **4/4**, `exit 0` |
| Accounting cashbook | `npx tsx --test tests/accounting/cashbook.integration.test.ts` | **15/15**, `exit 0` |
| Accounting revenue | `npx tsx --test tests/accounting/revenue.integration.test.ts` | **21/21**, `exit 0` |
| Accounting refund/profitability | `npx tsx --test tests/accounting/refund-profitability.integration.test.ts` | **21/21**, `exit 0` |
| Accounting P&L | `npx tsx --test tests/accounting/pnl.integration.test.ts` | **24/24**, `exit 0` |
| M2 integrity (SQL) | `npx tsx --test tests/accounting/integrity.integration.test.ts` | **30/30**, `exit 0` |
| **Accounting total** | — | **111/111**, every suite `exit 0` |
| `next/image` markup equivalence | temporary `renderToStaticMarkup` check | raw data URL kept, no optimizer URL, no `srcset` |
| DB target identity | `.env.test` + `tests/setup.ts` guard | `mysql://…@127.0.0.1:3308/restaurant_app_test_v3` only |

**Database boundary honoured:** every DB-backed suite ran against the approved disposable v3 target
on `127.0.0.1:3308`. No migration/deploy/reset/recreate was run; `3306` and `3307` were never
contacted; `prisma/migrations/**`, `tools/migration-order.baseline.json` and the v1/v2/v4 evidence
databases were untouched.

### 4.1 Verification integrity note (self-caught error)
An intermediate verification run was invalid (an empty JSON file made a “212 fixed / 0 remaining”
comparison meaningless); it was discarded and every number in this report comes from a re-run of
the real command with its exit code captured (`pipefail`). Likewise, the first full inventory after
the React-hooks batch showed a **classification drift** — `src/app/admin/customers/page.tsx`
lost its legacy finding (1→0) while `src/app/(customer)/checkout/page.tsx` gained one (1→2),
because routing a call through an indirection changes what the rule can resolve. Both files were
reworked (stable `useCallback` + search ref in customers; latest-value ref in checkout) until the
**per-file exception inventory matched the baseline exactly**. This is why §2 asserts parity rather
than a bare total of 49.

## 5. Behaviour preservation

* **No** business rule, validation, calculation, query, schema or migration was changed. The
  accounting suites (111) — including the cashbook run-scope counts, revenue sets and P&L/M2
  integrity — pass unchanged.
* All edits are: dead-code/import/cast removal, binding drops that keep the side-effecting call,
  memoization/declaration-order changes with **identical effect trigger sets**, markup-equivalent
  image conversion, and relative→absolute navigation targets.
* `void <param>;` sites and no-op casts are documented in §3.3/§3.4 with their rationale.

## 6. Changed files (implementation manifest — 75 paths)

`scripts/` (26): `_mock-ipaymu.mjs`, `_repro-qris-close-cash.mjs`, `dbg-qris.tmp.mjs`,
`dbg-shift.tmp.mjs`, `e2e-admin-fixup.mjs`, `e2e-admin-fixup2.mjs`, `e2e-admin-realtime.mjs`,
`e2e-cashier-sales.mjs`, `e2e-checkout-no-tax.mjs`, `e2e-customer-menu.mjs`,
`e2e-deploy-storage.mjs`, `e2e-dine-in-payment.mjs`, `e2e-kasir-cash-after-qris.mjs`,
`e2e-kasir-payment-branding-v2.mjs`, `e2e-kasir-shift-guard-matrix.mjs`, `e2e-order-realtime.mjs`,
`e2e-product-image.mjs`, `e2e-qris-shift-linking.mjs`, `e2e-server-validation.mjs`,
`final-regression-kasir-api.mjs`, `final-regression-kasir-ui.mjs`, `phase-b-harness.ts`,
`phase-c-browser-test.mjs`, `phase-c-harness.ts`, `phase-d-browser-test.mjs`,
`runtime-ui-kasir-cash-qris.mjs`.

`src/app/` (28): `(customer)/checkout/page.tsx`, `(customer)/menu/page.tsx`,
`(customer)/order/[orderNumber]/page.tsx`, `(customer)/payment/[orderNumber]/page.tsx`,
`(customer)/reservasi/[code]/payment/page.tsx`, `admin/accounting/pnl/page.tsx`,
`admin/cashier/sales/page.tsx`, `admin/costing/page.tsx`, `admin/customers/page.tsx`,
`admin/ingredients/page.tsx`, `admin/menu-engineering/page.tsx`, `admin/menu/page.tsx`,
`admin/orders/page.tsx`, `admin/purchasing/purchases/[id]/page.tsx`,
`admin/purchasing/purchases/page.tsx`, `admin/reports/inventory/page.tsx`,
`admin/reports/multi-outlet/page.tsx`, `admin/reports/payments/page.tsx`,
`admin/reports/products/page.tsx`, `admin/reports/purchases/page.tsx`,
`admin/reports/shift-sales/page.tsx`, `admin/shifts/[shiftId]/page.tsx`, `admin/shifts/page.tsx`,
`admin/tables/page.tsx`, `admin/whatsapp/page.tsx`, `api/admin/purchases/route.ts`,
`api/reports/menu-engineering/export/route.ts`, `login/page.tsx`.

`src/components/` (4): `admin/barcode-payment-flow.tsx`, `admin/product-image-field.tsx`,
`admin/realtime-provider.tsx`, `qr-code-display.tsx`.
`src/lib/` (3): `auth.ts`, `axios.ts`, `notify-shift.ts`.
`src/services/` (12): `cashier-sales/cashier-sales.service.ts`, `costing/costing.service.ts`,
`costing/historical-snapshot.ts`, `ingredient/ingredient.service.ts`,
`menu-engineering/menu-engineering.classify.unit.test.ts`,
`menu-engineering/menu-engineering.service.ts`, `payment.service.ts`,
`profitability/coverage.ts`, `profitability/profitability.service.ts`, `report/report.service.ts`,
`reservation/reservation-whatsapp.unit.test.ts`, `whatsapp/message.parser.ts`.
`tests/` (2): `accounting/pnl.integration.test.ts`, `fixtures/accounting.ts`.

Documentation, HELD/EXCLUDE artefacts, `.env*` and the generated `next-env.d.ts` are **not** part
of this manifest and were **not** staged.

## 7. Commit

* Message: `refactor: resolve scoped step 2c7 lint debt`
* Commit hash: `9666042a2185983e91f2d53e89e49de0cfe83f6e` (parent `4729a43ec09dc28d8425a5dfcbd713e1ebff24a8`)
* Staged path-explicitly; `git diff --cached --check` and a secret scan (DATABASE_URL/credentials/
  tokens/`IPAYMU_*`/`sk-`/private keys) were run over the staged diff. No push, no deploy, no
  production migration, STEP 2C.8 not started.

## 8. Remaining technical debt (explicit, owner-accepted)

1. **49 × `react-hooks/set-state-in-effect`** in 42 shipped files (§2) — error-level rule from the
   Next 16 preset, pre-existing, 0 from C1–C4, 0 in `src/services/**`/`tests/**`. Resolving them
   needs behaviour drift (spinner/error timing across 42 pages, unverifiable — the repo still has no
   component test harness) or an architecture change (Server Components / data-fetching layer).
2. **Four unused-but-exported fixture helpers** in `tests/fixtures/accounting.ts`
   (`createTestOrder`, `createOrderWithItemAndSnapshot`, `createFullRefund`, `createLegacyRefund`)
   omit columns the Prisma input type requires and have **no call sites**; their payloads are now
   asserted against the precise Prisma input type instead of `as any`. They need a real third-party
   rewrite (accept ids/relations as options) or deletion in a later step.
3. **`void <param>;` idiom (5 sites, §3.3)** — expressible only as a statement because the project's
   lint options carry no `argsIgnorePattern`. A future policy decision could allow `_`-prefixed
   args, which would replace this idiom mechanically.
4. **`report.service.ts` dead helpers removed** (`reportActivityWhere`, `orderFragment`) — the
   reporting refactor that would have used them is not part of this STEP.
5. **Dev harnesses were not re-executed** (`scripts/e2e-*.mjs`, `phase-*.ts`): they require a live
   server plus the shared application DB on `3306`, which this STEP is forbidden to use. Their edits
   are dead-code/parameter/format cleanups, verified by ESLint + `tsc`, and the one
   behaviour-relevant form (`const x = await f()` → `await f()`) preserves the call.
6. **Browser regression was not run** for the changed components (see §9 risk note).
7. Pre-existing per-site `no-img-element` disable comments at **14 other** `<img>` sites were left
   exactly as found (not part of this STEP's 7 findings).

## 9. Risk assessment for STEP 2C.8

* **Low risk — accounting core:** no change under `src/services/accounting/**`,
  `src/lib/prisma.ts`, `src/lib/database-url.ts`, `tools/**`, `tests/setup.ts`; lint is 0 findings
  there and all 111 accounting + 4 F-2 live tests pass.
* **Medium risk — UI behaviour is verified by static analysis, not by a browser run.** The React
  hook edits (deps/refs/memoization) and the 7 `<Image>` conversions are the highest-intent changes.
  Mitigations applied: per-site review, effect trigger sets held constant, deprecated-API-free
  conversions with markup-equivalence evidence, `tsc` + production build + prerender of the static
  pages that mount the changed components. **Residual:** a browser pass over the cashier QRIS/CASH
  flows, the customer menu→checkout→payment path, the admin tables QR dialog and the WhatsApp QR
  card should be re-run in 2C.8 (they need the disposable DB plus seed data, deliberately not
  created here to keep v3 at its evidence state).
* **Low risk — dev tooling:** changes are deletions/format fixes; the affected harnesses are not
  part of any CI gate.
* **Unchanged boundary:** `eslint .` still exits 1, so any future “green lint” gate must be
  introduced deliberately (policy decision), never by weakening the 49 or the ruleset.

**STEP 2C.7 COMPLETE WITH 49 DOCUMENTED LEGACY EXCEPTIONS — READY FOR STEP 2C.8**
