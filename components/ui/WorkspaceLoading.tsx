"use client";

import React from "react";
import { DouitLogo } from "@/app/components/icons/DouitLogo";

export function WorkspaceLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#FAF8F5]/80 backdrop-blur-md p-4">
      <div className="w-full max-w-md bg-white border border-emerald-900/10 rounded-3xl p-8 sm:p-10 shadow-2xl shadow-emerald-950/5 relative overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        
        {/* Subtle decorative background gradient blob */}
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-36 h-36 bg-emerald-700/10 rounded-full blur-2xl pointer-events-none" />

        {/* Container Logo Douit (Sesuai dengan Sidebar) */}
        <div className="relative mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0F2A1D] to-[#163827] border border-emerald-800/40 flex items-center justify-center shadow-md p-2.5">
            {/* Logo Asli Douit dari Sidebar */}
            <DouitLogo className="w-full h-full text-[#D6ECD9]" />
          </div>
        </div>

        {/* Title & Subtitle */}
        <div className="space-y-2">
          <h2 className="text-xl sm:text-2xl font-bold text-[#0F2A1D] tracking-tight flex items-center gap-2">
            Menyiapkan ruang kerja...
          </h2>
          <p className="text-sm text-slate-500 font-normal leading-relaxed">
            Memuat data dan sinkronisasi akun Anda dengan aman.
          </p>
        </div>

        {/* Animated Progress Bar */}
        <div className="mt-8">
          <div className="w-full bg-emerald-950/10 h-1.5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#0F2A1D] via-emerald-600 to-[#163827] rounded-full animate-progress" />
          </div>
        </div>

      </div>
    </div>
  );
}

export default WorkspaceLoading;
