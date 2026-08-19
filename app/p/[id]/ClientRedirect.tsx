'use client';

import { useEffect } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';

interface ClientRedirectProps {
  targetUrl: string;
  goalTitle?: string;
  goalName?: string;
}

export default function ClientRedirect({ targetUrl, goalTitle, goalName }: ClientRedirectProps) {
  const title = goalTitle || goalName;

  useEffect(() => {
    if (targetUrl) {
      window.location.replace(targetUrl);
    }
  }, [targetUrl]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-8 text-center shadow-2xl space-y-6">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Loader2 className="w-7 h-7 animate-spin" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-white">
            Membuka Halaman Produk...
          </h1>
          {title && (
            <p className="text-sm text-slate-400 line-clamp-1">
              Target: <span className="text-slate-200 font-medium">{title}</span>
            </p>
          )}
          <p className="text-xs text-slate-500">
            Anda sedang dialihkan langsung ke toko resmi di marketplace.
          </p>
        </div>

        <div className="pt-2">
          <a
            href={targetUrl}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-600/20"
          >
            <span>Buka Langsung</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
