# AUDIT-FIX-GLOBAL-BRANDING-THEME.md

## 1. Executive Summary

The application already has a complete website-branding system (RestaurantSettings →
`resolveBranding()` → `BrandingProvider` → CSS custom properties → Tailwind brand tokens).
The audit found the system is **correct and performant**, but its **application is
incomplete**: only `/menu` and `/t/[...tSegment]` called `applyBranding()`. Every other
customer page (`/cart`, `/checkout`, `/payment/*`, `/order/*`, `/pilih-cabang`, `/`)
relied on client-side navigation to inherit the theme — a **hard refresh on those pages
showed the fallback branding** ("Restoran" + default gray) even though the persisted
restaurant context existed. A handful of customer buttons/chips still used hardcoded
brand-equivalent colors (`bg-gray-900`, `border-black`) instead of the brand tokens.

Fixes: a shared `BrandingSync` component in the customer layout + root page applies the
restaurant branding as soon as the persisted `restaurantId` is known (one fetch per
restaurant per load), the `/api/public/branches` response now carries public-safe
branding so the first screens (`/`, `/pilih-cabang`) are themed, and the hardcoded
brand colors were replaced with `bg-brand-primary`/`border-brand-primary` tokens.

**Admin UI is intentionally left on the neutral shadcn palette** — it is a management
console, not a customer-facing brand surface; semantic status colors (PAID/FAILED/
SOLD OUT/PENDING) are preserved as required.

## 2. Existing Branding Architecture

```
RestaurantSettings (schema.prisma, additive migration 20260908_add_restaurant_branding)
  siteName | logoUrl | primaryColor | secondaryColor | accentColor
        ↓
src/services/branding/branding.service.ts — resolveBranding(restaurantName, settings):
  siteName → settings.siteName || restaurant.name || "Restoran"
  colors   → settings.<color> || BRANDING_DEFAULT_COLORS.<color>
        ↓
API: /api/public/restaurant (branding included), /api/public/tables/lookup (branding),
     /api/public/branches (NOW branding included — this task), /api/admin/settings/branding
        ↓
src/hooks/use-branding.tsx — BrandingProvider + applyBranding():
  validates colors ^#[0-9A-Fa-f]{6}$, computes WCAG contrast foregrounds
  sets CSS vars on <html>: --brand-primary/--brand-secondary/--brand-accent (+foregrounds)
        ↓
globals.css — @theme inline maps:
  bg-brand-primary, text-brand-primary-foreground, bg-brand-secondary, bg-brand-accent, etc.
        ↓
Customer components use Tailwind brand tokens (bg-brand-primary …) — no per-component fetch.
```

No new theme system was created — this task reuses the existing provider/variables/tokens.

## 3. Pages Audited

| Page | Branding applied? | Verdict |
| --- | --- | --- |
| `/` (root redirect/landing) | NO — hardcoded fallback until now | FIXED (BrandingProvider + applyBranding from branches response) |
| `/pilih-cabang` | NO — first screen a first-time customer sees | FIXED (applyBranding from branches response) |
| `/menu` | YES (`applyBranding`) | PASS |
| `/cart` | NO on hard refresh | FIXED (BrandingSync in layout) |
| `/checkout` | NO on hard refresh | FIXED (BrandingSync in layout) |
| `/payment/[orderNumber]` | NO on hard refresh | FIXED (BrandingSync in layout) |
| `/order/[orderNumber]` | NO on hard refresh | FIXED (BrandingSync in layout) |
| `/payment/callback` | NO on hard refresh | FIXED (BrandingSync in layout — covered by layout) |
| `/t/[...tSegment]` | YES (`applyBranding` in TableLanding) | PASS |
| Admin `/dashboard` … `/settings` | Not applicable (neutral shadcn console) | NOT APPLICABLE |

## 4. Components Audited

Customer: header (`CustomerHeader` + `BrandLogo`), auth dialog, promo section,
product card, category chips, filter chips, search, floating cart bar, customization
modal, empty/loading/error states, QR display, branch selector cards.
Admin: sidebar, tables, dialogs, sheets, print bill (already branding-aware per prior
audit), payment dialogs.

## 5. Hardcoded Colors Found

### A. Branding color (fixed → brand tokens)
| Location | Was | Now |
| --- | --- | --- |
| `/checkout` order-type selector (selected) | `border-black bg-gray-50` | `border-brand-primary bg-brand-secondary` |
| `/checkout` "Cek Voucher" button | `bg-gray-900 text-white` | `bg-brand-primary text-brand-primary-foreground` |
| `/checkout` back link hover | `hover:text-black` | `hover:text-brand-primary` |
| `/menu` category chip active ("Semua Kategori") | `bg-gray-900 text-white border-gray-900` | `bg-brand-primary text-brand-primary-foreground border-brand-primary` |
| `/menu` category chip active (per-category) | `bg-gray-900 text-white border-gray-900` | `bg-brand-primary text-brand-primary-foreground border-brand-primary` |
| `/menu` category chip hover | `hover:border-gray-400` | `hover:border-brand-accent` |

### B. Semantic colors (kept — must not be replaced by brand color)
- Payment status: PAID green / FAILED red / PENDING amber (`/payment`, `/order`).
- Stock: SOLD OUT red/amber badges, stock-warning amber.
- Order timeline: green completed steps, gray upcoming.
- Cart badge red count, table-info blue banners (`/cart`, `/checkout`).
- Voucher success green blocks.
- Error/destructive states red.

### C. Neutral UI (kept — Tailwind neutral tokens)
- `bg-gray-50` page background, `bg-white` cards, `text-gray-500` secondary text,
  `border-gray-200` cards, image overlays `bg-black/30|50|70` (readability scrims).

## 6. Logo Audit

- `CustomerHeader` (`BrandLogo`): uses `branding.logoUrl` with broken-image fallback →
  🍽️ emoji. PASS.
- `/t` TableLanding: `logoUrl` shown with onError hide. PASS.
- `/menu` restaurant header: `branding.logoUrl` shown, fallback to site name. PASS.
- Admin print bill: branding logo already supported (prior audit). PASS.
- No page shows a placeholder/hardcoded logo or a broken image. PASS.

## 7. Site Name Audit

- Header: `branding.siteName` (falls back to "Restoran"). After this fix the persisted
  restaurant's real site name is applied on every customer page, including hard refresh.
- `/t` + `/menu`: `branding.siteName || restaurant.name` — PASS.
- No hardcoded restaurant name anywhere in customer UI. PASS.

## 8. Branding Token Usage

All brand surfaces now use the existing Tailwind tokens mapped to the CSS variables:
`bg-brand-primary`, `text-brand-primary`, `text-brand-primary-foreground`,
`bg-brand-secondary`, `bg-brand-secondary-foreground`, `bg-brand-accent`,
`border-brand-primary`, `hover:border-brand-accent`. No duplicate variables or a second
theme system were introduced.

## 9. Customer Pages

| Page | logo | siteName | primary | secondary | accent | buttons/active/hover |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | ✅ (BrandingProvider added) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/pilih-cabang` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/menu` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (chips fixed) |
| `/cart` | ✅ via BrandingSync | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/checkout` | ✅ via BrandingSync | ✅ | ✅ | ✅ | ✅ | ✅ (buttons fixed) |
| `/payment/*` | ✅ via BrandingSync | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/order/*` | ✅ via BrandingSync | ✅ | ✅ | ✅ | ✅ | ✅ |

## 10. Admin Pages

Admin remains on the neutral shadcn design system (dark sidebar, status-colored
badges). This is deliberate: the admin is an operational console, not a branded
customer surface, and the task forbids replacing semantic status colors with brand
colors. Print bill already includes branding (logo/site name/address/phone) without
breaking A4/Thermal layouts (prior audit). → **NOT APPLICABLE** for global admin theming.

## 11. Semantic Colors

Preserved exactly: PAID/COMPLETED → green, FAILED/EXPIRED/CANCELLED → red, PENDING →
amber, SOLD OUT → danger/warning, stock warnings → amber. Brand color never overrides
status meaning.

## 12. Accessibility / Contrast

No change to the contrast algorithm: `getContrastText()` (WCAG relative luminance)
computes foregrounds for each brand color, and `--brand-*-foreground` are set by the
existing provider. The replaced buttons/chips use `text-brand-primary-foreground`
exactly like the rest of the app — same contrast guarantees.

## 13. Dark/Light Compatibility

Branding CSS vars are applied on `<html>` regardless of mode and are overridden at
runtime; neutral shadcn tokens (background/foreground/card) are untouched. The
hardcoded `bg-gray-900 text-white` chips (light-only look) were replaced with
contrast-correct brand tokens that work in both modes.

## 14. Branch Compatibility

Branding remains **restaurant-level**: `resolveBranding` reads `RestaurantSettings`
(unique per restaurantId); the branches endpoint returns the restaurant's branding
once, not per branch. All branches of a restaurant share the same theme — no
branch-specific branding introduced (consistent with schema design).

## 15. Security

- `restaurantId` always comes from the server/session; public endpoints only read
  `isActive` restaurants.
- `/api/public/branches` now returns only public-safe branding fields
  (siteName/logoUrl/colors) — never internal IDs, secrets, credentials, or settings
  rows.
- `BrandingSync` fetches `/public/restaurant?id=` which is already rate-limited and
  tenant-filtered; it never sends or trusts client-provided branding values beyond the
  validated server response.
- No new endpoint was opened; no secrets exposed.

## 16. Performance

- `BrandingSync` fetches at most **once per restaurant per page load** (module-level
  `Set` keeps client-side navigation from refetching) and applies through the single
  shared context — one fetch → many consumers.
- `/public/branches` is already fetched by `/` and `/pilih-cabang`; adding branding to
  that same response costs zero extra requests.
- No per-ProductCard / per-Button branding fetch exists or was added.

## 17. Files Changed

| File | Change |
| --- | --- |
| `src/components/customer/branding-sync.tsx` | **NEW** — shared effect: fetch `/public/restaurant?id=` once per restaurant, `applyBranding()`. |
| `src/app/(customer)/layout.tsx` | Render `<BrandingSync />` inside providers. |
| `src/app/page.tsx` | Wrap root in `BrandingProvider`; apply branding from `/public/branches` response. |
| `src/app/(customer)/pilih-cabang/page.tsx` | Apply branding from `/public/branches` response (+ dep fix). |
| `src/app/api/public/branches/route.ts` | Return restaurant `name` + public-safe `branding` (resolveBranding). |
| `src/app/(customer)/checkout/page.tsx` | 3 hardcoded brand colors → brand tokens. |
| `src/app/(customer)/menu/page.tsx` | Category chip active/hover states → brand tokens. |

## 18. Test Matrix

| Test | Expected | Status |
| --- | --- | --- |
| Hard refresh `/` with saved branch | Landing themed (brand primary button) | ✅ code-traced |
| First visit `/pilih-cabang` | Header logo/siteName + brand colors | ✅ code-traced |
| `/menu` after branch pick | Branding applied (existing) + header | ✅ unchanged |
| Hard refresh `/cart` | Brand tokens resolve to restaurant colors | ✅ BrandingSync |
| Hard refresh `/checkout` | Same + fixed order-type/voucher buttons | ✅ BrandingSync + token fix |
| Hard refresh `/payment/[orderNumber]` | Themed (PAID/FAILED semantic colors kept) | ✅ BrandingSync |
| Hard refresh `/order/[orderNumber]` | Themed | ✅ BrandingSync |
| `/t/{branchCode}/{number}` | Branding applied (existing) | ✅ unchanged |
| Menu category chip selected | `bg-brand-primary` + contrast foreground | ✅ fixed |
| Checkout order-type selected | `border-brand-primary bg-brand-secondary` | ✅ fixed |
| Checkout "Cek Voucher" | `bg-brand-primary` + contrast foreground | ✅ fixed |
| PAID/FAILED/SOLD OUT semantics | Unchanged (green/red/amber) | ✅ preserved |
| Admin console | Neutral palette, no brand override | ✅ NOT APPLICABLE (intended) |
| Branding update → refresh customer | New colors without rebuild | ✅ CSS vars runtime-set |

## 19. Regression Test

- Branch filtering/authorization — untouched.
- Customer branch selection — untouched (only added branding to existing response).
- Stock SOLD OUT / deduction — untouched.
- Kasir CASH / QRIS / Repayment — untouched (admin side).
- Payment webhook/polling — untouched.
- Print Bill — untouched (branding already supported).
- Manual Order, product customization, promo, recommendation — untouched.
- Product image / upload / tenant isolation — untouched.
- `/t` QR + legacy `/t/{number}` — untouched.
- Port 3000 untouched; production stays `next start -p 3001`.

## 20. TypeScript

`npx tsc --noEmit` — **PASS** (exit 0).

## 21. Build

`npm run build` — **PASS** (exit 0, all routes compiled).

## 22. Lint

Changed files linted. **0 new errors/warnings** introduced:
- New `branding-sync.tsx`, `pilih-cabang` (after dep fix), `branches/route.ts`: clean.
- Pre-existing baseline issues remain untouched and documented: `page.tsx:41/43`
  setState-in-effect, `menu/page.tsx:216` setState-in-effect + unused `restaurantId`
  + exhaustive-deps, `checkout/page.tsx:146/249` setState-in-effect + missing deps
  (verified identical via `git stash` baseline comparison).

## 23. Remaining Risks

1. Runtime e2e not executed (local DB & 3001 server inactive) — verification is
   code-trace + tsc/build, consistent with prior audits.
2. `BrandingSync` fires one `/public/restaurant` fetch per restaurant per hard load on
   pages that also fetch it themselves (`/menu`) — bounded and idempotent (module Set),
   but `/menu` may issue a duplicate parallel fetch; harmless (rate limit 240/min).
3. Admin stays neutral by design — if a future requirement wants brand-colored admin
   accents, it must be scoped to non-semantic surfaces only.

## 24. Final Verdict

**FIXED.** The branding system existed and was correct; the gap was application
coverage + a handful of hardcoded brand-equivalent colors. All customer pages now apply
the restaurant's theme (logo, site name, colors) on both navigation and hard refresh,
the first screens (`/`, `/pilih-cabang`) are themed from the branches response, and the
remaining hardcoded brand colors use the existing tokens. No duplicate theme system, no
semantic-color changes, no admin rebrand, no schema/DB change, no payment/stock/branch
regressions.