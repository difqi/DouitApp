"use client";

import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  FileCheck2,
  Globe2,
  Landmark,
  LockKeyhole,
  Mail,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { useDouit } from "../providers/DouitProvider";
import { createClient } from "@/lib/supabase/client";
import { CustomSelect } from "@/app/components/ui/CustomSelect";
import { DouitLogo } from "./icons/DouitLogo";

export function EntryBrand() {
  return (
    <Link href="/" className="inline-flex items-center gap-3 mb-8 no-underline group">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0F2A1D] to-[#163827] border border-emerald-800/40 flex items-center justify-center shadow-sm p-2 transition-transform duration-200 group-hover:scale-105">
        <DouitLogo className="w-full h-full text-[#D6ECD9]" />
      </div>
      <span className="text-xl font-bold tracking-tight text-slate-900 leading-none">
        Douit
      </span>
    </Link>
  );
}

export function LoginView() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { user, loading: sessionLoading } = useDouit();
  const router = useRouter();

  useEffect(() => {
    if (!sessionLoading && user) window.location.replace("/");
    
    // Check for success messages in URL (e.g. from reset password)
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const msg = params.get("message");
      if (msg) setMessage(msg);
    }
  }, [sessionLoading, user]);

  async function submit(event: FormEvent) {
    event.preventDefault(); 
    setErrorMessage(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    setLoading(false);
    if (error) {
      setErrorMessage("Email atau kata sandi yang Anda masukkan salah.");
      return;
    }
    window.location.assign("/");
  }
  
  return (
    <main className="entry-page">
      <section className="entry-form-side">
        <EntryBrand />
        <div className="entry-form-wrap">
          <span className="entry-kicker">Selamat datang kembali</span>
          <h1>Masuk ke Douit</h1>
          <p>Kelola pengeluaran, tabungan, dan tujuan keuanganmu di satu tempat.</p>
          
          {message && (
            <div className="entry-status entry-status--success" role="status">
              <CheckCircle2 size={16} /> {message}
            </div>
          )}

          {errorMessage && (
            <div className="entry-status entry-status--error" role="alert">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

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
                />
              </div>
            </label>
            <label>
              <span>
                Kata sandi <Link href="/forgot-password">Lupa kata sandi?</Link>
              </span>
              <div className="relative">
                <LockKeyhole size={16} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => {
                    setErrorMessage(null);
                    setPassword(event.target.value);
                  }}
                  autoComplete="current-password"
                  minLength={6}
                  required
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
                  {showPassword ? (
                    <EyeOff className="w-4 h-4"/>
                  ) : (
                    <Eye className="w-4 h-4"/>
                  )}
                </button>
              </div>
            </label>
            <button className="entry-primary" disabled={loading || sessionLoading}>
              {loading ? "Sedang masuk..." : sessionLoading ? "Memeriksa sesi..." : <>Masuk <ArrowRight size={16} /></>}
            </button>
          </form>

          <div className="entry-separator">
            <span>atau</span>
          </div>

          <button
            type="button"
            onClick={() => {
              const supabase = createClient();
              supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                  redirectTo: `${window.location.origin}/auth/callback`
                }
              });
            }}
            className="entry-google-button"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Lanjutkan dengan Google
          </button>

          <p className="entry-switch">
            Belum punya akun? <Link href="/signup">Mulai gratis</Link>
          </p>
        </div>
        <span className="entry-legal">Dengan masuk, kamu menyetujui Ketentuan Layanan dan Kebijakan Privasi Douit.</span>
      </section>
      <LoginShowcase />
    </main>
  );
}

export function ForgotPasswordView() {
  const [step, setStep] = useState<"request" | "reset" | "done">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setLoading(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    toast.success("Kode pemulihan telah dikirim ke email Anda.");
    setStep("reset");
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    if (password !== confirmation) {
      setErrorMessage("Konfirmasi kata sandi tidak cocok.");
      return;
    }
    if (password.length < 8) {
      setErrorMessage("Kata sandi minimal 8 karakter.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' });
    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setErrorMessage(updateError.message);
      return;
    }
    toast.success("Kata sandi berhasil diperbarui!");
    setStep("done");
  }

  return (
    <main className="entry-page">
      <section className="entry-form-side">
        <EntryBrand />
        <div className="entry-form-wrap signup">
          <span className="entry-kicker">Pemulihan akun</span>
          <h1>{step === "done" ? "Kata sandi diperbarui" : step === "reset" ? "Masukkan kode pemulihan" : "Atur ulang kata sandi"}</h1>
          <p>{step === "done" ? "Anda sekarang dapat masuk menggunakan kata sandi baru." : step === "reset" ? `Masukkan kode 6 digit yang dikirim ke ${email}, lalu pilih kata sandi baru.` : "Kami akan mengirim kode 6 digit ke email akun Douit Anda."}</p>
          
          {errorMessage && (
            <div className="flex items-center gap-2.5 p-3.5 mb-4 rounded-xl bg-rose-50 border border-rose-200/70 text-rose-700 text-sm animate-in fade-in slide-in-from-top-1 duration-200">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600"/>
              <span className="font-medium">{errorMessage}</span>
            </div>
          )}

          {step === "request" && (
            <form className="entry-form" onSubmit={requestCode}>
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
                {loading ? "Mengirim kode..." : <>Kirim kode pemulihan <ArrowRight size={16} /></>}
              </button>
            </form>
          )}

          {step === "reset" && (
            <form className="entry-form" onSubmit={resetPassword}>
              <label>
                <span>Kode 6 digit</span>
                <div>
                  <BadgeCheck size={16} />
                  <input
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(event) => {
                      setErrorMessage(null);
                      setCode(event.target.value.replace(/\D/g, ""));
                    }}
                    autoComplete="one-time-code"
                    required
                    autoFocus
                  />
                </div>
              </label>
              <label>
                <span>Kata sandi baru</span>
                <div>
                  <LockKeyhole size={16} />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => {
                      setErrorMessage(null);
                      setPassword(event.target.value);
                    }}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </div>
                <small>Minimal 8 karakter</small>
              </label>
              <label>
                <span>Konfirmasi kata sandi</span>
                <div>
                  <LockKeyhole size={16} />
                  <input
                    type="password"
                    value={confirmation}
                    onChange={(event) => {
                      setErrorMessage(null);
                      setConfirmation(event.target.value);
                    }}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </div>
              </label>
              <button className="entry-primary" disabled={loading || code.length !== 6}>
                {loading ? "Memperbarui..." : <>Simpan kata sandi baru <ArrowRight size={16} /></>}
              </button>
              <button
                type="button"
                className="google-button"
                onClick={() => {
                  setStep("request");
                  setCode("");
                  setErrorMessage(null);
                }}
                disabled={loading}
              >
                Kirim ulang kode
              </button>
            </form>
          )}

          {step === "done" && (
            <Link href="/login" className="entry-primary">
              Kembali ke halaman masuk <ArrowRight size={16} />
            </Link>
          )}

          <p className="entry-switch">
            Ingat kata sandi Anda? <Link href="/login">Kembali untuk masuk</Link>
          </p>
        </div>
        <span className="entry-legal">Kode pemulihan hanya berlaku sementara dan tidak pernah disimpan oleh Douit.</span>
      </section>
      <EntryStory />
    </main>
  );
}

export function SignupView() {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [verify, setVerify] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name }
      }
    });
    setLoading(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    toast.success("Kode verifikasi telah dikirim ke email Anda.");
    setVerify(true);
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setLoading(true); 
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: 'signup' });
    setLoading(false);
    if (error) {
      setErrorMessage("Kode OTP salah atau telah kadaluwarsa");
      return;
    }
    toast.success("Pendaftaran berhasil!");
    window.location.assign("/");
  }

  return (
    <main className="entry-page">
      <section className="entry-form-side">
        <EntryBrand />
        <div className="entry-form-wrap signup">
          <span className="entry-kicker">Mulai perjalanan finansialmu</span>
          <h1>{verify ? "Verifikasi emailmu" : "Mulai kelola uangmu"}</h1>
          <p>{verify ? `Masukkan kode 6 digit yang dikirim ke ${email}.` : "Catat transaksi, pahami pengeluaran, dan jaga target tabunganmu bersama Douit."}</p>

          {errorMessage && (
            <div className="entry-status entry-status--error" role="alert">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {verify ? (
            <form onSubmit={verifyCode} className="entry-form">
              <label>
                <span>Kode verifikasi</span>
                <div>
                  <BadgeCheck size={16} />
                  <input
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={otp}
                    onChange={(event) => {
                      setErrorMessage(null);
                      setOtp(event.target.value.replace(/\D/g, ""));
                    }}
                    autoFocus
                    required
                  />
                </div>
              </label>
              <button className="entry-primary" disabled={loading || otp.length !== 6}>
                {loading ? "Memverifikasi..." : <>Verifikasi &amp; lanjutkan <ArrowRight size={16} /></>}
              </button>
            </form>
          ) : (
            <>
              <form onSubmit={submit} className="entry-form">
                <label>
                  <span>Nama lengkap</span>
                  <div>
                    <UserRound size={16} />
                    <input
                      value={name}
                      onChange={(event) => {
                        setErrorMessage(null);
                        setName(event.target.value);
                      }}
                      autoComplete="name"
                      required
                    />
                  </div>
                </label>
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
                    />
                  </div>
                </label>
                <label>
                  <span>Kata sandi</span>
                  <div>
                    <LockKeyhole size={16} />
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => {
                        setErrorMessage(null);
                        setPassword(event.target.value);
                      }}
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </div>
                  <small>Minimal 8 karakter</small>
                </label>
                <button className="entry-primary" disabled={loading}>
                  {loading ? "Menyiapkan akun..." : <>Buat akun gratis <ArrowRight size={16} /></>}
                </button>
              </form>

              <div className="entry-separator">
                <span>atau</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  const supabase = createClient();
                  supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                      redirectTo: `${window.location.origin}/auth/callback`
                    }
                  });
                }}
                className="entry-google-button"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                Lanjutkan dengan Google
              </button>
            </>
          )}

          <p className="entry-switch">
            Sudah punya akun? <Link href="/login">Masuk</Link>
          </p>
        </div>
        <span className="entry-legal">Dengan membuat akun, kamu menyetujui Ketentuan Layanan dan Kebijakan Privasi Douit.</span>
      </section>
      <EntryStory />
    </main>
  );
}

export function EntryStory() { return <LoginShowcase />; }

function LoginShowcase() {
  const insightBars = [32, 46, 39, 58, 51, 76, 65, 88];

  return (
    <aside className="entry-story login-showcase" aria-label="Fitur pengelolaan keuangan pribadi Douit">
      <div className="login-showcase-inner">
        <header className="login-showcase-copy">
          <span><Sparkles size={15} /> Asisten keuangan pribadimu</span>
          <h2>Lebih paham uangmu.<br /><em>Lebih dekat ke tujuanmu.</em></h2>
          <p>Douit membantu mencatat transaksi, memahami pengeluaran, dan menjaga target tabunganmu tetap berjalan.</p>
        </header>

        <div className="login-product-stage" aria-label="Ringkasan fitur Douit">
          <article className="login-insight-card" tabIndex={0} aria-label="Insight pengeluaran bulan ini">
            <header>
              <span><BarChart3 size={14} /> Bulan ini</span>
              <i>Insight</i>
            </header>
            <small>Pengeluaran</small>
            <strong>Rp2.480.000</strong>
            <div className="login-insight-bars" aria-hidden="true">
              {insightBars.map((height, index) => (
                <i key={index}><b style={{ height: `${height}%` }} /></i>
              ))}
            </div>
            <p><Sparkles size={11} /> Makan kategori terbesar</p>
          </article>

          <article className="login-transaction-card" tabIndex={0} aria-label="Transaksi Bank BRI yang otomatis tercatat dari email">
            <div className="login-transaction-heading">
              <span className="login-mail-icon"><Mail size={17} /></span>
              <div>
                <small>Email transaksi</small>
                <strong>Otomatis tercatat</strong>
              </div>
              <span className="login-approved-pill"><CheckCircle2 size={12} /> Disetujui</span>
            </div>

            <div className="login-transaction-detail">
              <span className="login-bank-icon"><Landmark size={17} /></span>
              <div>
                <strong>Bank BRI</strong>
                <small>via Email Bank</small>
              </div>
              <strong>−Rp48.000</strong>
            </div>

            <footer>
              <span>Makanan</span>
              <small>Hari ini · 10.42 WIB</small>
            </footer>
          </article>

          <article className="login-saving-card" tabIndex={0} aria-label="Saving Assistant untuk target tabungan Laptop baru">
            <header>
              <span><Sparkles size={14} /> Saving Assistant</span>
              <i>On track</i>
            </header>
            <div className="login-saving-title">
              <div>
                <small>Target tabungan</small>
                <strong>Laptop baru</strong>
              </div>
              <b>52%</b>
            </div>
            <div className="login-saving-amounts">
              <span><b>Rp4,2 jt</b> terkumpul</span>
              <span>dari Rp8 jt</span>
            </div>
            <div className="login-saving-progress"><i /></div>
            <p><CheckCircle2 size={12} /> Cukup sisihkan Rp32rb/hari</p>
          </article>
        </div>

        <div className="login-feature-signals">
          <span><Mail size={15} /> Otomatis dari email</span>
          <span><BarChart3 size={15} /> Insight keuangan</span>
          <span><WalletCards size={15} /> Saving Assistant</span>
        </div>
      </div>
    </aside>
  );
}

export function OnboardingView() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [currency, setCurrency] = useState("IDR");
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("Agensi kreatif");
  const [teamSize, setTeamSize] = useState("2–10 orang");
  const [country, setCountry] = useState("Indonesia");
  const [paymentTerm, setPaymentTerm] = useState("14 hari");
  const [tax, setTax] = useState("PPN 10%");
  const [saving, setSaving] = useState(false);
  const { user, membership, refresh } = useDouit();
  
  async function next() {
    if (step === 1) { setStep(2); return; }
    if (step === 2) {
      if (!user) { router.push("/login"); return; }
      setSaving(true);
      setTimeout(() => {
        setSaving(false); setStep(3);
      }, 800);
      return;
    }
    router.push("/"); 
  }

  const industryOptions = [
    { value: "Agensi kreatif", label: "Agensi kreatif" },
    { value: "Konsultan", label: "Konsultan" },
    { value: "Freelancer", label: "Freelancer" }
  ];

  const teamSizeOptions = [
    { value: "2–10 orang", label: "2–10 orang" },
    { value: "Hanya saya", label: "Hanya saya" },
    { value: "11–50 orang", label: "11–50 orang" }
  ];

  const countryOptions = [
    { value: "Indonesia", label: "Indonesia" }
  ];

  const paymentTermOptions = [
    { value: "14 hari", label: "14 hari" },
    { value: "30 hari", label: "30 hari" }
  ];

  const taxOptions = [
    { value: "PPN 10%", label: "PPN 10%" },
    { value: "Tanpa pajak", label: "Tanpa pajak" }
  ];

  return (
    <main className="onboarding-page">
      <header>
        <EntryBrand />
        <span>Sudah punya akun? <Link href="/login">Masuk</Link></span>
      </header>
      <div className="onboarding-shell">
        <div className="onboarding-progress">
          {[1,2,3].map(n => (
            <div key={n} className={step >= n ? "active" : ""}>
              <span>{step > n ? <Check size={14} /> : n}</span>
              <p>
                <b>{["Profil bisnis","Preferensi","Selesai"][n-1]}</b>
                <small>{["Identitas perusahaan","Mata uang & invoice","Ruang kerja siap"][n-1]}</small>
              </p>
              {n < 3 && <i />}
            </div>
          ))}
        </div>
        <section className="onboarding-card">
          {step === 1 && (
            <>
              <span className="onboarding-icon"><WalletCards size={22} /></span>
              <h1>Ceritakan tentang bisnis Anda</h1>
              <p>Informasi ini akan digunakan pada invoice dan laporan.</p>
              <div className="onboarding-form">
                <label>
                  <span>Nama bisnis</span>
                  <input value={name} onChange={event => setName(event.target.value)} />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Bidang usaha</span>
                  <CustomSelect value={industry} onChange={setIndustry} options={industryOptions} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Ukuran tim</span>
                  <CustomSelect value={teamSize} onChange={setTeamSize} options={teamSizeOptions} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Negara</span>
                  <CustomSelect value={country} onChange={setCountry} options={countryOptions} />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <span className="onboarding-icon"><Globe2 size={22} /></span>
              <h1>Atur preferensi keuangan</h1>
              <p>Anda dapat mengubah pengaturan ini kapan saja.</p>
              <div className="currency-options">
                {[
                  { id: "IDR", name: "Rupiah Indonesia", symbol: "Rp" },
                  { id: "USD", name: "US Dollar", symbol: "$" },
                  { id: "SGD", name: "Singapore Dollar", symbol: "S$" }
                ].map(item => (
                  <button key={item.id} className={currency === item.id ? "active" : ""} onClick={() => setCurrency(item.id)}>
                    <span>{item.symbol}</span>
                    <p>
                      <b>{item.id}</b>
                      <small>{item.name}</small>
                    </p>
                    {currency === item.id && <CheckCircle2 size={18} />}
                  </button>
                ))}
              </div>
              <div className="onboarding-form">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Jangka waktu pembayaran default</span>
                  <CustomSelect value={paymentTerm} onChange={setPaymentTerm} options={paymentTermOptions} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>Pajak default</span>
                  <CustomSelect value={tax} onChange={setTax} options={taxOptions} />
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="onboarding-done">
              <span><CheckCircle2 size={34} /></span>
              <h1>Ruang kerja Anda siap</h1>
              <p>{name} kini siap membuat invoice dan memantau arus kas bersama Douit.</p>
              <div>
                <span><Check size={15} /> Profil bisnis tersimpan</span>
                <span><Check size={15} /> Mata uang {currency} dipilih</span>
                <span><Check size={15} /> Persetujuan AI diaktifkan</span>
              </div>
            </div>
          )}

          <footer>
            <button className="onboarding-back" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1 || saving}>Kembali</button>
            <button className="entry-primary" onClick={next} disabled={saving}>
              {saving ? "Menyiapkan ruang kerja..." : step === 3 ? "Buka dashboard" : "Lanjutkan"}
              <ArrowRight size={16} />
            </button>
          </footer>
        </section>
        <p className="demo-note"><ShieldCheck size={14} /> Data bisnis dilindungi dengan akses berbasis peran.</p>
      </div>
    </main>
  );
}

export function PricingView() {
  return <div style={{ padding: '2rem', textAlign: 'center' }}><h1>Pricing (Mock)</h1><Link href="/" className="entry-primary" style={{ display: 'inline-block', marginTop: '1rem' }}>Kembali ke Home</Link></div>;
}
