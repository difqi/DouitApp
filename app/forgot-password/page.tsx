"use client";

import { AlertCircle, ArrowRight, CheckCircle2, Mail } from "lucide-react";
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
          <span className="entry-kicker">Pulihkan aksesmu</span>
          <h1>Lupa kata sandi?</h1>
          <p>Masukkan email akun Douit-mu. Kami akan mengirim tautan aman untuk membuat kata sandi baru.</p>

          {errorMessage && (
            <div className="entry-status entry-status--error" role="alert">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {submitted ? (
            <div className="entry-status entry-status--success entry-status--prominent" role="status">
              <CheckCircle2 size={18} />
              <span>Tautan sudah dikirim ke <strong>{email}</strong>. Periksa kotak masuk atau folder spam-mu.</span>
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
        <span className="entry-legal">Tautan pemulihan hanya dikirim ke email yang terhubung dengan akun Douit.</span>
      </section>
      <EntryStory />
    </main>
  );
}
