# STEP 2C.7 — FULL CODE QUALITY & LINT RESOLUTION — EXECUTION

**Subphase of 2C.7 · mode: FULL IMPLEMENTATION ATTEMPT (AP-2C7-FULL) · RESULT: BLOCKED BEFORE FIRST EDIT**

| | |
|---|---|
| Date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| HEAD (unchanged) | `4729a43ec09dc28d8425a5dfcbd713e1ebff24a8` |
| Branch / index / stash | `main` · **0** · **0** |
| Toolchain | ESLint **9.39.5** + `eslint-config-next` (Next 16 preset) · `eslint-plugin-react-hooks` **7.1.1** · node v24.21.0 |
| Verdict | ❌ **STEP 2C.7 BLOCKED — NO COMMIT** |

> **What happened.** Before making any edit, the full inventory was classified against the §4 engineering rules and the
> §5 protected-functionality list. **49 of the 245 findings cannot be resolved within those rules**: they are
> `react-hooks/set-state-in-effect` errors raised by the framework preset against the app's *existing* data-loading
> architecture. Per §4/§8 (“jangan melakukan workaround palsu … STOP dan laporkan blocker sebenarnya”) **no source file was
> modified and no commit was made**, so the verified STEP 2C.6 state is preserved exactly.
>
> **Scope honoured.** No `eslint --fix`, no rule disabled/downgraded, **no config change**, no `@ts-ignore`/`@ts-nocheck`,
> no new `any`, no test/assertion/functionality removed, no exclusion of files, **no `reset`/`restore`/`clean`/`stash`**, no
> schema/migration/dependency/production-config change, no push, no deploy, no STEP 2C.8/2C.9.

---

## 1. Baseline `[Measured]`

HEAD `4729a43`, branch `main`, index **0**, stash **0** — matches the expected baseline exactly.
Repo-wide `npx eslint . -f json`: **534 files · 106 errors · 139 warnings · 245 findings · 8 autofixable** (`eslint` exit **1**).
`npx tsc --noEmit` **exit 0**. Ownership: `src/**` **127** (65 files) · `scripts/**` **91** (36) · `tests/**` **27** (2);
`tools/**`, `prisma/**`, root configs **0**. C3-attributed findings **27** (2 added test files). Accounting core **0 errors,
3 warnings**.

**Worktree safety (§2) `[Measured]`:** **11** entries inventoried and preserved — 6 HELD (`.env.example`, 4 ×
`HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md`), 2 EXCLUDE (`next-env.d.ts`, `…GUARD-IMPLEMENTATION.md.kate-swp`), 3
uncommitted docs (`STEP-2C-7-LINT-READINESS.md`, `ROADMAP.md`, `EXECUTION-STATE.md`). All 8 HELD/EXCLUDE confirmed present;
migration history untouched (22 dirs, `prisma/` + `tools/migration-order.baseline.json` clean).

## 2. Exact files changed

**NONE.** Zero source, test, script, config, schema or migration files were modified. Proof `[Measured]`:
`git status --porcelain -uall` for `src`, `tests`, `scripts`, `prisma`, `tools`, `package.json`, `package-lock.json`,
`eslint.config.mjs`, `tsconfig.json`, `next.config.ts` → **identical to HEAD** (0 entries each). The only writes in this
session are this report and the two tracking-doc updates.

## 3. Root-cause analysis (which class is fixable, and why one is not)

| Class | Findings | Files | Verdict |
|---|---|---|---|
| `no-unused-vars` (112w), `no-explicit-any` (38e), `no-require-imports` (3e), `no-unused-expressions` (4w), `prefer-const` (4e), unused `eslint-disable` (4w), `no-img-element` (7w), `no-location-assign…` (4w), `react/no-unescaped-entities` (4e) | **180** | 82 | ✅ fixable within constraints (root-cause edits, no behaviour change) |
| `react-hooks/refs` (6e), `react-hooks/immutability` (2e), `react-hooks/exhaustive-deps` (8w) | **16** | 8 | ⚠️ fixable **with per-site behaviour review** (dependency/ref changes can alter timing) |
| **`react-hooks/set-state-in-effect` (49e)** | **49** | **42** | ❌ **BLOCKED — requires behaviour or architecture change** |

**Why the 49 are blocked (concrete evidence).** The rule is an **error** in the Next 16 preset
(`eslint --print-config` → `react-hooks/set-state-in-effect = [2]`), from `eslint-plugin-react-hooks@7.1.1`. Every site is
the same pattern: an effect that calls a loader which synchronously sets state. Representative,
`src/app/admin/reports/inventory/page.tsx`:

```tsx
const loadReport = useCallback(async (silent = false) => {
  if (!silent) setIsLoading(true);   // ← synchronous setState on the effect path
  setError(null);                    // ← also synchronous
  try { … setReport(data) } finally { setIsLoading(false) }
}, [period, …]);

useEffect(() => { if (branchCtxLoading) return; loadReport(true); … }, [period, …]);
```

To satisfy the rule the synchronous state writes must leave the effect path, which means either:
1. **Behaviour change** — drop the eager `setError(null)`/`setIsLoading(true)` or defer them past an `await`: the spinner
   and error-clearing timing on filter/period/branch changes change, and the previous data/error can stay on screen for an
   extra frame. That is user-visible behaviour drift across 42 pages, and equivalence cannot be verified here: the repo has
   **no component test harness** — no `vitest`/`jest`/`@testing-library` dependency, no test-runner config, no `test`
   script — and although there are **34** `node:test` files, **none renders React** (`react-dom`/`render()` appear in zero
   of them); the only browser-level assets are **59** ad-hoc Puppeteer `.mjs` scripts (**25** `e2e-*`, **6** UI/browser)
   plus **13** `.ts` harnesses covering selected flows, not 42 pages; or
2. **Architecture change** — move fetching out of effects (Server Components / SWR / TanStack Query) across ~40 admin and
   customer pages, i.e. new data-fetching infrastructure or a new dependency; explicitly outside §3/§5 (“no new engine”,
   no dependency change); or
3. **Suppression / config scoping** — forbidden by §4 (no rule disable, no severity downgrade, no file exclusion, no
   config change “agar findings tidak terdeteksi”).

**These are pre-existing, not hardening regressions `[Measured]`:** blame on all **49** sites →
**0** introduced by C1/C1B/C2/C3/C4 or the documentation commit; commit dates span **2026-09-02 → 2026-10-10**. They also
sit entirely in the presentation layer: **0 in `src/services/**`, 0 in `tests/**`** (11 in accounting/costing report pages,
38 in other pages/components) — no accounting calculation, service or suite is affected.

## 4. L1–L5 status

All batches: **not applied** (single blocker, no partial work — a partial refactor could not be committed under §9 and
would leave 82–100 unverified files in the tree).

| Batch | Scope | Findings | Status |
|---|---|---|---|
| L1 | autofix-safe (`prefer-const` ×4, unused `eslint-disable` ×4) | 8 | not applied — fixable |
| L2 | C3-introduced test typing (`tests/fixtures/accounting.ts`, `pnl.integration.test.ts`) | 27 | not applied — fixable (test-only, behaviour preserved) |
| L3 | dev tooling `scripts/**` (+ `no-require-imports`) | 91 | not applied — fixable, **migration/db/credential/diagnostic/preflight code excluded by design** |
| L4 | shipped `src/**` = 62 fixable + 16 review + **49 blocked** | 127 | **blocked** |
| L5 | remaining repo-wide | 180 | not applied — fixable |

## 5. Before/after comparison

| Metric | Before | After |
|---|---|---|
| Files linted | 534 | **534** |
| Errors / warnings | **106 / 139** | **106 / 139** |
| `eslint` exit | **1** | **1** |

No improvement is claimed: not a single finding was changed, because the acceptance criterion (0/0) is unreachable within
§4–§5 and a partial result would be un-committable.

## 6. Test commands and actual exit codes `[Measured]`

| Command | Exit |
|---|---|
| `npx eslint .` | **1** (106 errors, 139 warnings) |
| `npx tsc --noEmit` | **0** |
| `npm run db:preflight` | **0** (PASS 22/22) |
| `git diff --check` / `git diff --cached --check` | **0** / **0** |

**Database tests were deliberately not run.** There is no implementation to verify, and the blocker halts execution before
the verification phase; §7 forbids the “no database contact / no migration” boundary being crossed without a code change to
justify it. Consequently **no accounting/DB result is claimed here** — the 111/111, F-2 4/4 and M2 78/78 figures belong to
earlier phases and are **not re-claimed**.

## 7. Regression verification

The strongest available evidence, since nothing changed: **the source tree is byte-identical to the verified HEAD**
(`git status` empty for `src`, `tests`, `scripts`, `prisma`, `tools`, `package.json`, `package-lock.json`,
`eslint.config.mjs`, `tsconfig.json`, `next.config.ts`). Therefore **no regression is possible** and no protected
functionality (Orders, Payment, Cashier, QRIS, Refund, Reservation, WhatsApp, tenant isolation, accounting calculations,
revenue recognition, migrations) was touched.

## 8. Commit manifest and hash

**No commit was made.** Acceptance requires repo-wide **0 errors / 0 warnings**; the repo is at **106/139**. Manifest is
therefore empty, index and stash are empty, HEAD is still `4729a43`, and nothing was staged (no `git add .`/`-A` was used —
staging never started).

## 9. Remaining limitations

1. All **245** findings remain, **49** of them hard-blocked by the framework-preset rule versus the app's architecture.
2. **196 findings (180 fixable + 16 review) are ready to execute** but must be approved as a coherent change set, since
   §9 forbids committing while any finding remains.
3. The repository has **no component-level test harness**, which is precisely why the blocked class cannot be proven
   behaviour-equivalent. Adding one is a prerequisite for any future React-lifecycle refactor.
4. `react-hooks/set-state-in-effect`, `refs` and `immutability` are **React-Compiler-era rules** newly enforced by the
   Next 16 preset; the app predates them. Resolving them is an **architecture programme**, not lint cleanup.
5. The 3 tracking docs + this report remain **uncommitted by design** (pending documentation commit).

## 10. Final verdict and decision paths

**STEP 2C.7 BLOCKED — NO COMMIT**

To proceed, one owner decision is required (these are alternatives, not sequential sub-approvals):

* **Path A — Architecture phase (recommended for a true 0/0).** Open a dedicated phase to migrate the ~40 effect-driven
  data loaders to a supported pattern (Server Components or one agreed data-fetching library), with a component test
  harness added first. This is the only route that reaches 0/0 without behaviour drift or suppression.
* **Path B — Owner lint-policy decision.** The owner explicitly scopes the React-Compiler hook rules (e.g. warnings for
  `set-state-in-effect` pending the architecture phase, or a documented `scripts/**`+legacy-UI boundary) in
  `eslint.config.mjs`. §4 forbids *me* doing this silently; it is legitimate only as an explicit owner ruling.
* **Path C — Partial cleanup now.** Approve execution of the **196** fixable/review findings (L1+L2+L3 + the 62 fixable
  src findings) while the 49 remain a documented, owner-accepted exception; lint would then be **49 errors / 0 warnings**,
  not 0/0, so the §9 commit gate would have to be explicitly amended by the owner.

No push, no deploy, no production migration, no STEP 2C.8/2C.9. STEP 2C.6 remains closed and intact.
