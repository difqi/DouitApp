"use client";

import { AlertCircle, ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { EntryBrand, EntryStory } from "../components/EntryViews";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);

    if (password !== confirmation) {
      setErrorMessage("Kata sandi baru tidak cocok dengan konfirmasi kata sandi.");
      return;
    }
    if (password.length < 6) {
      setErrorMessage("Kata sandi harus minimal 6 karakter.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    
    setLoading(false);

    if (error) {
      setErrorMessage(error.message || "Gagal memperbarui kata sandi.");
      return;
    }

    toast.success("Kata sandi berhasil diperbarui!");
    // On success, redirects the user back to the Login page with a confirmation message
    router.push('/login?message=Kata sandi berhasil diperbarui');
  }

  return (
    <main className="entry-page">
      <section className="entry-form-side">
        <EntryBrand />
        <div className="entry-form-wrap">
          <span className="entry-kicker">Amankan akunmu</span>
          <h1>Buat kata sandi baru</h1>
          <p>Pilih kata sandi baru agar akun dan data keuanganmu tetap terlindungi.</p>

          {errorMessage && (
            <div className="entry-status entry-status--error" role="alert">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={submit} className="entry-form">
            <label>
              <span>Kata Sandi Baru</span>
              <div className="relative">
                <LockKeyhole size={16} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => {
                    setErrorMessage(null);
                    setPassword(event.target.value);
                  }}
                  autoComplete="new-password"
                  minLength={6}
                  required
                  autoFocus
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowPassword((prev) => !prev);
                  }}
                  className="entry-password-toggle"
                  tabIndex={-1}
                  aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>
            <label>
              <span>Konfirmasi Kata Sandi Baru</span>
              <div className="relative">
                <LockKeyhole size={16} />
                <input
                  type={showConfirmation ? "text" : "password"}
                  value={confirmation}
                  onChange={(event) => {
                    setErrorMessage(null);
                    setConfirmation(event.target.value);
                  }}
                  autoComplete="new-password"
                  minLength={6}
                  required
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowConfirmation((prev) => !prev);
                  }}
                  className="entry-password-toggle"
                  tabIndex={-1}
                  aria-label={showConfirmation ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                >
                  {showConfirmation ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>
            <button className="entry-primary" disabled={loading || !password || !confirmation}>
              {loading ? "Menyimpan..." : <>Simpan Kata Sandi Baru <ArrowRight size={16} /></>}
            </button>
          </form>
        </div>
        <span className="entry-legal">Kata sandi baru akan melindungi akses ke seluruh data keuanganmu di Douit.</span>
      </section>
      <EntryStory />
    </main>
  );
}
