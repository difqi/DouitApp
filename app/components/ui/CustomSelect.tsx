"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, X } from "lucide-react";

export interface Option {
  value: string;
  label: string;
  icon?: React.ReactNode;
  color?: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  label?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
  name?: string;
  variant?: "default" | "dark-emerald";
  icon?: React.ReactNode;
  responsiveOverlay?: boolean;
  selectionTitle?: string;
}

const getPopoverStyle = (trigger: HTMLButtonElement): React.CSSProperties => {
  const rect = trigger.getBoundingClientRect();
  const viewportPadding = 12;
  const width = Math.min(Math.max(rect.width, 220), window.innerWidth - viewportPadding * 2);
  const left = Math.min(
    Math.max(rect.left, viewportPadding),
    window.innerWidth - width - viewportPadding,
  );
  const spaceBelow = window.innerHeight - rect.bottom;
  const opensUpward = spaceBelow < 250 && rect.top > spaceBelow;

  return {
    position: "fixed",
    left,
    width,
    ...(opensUpward
      ? { bottom: window.innerHeight - rect.top + 6 }
      : { top: rect.bottom + 6 }),
  };
};

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Pilih opsi...",
  label,
  className = "",
  buttonClassName = "",
  menuClassName = "",
  disabled = false,
  name,
  variant = "default",
  icon,
  responsiveOverlay = false,
  selectionTitle = "Pilih opsi",
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobileSheet, setIsMobileSheet] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        !overlayRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !responsiveOverlay) return;

    const updateOverlayLayout = () => {
      const trigger = buttonRef.current;
      if (!trigger) return;

      const mobile = window.matchMedia("(max-width: 760px)").matches;
      setIsMobileSheet(mobile);
      if (!mobile) setPopoverStyle(getPopoverStyle(trigger));
    };

    updateOverlayLayout();
    window.addEventListener("resize", updateOverlayLayout);
    window.addEventListener("scroll", updateOverlayLayout, true);
    return () => {
      window.removeEventListener("resize", updateOverlayLayout);
      window.removeEventListener("scroll", updateOverlayLayout, true);
    };
  }, [isOpen, responsiveOverlay]);

  const isDarkEmerald = variant === "dark-emerald";

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* Hidden input for form submissions if name is supplied */}
      {name && <input type="hidden" name={name} value={value} />}

      {label && (
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (responsiveOverlay && !isOpen) {
            const mobile = window.matchMedia("(max-width: 760px)").matches;
            setIsMobileSheet(mobile);
            if (!mobile && buttonRef.current) setPopoverStyle(getPopoverStyle(buttonRef.current));
          }
          setIsOpen((prev) => !prev);
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full flex items-center justify-between rounded-xl text-sm font-medium shadow-sm transition-all cursor-pointer focus:outline-none ${
          isDarkEmerald
            ? "px-3.5 py-2.5 bg-gradient-to-r from-[#0F2A1D] to-[#163827] hover:from-[#133525] hover:to-[#1a4430] border border-white/10 text-white focus:ring-2 focus:ring-emerald-500/30"
            : "px-3.5 py-2.5 bg-white border border-slate-200 text-slate-800 hover:border-slate-300 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
        } ${
          disabled ? "opacity-50 cursor-not-allowed bg-slate-50" : ""
        } ${buttonClassName}`}
      >
        <span className="flex items-center gap-2 truncate">
          {icon && <span className="shrink-0 flex items-center">{icon}</span>}
          {selectedOption?.icon && (
            <span className="shrink-0 flex items-center justify-center">
              {selectedOption.icon}
            </span>
          )}
          <span className={`truncate ${
            isDarkEmerald
              ? (!selectedOption ? "text-slate-300/70 font-normal" : "text-white font-medium")
              : (!selectedOption ? "text-slate-400 font-normal" : "text-slate-900")
          }`}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
            isDarkEmerald
              ? (isOpen ? "rotate-180 text-lime-400" : "text-emerald-200/80")
              : (isOpen ? "rotate-180 text-emerald-600" : "text-slate-400")
          }`}
        />
      </button>

      {/* Dropdown Menu (Cream Background + Emerald Hover) */}
      {isOpen && !responsiveOverlay && (
        <div className={`absolute left-0 right-0 min-w-full w-max max-w-xs top-full mt-1.5 z-50 bg-[#FAF9F5] border border-amber-950/10 rounded-2xl p-1.5 shadow-xl shadow-slate-900/10 animate-in fade-in-0 zoom-in-95 duration-150 max-h-60 overflow-y-auto ${menuClassName}`} role="listbox">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors cursor-pointer text-left ${
                  isSelected
                    ? "bg-[#DCF0DE] text-[#0F2A1D] font-semibold"
                    : "text-slate-800 hover:bg-emerald-600/10 hover:text-emerald-950 font-medium"
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  {option.icon && (
                    <span className="shrink-0 flex items-center justify-center">
                      {option.icon}
                    </span>
                  )}
                  <span className="truncate">{option.label}</span>
                </span>
                {isSelected && <Check className="w-4 h-4 text-emerald-700 shrink-0 ml-2" />}
              </button>
            );
          })}
        </div>
      )}

      {isOpen && responsiveOverlay && typeof document !== "undefined" && createPortal(
        isMobileSheet ? (
          <div className="fixed inset-0 z-[200] bg-slate-950/45 backdrop-blur-[2px]" onMouseDown={() => setIsOpen(false)}>
            <div
              ref={overlayRef}
              className="absolute inset-x-0 bottom-0 max-h-[78dvh] overflow-hidden rounded-t-3xl border border-slate-200 bg-[#FAF9F5] shadow-2xl"
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={selectionTitle}
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h3 className="m-0 text-base font-semibold text-slate-900">{selectionTitle}</h3>
                <button type="button" className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" onClick={() => setIsOpen(false)} aria-label="Tutup pilihan">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="max-h-[calc(78dvh-73px)] overflow-y-auto p-3 pb-[max(16px,env(safe-area-inset-bottom))]" role="listbox">
                {options.map((option) => {
                  const isSelected = option.value === value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                      }}
                      className={`flex min-h-12 w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm transition-colors ${
                        isSelected
                          ? "bg-[#DCF0DE] font-semibold text-[#0F2A1D]"
                          : "font-medium text-slate-800 hover:bg-emerald-600/10"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {option.icon && <span className="flex shrink-0 items-center justify-center">{option.icon}</span>}
                        <span className="truncate">{option.label}</span>
                      </span>
                      {isSelected && <Check className="ml-2 h-4 w-4 shrink-0 text-emerald-700" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div
            ref={overlayRef}
            style={popoverStyle}
            className={`z-[200] max-h-60 overflow-y-auto rounded-2xl border border-amber-950/10 bg-[#FAF9F5] p-1.5 shadow-xl shadow-slate-900/10 animate-in fade-in-0 zoom-in-95 duration-150 ${menuClassName}`}
            role="listbox"
          >
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? "bg-[#DCF0DE] font-semibold text-[#0F2A1D]"
                      : "font-medium text-slate-800 hover:bg-emerald-600/10 hover:text-emerald-950"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.icon && <span className="flex shrink-0 items-center justify-center">{option.icon}</span>}
                    <span className="truncate">{option.label}</span>
                  </span>
                  {isSelected && <Check className="ml-2 h-4 w-4 shrink-0 text-emerald-700" />}
                </button>
              );
            })}
          </div>
        ),
        document.body,
      )}
    </div>
  );
}
