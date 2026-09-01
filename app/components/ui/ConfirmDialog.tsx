"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Trash2, HelpCircle } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | boolean | Promise<void | boolean>;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info" | "emerald";
  confirmClassName?: string;
  isLoading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  variant = "danger",
  confirmClassName,
  isLoading = false,
}: ConfirmDialogProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busy = isLoading || isConfirming;
  const busyRef = useRef(busy);
  const titleId = useId();
  const descriptionId = useId();

  busyRef.current = busy;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => cancelButtonRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [isOpen]);

  const handleConfirm = async () => {
    if (busyRef.current) return;
    setIsConfirming(true);
    try {
      const shouldClose = await onConfirm();
      if (shouldClose !== false) onClose();
    } finally {
      setIsConfirming(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="w-full max-w-md p-6 bg-white rounded-2xl shadow-xl border border-slate-100 animate-in zoom-in-95 duration-200">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-xl shrink-0 ${
            variant === "danger" ? "bg-rose-50 text-rose-600" :
            variant === "warning" ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
          }`}>
            {variant === "danger" ? (
              <Trash2 className="w-5 h-5"/>
            ) : variant === "warning" ? (
              <AlertTriangle className="w-5 h-5"/>
            ) : (
              <HelpCircle className="w-5 h-5"/>
            )}
          </div>
          <div className="space-y-1.5 flex-1">
            <h3 id={titleId} className="text-base font-semibold text-slate-900">{title}</h3>
            <p id={descriptionId} className="text-sm text-slate-500 leading-relaxed">{description}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={
              confirmClassName ||
              "px-5 py-2.5 rounded-xl text-sm font-semibold !text-white text-white bg-gradient-to-r from-[#0F2A1D] to-[#163827] hover:from-[#143827] hover:to-[#1c4732] shadow-sm hover:shadow active:scale-[0.98] transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-800/50"
            }
          >
            <span className="text-white font-semibold">
              {busy ? (confirmLabel.toLocaleLowerCase("id-ID").startsWith("hapus") ? "Menghapus..." : "Memproses...") : confirmLabel}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
