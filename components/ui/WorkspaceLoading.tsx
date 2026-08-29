"use client";

import React from "react";
import { DouitLogo } from "@/app/components/icons/DouitLogo";

export function WorkspaceLoading() {
  return (
    <div className="workspace-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="workspace-loading-glow" aria-hidden="true" />
      <div className="workspace-loading-content">
        <div className="workspace-loading-logo" aria-hidden="true">
          <DouitLogo className="h-full w-full" />
        </div>
        <h2>Menyiapkan keuanganmu...</h2>
        <p>Memuat transaksi, rekening, dan target tabunganmu dengan aman.</p>
        <div className="workspace-loading-progress" aria-hidden="true">
          <div className="animate-progress" />
        </div>
      </div>
    </div>
  );
}

export default WorkspaceLoading;
