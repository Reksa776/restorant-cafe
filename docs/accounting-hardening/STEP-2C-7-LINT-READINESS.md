# STEP 2C.7 — CODE QUALITY / LINT READINESS (READ-ONLY AUDIT)

**Subphase of 2C.7 · mode: READ-ONLY TRIAGE (AP-2C7-READONLY) · NO FIXES · NO CONFIG/SOURCE/TEST CHANGES**

| | |
|---|---|
| Date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| HEAD at audit time | `4729a43ec09dc28d8425a5dfcbd713e1ebff24a8` (parent `eb313bb`) — the AP-DOC-COMMIT is in |
| Branch / index / stash | `main` · **0** · **0** |
| Toolchain | ESLint **v9.39.5** (flat config `eslint.config.mjs`), `npm run lint` = `eslint` (ESLint 9 → whole repo), TypeScript 5.x, node v24.21.0 |
| Verdict | ⚠️ **READ-ONLY TRIAGE COMPLETE — 106 errors / 139 warnings, 0 accounting-core errors, 27 findings attributable to C3 — AWAITING FIX-SCOPE APPROVAL** |

> **Scope honoured.** No `eslint --fix`, no source/test/config/dependency/schema/migration/business-rule change, no
> database contact, no migration, no push, no deployment, no STEP 2C.8/2C.9. The only writes are this report plus short
> `ROADMAP.md` / `EXECUTION-STATE.md` updates. Findings were produced by `eslint . -f json` (read-only) and analysed
> offline. No gate was weakened and no rule was silenced.

---

## 1. Actual measurements `[Measured]` — exact exit codes

| # | Command | **Actual result** |
|---|---|---|
| B1 | `npx eslint --version` | `v9.39.5` — exit **0** |
| B2 | `npx eslint . -f json -o /tmp/eslint.json` | **ESLINT_EXIT = 1** (violations exist) — **534** files linted |
| B3 | totals from the JSON | **106 errors · 139 warnings · 245 findings · 8 autofixable** |
| B4 | `npx tsc --noEmit` | **TSC_EXIT = 0** — type-clean |
| B5 | `git diff --check` / `git diff --cached --check` | exit **0** / **0** |
| B6 | `npm run db:preflight` | **PASS 22/22** — exit **0** |

## 2. Full inventory by rule, severity and ownership `[Measured]`

| Rule | Total | err | warn | shipped `src/**` | dev `scripts/**` | `tests/**` | autofixable |
|---|---|---|---|---|---|---|---|
| `@typescript-eslint/no-unused-vars` | **112** | 0 | 112 | 38w | 69w | 5w | 0 |
| `react-hooks/set-state-in-effect` | **49** | 49 | 0 | 49e | — | — | 0 |
| `@typescript-eslint/no-explicit-any` | **38** | 38 | 0 | 2e | 14e | 22e | 0 |
| `react-hooks/exhaustive-deps` | 8 | 0 | 8 | 8w | — | — | 0 |
| `@next/next/no-img-element` | 7 | 0 | 7 | 7w | — | — | 0 |
| `react-hooks/refs` | 6 | 6 | 0 | 6e | — | — | 0 |
| `@typescript-eslint/no-unused-expressions` | 4 | 0 | 4 | — | 4w | — | 0 |
| `prefer-const` | 4 | 4 | 0 | 3e | 1e | — | **4** |
| unused `eslint-disable` directive (ruleId `null`) | 4 | 0 | 4 | 4w | — | — | **4** |
| `react/no-unescaped-entities` | 4 | 4 | 0 | 4e | — | — | 0 |
| `@next/next/no-location-assign-relative-destination` | 4 | 0 | 4 | 4w | — | — | 0 |
| `@typescript-eslint/no-require-imports` | 3 | 3 | 0 | — | 3e | — | 0 |
| `react-hooks/immutability` | 2 | 2 | 0 | 2e | — | — | 0 |
| **Totals** | **245** | **106** | **139** | **127 (66e/61w)** | **91 (18e/73w)** | **27 (22e/5w)** | **8** |

Ownership in one line: **shipped runtime code 127 findings / 65 files**, **dev tooling 91 / 36 files**, **tests 27 / 2 files**.
`tools/**` (the C1B guard and its frozen baseline) is **0 findings**; `prisma/**` and the root configs are **0 findings**.

## 3. Regression triage — what C1–C4 actually contributed `[Measured]`

Blame was run on **every** flagged line that falls inside a closed boundary:

| Finding set | Attribution | Assessment |
|---|---|---|
| `tests/fixtures/accounting.ts` — 22 × `no-explicit-any` (L69–74, 112–117, 127–128, 138–139, 147, 150, 184, 188, 215, 219) + 4 × `no-unused-vars` (L38, 104, 178, 648) | **all 26 lines blame to `4550d28` (C3)** | **C3-introduced** |
| `tests/accounting/pnl.integration.test.ts` L1389 `'today' is assigned a value but never used` | **blames to `4550d28` (C3)** | **C3-introduced** |
| `src/services/report/report.service.ts` L170 `reportActivityWhere`, L605 `orderFragment` | **`27cb467` (2026-09-10, “feat: add advanced sales reports”)** — ancestor of C4 | **pre-existing** — these are exactly the “2 known warnings” flagged as **C2R-2** in the C2 report |
| everything else (217 findings) | no closed-boundary blame | **pre-existing debt** |

Both C3 files are **pure additions** in `4550d28` (`A` in `git show --name-status`), so the whole 27 is C3-attributed and
the pre-C3 level is **derived** as **84 errors / 134 warnings** (arithmetic, not a measurement — a real baseline would need
a checkout of `4550d28^`, which is out of scope here).

**Consequence to state plainly:** the “0 errors / 2 warnings” figure inherited from C2 in `EXECUTION-STATE.md` was a
**changed-files-scoped** observation, never a repo-wide run. C3's own report contains **no** eslint claim at all. The first
full-repo inventory therefore reveals **22 ESLint errors introduced by C3** — a documentation gap, not a runtime defect.
`tests/fixtures/accounting.ts` is **imported by 6 suites** (5 accounting + `database-connection`), so it is **not** dead
code and any change to it is test-visible.

**Accounting-critical surface is clean of errors:** `src/services/accounting/*` (pnl / cashbook / expense / integrity),
`src/lib/prisma.ts`, `src/lib/database-url.ts`, `tools/preflight-migrations.mjs`, `tests/setup.ts`, and
`tests/accounting/cashbook | revenue | refund-profitability | integrity .integration` + `database-connection` all report
**0 errors and 0 warnings**; the only accounting-adjacent findings are 3 **warnings** (`report.service.ts` ×2 pre-existing,
`pnl.integration.test.ts` ×1 C3). **Accounting-core total errors = 0.**

## 4. Autofix-safe vs manual review `[Measured]`

**Autofix-safe — 8 findings, 8 files, zero behavioural intent change** (still to be applied only under a fix approval):

| File | Line | Rule | Sev |
|---|---|---|---|
| `scripts/phase-h4-4-harness.ts` | 41 | `prefer-const` (`skipped`) | error |
| `src/app/api/admin/purchases/route.ts` | 79 | `prefer-const` (`branchId`) | error |
| `src/services/cashier-sales/cashier-sales.service.ts` | 107 | `prefer-const` (`shiftWhere`) | error |
| `src/services/menu-engineering/menu-engineering.service.ts` | 211 | `prefer-const` (`visibleRows`) | error |
| `src/app/(customer)/menu/page.tsx` | 1178 | unused `eslint-disable` | warning |
| `src/app/admin/reports/inventory/page.tsx` | 125 | unused `eslint-disable` | warning |
| `src/app/admin/reports/purchases/page.tsx` | 121 | unused `eslint-disable` | warning |
| `src/components/admin/product-image-field.tsx` | 115 | unused `eslint-disable` | warning |

**Manual review required — 237 findings**, grouped by root cause:

| Group | Count | Why manual |
|---|---|---|
| **G1** Loose test typing | 22e + 5w | Replacing `any` in a 6-suite-imported fixture changes mock shapes; needs real types **and** a full accounting-suite re-run |
| **G2** React state-in-effect / refs / immutability | 49e + 6e + 2e + 8w | Behavioural React semantics (render-loop risk); must be reviewed per component with browser/UI verification |
| **G3** Unused locals/params (mostly dev tooling) | 112w | Individually trivial, but “unused” is sometimes deliberate (API symmetry, future use, destructuring rest) |
| **G4** `no-explicit-any` in shipped/dev code | 16e (2 shipped, 14 dev) | Needs real types; dev harnesses may legitimately use `any` |
| **G5** `no-require-imports` | 3e | Requires CJS→ESM conversion in `.mjs`/`.ts` harnesses |
| **G6** `no-img-element` / `no-location-assign` / unescaped entities | 15 (7w/4w/4e) | Perf and UX semantics (`next/image` migration, navigation behaviour, user-visible strings) |
| **G7** Unused `eslint-disable` / `prefer-const` | 8 | **autofix-safe** (see table above) |

## 5. Exact proposed files and minimal implementation batches `[Proposed — needs approval]`

Nothing below has been executed. Each batch is independently approvable; each ends with its own verification.

| Batch | Scope | Exact files | Findings | Risk | Verification |
|---|---|---|---|---|---|
| **L1** | Autofix-safe cosmetics | the **8** files in §4 (1 line each) | 8 | **Very low** — `prefer-const` and directive removal only | `eslint` on the 8 paths (expect 0), `tsc`, targeted suites |
| **L2** | **C3-introduced regression cleanup** | `tests/fixtures/accounting.ts`, `tests/accounting/pnl.integration.test.ts` | 27 (22e/5w) | **Medium** — fixture is imported by **6 suites**; typed mocks can shift assertions | **Full accounting suites 111/111 + F-2 live 4/4 + `tsc` + `eslint`** |
| **L3** | Dev tooling hygiene (`scripts/**`, root `.mjs`) | 36 files, led by `scripts/phase-b-harness.ts` (15e/3w), `scripts/runtime-ui-kasir-cash-qris.mjs` (7w), `scripts/e2e-dine-in-payment.mjs` (5w), `scripts/final-regression-kasir-ui.mjs` (5w) | 91 (18e/73w) | **Low** for product, but these are the verification harnesses | `eslint scripts/`, plus each touched harness re-run |
| **L4** | Shipped UI correctness (`react-hooks/**`) | 49×`set-state-in-effect` + 6×`refs` + 2×`immutability` + 8×`exhaustive-deps`; worst: `src/app/admin/costing/page.tsx` (7e), `src/components/admin/product-image-field.tsx` (7e/1w), `src/app/admin/accounting/pnl/page.tsx` (3e), `src/app/(customer)/checkout/page.tsx` (2e/3w), `src/app/admin/accounting/cashbook|expenses/page.tsx` (2e each) | 65 (57e/8w) | **High** — behavioural; can introduce render loops | Per-component review + browser pass + accounting suites |
| **L5** | Shipped misc | `no-img-element` 7w, `no-location-assign` 4w, unescaped entities 4e, `no-unused-vars` 38w, `no-explicit-any` 2e | 55 | **Low–medium** | `eslint src/`, `tsc`, targeted suites |
| **L6** | **Policy decision (not code)** | `eslint.config.mjs` — e.g. relax/scope rules for `scripts/**`, decide whether `react-hooks/set-state-in-effect` should gate CI, add `lint` to a CI gate | 0 | None (config) | Config change + full run; owner decision only |

**Recommended order:** **L1 → L2 → L3 → L4 → L5**, with **L6** decided by the owner at any point (it changes what
“green” means and should not silently swallow real errors). Rationale: L1 is free and shrinks the noise floor; L2 closes
the only **self-inflicted** regression and restores an honest “no new errors from hardening” statement; L3 removes 91
findings from non-shipped code at low risk; L4 is the largest and riskiest block and deserves its own phase; L5 is
cleanup; L6 must be an explicit policy choice, never a way to hide findings.

## 6. Regression risks to guard `[Policy]`

1. **L2 touches the accounting test support layer** — the integrity of **111/111** and **F-2 live 4/4** is the acceptance
   gate; a failure means revert the batch, never weaken an assertion.
2. **L4 can change runtime behaviour** (render loops, stale closures, missing deps) — no autofix; require UI verification,
   and keep Order/Payment/Cashier/QRIS behaviour in scope only if the owner extends scope.
3. **L6 can mask real errors** — any rule relaxation must be justified per path (`scripts/**` only), never repo-wide.
4. **The frozen migration baseline must stay byte-identical** — any batch touching `tools/migration-order.baseline.json`
   or `prisma/migrations/**` is **out of scope by default** (it would invalidate the A4 evidence).
5. **No rule may be silenced with a new `eslint-disable`** as a “fix” — that would recreate the unused-directive class in §4.

## 7. STOP / approval request

**This is a read-only audit. No fix was applied, no config changed, no commit made, nothing pushed, no database contact.**

**Requested next approval — one of:**
* **AP-2C7-L1** — apply the 8 autofix-safe items (8 files, 1 line each), or
* **AP-2C7-L1+L2** — L1 **plus** the C3-introduced test-fixture cleanup with the full 111/111 acceptance gate, or
* **AP-2C7-L1+L2+L3** — also clean the dev-tooling `scripts/**` layer.

L4/L5 should be scheduled as their own phase given the behavioural risk, and L6 is an owner policy decision.
