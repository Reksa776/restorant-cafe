import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import {
  APP_NAME,
  DEMO_STORE_PATH,
  EXAMPLE_STOREFRONT,
  ROOT_DOMAIN,
  TRIAL_LABEL,
} from "./landing-data";

const PRODUCT_LINKS = [
  { href: "#fitur", label: "Fitur Unggulan" },
  { href: "#cara-kerja", label: "Cara Kerja" },
  { href: "#harga", label: "Harga Paket" },
  { href: "#faq", label: "FAQ" },
];

const ACCOUNT_LINKS = [
  { href: "/register", label: "Daftar Gratis" },
  { href: "/login", label: "Masuk" },
  { href: DEMO_STORE_PATH, label: "Lihat Demo Toko" },
];

/** Marketing footer with the required quick links. */
export default function LandingFooter() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950 text-slate-400">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-slate-900">
                <UtensilsCrossed className="h-5 w-5" />
              </span>
              <span className="text-base font-bold text-white">{APP_NAME}</span>
            </div>
            <p className="mt-3 max-w-sm text-sm leading-relaxed">
              Platform POS &amp; operasional restoran multi-cabang: kasir, QR
              order meja, pembayaran QRIS, resep &amp; HPP, sampai laporan laba
              rugi. {TRIAL_LABEL} untuk setiap akun baru.
            </p>
            <p className="mt-3 text-xs text-slate-500">
              Toko online resto Anda:{" "}
              <span className="font-mono text-slate-400">
                {EXAMPLE_STOREFRONT}
              </span>
            </p>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Produk
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="transition-colors hover:text-white"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Akun
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              {ACCOUNT_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="transition-colors hover:text-white"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-slate-800 pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {APP_NAME}. Semua hak dilindungi.
          </p>
          <p className="text-slate-500">
            Subdomain merchant:{" "}
            <span className="font-mono">&lt;namakafe&gt;.{ROOT_DOMAIN}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
