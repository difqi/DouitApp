"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

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
}

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
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
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
      {isOpen && (
        <div className={`absolute left-0 right-0 min-w-full w-max max-w-xs top-full mt-1.5 z-50 bg-[#FAF9F5] border border-amber-950/10 rounded-2xl p-1.5 shadow-xl shadow-slate-900/10 animate-in fade-in-0 zoom-in-95 duration-150 max-h-60 overflow-y-auto ${menuClassName}`}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
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
    </div>
  );
}
