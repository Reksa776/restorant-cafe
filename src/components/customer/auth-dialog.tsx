"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useCustomerAuth } from "@/hooks/use-customer-auth";

// ============================================================
// Customer login / register dialog (F3). Used from the menu promo
// section and the customer header. Keeps the staff /login flow
// completely separate — this is a different audience + session.
// ============================================================

type Mode = "login" | "register";

export function CustomerAuthDialog({
  restaurantId,
  open,
  onOpenChange,
  onSuccess,
}: {
  restaurantId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful login/register (e.g. to refresh promos). */
  onSuccess?: () => void;
}) {
  const { login, register } = useCustomerAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurantId) {
      toast.error("Restoran belum dimuat — coba lagi sebentar");
      return;
    }
    setIsSubmitting(true);
    try {
      if (mode === "login") {
        await login(restaurantId, email.trim(), password);
        toast.success("Login berhasil");
      } else {
        await register({
          restaurantId,
          name: name.trim(),
          phone: phone.trim() || undefined,
          email: email.trim(),
          password,
        });
        toast.success("Pendaftaran berhasil");
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.message;
      toast.error(msg || "Gagal — coba lagi");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle className="text-lg">
          {mode === "login" ? "Masuk Akun" : "Daftar Akun"}
        </DialogTitle>

        {/* Mode tabs */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md py-1.5 text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {m === "login" ? "Masuk" : "Daftar"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "register" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nama <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Nama Anda"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nomor WhatsApp{" "}
                  <span className="text-gray-400 font-normal">(opsional)</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="081234567890"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="email@contoh.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "register" ? 6 : undefined}
              placeholder="••••••••"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
          </div>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary/90"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Memproses...
              </>
            ) : mode === "login" ? (
              "Masuk"
            ) : (
              "Daftar"
            )}
          </Button>
        </form>

        <p className="text-center text-xs text-gray-400">
          Akun digunakan untuk mengklaim dan memakai promo.
        </p>
      </DialogContent>
    </Dialog>
  );
}