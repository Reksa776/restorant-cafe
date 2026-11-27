"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import AuthSplitLayout, { AuthField } from "@/components/auth/auth-split-layout";
import { toast } from "sonner";

// Seeded demo account (prisma/seed.ts). The hint can be disabled per
// deployment with NEXT_PUBLIC_ENABLE_DEMO_HINT="false".
const DEMO_HINT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_HINT !== "false";
const DEMO_EMAIL = "admin@restobahagia.com";
const DEMO_PASSWORD = "admin123";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);
  const router = useRouter();

  // Merchant onboarding hands off here with ?registered=1&email=… — show the
  // success banner once and prefill the email the owner just registered with.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get("email");
    // Defer the updates so they are not synchronous setState calls in the
    // effect body (same pattern used by the menu/branch pages).
    const timer = setTimeout(() => {
      if (params.get("registered") === "1") setJustRegistered(true);
      if (emailParam) setEmail(emailParam);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        toast.error("Email atau password salah");
      } else {
        toast.success("Login berhasil");
        router.push("/admin/dashboard");
      }
    } catch {
      toast.error("Terjadi kesalahan");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthSplitLayout
      switchPrompt="Belum punya akun?"
      switchCta="Daftar Gratis"
      switchHref="/register"
    >
      <div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          Portal Admin &amp; Kasir
        </span>

        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">
          Selamat Datang Kembali
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Masuk ke dashboard kasir &amp; kelola operasional kafe Anda.
        </p>

        {justRegistered && (
          <div
            role="status"
            aria-live="polite"
            className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3.5"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-semibold text-emerald-900">
                Pendaftaran berhasil!
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-emerald-800">
                Silakan masuk menggunakan akun yang baru Anda buat.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <AuthField
              id="email"
              icon={Mail}
              type="email"
              placeholder="nama@kafeanda.id"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <AuthField
              id="password"
              icon={Lock}
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={
                    showPassword ? "Sembunyikan password" : "Tampilkan password"
                  }
                  aria-pressed={showPassword}
                  className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              }
            />
            <p className="text-[11px] leading-relaxed text-slate-400">
              Lupa password? Hubungi admin outlet Anda — reset akun dilakukan
              oleh pemilik toko demi keamanan data.
            </p>
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Memproses…
              </>
            ) : (
              "Masuk"
            )}
          </Button>
        </form>

        {DEMO_HINT_ENABLED && (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-3.5">
            <div className="flex items-start gap-2.5">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-700">
                  Ingin mencoba tanpa mengetik?
                </p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">
                  {DEMO_EMAIL} · {DEMO_PASSWORD}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setEmail(DEMO_EMAIL);
                setPassword(DEMO_PASSWORD);
                setShowPassword(false);
                toast.success("Akun demo terisi. Klik Masuk.");
              }}
              className="mt-2.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-emerald-400 hover:text-emerald-700"
            >
              Isi Akun Demo ({DEMO_EMAIL})
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-400">
          Dengan masuk, Anda menyetujui penggunaan data operasional toko sesuai
          kebijakan privasi platform.
        </p>
      </div>
    </AuthSplitLayout>
  );
}
