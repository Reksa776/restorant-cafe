import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { APP_NAME, TRIAL_CTA } from "./landing-data";

const NAV_LINKS = [
  { href: "#fitur", label: "Fitur Unggulan" },
  { href: "#cara-kerja", label: "Cara Kerja" },
  { href: "#harga", label: "Harga Paket" },
  { href: "#faq", label: "FAQ" },
];

/**
 * Sticky marketing navbar.
 *
 * Intentionally a SERVER component (no mobile drawer JS): the anchor links are
 * hidden on small screens and only the two action buttons remain.
 */
export default function LandingNavbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-900 text-white">
            <UtensilsCrossed className="h-5 w-5" />
          </span>
          <span className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-lg">
            {APP_NAME}
          </span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="rounded-full px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            Masuk
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
          >
            <span className="hidden sm:inline">{TRIAL_CTA}</span>
            <span className="sm:hidden">Coba Gratis</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
