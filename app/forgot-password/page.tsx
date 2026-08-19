"use client";

import { AlertCircle, ArrowRight, Mail } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { EntryBrand, EntryStory } from "../components/EntryViews";

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);

    if (error) {
      setErrorMessage(error.message || "Gagal mengirim tautan reset kata sandi.");
      return;
    }
    setSubmitted(true);
    toast.success("Tautan reset kata sandi telah dikirim ke email Anda.");
  }

  return (
    <main className="entry-page">
      <section className="entry-form-side">
        <EntryBrand />
        <div className="entry-form-wrap">
          <span className="entry-kicker">PEMULIHAN AKUN</span>
          <h1>Lupa Kata Sandi?</h1>
          <p>
            Masukkan email yang terdaftar pada akun Douit Anda. Kami akan mengirimkan tautan untuk mengatur ulang kata sandi.
          </p>

          {errorMessage && (
            <div className="flex items-center gap-2.5 p-3.5 mb-4 rounded-xl bg-rose-50 border border-rose-200/70 text-rose-700 text-sm animate-in fade-in slide-in-from-top-1 duration-200">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span className="font-medium">{errorMessage}</span>
            </div>
          )}

          {submitted ? (
            <div style={{ padding: '16px', background: '#ecfdf5', border: '1px solid #10b981', borderRadius: '8px', color: '#047857', fontSize: '14px', lineHeight: 1.5, marginTop: '24px', marginBottom: '24px' }}>
              Tautan reset kata sandi telah dikirim ke <strong>{email}</strong>. Silakan periksa kotak masuk atau folder spam Anda.
            </div>
          ) : (
            <form onSubmit={submit} className="entry-form">
              <label>
                <span>Email</span>
                <div>
                  <Mail size={16} />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setErrorMessage(null);
                      setEmail(event.target.value);
                    }}
                    autoComplete="email"
                    required
                    autoFocus
                  />
                </div>
              </label>
              <button className="entry-primary" disabled={loading}>
                {loading ? "Mengirim Tautan..." : <>Kirim Tautan Reset <ArrowRight size={16} /></>}
              </button>
            </form>
          )}

          <p className="entry-switch">
            Kembali ke <Link href="/login">Masuk</Link>
          </p>
        </div>
      </section>
      <EntryStory />
    </main>
  );
}
